"""
Health Data Importer — accepts CSV / ZIP files from Samsung Health,
Health Connect, and generic sources. Auto-detects known formats; falls
back to the user's configured AI provider for unknown column layouts.
AI-generated mappings are saved so the same format is recognised next time.

Two-step flow:
  POST /health-import/analyze   – parse file(s), return preview + session_id
  POST /health-import/commit    – upsert all readings from a session
  DELETE /health-import/session – discard a pending session
"""
import asyncio
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from auth.middleware import require_auth
from database import get_app_db, get_user_db
from lib.ai_client import call_ai

router = APIRouter()

# ── Metric catalogue for AI prompt ───────────────────────────────────────────

METRIC_CATALOG = """
steps               – daily step count (count)
heart_rate_avg      – heart rate (bpm)
bp_systolic         – blood pressure systolic (mmHg)
bp_diastolic        – blood pressure diastolic (mmHg)
spo2                – blood oxygen saturation (%)
weight              – body weight (lb)
body_fat            – body fat percentage (%)
sleep_duration      – total sleep per night (min)
sleep_deep          – deep sleep (min)
sleep_rem           – REM sleep (min)
sleep_light         – light sleep (min)
sleep_awake         – awake during sleep session (min)
calories_burned     – active/total calories burned (kcal)
blood_glucose       – blood glucose (mg/dL)
body_temp           – body temperature (°F)
water_intake        – water consumed (oz)
neck_circumference  – neck measurement (in)
waist_circumference – waist measurement (in)
hip_circumference   – hip measurement (in)
height              – height (in)
""".strip()

# ── Date parsing ──────────────────────────────────────────────────────────────

_DT_FMTS = [
    '%Y.%m.%d %H:%M:%S',
    '%Y-%m-%d %H:%M:%S',
    '%Y/%m/%d %H:%M:%S',
    '%Y-%m-%dT%H:%M:%S',
    '%Y-%m-%dT%H:%M:%SZ',
    '%Y.%m.%d',
    '%Y-%m-%d',
    '%Y/%m/%d',
    '%m/%d/%Y %H:%M:%S',
    '%m/%d/%Y',
    '%d/%m/%Y %H:%M:%S',
    '%d/%m/%Y',
]


def _parse_dt(s: str) -> datetime | None:
    s = (s or '').strip()
    if not s:
        return None
    for fmt in _DT_FMTS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _float(v) -> float | None:
    try:
        return float(str(v).replace(',', '').strip())
    except (ValueError, TypeError, AttributeError):
        return None


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


# ── Column-signature key for saved mappings ───────────────────────────────────

def _col_sig(columns: list[str]) -> str:
    """Stable hash of the lowercase sorted column names — used as the mapping cache key."""
    normalized = sorted(c.lower().strip() for c in columns if c.strip())
    raw = '|'.join(normalized)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _col_set(columns: list[str]) -> set[str]:
    return {c.lower().strip() for c in columns}


# ── Known format detection ────────────────────────────────────────────────────

def detect_format(columns: list[str]) -> str | None:
    cols = _col_set(columns)
    if {'date', 'time', 'duration in seconds', 'sleep stage'} <= cols:
        return 'samsung_sleep'
    if {'date', 'time', 'diastolic', 'systolic'} <= cols:
        return 'samsung_blood_pressure'
    if {'date', 'time', 'heart rate'} <= cols:
        return 'samsung_heart_rate'
    if {'date', 'time', 'steps'} <= cols:
        return 'samsung_steps'
    if {'date', 'time', 'oxygen saturation'} <= cols:
        return 'samsung_spo2'
    if {'date', 'time', 'active calories', 'total calories'} <= cols:
        return 'health_connect_calories'
    if {'date', 'time', 'resting calories', 'total calories'} <= cols:
        return 'health_connect_calories'
    if {'metrickey', 'value', 'takenat'} <= {c.lower() for c in cols}:
        return 'ht_standard'
    return None


FORMAT_LABELS = {
    'samsung_sleep':           'Samsung Health – Sleep',
    'samsung_blood_pressure':  'Samsung Health – Blood Pressure',
    'samsung_heart_rate':      'Samsung Health / Health Connect – Heart Rate',
    'samsung_steps':           'Samsung Health / Health Connect – Steps',
    'samsung_spo2':            'Samsung Health / Health Connect – SpO₂',
    'health_connect_calories': 'Health Connect – Calories Burned',
    'ht_standard':             'Health Tracker Standard Export',
    'ai_mapped':               'AI-Assisted Mapping',
}


