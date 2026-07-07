import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from 'recharts';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';
import { useConfirm, useNotify } from '../components/AppFeedback';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  body: '#60a5fa', vitals: '#ef4444', lab: '#f59e0b',
  sleep: '#a855f7', activity: '#10b981', mood: '#34d399', custom: '#94a3b8',
};

const CHART_THEME = {
  grid: '#1e3050',
  axis: '#64748b',
  tooltip: { background: '#0f172a', border: '1px solid #243660', borderRadius: 7, fontSize: '0.72rem' },
};

const DATE_RANGE_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
];

const REPORT_GROUPS = [
  { id: 'heart_rate',     title: 'Heart Rate',       keys: ['heart_rate_min', 'heart_rate', 'heart_rate_avg', 'heart_rate_max'] },
  { id: 'blood_pressure', title: 'Blood Pressure',   keys: ['bp_systolic', 'bp_diastolic'] },
  { id: 'skin_temp',      title: 'Skin Temperature', keys: ['skin_temp_min', 'skin_temp_avg', 'skin_temp_max'] },
  { id: 'sleep_stages',   title: 'Sleep Stages',     keys: ['sleep_duration', 'sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_awake'] },
  { id: 'sleep_quality',  title: 'Sleep Quality',    keys: ['sleep_score', 'sleep_efficiency'] },
  { id: 'recovery',       title: 'Recovery',         keys: ['physical_recovery', 'mental_recovery'] },
  { id: 'body',           title: 'Body Composition', keys: ['weight', 'body_fat'],       dualAxis: true },
  { id: 'activity',       title: 'Activity',         keys: ['steps', 'calories_burned'], dualAxis: true },
  { id: 'vitals',         title: 'Other Vitals',     keys: ['spo2', 'body_temp'],        dualAxis: true },
  { id: 'stress',         title: 'Stress',           keys: ['stress_min', 'stress_avg', 'stress_max'] },
  { id: 'mood',           title: 'Mood & Pain',      keys: ['mood', 'pain'] },
];

const VALUE_TYPES = ['number', 'string', 'boolean'];
const CATEGORIES = ['body', 'vitals', 'lab', 'sleep', 'activity', 'mood', 'custom'];

