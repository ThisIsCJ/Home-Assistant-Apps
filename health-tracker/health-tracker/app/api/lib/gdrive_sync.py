"""
Google Drive sync library.

Handles OAuth2 token management, Drive folder/file listing, CSV downloading,
and importing health data via the existing health_import pipeline.
"""
import asyncio
import base64
import hashlib
import hmac
import io
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

from config import get_settings
from database import get_app_db, get_user_db
from lib.encryption import encrypt, decrypt

logger = logging.getLogger(__name__)

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
_TOKEN_URI = 'https://oauth2.googleapis.com/token'
_AUTH_URI = 'https://accounts.google.com/o/oauth2/auth'

# Folders created by Health Sync app — detected by name prefix
HEALTH_SYNC_FOLDER_PREFIX = 'Health Sync'


# ── OAuth state helpers ────────────────────────────────────────────────────────

def make_oauth_state(user_id: str) -> str:
    secret = get_settings().secret_key
    ts = str(int(time.time()))
    payload = f"{user_id}:{ts}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()


def verify_oauth_state(state: str, max_age_sec: int = 600) -> Optional[str]:
    """Return user_id if state is valid and fresh, else None."""
    try:
        secret = get_settings().secret_key
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        parts = decoded.rsplit(':', 2)
        if len(parts) != 3:
            return None
        user_id, ts, sig = parts
        expected = hmac.new(secret.encode(), f"{user_id}:{ts}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if int(time.time()) - int(ts) > max_age_sec:
            return None
        return user_id
    except Exception:
        return None


# ── Credentials helpers ────────────────────────────────────────────────────────

class GDriveAuthError(Exception):
    """Raised when the stored Google grant is dead and the user must reconnect."""


def _is_invalid_grant(exc: Exception) -> bool:
    return 'invalid_grant' in str(exc)


def _build_credentials(config_doc: dict):
    """Build a google.oauth2.credentials.Credentials from a stored config doc."""
    from google.oauth2.credentials import Credentials
    if not config_doc.get('encryptedClientId') or not config_doc.get('encryptedClientSecret'):
        raise ValueError("Google OAuth credentials not configured for this user")
    return Credentials(
        token=decrypt(config_doc['encryptedAccessToken']) if config_doc.get('encryptedAccessToken') else None,
        refresh_token=decrypt(config_doc['encryptedRefreshToken']) if config_doc.get('encryptedRefreshToken') else None,
        token_uri=_TOKEN_URI,
        client_id=decrypt(config_doc['encryptedClientId']),
        client_secret=decrypt(config_doc['encryptedClientSecret']),
        scopes=SCOPES,
        expiry=config_doc.get('tokenExpiry'),
    )


async def _refresh_if_needed(creds, user_id: str) -> None:
    """Refresh expired credentials and persist updated access token."""
    # An expiry of None means we can't tell whether the access token is still
    # good — refresh unconditionally rather than let a stale token fail later.
    if creds.valid and not creds.expired and creds.expiry is not None:
        return

    def _do_refresh():
        from google.auth.transport.requests import Request
        creds.refresh(Request())

    await asyncio.to_thread(_do_refresh)

    user_db = get_user_db(user_id)
    await user_db.gdrive_config.update_one(
        {'_id': 'gdrive_config'},
        {'$set': {
            'encryptedAccessToken': encrypt(creds.token),
            'tokenExpiry': creds.expiry,
        }},
    )


async def mark_auth_failed(user_id: str, error: str) -> None:
    """Record a dead grant and pause scheduled syncs until the user reconnects."""
    now = datetime.utcnow()
    await get_user_db(user_id).gdrive_config.update_one(
        {'_id': 'gdrive_config'},
        {'$set': {'syncStatus': 'reauth_required', 'lastError': error, 'lastErrorAt': now}},
    )
    await get_app_db().gdrive_sync_registry.delete_one({'_id': user_id})
    logger.warning("GDrive auth dead for user %s — scheduled sync paused: %s", user_id, error)


async def get_drive_service(user_id: str):
    """Return (service, config_doc) or (None, None) if not connected.

    Raises GDriveAuthError if the stored grant has been revoked/expired.
    """
    user_db = get_user_db(user_id)
    config = await user_db.gdrive_config.find_one({'_id': 'gdrive_config'})
    if not config or not config.get('encryptedRefreshToken'):
        return None, None

    creds = _build_credentials(config)
    try:
        await _refresh_if_needed(creds, user_id)
    except Exception as e:
        logger.error("GDrive token refresh failed for user %s: %s", user_id, e)
        if _is_invalid_grant(e):
            await mark_auth_failed(user_id, str(e))
            raise GDriveAuthError(
                'Google Drive authorization has expired or been revoked — reconnect in Settings.'
            ) from e
        return None, None

    def _build():
        from googleapiclient.discovery import build
        return build('drive', 'v3', credentials=creds, cache_discovery=False)

    service = await asyncio.to_thread(_build)
    return service, config


# ── Drive API wrappers ─────────────────────────────────────────────────────────

async def list_drive_folders(user_id: str) -> list[dict]:
    """List all non-trashed folders in the user's Drive."""
    service, _ = await get_drive_service(user_id)
    if not service:
        return []

    def _list():
        results = []
        page_token = None
        while True:
            resp = service.files().list(
                q="mimeType='application/vnd.google-apps.folder' and trashed=false",
                fields="nextPageToken, files(id, name, modifiedTime)",
                pageSize=100,
                orderBy='name',
                pageToken=page_token,
            ).execute()
            results.extend(resp.get('files', []))
            page_token = resp.get('nextPageToken')
            if not page_token:
                break
        return results

    folders = await asyncio.to_thread(_list)

    # Mark Health Sync folders
    for f in folders:
        f['isHealthSync'] = f['name'].startswith(HEALTH_SYNC_FOLDER_PREFIX)
    return folders


async def _list_csv_files(service, folder_id: str) -> list[dict]:
    """List CSV files in a folder."""
    def _list():
        results = []
        page_token = None
        while True:
            resp = service.files().list(
                q=f"'{folder_id}' in parents and mimeType='text/plain' and trashed=false",
                fields="nextPageToken, files(id, name, modifiedTime, size)",
                pageSize=200,
                orderBy='modifiedTime desc',
                pageToken=page_token,
            ).execute()
            results.extend(resp.get('files', []))
            page_token = resp.get('nextPageToken')
            if not page_token:
                break
        # Also catch files named *.csv regardless of declared MIME
        resp2 = service.files().list(
            q=f"'{folder_id}' in parents and name contains '.csv' and trashed=false",
            fields="nextPageToken, files(id, name, modifiedTime, size)",
            pageSize=200,
        ).execute()
        seen_ids = {f['id'] for f in results}
        for f in resp2.get('files', []):
            if f['id'] not in seen_ids:
                results.append(f)
        return results

    return await asyncio.to_thread(_list)


async def _download_file(service, file_id: str) -> bytes:
    def _download():
        from googleapiclient.http import MediaIoBaseDownload
        request = service.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue()

    return await asyncio.to_thread(_download)


# ── Workout activity import (Health Sync "Activities" CSVs) ───────────────────
# One file per workout, e.g. "WALKING 2026.07.05 16.17 Samsung Health.csv":
#   Source app,Activity type,Activity name,Date,Time,Elapsed time,Active time,
#   Distance (miles),Calories (kcal),Steps,Average heart rate,Max heart rate,…

_ACTIVITY_COLUMNS = {'Activity type', 'Date', 'Elapsed time'}


def _is_activity_csv(columns: list[str]) -> bool:
    return _ACTIVITY_COLUMNS.issubset(set(columns))


def _num(row: dict, col: str):
    try:
        v = float(str(row.get(col, '')).strip())
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _activity_row_to_session(row: dict, user_id: str) -> Optional[dict]:
    try:
        started_at = datetime.strptime(row['Date'].strip(), '%Y.%m.%d %H:%M:%S')
    except (KeyError, ValueError):
        return None

    activity_type = (row.get('Activity type') or '').strip()
    name = (row.get('Activity name') or '').strip()
    if not name:
        name = 'Workout' if activity_type in ('', 'GENERIC') else activity_type.replace('_', ' ').title()

    elapsed = _num(row, 'Elapsed time')
    active = _num(row, 'Active time') or elapsed
    duration = int(active) if active else None

    now = datetime.utcnow()
    return {
        'userId': user_id,
        'name': name,
        'startedAt': started_at,
        'completedAt': started_at + timedelta(seconds=elapsed) if elapsed else None,
        'durationSeconds': duration,
        'notes': None,
        'exercises': [{
            'exerciseId': f"imported:{(activity_type or 'generic').lower()}",
            'exerciseName': name,
            'category': 'cardio',
            'sets': [{
                'setNumber': 1,
                'completed': True,
                'reps': None,
                'weight': None,
                'weightUnit': 'lb',
                'rpe': None,
                'durationSeconds': duration,
                'distance': round(_num(row, 'Distance (miles)'), 2) if _num(row, 'Distance (miles)') else None,
                'distanceUnit': 'mi',
                'averageHeartRate': int(_num(row, 'Average heart rate')) if _num(row, 'Average heart rate') else None,
                'calories': _num(row, 'Calories (kcal)'),
            }],
            'notes': None,
        }],
        'templateId': None,
        'source': 'health_sync',
        'deletedAt': None,
        'updatedAt': now,
    }


async def _import_activity_sessions(user_db, user_id: str, file_id: str, rows: list[dict]) -> int:
    """Upsert workout sessions from one Activities CSV. Returns sessions written."""
    written = 0
    for i, row in enumerate(rows):
        session = _activity_row_to_session(row, user_id)
        if not session:
            continue
        import_key = f"{file_id}:{i}"
        await user_db.workout_sessions.update_one(
            {'userId': user_id, 'importKey': import_key},
            {
                '$set': session,
                '$setOnInsert': {'importKey': import_key, 'createdAt': datetime.utcnow()},
            },
            upsert=True,
        )
        written += 1
    return written


# ── Core sync logic ────────────────────────────────────────────────────────────

async def sync_user(user_id: str) -> dict:
    """Run a full Google Drive sync for one user. Returns summary stats."""
    started_at = datetime.utcnow()
    try:
        service, config = await get_drive_service(user_id)
    except GDriveAuthError as e:
        await get_user_db(user_id).gdrive_sync_log.insert_one({
            'userId': user_id,
            'startedAt': started_at,
            'completedAt': datetime.utcnow(),
            'filesProcessed': 0, 'inserted': 0, 'updated': 0, 'skipped': 0,
            'errors': [{'error': str(e)}],
        })
        return {'error': str(e), 'authExpired': True, 'inserted': 0, 'updated': 0, 'skipped': 0, 'files': 0}
    if not service:
        return {'error': 'Not connected to Google Drive', 'inserted': 0, 'updated': 0, 'skipped': 0, 'files': 0}

    user_db = get_user_db(user_id)
    app_db = get_app_db()

    enabled_folders = [f for f in config.get('folderMappings', []) if f.get('enabled')]
    if not enabled_folders:
        return {'error': 'No folders enabled', 'inserted': 0, 'updated': 0, 'skipped': 0, 'files': 0}

    # Build metric type key map
    app_types, usr_types = await asyncio.gather(
        app_db.health_metric_types.find({'deletedAt': None}).to_list(300),
        user_db.health_metric_types.find({'deletedAt': None}).to_list(300),
    )
    key_map = {t['key']: t for t in (app_types + usr_types)}

    # Import pipeline helpers (import here to avoid circular at module load)
    from routes.health_import import (
        detect_format, CONVERTERS, apply_ai_mapping,
        parse_csv_bytes, _upsert_readings, _col_sig,
    )

    # Health Sync can export the same metric from two sources ("… Samsung
    # Health.csv" and "… Health Connect.csv") whose values disagree; the user
    # picks which variant to trust in Settings → Sync Sources.
    prefs = await user_db.sync_preferences.find_one({'_id': 'sync_preferences'}) or {}
    variant = prefs.get('gdriveFileVariant', 'both')
    skip_marker = {
        'samsung_health': 'Health Connect',
        'health_connect': 'Samsung Health',
    }.get(variant)

    total = {'inserted': 0, 'updated': 0, 'skipped': 0, 'files': 0, 'errors': []}
    auth_died = False

    for folder in enabled_folders:
        folder_id = folder['folderId']
        try:
            files = await _list_csv_files(service, folder_id)
        except Exception as e:
            total['errors'].append({'folder': folder.get('folderName'), 'error': str(e)})
            if _is_invalid_grant(e):
                # The grant died mid-sync — every remaining folder will fail the
                # same way, so stop here instead of hammering Google per folder.
                auth_died = True
                break
            continue

        for f in files:
            if skip_marker and skip_marker in f.get('name', ''):
                continue
            file_id = f['id']
            modified_time = f.get('modifiedTime', '')

            # Skip if already processed with same modified time
            already = await user_db.gdrive_processed_files.find_one({
                '_id': file_id,
                'modifiedTime': modified_time,
            })
            if already:
                continue

            try:
                csv_bytes = await _download_file(service, file_id)
                columns, rows = parse_csv_bytes(csv_bytes)
                if not rows:
                    continue

                readings = []

                # Workout exports become workout sessions, not health readings
                if _is_activity_csv(columns):
                    workouts = await _import_activity_sessions(user_db, user_id, file_id, rows)
                    if workouts:
                        total['workouts'] = total.get('workouts', 0) + workouts
                        total['files'] += 1
                else:
                    fmt = detect_format(columns)

                    if fmt and fmt in CONVERTERS:
                        readings = CONVERTERS[fmt](rows)
                    else:
                        col_sig = _col_sig(columns)
                        saved = await app_db.import_format_mappings.find_one({'colSig': col_sig})
                        if saved:
                            readings = apply_ai_mapping(rows, saved['mapping'])

                if readings:
                    stats = await _upsert_readings(user_db, user_id, key_map, readings)
                    total['inserted'] += stats['inserted']
                    total['updated'] += stats['updated']
                    total['skipped'] += stats['skipped']
                    total['files'] += 1

                await user_db.gdrive_processed_files.update_one(
                    {'_id': file_id},
                    {'$set': {
                        'folderId': folder_id,
                        'folderName': folder.get('folderName', ''),
                        'fileName': f['name'],
                        'modifiedTime': modified_time,
                        'processedAt': datetime.utcnow(),
                        'readingsFound': len(readings),
                    }},
                    upsert=True,
                )

            except Exception as e:
                logger.error("GDrive file error user=%s file=%s: %s", user_id, f.get('name'), e)
                total['errors'].append({'file': f.get('name'), 'error': str(e)})

    interval_hours = config.get('syncIntervalHours', 6)
    now = datetime.utcnow()

    if auth_died:
        await mark_auth_failed(
            user_id,
            'Google Drive authorization has expired or been revoked — reconnect in Settings.',
        )
        total['authExpired'] = True
        await user_db.gdrive_config.update_one(
            {'_id': 'gdrive_config'},
            {'$set': {'lastSyncAt': now}},
        )
    else:
        # Persist next sync time and clear any previous error state
        next_sync = now + timedelta(hours=interval_hours)
        await user_db.gdrive_config.update_one(
            {'_id': 'gdrive_config'},
            {'$set': {
                'lastSyncAt': now,
                'nextSyncAt': next_sync,
                'syncStatus': 'ok',
                'lastError': None,
                'lastErrorAt': None,
            }},
        )

        # Update global registry
        await app_db.gdrive_sync_registry.update_one(
            {'_id': user_id},
            {'$set': {'nextSyncAt': next_sync, 'syncIntervalHours': interval_hours}},
            upsert=True,
        )

    # Store sync log entry
    await user_db.gdrive_sync_log.insert_one({
        'userId': user_id,
        'startedAt': started_at,
        'completedAt': now,
        'filesProcessed': total['files'],
        'inserted': total['inserted'],
        'updated': total['updated'],
        'skipped': total['skipped'],
        'workouts': total.get('workouts', 0),
        'errors': total['errors'][:20],
    })

    return total


# ── Background scheduler ───────────────────────────────────────────────────────

async def gdrive_sync_loop():
    """Background asyncio task: run overdue syncs every 5 minutes."""
    await asyncio.sleep(30)  # brief startup delay
    while True:
        try:
            app_db = get_app_db()
            now = datetime.utcnow()
            overdue = await app_db.gdrive_sync_registry.find(
                {'nextSyncAt': {'$lte': now}}
            ).to_list(50)

            for entry in overdue:
                user_id = entry['_id']
                logger.info("GDrive scheduled sync for user %s", user_id)
                try:
                    await sync_user(user_id)
                except Exception as e:
                    logger.error("GDrive sync failed for user %s: %s", user_id, e)

        except Exception as e:
            logger.error("GDrive sync loop error: %s", e)

        await asyncio.sleep(300)  # check every 5 minutes
