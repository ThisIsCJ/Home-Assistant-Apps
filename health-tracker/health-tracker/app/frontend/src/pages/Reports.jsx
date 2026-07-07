import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';

// ── Theme ─────────────────────────────────────────────────────────────────────

const GRID  = '#1e3050';
const AXIS  = '#64748b';
const TT_STYLE = {
  background: '#0f172a', border: '1px solid #243660',
  borderRadius: 7, fontSize: '0.72rem', padding: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function buildDays(from, to) {
  const days = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to   + 'T00:00:00');
  while (cur <= end) {
    days.push(toDateStr(new Date(cur)));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function shortLabel(dateStr, totalDays) {
  const d = new Date(dateStr + 'T00:00:00');
  if (totalDays <= 14) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (totalDays <= 60) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function hasValues(arr, keys) {
  return arr.some(d => keys.some(k => (d[k] || 0) > 0));
}

function trimEnds(arr, nonZeroKeys) {
  let s = 0, e = arr.length - 1;
  while (s < e && !nonZeroKeys.some(k => (arr[s][k] || 0) > 0)) s++;
  while (e > s && !nonZeroKeys.some(k => (arr[e][k] || 0) > 0)) e--;
  return arr.slice(s, e + 1);
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return typeof n === 'number' ? (n % 1 === 0 ? String(n) : n.toFixed(1)) : String(n);
}

// ── Shared components ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE}>
      <div style={{ padding: '5px 10px', borderBottom: '1px solid #1e3050', fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
      <div style={{ padding: '5px 10px' }}>
        {payload.map(p => (
          <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill || p.color, flexShrink: 0 }} />
            <span style={{ color: '#94a3b8' }}>{p.name}:</span>
            <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{fmtNum(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCards({ stats }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      {stats.map(({ label, value, color }) => (
        <div key={label} style={{
          flex: '1 1 110px', background: 'var(--bg-2)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 14px',
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: color || 'var(--fg)' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ChartSection({ title, hidden, height = 180, children }) {
  if (hidden) return null;
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel__header"><span>{title}</span></div>
      <div className="panel__body" style={{ padding: '12px 4px 6px' }}>
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function axisProps(extra) {
  return { tick: { fontSize: 10, fill: AXIS }, tickLine: false, axisLine: false, ...extra };
}

function EmptySection({ icon: Icon, text, sub }) {
  return (
    <div className="empty-state" style={{ padding: '48px 0' }}>
      <div className="empty-state-icon"><Icon size={28} /></div>
      <div className="empty-state-text">{text}</div>
      <div className="empty-state-sub">{sub}</div>
    </div>
  );
}

// ── Food section ──────────────────────────────────────────────────────────────

function FoodSection({ from, to, accessToken }) {
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    setLogs(null);
    api.get(`/food/logs?date_from=${from}T00:00:00&date_to=${to}T23:59:59&limit=5000`, accessToken)
      .then(setLogs).catch(() => setLogs([]));
  }, [from, to, accessToken]);

  const days = useMemo(() => buildDays(from, to), [from, to]);

  const byDay = useMemo(() => {
    if (!logs) return [];
    const map = {};
    days.forEach(d => {
      map[d] = { date: d, label: shortLabel(d, days.length), calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
    });
    logs.forEach(log => {
      const d = (log.loggedAt || '').slice(0, 10);
      if (!map[d]) return;
      const n = log.nutritionSnapshot || {};
      map[d].calories += n.calories  || 0;
      map[d].proteinG += n.proteinG  || 0;
      map[d].carbsG   += n.carbsG    || 0;
      map[d].fatG     += n.fatG      || 0;
      map[d].fiberG   += n.fiberG    || 0;
    });
    return days.map(d => map[d]);
  }, [logs, days]);

  if (logs === null) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.85rem' }}>Loading…</div>;

  if (!hasValues(byDay, ['calories'])) {
    return <EmptySection icon={Icons.Food} text="No food logs in this period" sub="Start logging meals to see nutrition trends" />;
  }

  const loggedDays = byDay.filter(d => d.calories > 0);
  const avg = k => loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d[k], 0) / loggedDays.length) : 0;
  const trimmed = trimEnds(byDay, ['calories']);

  return (
    <>
      <StatCards stats={[
        { label: 'Days logged',  value: loggedDays.length },
        { label: 'Avg calories', value: avg('calories') ? `${avg('calories')} kcal` : '—', color: '#f97316' },
        { label: 'Avg protein',  value: avg('proteinG')  ? `${avg('proteinG')}g`    : '—', color: '#60a5fa' },
        { label: 'Avg carbs',    value: avg('carbsG')    ? `${avg('carbsG')}g`      : '—', color: '#f59e0b' },
        { label: 'Avg fat',      value: avg('fatG')      ? `${avg('fatG')}g`        : '—', color: '#ef4444' },
      ]} />

      <ChartSection title="Daily Calories" hidden={!hasValues(trimmed, ['calories'])}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({})} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="calories" name="Calories (kcal)" fill="#f97316" radius={[2, 2, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>

      <ChartSection title="Daily Macros" hidden={!hasValues(trimmed, ['proteinG', 'carbsG', 'fatG'])}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({ unit: 'g' })} />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: '0.7rem', paddingTop: 4 }} />
          <Bar dataKey="proteinG" name="Protein" fill="#60a5fa" stackId="m" maxBarSize={32} />
          <Bar dataKey="carbsG"   name="Carbs"   fill="#f59e0b" stackId="m" maxBarSize={32} />
          <Bar dataKey="fatG"     name="Fat"     fill="#ef4444" stackId="m" radius={[2, 2, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>

      <ChartSection title="Fiber Intake" hidden={!hasValues(trimmed, ['fiberG'])}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({ unit: 'g' })} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="fiberG" name="Fiber (g)" fill="#34d399" radius={[2, 2, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>
    </>
  );
}

// ── Medications section ───────────────────────────────────────────────────────

function MedsSection({ from, to, accessToken }) {
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    setLogs(null);
    api.get(`/medications/logs/list?date_from=${from}T00:00:00&date_to=${to}T23:59:59`, accessToken)
      .then(setLogs).catch(() => setLogs([]));
  }, [from, to, accessToken]);

  const days = useMemo(() => buildDays(from, to), [from, to]);

  const dailyData = useMemo(() => {
    if (!logs) return [];
    const map = {};
    days.forEach(d => { map[d] = { date: d, label: shortLabel(d, days.length), taken: 0, skipped: 0, missed: 0 }; });
    logs.forEach(log => {
      const d = (log.takenAt || log.scheduledFor || '').slice(0, 10);
      if (!map[d]) return;
      const s = log.status || 'missed';
      if (s === 'taken') map[d].taken++;
      else if (s === 'skipped') map[d].skipped++;
      else map[d].missed++;
    });
    return days.map(d => map[d]);
  }, [logs, days]);

  const byMed = useMemo(() => {
    if (!logs) return [];
    const map = {};
    logs.forEach(log => {
      const name = log.medicationName || 'Unknown';
      if (!map[name]) map[name] = { name, taken: 0, skipped: 0, missed: 0 };
      const s = log.status || 'missed';
      if (s === 'taken') map[name].taken++;
      else if (s === 'skipped') map[name].skipped++;
      else map[name].missed++;
    });
    return Object.values(map)
      .map(m => ({ ...m, total: m.taken + m.skipped + m.missed, pct: Math.round(m.taken / (m.taken + m.skipped + m.missed) * 100) }))
      .sort((a, b) => b.total - a.total);
  }, [logs]);

  if (logs === null) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.85rem' }}>Loading…</div>;

  if (!logs.length) {
    return <EmptySection icon={Icons.Pill} text="No medication logs in this period" sub="Log your medications to see adherence trends" />;
  }

  const taken = logs.filter(l => l.status === 'taken').length;
  const adherencePct = Math.round(taken / logs.length * 100);
  const trimmed = trimEnds(dailyData, ['taken', 'skipped', 'missed']);

  const adherenceColor = adherencePct >= 80 ? '#10b981' : adherencePct >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <>
      <StatCards stats={[
        { label: 'Total doses',  value: logs.length },
        { label: 'Taken',        value: taken,          color: '#10b981' },
        { label: 'Skipped',      value: logs.filter(l => l.status === 'skipped').length, color: '#f59e0b' },
        { label: 'Missed',       value: logs.filter(l => l.status === 'missed').length,  color: '#ef4444' },
        { label: 'Adherence',    value: `${adherencePct}%`, color: adherenceColor },
      ]} />

      <ChartSection title="Daily Doses" hidden={!hasValues(trimmed, ['taken', 'skipped', 'missed'])}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({ allowDecimals: false })} />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: '0.7rem', paddingTop: 4 }} />
          <Bar dataKey="taken"   name="Taken"   fill="#10b981" stackId="d" maxBarSize={32} />
          <Bar dataKey="skipped" name="Skipped" fill="#f59e0b" stackId="d" maxBarSize={32} />
          <Bar dataKey="missed"  name="Missed"  fill="#ef4444" stackId="d" radius={[2, 2, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>

      {byMed.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel__header"><span>Adherence by Medication</span></div>
          <div className="panel__body">
            {byMed.map((m, i) => {
              const c = m.pct >= 80 ? '#10b981' : m.pct >= 50 ? '#f59e0b' : '#ef4444';
              return (
                <div key={m.name} style={{ padding: '10px 0', borderBottom: i < byMed.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{m.name}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: c }}>{m.pct}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ height: '100%', width: `${m.pct}%`, background: c, borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)' }}>
                    {m.taken} taken · {m.skipped} skipped · {m.missed} missed
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ── Workouts section ──────────────────────────────────────────────────────────

function WorkoutsSection({ from, to, accessToken }) {
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    setSessions(null);
    api.get(`/workouts/sessions?date_from=${from}T00:00:00&date_to=${to}T23:59:59&limit=500`, accessToken)
      .then(r => setSessions(r?.sessions || [])).catch(() => setSessions([]));
  }, [from, to, accessToken]);

  const days = useMemo(() => buildDays(from, to), [from, to]);

  const byDay = useMemo(() => {
    if (!sessions) return [];
    const map = {};
    days.forEach(d => { map[d] = { date: d, label: shortLabel(d, days.length), count: 0, durationMin: 0, volume: 0 }; });
    sessions.forEach(s => {
      const d = (s.startedAt || '').slice(0, 10);
      if (!map[d]) return;
      map[d].count++;
      map[d].durationMin += Math.round((s.durationSeconds || 0) / 60);
      (s.exercises || []).forEach(ex => {
        (ex.sets || []).forEach(set => {
          if (set.completed) map[d].volume += (set.weight || 0) * (set.reps || 0);
        });
      });
    });
    return days.map(d => map[d]);
  }, [sessions, days]);

  if (sessions === null) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.85rem' }}>Loading…</div>;

  if (!sessions.length) {
    return <EmptySection icon={Icons.Dumbbell} text="No workouts in this period" sub="Complete a workout to see training trends" />;
  }

  const totalSec = sessions.reduce((s, x) => s + (x.durationSeconds || 0), 0);
  const avgMin   = sessions.length ? Math.round(totalSec / sessions.length / 60) : 0;
  const totalVol = Math.round(byDay.reduce((s, d) => s + d.volume, 0));
  const trimmed  = trimEnds(byDay, ['count']);

  return (
    <>
      <StatCards stats={[
        { label: 'Sessions',       value: sessions.length,                                             color: '#a78bfa' },
        { label: 'Avg duration',   value: avgMin   ? `${avgMin} min`                               : '—' },
        { label: 'Total time',     value: totalSec ? `${(totalSec / 3600).toFixed(1)} hr`          : '—' },
        { label: 'Total volume',   value: totalVol ? `${totalVol.toLocaleString()} lb`             : '—', color: '#34d399' },
      ]} />

      <ChartSection title="Sessions per Day" hidden={!hasValues(trimmed, ['count'])} height={160}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({ allowDecimals: false })} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="count" name="Sessions" fill="#a78bfa" radius={[3, 3, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>

      <ChartSection title="Session Duration (min)" hidden={!hasValues(trimmed, ['durationMin'])} height={160}>
        <LineChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({})} />
          <Tooltip content={<ChartTooltip />} />
          <Line type="monotone" dataKey="durationMin" name="Duration (min)" stroke="#818cf8" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ChartSection>

      <ChartSection title="Training Volume (lb)" hidden={!hasValues(trimmed, ['volume'])} height={160}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({})} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="volume" name="Volume (lb)" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>
    </>
  );
}

// ── Sleep section ─────────────────────────────────────────────────────────────

function fmtMin(min) {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SleepSection({ from, to, accessToken }) {
  const [readings, setReadings] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    setReadings(null);
    api.get(`/stats/readings?metric_keys=sleep_duration,sleep_deep,sleep_rem,sleep_light,sleep_awake&date_from=${from}T00:00:00&date_to=${to}T23:59:59&limit=2000`, accessToken)
      .then(setReadings).catch(() => setReadings([]));
  }, [from, to, accessToken]);

  const days = useMemo(() => buildDays(from, to), [from, to]);

  const byDay = useMemo(() => {
    if (!readings) return [];
    const map = {};
    days.forEach(d => {
      map[d] = { date: d, label: shortLabel(d, days.length), total: 0, deep: 0, rem: 0, light: 0 };
    });
    // For each day keep the max value (handles duplicate readings)
    readings.forEach(r => {
      const d = (r.takenAt || '').slice(0, 10);
      if (!map[d]) return;
      if (r.metricKey === 'sleep_duration') map[d].total = Math.max(map[d].total, r.value);
      if (r.metricKey === 'sleep_deep')     map[d].deep  = Math.max(map[d].deep,  r.value);
      if (r.metricKey === 'sleep_rem')      map[d].rem   = Math.max(map[d].rem,   r.value);
      if (r.metricKey === 'sleep_light')    map[d].light = Math.max(map[d].light, r.value);
    });
    return days.map(d => ({
      ...map[d],
      totalH: +(map[d].total / 60).toFixed(2),
      deepH:  +(map[d].deep  / 60).toFixed(2),
      remH:   +(map[d].rem   / 60).toFixed(2),
      lightH: +(map[d].light / 60).toFixed(2),
    }));
  }, [readings, days]);

  if (readings === null) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.85rem' }}>Loading…</div>;

  if (!hasValues(byDay, ['total'])) {
    return (
      <div className="empty-state" style={{ padding: '48px 0' }}>
        <div className="empty-state-icon"><Icons.Moon size={28} /></div>
        <div className="empty-state-text">No sleep data in this period</div>
        <div className="empty-state-sub">Sync sleep from your wearable to see trends</div>
      </div>
    );
  }

  const withData  = byDay.filter(d => d.total > 0);
  const avgTotal  = withData.length ? withData.reduce((s, d) => s + d.total, 0) / withData.length : 0;
  const withDeep  = withData.filter(d => d.deep > 0);
  const avgDeep   = withDeep.length  ? withDeep.reduce((s, d) => s + d.deep, 0)  / withDeep.length  : 0;
  const withRem   = withData.filter(d => d.rem  > 0);
  const avgRem    = withRem.length   ? withRem.reduce((s, d)  => s + d.rem,  0)  / withRem.length   : 0;
  const withLight = withData.filter(d => d.light > 0);
  const avgLight  = withLight.length ? withLight.reduce((s, d) => s + d.light, 0) / withLight.length : 0;

  const trimmed = trimEnds(byDay, ['total']);
  const hasStages = hasValues(trimmed, ['deepH', 'remH', 'lightH']);

  return (
    <>
      <StatCards stats={[
        { label: 'Nights tracked', value: withData.length },
        { label: 'Avg sleep',      value: fmtMin(avgTotal),  color: '#a855f7' },
        { label: 'Avg deep',       value: fmtMin(avgDeep),   color: '#7c3aed' },
        { label: 'Avg REM',        value: fmtMin(avgRem),    color: '#c084fc' },
        { label: 'Avg light',      value: fmtMin(avgLight),  color: '#818cf8' },
      ]} />

      <ChartSection title="Sleep Duration" hidden={!hasValues(trimmed, ['totalH'])}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({ unit: 'h' })} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="totalH" name="Sleep (hr)" fill="#a855f7" radius={[2, 2, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>

      <ChartSection title="Sleep Stages" hidden={!hasStages}>
        <BarChart data={trimmed} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" {...axisProps({ interval: 'preserveStartEnd' })} />
          <YAxis {...axisProps({ unit: 'h' })} />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: '0.7rem', paddingTop: 4 }} />
          <Bar dataKey="deepH"  name="Deep"  fill="#7c3aed" stackId="s" maxBarSize={32} />
          <Bar dataKey="remH"   name="REM"   fill="#c084fc" stackId="s" maxBarSize={32} />
          <Bar dataKey="lightH" name="Light" fill="#818cf8" stackId="s" radius={[2, 2, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartSection>
    </>
  );
}

// ── Date range controls ───────────────────────────────────────────────────────

const PRESETS = ['7d', '30d', '90d'];

function useDateRange() {
  const today = toDateStr(new Date());
  const [preset, setPreset]       = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');

  const { from, to } = useMemo(() => {
    if (preset === 'custom') {
      return { from: customFrom || today, to: customTo || today };
    }
    const days = parseInt(preset);
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    return { from: toDateStr(d), to: today };
  }, [preset, customFrom, customTo, today]);

  function activateCustom() {
    if (!customFrom) {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      setCustomFrom(toDateStr(d));
    }
    if (!customTo) setCustomTo(today);
    setPreset('custom');
  }

  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, activateCustom, from, to, today };
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'food',        label: 'Food',        Icon: Icons.Food      },
  { id: 'medications', label: 'Medications', Icon: Icons.Pill      },
  { id: 'workouts',    label: 'Workouts',    Icon: Icons.Dumbbell  },
  { id: 'sleep',       label: 'Sleep',       Icon: Icons.Moon      },
];

export default function Reports() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState('food');
  const range = useDateRange();
  const { from, to } = range;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>Reports</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button
              key={p}
              className={`btn${range.preset === p ? ' btn--primary' : ''}`}
              onClick={() => range.setPreset(p)}
              style={{ minWidth: 40, padding: '4px 10px', fontSize: '0.78rem' }}
            >
              {p}
            </button>
          ))}
          <button
            className={`btn${range.preset === 'custom' ? ' btn--primary' : ''}`}
            onClick={range.activateCustom}
            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
          >
            Custom
          </button>

          {range.preset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input
                type="date" className="input"
                value={range.customFrom}
                max={range.customTo || range.today}
                onChange={e => range.setCustomFrom(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '3px 8px', width: 130 }}
              />
              <span style={{ color: 'var(--fg-muted)', fontSize: '0.72rem' }}>to</span>
              <input
                type="date" className="input"
                value={range.customTo}
                min={range.customFrom}
                max={range.today}
                onChange={e => range.setCustomTo(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '3px 8px', width: 130 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Range label */}
      <div style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginBottom: 16 }}>
        {from === to ? from : `${from} — ${to}`}
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {Icon({ size: 13, style: { marginRight: 5, verticalAlign: 'middle' } })}
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'food'        && <FoodSection     from={from} to={to} accessToken={accessToken} />}
      {tab === 'medications' && <MedsSection     from={from} to={to} accessToken={accessToken} />}
      {tab === 'workouts'    && <WorkoutsSection from={from} to={to} accessToken={accessToken} />}
      {tab === 'sleep'       && <SleepSection    from={from} to={to} accessToken={accessToken} />}
    </div>
  );
}