# ── Converters ────────────────────────────────────────────────────────────────

def convert_samsung_heart_rate(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        dt  = _parse_dt(r.get('Date') or r.get('date', ''))
        val = _float(r.get('Heart rate') or r.get('heart rate'))
        if dt and val and val > 0:
            out.append({'metricKey': 'heart_rate_avg', 'value': val, 'unit': 'bpm', 'takenAt': dt})
    return out


def convert_samsung_steps(rows: list[dict]) -> list[dict]:
    daily: dict[str, float] = defaultdict(float)
    for r in rows:
        dt  = _parse_dt(r.get('Date') or r.get('date', ''))
        val = _float(r.get('Steps') or r.get('steps'))
        if dt and val and val > 0:
            daily[dt.strftime('%Y-%m-%d')] += val
    return [
        {'metricKey': 'steps', 'value': round(v), 'unit': 'count',
         'takenAt': datetime.strptime(d, '%Y-%m-%d')}
        for d, v in sorted(daily.items())
    ]


def convert_samsung_blood_pressure(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        dt = _parse_dt(r.get('Date') or r.get('date', ''))
        if not dt:
            continue
        sys_v = _float(r.get('Systolic') or r.get('systolic'))
        dia_v = _float(r.get('Diastolic') or r.get('diastolic'))
        hr_v  = _float(r.get('Heart rate') or r.get('heart rate'))
        if sys_v and sys_v > 0:
            out.append({'metricKey': 'bp_systolic',    'value': sys_v, 'unit': 'mmHg', 'takenAt': dt})
        if dia_v and dia_v > 0:
            out.append({'metricKey': 'bp_diastolic',   'value': dia_v, 'unit': 'mmHg', 'takenAt': dt})
        if hr_v and hr_v > 0:
            out.append({'metricKey': 'heart_rate_avg', 'value': hr_v,  'unit': 'bpm',  'takenAt': dt})
    return out


def convert_samsung_spo2(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        dt  = _parse_dt(r.get('Date') or r.get('date', ''))
        val = _float(r.get('Oxygen saturation') or r.get('oxygen saturation'))
        if dt and val and val > 0:
            out.append({'metricKey': 'spo2', 'value': val, 'unit': '%', 'takenAt': dt})
    return out


def convert_health_connect_calories(rows: list[dict]) -> list[dict]:
    daily: dict[str, float] = defaultdict(float)
    for r in rows:
        dt  = _parse_dt(r.get('Date') or r.get('date', ''))
        val = _float(
            r.get('Total calories') or r.get('total calories') or
            r.get('Active calories') or r.get('active calories')
        )
        if dt and val and val > 0:
            daily[dt.strftime('%Y-%m-%d')] += val
    return [
        {'metricKey': 'calories_burned', 'value': round(v, 1), 'unit': 'kcal',
         'takenAt': datetime.strptime(d, '%Y-%m-%d')}
        for d, v in sorted(daily.items())
    ]


_SLEEP_STAGE_MAP = {
    'light': 'sleep_light',
    'deep':  'sleep_deep',
    'rem':   'sleep_rem',
    'awake': 'sleep_awake',
}


def convert_samsung_sleep(rows: list[dict]) -> list[dict]:
    if not rows:
        return []

    parsed = []
    for r in rows:
        dt    = _parse_dt(r.get('Date') or r.get('date', ''))
        dur   = _float(r.get('Duration in seconds') or r.get('duration in seconds'))
        stage = (r.get('Sleep stage') or r.get('sleep stage') or '').lower().strip()
        if dt and dur is not None and dur >= 0:
            parsed.append((dt, float(dur), stage))
    parsed.sort(key=lambda x: x[0])

    out = []

    # Per-segment stage readings
    for dt, dur_sec, stage in parsed:
        metric_key = _SLEEP_STAGE_MAP.get(stage)
        if metric_key and dur_sec > 0:
            out.append({'metricKey': metric_key, 'value': round(dur_sec / 60, 1),
                        'unit': 'min', 'takenAt': dt})

    # Group into sleep sessions (gap > 2 h = new session) and emit sleep_duration
    if parsed:
        sessions: list[list] = []
        current: list = [parsed[0]]
        for seg in parsed[1:]:
            prev_end = current[-1][0] + timedelta(seconds=current[-1][1])
            if (seg[0] - prev_end).total_seconds() > 7200:
                sessions.append(current)
                current = [seg]
            else:
                current.append(seg)
        sessions.append(current)

        for sess in sessions:
            total_non_awake = sum(d for _, d, s in sess if s != 'awake')
            if total_non_awake > 0:
                out.append({'metricKey': 'sleep_duration', 'value': round(total_non_awake / 60, 1),
                            'unit': 'min', 'takenAt': sess[0][0]})

    return out


def convert_ht_standard(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        mk     = r.get('metricKey') or r.get('MetricKey') or r.get('metric_key')
        val    = _float(r.get('value') or r.get('Value'))
        raw_dt = r.get('takenAt') or r.get('TakenAt') or r.get('taken_at')
        dt     = _parse_dt(str(raw_dt)) if raw_dt else None
        if mk and val is not None and dt:
            out.append({'metricKey': mk, 'value': val,
                        'unit': r.get('unit') or r.get('Unit') or '',
                        'takenAt': dt, 'device': r.get('device') or None})
    return out


CONVERTERS = {
    'samsung_heart_rate':      convert_samsung_heart_rate,
    'samsung_steps':           convert_samsung_steps,
    'samsung_blood_pressure':  convert_samsung_blood_pressure,
    'samsung_spo2':            convert_samsung_spo2,
    'health_connect_calories': convert_health_connect_calories,
    'samsung_sleep':           convert_samsung_sleep,
    'ht_standard':             convert_ht_standard,
}


# ── AI-assisted mapping ───────────────────────────────────────────────────────

async def ai_map_columns(columns: list[str], sample_rows: list[dict],
                         provider: dict) -> dict:
    sample_text = json.dumps(sample_rows[:5], default=str, indent=2)
    prompt = f"""You are mapping health data CSV columns to standard metric keys for a health tracker app.

Available metric keys and units:
{METRIC_CATALOG}

CSV columns: {columns}

Sample rows (first 5):
{sample_text}

Return a JSON object with this EXACT shape (no prose, no markdown):
{{
  "format_name": "<short human-readable source name, e.g. 'Fitbit Daily Summary'>",
  "datetime_column": "<column that contains the datetime, e.g. 'Date' or 'Timestamp'>",
  "datetime_format": "<Python strptime format, e.g. '%Y-%m-%d %H:%M:%S'>",
  "aggregate_by_day": ["<column names whose values should be summed into a daily total (e.g. step intervals)>"],
  "mappings": [
    {{
      "column": "<exact CSV column name>",
      "metric_key": "<metric key from the list above, or null if not a health metric>",
      "unit": "<unit string>",
      "multiply_by": 1.0,
      "skip_if_zero": true
    }}
  ]
}}

Rules:
- Only include columns that map to a health metric (skip date/time/source/comment columns in mappings).
- If one row produces multiple metrics (e.g. systolic AND diastolic), include both in mappings.
- Use aggregate_by_day for step counts, calorie totals, or any sub-daily interval data.
- Set metric_key to null for columns that don't correspond to a health metric.
- Do not include any explanation outside the JSON object.
"""
    raw = await call_ai(provider, [{'role': 'user', 'content': prompt}], json_mode=True)
    try:
        return json.loads(raw)
    except Exception:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"AI returned non-parseable response: {raw[:300]}")


def apply_ai_mapping(rows: list[dict], spec: dict) -> list[dict]:
    dt_col   = spec.get('datetime_column', 'Date')
    dt_fmt   = spec.get('datetime_format', '')
    mappings = spec.get('mappings', [])
    agg_cols = set(spec.get('aggregate_by_day', []))

    point: list[dict] = []
    daily: dict[tuple, float] = defaultdict(float)

    for r in rows:
        raw_dt = r.get(dt_col, '')
        dt = None
        if dt_fmt:
            try:
                dt = datetime.strptime(str(raw_dt).strip(), dt_fmt)
            except ValueError:
                pass
        if not dt:
            dt = _parse_dt(str(raw_dt))
        if not dt:
            continue

        for m in mappings:
            col   = m.get('column', '')
            mk    = m.get('metric_key')
            unit  = m.get('unit', '')
            scale = float(m.get('multiply_by', 1.0))
            skip0 = m.get('skip_if_zero', True)
            if not mk:
                continue
            val = _float(r.get(col))
            if val is None:
                continue
            if skip0 and val == 0:
                continue
            val *= scale
            if col in agg_cols:
                daily[(mk, unit, dt.strftime('%Y-%m-%d'))] += val
            else:
                point.append({'metricKey': mk, 'value': val, 'unit': unit, 'takenAt': dt})

    for (mk, unit, day_key), total in daily.items():
        point.append({'metricKey': mk, 'value': round(total, 2), 'unit': unit,
                      'takenAt': datetime.strptime(day_key, '%Y-%m-%d')})
    return point


# ── CSV / ZIP parsing ─────────────────────────────────────────────────────────

def parse_csv_bytes(raw: bytes) -> tuple[list[str], list[dict]]:
    text = raw.decode('utf-8-sig', errors='replace')
    reader = csv.DictReader(io.StringIO(text))
    columns = list(reader.fieldnames or [])
    rows = list(reader)
    return columns, rows


def extract_csvs_from_zip(raw: bytes) -> list[tuple[str, bytes]]:
    result = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for name in zf.namelist():
            if name.lower().endswith('.csv') and not name.startswith('__MACOSX'):
                result.append((name.split('/')[-1], zf.read(name)))
    return result


# ── Serialise: datetime → ISO string for JSON responses ──────────────────────

def _to_preview(readings: list[dict]) -> list[dict]:
    """Convert a list of reading dicts to JSON-safe dicts (datetime → ISO string)."""
    out = []
    for r in readings:
        dt = r.get('takenAt')
        out.append({
            'metricKey': r['metricKey'],
            'value':     float(r['value']),
            'unit':      r.get('unit', ''),
            'takenAt':   _iso(dt) if isinstance(dt, datetime) else str(dt or ''),
            'device':    r.get('device') or 'import',
        })
    return out


def _to_storage(readings: list[dict]) -> list[dict]:
    """Prepare readings for MongoDB storage — datetime truncated to second."""
    out = []
    for r in readings:
        dt = r['takenAt']
        ts = dt.replace(tzinfo=None, microsecond=0)
        out.append({
            'metricKey': r['metricKey'],
            'value':     float(r['value']),
            'unit':      r.get('unit', ''),
            'takenAt':   ts,
            'device':    r.get('device') or 'import',
        })
    return out


# ── Upsert helper ─────────────────────────────────────────────────────────────

async def _upsert_readings(user_db, user_id: str,
                           key_map: dict, readings: list[dict]) -> dict:
    inserted = updated = skipped = 0
    now = datetime.utcnow()
    for r in readings:
        mt = key_map.get(r['metricKey'])
        if not mt:
            skipped += 1
            continue
        ts = r['takenAt']
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        ts = ts.replace(tzinfo=None, microsecond=0)
        result = await user_db.health_readings.update_one(
            {'userId': user_id, 'metricKey': r['metricKey'],
             'takenAt': ts, 'deletedAt': None},
            {
                '$set': {
                    'value':     r['value'],
                    'unit':      r.get('unit') or mt.get('unit', ''),
                    'device':    r.get('device', 'import'),
                    'source':    'csv_import',
                    'updatedAt': now,
                },
                '$setOnInsert': {
                    'metricTypeId': str(mt['_id']),
                    'metricName':   mt['displayName'],
                    'notes':        None,
                    'deletedAt':    None,
                    'createdAt':    now,
                    'createdBy':    user_id,
                },
            },
            upsert=True,
        )
        if result.upserted_id:
            inserted += 1
        elif result.modified_count:
            updated += 1
        else:
            skipped += 1
    return {'inserted': inserted, 'updated': updated, 'skipped': skipped}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post('/analyze')
async def analyze(
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    user_id = str(user['_id'])
    app_db  = get_app_db()
    user_db = get_user_db(user_id)
    raw     = await file.read()
    fname   = file.filename or ''

    # Expand ZIP or treat as single CSV
    csv_files: list[tuple[str, bytes]] = (
        extract_csvs_from_zip(raw) if fname.lower().endswith('.zip')
        else [(fname, raw)]
    )
    if not csv_files:
        raise HTTPException(400, 'No CSV files found in upload')

    # Metric type map
    app_types = await app_db.health_metric_types.find({'deletedAt': None}).to_list(300)
    usr_types = await user_db.health_metric_types.find({'deletedAt': None}).to_list(300)
    key_map   = {t['key']: t for t in (app_types + usr_types)}

    # User's default AI provider
    ai_provider = None
    pref_ai_id = (user.get('preferences') or {}).get('defaultAiProviderId')
    if pref_ai_id:
        try:
            ai_provider = await user_db.ai_providers.find_one(
                {'_id': ObjectId(pref_ai_id), 'enabled': True, 'deletedAt': None})
        except Exception:
            pass
    if not ai_provider:
        ai_provider = await user_db.ai_providers.find_one(
            {'enabled': True, 'deletedAt': None})

    file_results: list[dict] = []
    all_storage_readings: list[dict] = []  # for session (datetime objects OK)

    for csv_name, csv_bytes in csv_files:
        try:
            columns, rows = parse_csv_bytes(csv_bytes)
        except Exception as exc:
            file_results.append({'filename': csv_name, 'error': f'Could not parse CSV: {exc}', 'count': 0})
            continue

        if not rows:
            file_results.append({'filename': csv_name, 'error': 'File is empty', 'count': 0})
            continue

        # 1. Try built-in format detection
        fmt          = detect_format(columns)
        ai_used      = False
        ai_mapping   = None
        format_label = FORMAT_LABELS.get(fmt, 'Unknown')
        readings: list[dict] = []

        if fmt and fmt in CONVERTERS:
            readings = CONVERTERS[fmt](rows)

        else:
            # 2. Check saved AI mappings cache
            col_sig = _col_sig(columns)
            saved   = await app_db.import_format_mappings.find_one({'colSig': col_sig})
            if saved:
                ai_mapping   = saved['mapping']
                format_label = saved.get('formatName', 'Saved Mapping')
                readings     = apply_ai_mapping(rows, ai_mapping)
                ai_used      = False   # used saved — no AI call needed
                fmt          = 'ai_mapped'
            elif ai_provider:
                # 3. Call AI
                try:
                    ai_mapping   = await ai_map_columns(columns, rows, ai_provider)
                    readings     = apply_ai_mapping(rows, ai_mapping)
                    format_label = ai_mapping.get('format_name', 'AI-Mapped')
                    ai_used      = True
                    fmt          = 'ai_mapped'
                    # Save the mapping so we don't need AI next time
                    await app_db.import_format_mappings.update_one(
                        {'colSig': col_sig},
                        {'$set': {
                            'colSig':     col_sig,
                            'columns':    columns,
                            'formatName': format_label,
                            'mapping':    ai_mapping,
                            'createdAt':  datetime.utcnow(),
                        }},
                        upsert=True,
                    )
                except Exception as exc:
                    file_results.append({
                        'filename': csv_name,
                        'error':    f'AI mapping failed: {exc}',
                        'count':    0,
                    })
                    continue
            else:
                file_results.append({
                    'filename': csv_name,
                    'error':    (
                        'Unknown format — no AI provider configured to map it automatically. '
                        'Add an AI provider in Settings → AI Providers.'
                    ),
                    'columns': columns,
                    'count':   0,
                })
                continue

        # Filter to known metric keys
        valid        = [r for r in readings if r.get('metricKey') in key_map]
        unknown_keys = sorted({r['metricKey'] for r in readings
                               if r.get('metricKey') and r['metricKey'] not in key_map})

        storage_rows = _to_storage(valid)
        all_storage_readings.extend(storage_rows)

        file_results.append({
            'filename':     csv_name,
            'format':       fmt,
            'format_label': format_label,
            'count':        len(storage_rows),
            'preview':      _to_preview(valid[:10]),   # ISO strings — JSON-safe
            'ai_used':      ai_used,
            'unknown_keys': unknown_keys,
        })

    # Persist session
    session_doc = {
        'userId':      user_id,
        'readings':    all_storage_readings,   # datetime objects stored in MongoDB
        'total_count': len(all_storage_readings),
        'createdAt':   datetime.utcnow(),
        'expiresAt':   datetime.utcnow() + timedelta(minutes=30),
    }
    result     = await app_db.import_sessions.insert_one(session_doc)
    session_id = str(result.inserted_id)

    return {
        'session_id':  session_id,
        'files':       file_results,
        'total_count': len(all_storage_readings),
    }


@router.post('/commit/{session_id}')
async def commit(session_id: str, user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    app_db  = get_app_db()
    user_db = get_user_db(user_id)

    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(400, 'Invalid session_id')

    session = await app_db.import_sessions.find_one({'_id': oid, 'userId': user_id})
    if not session:
        raise HTTPException(404, 'Import session not found or already committed')

    app_types = await app_db.health_metric_types.find({'deletedAt': None}).to_list(300)
    usr_types = await user_db.health_metric_types.find({'deletedAt': None}).to_list(300)
    key_map   = {t['key']: t for t in (app_types + usr_types)}

    readings = session.get('readings', [])
    stats    = await _upsert_readings(user_db, user_id, key_map, readings)

    await app_db.import_sessions.delete_one({'_id': oid})
    return {**stats, 'total': len(readings)}


@router.delete('/session/{session_id}')
async def discard_session(session_id: str, user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    app_db  = get_app_db()
    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(400, 'Invalid session_id')
    await app_db.import_sessions.delete_one({'_id': oid, 'userId': user_id})
    return {'ok': True}