function fmtMinutes(totalMin) {
  if (totalMin == null || isNaN(totalMin)) return '—';
  const h = Math.floor(Math.abs(totalMin) / 60);
  const m = Math.round(Math.abs(totalMin) % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtValue(val, unit) {
  if (val == null) return '—';
  if (unit === 'min') return fmtMinutes(val);
  if (typeof val === 'number') return val % 1 === 0 ? String(val) : val.toFixed(1);
  return String(val);
}

function fmtDate(iso, includeYear = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const opts = includeYear
    ? { month: 'short', day: 'numeric', year: '2-digit' }
    : { month: 'short', day: 'numeric' };
  return d.toLocaleDateString('en-US', opts);
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function TrendArrow({ trend, change, unit }) {
  if (trend === 'flat' || change == null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const up = trend === 'up';
  return (
    <span style={{ color: up ? 'var(--green2)' : 'var(--red)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 3 }}>
      {up ? '▲' : '▼'} {Math.abs(change)}{unit}
    </span>
  );
}

// ── Dashboard card with mini chart ────────────────────────────────────────────

function MetricCard({ card, onSelect, selected }) {
  const { type, latestReading, trend, change, readingCount } = card;
  const color = type.color || CATEGORY_COLORS[type.category] || '#60a5fa';
  const isSelected = selected?.id === type.id;

  return (
    <div
      className="card"
      style={{
        cursor: 'pointer',
        borderLeft: `3px solid ${color}`,
        borderColor: isSelected ? color : undefined,
        boxShadow: isSelected ? `0 0 0 1px ${color}40` : undefined,
      }}
      onClick={() => onSelect(isSelected ? null : card)}
    >
      <div style={{ padding: '12px 14px' }}>
        <div className="flex justify-between items-center mb-1">
          <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
            {type.displayName}
          </div>
          <span className="badge" style={{ background: `${color}20`, color }}>{type.category}</span>
        </div>
        {latestReading ? (
          <>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color, marginTop: 4 }}>
              {fmtValue(latestReading.value, latestReading.unit)}
              {latestReading.unit !== 'min' && (
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 4, fontFamily: 'inherit' }}>
                  {latestReading.unit}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <TrendArrow trend={trend} change={change} unit={latestReading.unit} />
              <span className="text-xs text-muted">{fmtDateTime(latestReading.takenAt)}</span>
            </div>
            <div className="text-xs text-muted" style={{ marginTop: 2 }}>
              {readingCount} reading{readingCount !== 1 ? 's' : ''}
            </div>
          </>
        ) : (
          <div className="text-muted text-sm" style={{ marginTop: 6 }}>No readings yet</div>
        )}
      </div>
    </div>
  );
}

// ── Trend chart panel ─────────────────────────────────────────────────────────

function TrendPanel({ card, accessToken, onClose }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { type } = card;
  const color = type.color || CATEGORY_COLORS[type.category] || '#60a5fa';

  useEffect(() => {
    setLoading(true);
    api.get(`/stats/trend?metric_type_id=${type.id}&days=${days}`, accessToken)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [type.id, days, accessToken]);

  const spansDays = (() => {
    const rs = data?.readings;
    if (!rs || rs.length < 2) return days;
    const ts = rs.map(r => new Date(r.takenAt).getTime());
    return (Math.max(...ts) - Math.min(...ts)) / 86400000;
  })();
  const useYear = spansDays > 300;

  const chartData = [...(data?.readings ?? [])]
    .sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt))
    .map(r => ({
      date: fmtDate(r.takenAt, useYear),
      value: typeof r.value === 'number' ? r.value : null,
      fullDate: r.takenAt,
      notes: r.notes,
    }));

  const values = chartData.map(d => d.value).filter(v => v != null);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 100;
  const padding = (maxVal - minVal) * 0.1 || 5;
  const yDomain = [Math.floor(minVal - padding), Math.ceil(maxVal + padding)];

  const hasNormal = type.normalRangeMin != null && type.normalRangeMax != null;

  const handleDeleteReading = async (readingId) => {
    const ok = await confirm({
      title: 'Delete reading?',
      message: 'This health reading will be removed.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/stats/readings/${readingId}`, accessToken);
      setData(d => ({ ...d, readings: d.readings.filter(x => x.id !== readingId) }));
    } catch {
      notify('Failed to delete reading.', 'error');
    }
  };

  return (
    <div className="card mb-4" style={{ borderTop: `3px solid ${color}` }}>
      <div className="card-header">
        <div className="card-title" style={{ '--dot-color': color }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 4 }} />
          {type.displayName}
          <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            ({type.unit})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ display: 'flex', gap: 3 }}>
            {DATE_RANGE_OPTIONS.map(opt => (
              <button key={opt.days} onClick={() => setDays(opt.days)}
                className={`btn btn-xs ${days === opt.days ? 'btn-pri' : 'btn-sec'}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-xs" onClick={onClose}><Icons.X size={13} /></button>
        </div>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Loading…</div>
        ) : chartData.length === 0 ? (
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
            No readings in the last {days} days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${type.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
              <XAxis dataKey="date" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} tickLine={false} />
              <YAxis stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} tickLine={false} domain={yDomain}
                tickFormatter={type.unit === 'min' ? fmtMinutes : undefined} width={type.unit === 'min' ? 42 : undefined} />
              <Tooltip
                contentStyle={CHART_THEME.tooltip}
                labelStyle={{ color: 'var(--muted2)' }}
                itemStyle={{ color }}
                formatter={(val) => [
                  type.unit === 'min' ? fmtMinutes(val) : `${val} ${type.unit}`,
                  type.displayName,
                ]}
              />
              {hasNormal && (
                <>
                  <ReferenceLine y={type.normalRangeMin} stroke="rgba(16,185,129,0.3)" strokeDasharray="4 4" label={{ value: 'Min', fill: '#64748b', fontSize: 9 }} />
                  <ReferenceLine y={type.normalRangeMax} stroke="rgba(239,68,68,0.3)" strokeDasharray="4 4" label={{ value: 'Max', fill: '#64748b', fontSize: 9 }} />
                </>
              )}
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2}
                fill={`url(#grad-${type.id})`} dot={chartData.length <= 20}
                activeDot={{ r: 4, fill: color }} connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* Recent readings table */}
        {data?.readings?.length > 0 && (
          <div className="table-wrap mt-3">
            <table>
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th className="num">Value</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...data.readings].reverse().slice(0, 8).map(r => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.takenAt)}</td>
                    <td className="num" style={{ color }}>
                      {r.unit === 'min' ? fmtMinutes(r.value) : `${r.value} ${r.unit}`}
                    </td>
                    <td style={{ color: 'var(--muted2)' }}>{r.notes || '—'}</td>
                    <td>
                      <button className="btn btn-ghost btn-xs btn-danger" onClick={() => handleDeleteReading(r.id)}><Icons.Trash size={11} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Multi-metric report chart ─────────────────────────────────────────────────

function ReportChart({ group, metricTypes, days, accessToken }) {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  const groupMetrics = useMemo(
    () => group.keys.map(k => metricTypes.find(t => t.key === k)).filter(Boolean),
    [metricTypes, group]
  );

  useEffect(() => {
    if (!accessToken || groupMetrics.length === 0) { setLoading(false); setChartData([]); return; }
    setLoading(true);
    Promise.all(
      groupMetrics.map(mt =>
        api.get(`/stats/trend?metric_type_id=${mt.id}&days=${days}`, accessToken)
          .then(d => ({ mt, readings: (d.readings ?? []).filter(r => typeof r.value === 'number') }))
          .catch(() => ({ mt, readings: [] }))
      )
    ).then(results => {
      const byDay = {};
      for (const { mt, readings } of results) {
        for (const r of readings) {
          const day = r.takenAt.slice(0, 10);
          if (!byDay[day]) byDay[day] = { _ts: new Date(r.takenAt).getTime(), _date: fmtDate(r.takenAt, days > 300) };
          if (!byDay[day][mt.key]) byDay[day][mt.key] = { sum: 0, n: 0 };
          byDay[day][mt.key].sum += r.value;
          byDay[day][mt.key].n++;
        }
      }
      setChartData(
        Object.values(byDay)
          .sort((a, b) => a._ts - b._ts)
          .map(entry => {
            const { _ts: _t, _date, ...rest } = entry;
            const p = { date: _date };
            for (const mt of groupMetrics) {
              if (rest[mt.key]) p[mt.key] = +(rest[mt.key].sum / rest[mt.key].n).toFixed(1);
            }
            return p;
          })
      );
    }).finally(() => setLoading(false));
  }, [groupMetrics, days, accessToken]);

  if (loading) return (
    <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.76rem' }}>
      Loading…
    </div>
  );

  if (chartData.length === 0) return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, color: 'var(--muted)' }}>
      <Icons.HealthStats size={22} style={{ opacity: 0.25 }} />
      <span style={{ fontSize: '0.72rem' }}>No data for this period</span>
    </div>
  );

  const allMin = groupMetrics.length > 0 && groupMetrics.every(m => m.unit === 'min');
  const yAxisProps = {
    stroke: CHART_THEME.axis,
    tick: { fill: CHART_THEME.axis, fontSize: 10 },
    tickLine: false,
    ...(allMin ? { tickFormatter: fmtMinutes, width: 48 } : {}),
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 5, right: group.dualAxis ? 42 : 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
        <XAxis dataKey="date" stroke={CHART_THEME.axis} tick={{ fill: CHART_THEME.axis, fontSize: 10 }} tickLine={false} />
        {group.dualAxis ? (
          <>
            <YAxis yAxisId="left" {...yAxisProps} />
            <YAxis yAxisId="right" orientation="right" {...yAxisProps} />
          </>
        ) : (
          <YAxis {...yAxisProps} />
        )}
        <Tooltip
          contentStyle={CHART_THEME.tooltip}
          labelStyle={{ color: 'var(--muted2)', marginBottom: 2, fontSize: '0.72rem' }}
          formatter={(val, key) => {
            const mt = groupMetrics.find(m => m.key === key);
            const display = mt?.unit === 'min' ? fmtMinutes(val) : `${val} ${mt?.unit ?? ''}`;
            return [display, mt?.displayName ?? key];
          }}
        />
        {groupMetrics.map((mt, i) => {
          const color = mt.color || CATEGORY_COLORS[mt.category] || '#60a5fa';
          return (
            <Line
              key={mt.key}
              {...(group.dualAxis ? { yAxisId: i === 0 ? 'left' : 'right' } : {})}
              type="monotone"
              dataKey={mt.key}
              stroke={color}
              strokeWidth={2}
              dot={chartData.length <= 30}
              activeDot={{ r: 4, fill: color }}
              connectNulls={false}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Log reading modal ─────────────────────────────────────────────────────────

function LogModal({ metricTypes, defaultTypeId, onClose, onLogged, accessToken }) {
  const notify = useNotify();
  const [typeId, setTypeId] = useState(defaultTypeId || metricTypes[0]?.id || '');
  const [value, setValue] = useState('');
  const [takenAt, setTakenAt] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedType = metricTypes.find(t => t.id === typeId);

  const handleSave = async () => {
    if (!typeId || value === '') return;
    setSaving(true);
    try {
      await api.post('/stats/readings', {
        metricTypeId: typeId,
        value: selectedType?.valueType === 'number' ? parseFloat(value) : value,
        takenAt: new Date(takenAt).toISOString(),
        notes: notes || null,
      }, accessToken);
      onLogged();
      onClose();
    } catch {
      notify('Failed to save reading.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Log Health Reading</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="input-group">
            <label className="input-label">Metric</label>
            <select className="input" value={typeId} onChange={e => setTypeId(e.target.value)}>
              {metricTypes.map(t => (
                <option key={t.id} value={t.id}>{t.displayName} ({t.unit})</option>
              ))}
            </select>
          </div>

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">
                Value {selectedType?.unit && <span className="text-muted">({selectedType.unit})</span>}
              </label>
              <input
                className="input mono"
                type={selectedType?.valueType === 'number' ? 'number' : 'text'}
                step="any"
                placeholder={selectedType?.normalRangeMin != null ? `Normal: ${selectedType.normalRangeMin}–${selectedType.normalRangeMax}` : ''}
                value={value}
                onChange={e => setValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="input-group">
              <label className="input-label">Date & Time</label>
              <input type="datetime-local" className="input mono" value={takenAt} onChange={e => setTakenAt(e.target.value)} />
            </div>
          </div>

          {selectedType?.normalRangeMin != null && value !== '' && (
            (() => {
              const v = parseFloat(value);
              const inRange = v >= selectedType.normalRangeMin && v <= selectedType.normalRangeMax;
              return (
                <div style={{
                  padding: '8px 12px', borderRadius: 6, fontSize: '0.72rem',
                  background: inRange ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${inRange ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
                  color: inRange ? 'var(--green2)' : 'var(--orange)',
                }}>
                  {inRange ? '✓ Within normal range' : `⚠ Outside normal range (${selectedType.normalRangeMin}–${selectedType.normalRangeMax} ${selectedType.unit})`}
                </div>
              );
            })()
          )}

          <div className="input-group">
            <label className="input-label">Notes (optional)</label>
            <input className="input" placeholder="e.g. After exercise, fasting, morning…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={!typeId || value === '' || saving}>
            {saving ? 'Saving…' : 'Save Reading'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Custom metric type modal ──────────────────────────────────────────────────

function MetricTypeModal({ type, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const isEdit = !!type;
  const [form, setForm] = useState({
    key: type?.key ?? '',
    displayName: type?.displayName ?? '',
    unit: type?.unit ?? '',
    valueType: type?.valueType ?? 'number',
    category: type?.category ?? 'custom',
    normalRangeMin: type?.normalRangeMin ?? '',
    normalRangeMax: type?.normalRangeMax ?? '',
    description: type?.description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.key || !form.displayName || !form.unit) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        key: form.key.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
        normalRangeMin: form.normalRangeMin !== '' ? parseFloat(form.normalRangeMin) : null,
        normalRangeMax: form.normalRangeMax !== '' ? parseFloat(form.normalRangeMax) : null,
      };
      if (isEdit) {
        await api.put(`/stats/metric-types/${type.id}`, payload, accessToken);
      } else {
        await api.post('/stats/metric-types', payload, accessToken);
      }
      onSaved();
      onClose();
    } catch (err) {
      notify(err.detail?.detail || 'Failed to save metric type.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Metric Type' : 'Create Custom Metric'}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Display Name *</label>
              <input className="input" placeholder="e.g. Waist Circumference" value={form.displayName}
                onChange={e => { set('displayName', e.target.value); if (!isEdit) set('key', e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')); }} autoFocus />
            </div>
            <div className="input-group">
              <label className="input-label">Key *</label>
              <input className="input mono" placeholder="e.g. waist_cm" value={form.key} onChange={e => set('key', e.target.value)} readOnly={isEdit} style={{ opacity: isEdit ? 0.6 : 1 }} />
            </div>
          </div>
          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Unit *</label>
              <input className="input" placeholder="e.g. cm, in, mmol/L" value={form.unit} onChange={e => set('unit', e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Category</label>
              <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Normal Min</label>
              <input type="number" className="input mono" placeholder="Optional" value={form.normalRangeMin} onChange={e => set('normalRangeMin', e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Normal Max</label>
              <input type="number" className="input mono" placeholder="Optional" value={form.normalRangeMax} onChange={e => set('normalRangeMax', e.target.value)} />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">Description</label>
            <input className="input" placeholder="Optional description" value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={!form.key || !form.displayName || !form.unit || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Metric'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CSV Import wizard ─────────────────────────────────────────────────────────

function ImportTab({ metricTypes, accessToken }) {
  const notify = useNotify();
  const [step, setStep] = useState('upload');   // upload | preview | result
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState(null);
  const [dateColumn, setDateColumn] = useState('');
  const [dateFormat, setDateFormat] = useState('%Y-%m-%d');
  const [mappings, setMappings] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);
  const [aiError, setAiError] = useState('');
  const fileRef = useRef(null);

  const handleFile = (file) => {
    const reader = new FileReader();
    reader.onload = e => setCsvText(e.target.result);
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!csvText) return;
    setLoading(true);
    try {
      const data = await api.post('/stats/import/preview', { csvText }, accessToken);
      setPreview(data);
      setDateColumn(data.columns[0] || '');
      setMappings([]);
      setAiApplied(false);
      setAiError('');
      setStep('preview');
    } catch (err) {
      notify('Failed to parse CSV. Check the file format.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAISuggest = async () => {
    if (!preview) return;
    setAiLoading(true);
    setAiError('');
    try {
      const suggestion = await api.post('/stats/import/ai-suggest', {
        csvText,
        columns: preview.columns,
        preview: preview.preview,
      }, accessToken);

      if (suggestion.dateColumn && preview.columns.includes(suggestion.dateColumn)) {
        setDateColumn(suggestion.dateColumn);
      }
      if (suggestion.dateFormat) {
        setDateFormat(suggestion.dateFormat);
      }
      if (Array.isArray(suggestion.mappings)) {
        const valid = suggestion.mappings.filter(m =>
          preview.columns.includes(m.column) &&
          metricTypes.some(t => t.id === m.metricTypeId)
        );
        setMappings(valid.map(m => ({ column: m.column, metricTypeId: m.metricTypeId })));
      }
      setAiApplied(true);
    } catch (err) {
      setAiError(err?.message || 'AI suggestion failed. Check your AI provider in Settings.');
    } finally {
      setAiLoading(false);
    }
  };

  const setMapping = (column, metricTypeId) => {
    setMappings(prev => {
      const without = prev.filter(m => m.column !== column);
      if (!metricTypeId) return without;
      return [...without, { column, metricTypeId }];
    });
  };

  const handleCommit = async () => {
    if (!dateColumn || mappings.length === 0) return;
    setLoading(true);
    try {
      const data = await api.post('/stats/import/commit', { csvText, dateColumn, dateFormat, mappings }, accessToken);
      setResult(data);
      setStep('result');
    } catch {
      notify('Import failed. Check your column mappings and date format.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setStep('upload'); setCsvText(''); setPreview(null); setMappings([]); setResult(null); setAiApplied(false); setAiError(''); };

  const nonDateColumns = preview?.columns?.filter(c => c !== dateColumn) ?? [];

  return (
    <div style={{ maxWidth: 680 }}>
      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 9, padding: '14px 16px', fontSize: '0.74rem', color: 'var(--muted2)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--accent2)' }}>CSV Import</strong><br />
            Upload a CSV file with a date column and one or more numeric health measurements.
            You will map each column to a metric type before the import is committed.
            <div style={{ marginTop: 8, opacity: 0.7 }}>
              Example: <span className="mono" style={{ background: 'var(--card)', padding: '1px 6px', borderRadius: 4 }}>Date,Weight (lb),Heart Rate</span>
            </div>
          </div>

          <div
            style={{ border: '2px dashed var(--border2)', borderRadius: 9, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s' }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border2)'; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border2)'; const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <input type="file" ref={fileRef} accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <Icons.Upload size={28} style={{ color: 'var(--border2)', marginBottom: 10 }} />
            <div style={{ fontSize: '0.78rem', color: 'var(--muted2)' }}>Drop a CSV file here or click to browse</div>
            {csvText && <div style={{ marginTop: 10, color: 'var(--green2)', fontSize: '0.72rem' }}>✓ File loaded ({csvText.split('\n').length} rows)</div>}
          </div>

          <button className="btn btn-pri" onClick={handlePreview} disabled={!csvText || loading}>
            {loading ? 'Parsing…' : 'Preview CSV →'}
          </button>
        </div>
      )}

      {step === 'preview' && preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="flex justify-between items-center">
            <div style={{ fontSize: '0.78rem', color: 'var(--muted2)' }}>
              {preview.estimatedRows} rows · {preview.columns.length} columns
            </div>
            <div className="flex gap-2 items-center">
              <button className="btn btn-sec btn-sm" onClick={handleAISuggest} disabled={aiLoading}>
                <Icons.Sparkle size={12} /> {aiLoading ? 'Analysing…' : 'AI Suggest'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={reset}><Icons.X size={12} /> Start over</button>
            </div>
          </div>

          {aiApplied && !aiError && (
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '8px 12px', fontSize: '0.73rem', color: 'var(--green2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icons.Sparkle size={12} /> AI mapped {mappings.length} column{mappings.length !== 1 ? 's' : ''} — review and adjust before importing.
            </div>
          )}
          {aiError && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 12px', fontSize: '0.73rem', color: 'var(--red)' }}>
              {aiError}
            </div>
          )}

          {/* Date column + format */}
          <div className="card">
            <div className="card-header"><div className="card-title"><Icons.Calendar size={13} /> Date Settings</div></div>
            <div className="card-body">
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Date Column</label>
                  <select className="input" value={dateColumn} onChange={e => setDateColumn(e.target.value)}>
                    {preview.columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Date Format</label>
                  <select className="input" value={dateFormat} onChange={e => setDateFormat(e.target.value)}>
                    {[
                      '%Y-%m-%d', '%Y-%m-%d %H:%M:%S',
                      '%Y.%m.%d', '%Y.%m.%d %H:%M:%S',
                      '%Y/%m/%d', '%Y/%m/%d %H:%M:%S',
                      '%m/%d/%Y', '%d/%m/%Y', '%m-%d-%Y',
                    ].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Column mappings */}
          <div className="card">
            <div className="card-header"><div className="card-title"><Icons.HealthStats size={13} /> Map Columns to Metrics</div></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {nonDateColumns.map(col => {
                const mapping = mappings.find(m => m.column === col);
                return (
                  <div key={col} className="flex items-center gap-3">
                    <div style={{ flex: '0 0 180px', fontSize: '0.76rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</div>
                    <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>→</span>
                    <select className="input" value={mapping?.metricTypeId || ''} onChange={e => setMapping(col, e.target.value)}>
                      <option value="">— skip this column —</option>
                      {metricTypes.filter(t => t.valueType === 'number').map(t => (
                        <option key={t.id} value={t.id}>{t.displayName} ({t.unit})</option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {nonDateColumns.length === 0 && <div className="text-xs text-muted">No data columns found. Make sure the date column is set correctly.</div>}
            </div>
          </div>

          {/* Data preview */}
          <div className="card">
            <div className="card-header"><div className="card-title"><Icons.Info size={13} /> Data Preview (first 10 rows)</div></div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>{preview.columns.map(c => <th key={c} style={{ whiteSpace: 'nowrap' }}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.preview.map((row, i) => (
                    <tr key={i}>{preview.columns.map(c => <td key={c} className={typeof row[c] === 'string' && !isNaN(parseFloat(row[c])) ? 'num' : ''}>{row[c] || '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-sec" onClick={reset}>← Back</button>
            <button className="btn btn-pri" onClick={handleCommit} disabled={mappings.length === 0 || !dateColumn || loading}>
              {loading ? 'Importing…' : `Import ${mappings.length} column${mappings.length !== 1 ? 's' : ''} →`}
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 9, padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--green2)' }}>{result.imported}</div>
            <div style={{ fontSize: '0.76rem', color: 'var(--muted2)', marginTop: 4 }}>readings imported successfully</div>
            {result.duplicates > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--muted2)', marginTop: 6 }}>{result.duplicates} duplicate{result.duplicates !== 1 ? 's' : ''} skipped</div>}
            {result.skipped > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--orange)', marginTop: 4 }}>{result.skipped} rows had errors</div>}
          </div>

          {result.errors?.length > 0 && (
            <div className="card">
              <div className="card-header"><div className="card-title orange"><Icons.AlertTriangle size={13} /> Import Errors</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {result.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>
                    Row {e.row}: <span style={{ color: 'var(--orange)' }}>{e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-sec" onClick={reset}>Import Another File</button>
        </div>
      )}
    </div>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────

function HistoryTab({ metricTypes, accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [metricId, setMetricId] = useState('');
  const [days, setDays] = useState(30);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ limit: 500, days });
      if (metricId) params.set('metric_type_id', metricId);
      const data = await api.get(`/stats/readings?${params}`, accessToken);
      setReadings(Array.isArray(data) ? data : data.readings ?? []);
    } catch { setReadings([]); }
    finally { setLoading(false); }
  }, [metricId, days, accessToken]);

  useEffect(() => { load(); }, [load]);

  const toggleAll = () => setSelected(s => s.size === readings.length ? new Set() : new Set(readings.map(r => r.id)));
  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const deleteOne = async (id) => {
    const ok = await confirm({
      title: 'Delete reading?',
      message: 'This health reading will be removed.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/stats/readings/${id}`, accessToken);
      setReadings(r => r.filter(x => x.id !== id));
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
    } catch {
      notify('Failed to delete reading.', 'error');
    }
  };

  const deleteSelected = async () => {
    const ok = await confirm({
      title: 'Delete readings?',
      message: `Delete ${selected.size} reading${selected.size !== 1 ? 's' : ''}?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const failed = await Promise.all([...selected].map(id =>
      api.delete(`/stats/readings/${id}`, accessToken).then(() => null).catch(() => id)
    ));
    const failedIds = new Set(failed.filter(Boolean));
    setReadings(r => r.filter(x => !selected.has(x.id) || failedIds.has(x.id)));
    setSelected(failedIds);
    if (failedIds.size > 0) notify('Some deletes failed.', 'error');
  };

  const metricColor = (r) => {
    const mt = metricTypes.find(t => t.id === r.metricTypeId);
    return mt?.color || CATEGORY_COLORS[mt?.category] || '#60a5fa';
  };

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" style={{ flex: '1 1 200px', maxWidth: 280 }} value={metricId} onChange={e => setMetricId(e.target.value)}>
          <option value="">All metrics</option>
          {metricTypes.map(t => <option key={t.id} value={t.id}>{t.displayName}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 30, 90, 365].map(d => (
            <button key={d} className={`btn btn-xs ${days === d ? 'btn-pri' : 'btn-sec'}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
        {selected.size > 0 && (
          <button className="btn btn-sm btn-danger" onClick={deleteSelected} style={{ marginLeft: 'auto' }}>
            <Icons.Trash size={12} /> Delete {selected.size} selected
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty-state"><div className="text-muted">Loading…</div></div>
      ) : readings.length === 0 ? (
        <div className="empty-state"><div className="text-muted">No readings found</div></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selected.size === readings.length && readings.length > 0}
                    onChange={toggleAll} style={{ cursor: 'pointer' }} />
                </th>
                <th>Metric</th>
                <th>Date / Time</th>
                <th className="num">Value</th>
                <th>Source</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {readings.map(r => {
                const color = metricColor(r);
                return (
                  <tr key={r.id} style={selected.has(r.id) ? { background: 'rgba(59,130,246,0.06)' } : {}}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.75rem' }}>{r.metricName}</span>
                      </span>
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--muted2)' }}>{fmtDateTime(r.takenAt)}</td>
                    <td className="num" style={{ color }}>
                      {r.unit === 'min' ? fmtMinutes(r.value) : `${r.value} ${r.unit}`}
                    </td>
                    <td style={{ fontSize: '0.7rem', color: 'var(--muted2)' }}>{r.source || r.device || '—'}</td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--muted2)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes || '—'}</td>
                    <td>
                      <button className="btn btn-ghost btn-xs btn-danger" onClick={() => deleteOne(r.id)}><Icons.Trash size={11} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '8px 12px', fontSize: '0.7rem', color: 'var(--muted2)', borderTop: '1px solid var(--border)' }}>
            {readings.length} reading{readings.length !== 1 ? 's' : ''}
            {selected.size > 0 && ` · ${selected.size} selected`}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reports tab ───────────────────────────────────────────────────────────────

function ReportsTab({ metricTypes, accessToken }) {
  const [days, setDays] = useState(30);

  const visibleGroups = REPORT_GROUPS.filter(g =>
    g.keys.some(k => metricTypes.find(t => t.key === k))
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', marginRight: 4 }}>Range:</span>
        {DATE_RANGE_OPTIONS.map(opt => (
          <button key={opt.days} className={`btn btn-sm ${days === opt.days ? 'btn-pri' : 'btn-sec'}`}
            onClick={() => setDays(opt.days)}>
            {opt.label}
          </button>
        ))}
      </div>

      {visibleGroups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icons.BarChart size={32} /></div>
          <div className="empty-state-text">No metrics configured</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
          {visibleGroups.map(group => {
            const groupMetrics = group.keys.map(k => metricTypes.find(t => t.key === k)).filter(Boolean);
            return (
              <div key={group.id} className="card">
                <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <div className="card-title">{group.title}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {groupMetrics.map(mt => {
                      const color = mt.color || CATEGORY_COLORS[mt.category] || '#60a5fa';
                      return (
                        <span key={mt.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.68rem', color: 'var(--muted2)' }}>
                          <span style={{ width: 14, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
                          {mt.displayName}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="card-body" style={{ paddingTop: 4 }}>
                  <ReportChart group={group} metricTypes={metricTypes} days={days} accessToken={accessToken} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Metrics management tab ────────────────────────────────────────────────────

function MetricsTab({ metricTypes, onRefresh, accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');

  const handleDelete = async (type) => {
    const ok = await confirm({
      title: 'Delete custom metric?',
      message: `Delete custom metric "${type.displayName}"? Existing readings will remain but will no longer be editable through this metric.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/stats/metric-types/${type.id}`, accessToken);
      onRefresh();
    } catch {
      notify('Cannot delete this metric type.', 'error');
    }
  };

  const displayed = filter === 'all' ? metricTypes : metricTypes.filter(t => t.scope === 'user');

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          {['all', 'custom'].map(f => (
            <button key={f} className={`btn btn-sm ${filter === f ? 'btn-pri' : 'btn-sec'}`} onClick={() => setFilter(f)} style={{ textTransform: 'capitalize' }}>
              {f === 'all' ? 'All Metrics' : 'My Custom Metrics'}
            </button>
          ))}
        </div>
        <button className="btn btn-pri btn-sm" onClick={() => { setEditing(null); setShowModal(true); }}>
          <Icons.Plus size={13} /> Custom Metric
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Unit</th>
              <th>Category</th>
              <th>Normal Range</th>
              <th>Scope</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(t => {
              const color = t.color || CATEGORY_COLORS[t.category] || '#94a3b8';
              return (
                <tr key={t.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                      {t.displayName}
                    </div>
                  </td>
                  <td className="mono" style={{ color: 'var(--muted2)' }}>{t.unit}</td>
                  <td><span className="badge" style={{ background: `${color}20`, color }}>{t.category}</span></td>
                  <td className="mono" style={{ fontSize: '0.68rem', color: 'var(--muted2)' }}>
                    {t.normalRangeMin != null ? `${t.normalRangeMin}–${t.normalRangeMax}` : '—'}
                  </td>
                  <td><span className={`badge ${t.scope === 'global' ? 'badge-muted' : 'badge-blue'}`}>{t.scope}</span></td>
                  <td>
                    {t.scope === 'user' && (
                      <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(t); setShowModal(true); }}><Icons.Edit size={11} /></button>
                        <button className="btn btn-ghost btn-xs btn-danger" onClick={() => handleDelete(t)}><Icons.Trash size={11} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <MetricTypeModal
          type={editing}
          accessToken={accessToken}
          onClose={() => setShowModal(false)}
          onSaved={onRefresh}
        />
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HealthStats() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const [metricTypes, setMetricTypes] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loadingDash, setLoadingDash] = useState(true);
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [defaultLogType, setDefaultLogType] = useState(null);

  const fetchTypes = useCallback(async () => {
    if (!accessToken) return;
    const data = await api.get('/stats/metric-types', accessToken).catch(() => []);
    setMetricTypes(data);
  }, [accessToken]);

  const fetchDashboard = useCallback(async () => {
    if (!accessToken) return;
    setLoadingDash(true);
    const data = await api.get('/stats/dashboard', accessToken).catch(() => ({ cards: [] }));
    setDashboard(data);
    setLoadingDash(false);
  }, [accessToken]);

  useEffect(() => { fetchTypes(); fetchDashboard(); }, [fetchTypes, fetchDashboard]);

  const handleLogged = () => { fetchDashboard(); };

  const trackedTypeIds = new Set(dashboard?.cards?.map(c => c.type.id) ?? []);
  const untrackedTypes = metricTypes.filter(t => !trackedTypeIds.has(t.id));

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Health Stats</div>
          <div className="text-muted text-sm mt-1">
            {dashboard?.cards?.length ?? 0} metric{dashboard?.cards?.length !== 1 ? 's' : ''} tracked
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-pri btn-sm" onClick={() => { setDefaultLogType(null); setShowLogModal(true); }}>
            <Icons.Plus size={13} /> Log Reading
          </button>
        </div>
      </div>

      <div className="tabs">
        {[
          { id: 'dashboard', icon: Icons.Dashboard,  label: 'Dashboard' },
          { id: 'reports',   icon: Icons.BarChart,   label: 'Reports' },
          { id: 'history',   icon: Icons.List,       label: 'History' },
          { id: 'metrics',   icon: Icons.HealthStats, label: 'Metric Types' },
          { id: 'import',    icon: Icons.Upload,     label: 'Import CSV' },
        ].map(({ id, icon: Icon, label }) => (
          <button key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            {label}
          </button>
        ))}
      </div>

      {/* Dashboard tab */}
      {tab === 'dashboard' && (
        <>
          {/* Trend drilldown panel */}
          {selectedCard && (
            <TrendPanel
              card={selectedCard}
              accessToken={accessToken}
              onClose={() => setSelectedCard(null)}
            />
          )}

          {loadingDash ? (
            <div className="empty-state"><div className="text-muted">Loading…</div></div>
          ) : (
            <>
              {dashboard?.cards?.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 16 }}>
                  {dashboard.cards.map(card => (
                    <MetricCard
                      key={card.type.id}
                      card={card}
                      selected={selectedCard?.type}
                      onSelect={(c) => setSelectedCard(c)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state" style={{ minHeight: 200 }}>
                  <div className="empty-state-icon"><Icons.HealthStats size={32} /></div>
                  <div className="empty-state-text">No readings yet</div>
                  <div className="empty-state-sub">Click "Log Reading" to start tracking your health metrics</div>
                </div>
              )}

              {/* Untracked metrics nudge */}
              {untrackedTypes.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="text-xs text-muted mb-2" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
                    Also Available
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {untrackedTypes.slice(0, 12).map(t => {
                      const color = t.color || CATEGORY_COLORS[t.category] || '#94a3b8';
                      return (
                        <button
                          key={t.id}
                          className="btn btn-sec btn-sm"
                          style={{ borderColor: `${color}40`, color: 'var(--muted2)' }}
                          onClick={() => { setDefaultLogType(t.id); setShowLogModal(true); }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
                          {t.displayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'reports' && (
        <ReportsTab metricTypes={metricTypes} accessToken={accessToken} />
      )}

      {tab === 'history' && (
        <HistoryTab metricTypes={metricTypes} accessToken={accessToken} />
      )}

      {tab === 'metrics' && (
        <MetricsTab metricTypes={metricTypes} onRefresh={fetchTypes} accessToken={accessToken} />
      )}

      {tab === 'import' && (
        <ImportTab metricTypes={metricTypes} accessToken={accessToken} />
      )}

      {showLogModal && (
        <LogModal
          metricTypes={metricTypes}
          defaultTypeId={defaultLogType}
          accessToken={accessToken}
          onClose={() => { setShowLogModal(false); setDefaultLogType(null); }}
          onLogged={handleLogged}
        />
      )}
    </>
  );
}
