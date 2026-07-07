import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';

const TODAY = new Date().toLocaleDateString('en-CA');
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const MEAL_COLORS = {
  breakfast: 'var(--orange)', lunch: 'var(--accent2)',
  dinner: 'var(--purple)', snack: 'var(--green2)', other: 'var(--muted)',
};

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SectionCard({ icon, title, badge, children }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon} {title}
        </div>
        {badge != null && <span className="mono text-xs text-muted">{badge}</span>}
      </div>
      <div className="card-body" style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  );
}

function EmptyRow({ text }) {
  return <div className="text-xs text-muted">{text}</div>;
}

function Divider() {
  return <div style={{ borderBottom: '1px solid var(--border)', margin: '2px 0' }} />;
}

// ── Day detail sections ───────────────────────────────────────────────────────

function _bundleKey(logs) {
  for (const log of logs ?? []) {
    if (log.bundleId) {
      const name = log.bundleName ||
        (log.notes?.startsWith('Logged via bundle: ') ? log.notes.slice(19) : null) ||
        'Bundle';
      return { id: log.bundleId, name };
    }
  }
  return null;
}

function _groupByBundle(items) {
  const bundleMap = {};
  const standalone = [];
  for (const item of items) {
    const b = _bundleKey(item.logs);
    if (b) {
      if (!bundleMap[b.id]) bundleMap[b.id] = { id: b.id, name: b.name, items: [] };
      bundleMap[b.id].items.push(item);
    } else {
      standalone.push(item);
    }
  }
  return { bundles: Object.values(bundleMap), standalone };
}

function MedsSection({ data }) {
  const loggedItems = (data?.items ?? []).filter(i => i.status !== 'pending');
  const [expanded, setExpanded] = useState({});

  const { bundles, standalone: standaloneDone } = _groupByBundle(loggedItems);
  const standalonePending = [];

  const renderMedRow = ({ medication, status, logs }, padLeft) => {
    const log = logs?.[0];
    const dotColor = status === 'taken' ? 'var(--green)' : status === 'skipped' ? 'var(--red)' : 'var(--muted)';
    const labelColor = status === 'taken' ? 'var(--green2)' : status === 'skipped' ? 'var(--red)' : 'var(--muted)';
    const label = status === 'taken' ? 'Taken' : status === 'skipped' ? 'Skipped' : 'Pending';
    return (
      <div key={medication.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
        paddingLeft: padLeft ? 10 : 0, opacity: status === 'pending' ? 0.5 : 1 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
        <span style={{ fontWeight: 600, fontSize: '0.78rem', flex: 1 }}>{medication.name}</span>
        {medication.dose && <span className="mono text-xs text-muted">{medication.dose}</span>}
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: labelColor }}>{label}</span>
        {log?.takenAt && <span className="text-xs text-muted" style={{ minWidth: 44 }}>{fmtTime(log.takenAt)}</span>}
      </div>
    );
  };

  return (
    <SectionCard
      icon={<img src="/icons/medicines@2x.png" width={16} height={16} className="png-icon" alt="" />}
      title="Medications"
      badge={loggedItems.length > 0 ? `${loggedItems.length} logged` : null}
    >
      {loggedItems.length === 0 ? <EmptyRow text="No medications logged" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Bundle groups */}
          {bundles.map(bundle => {
            const isExp = !!expanded[bundle.id];
            const bundleTotal = bundle.items.length;
            const allTaken = bundle.items.every(i => i.status === 'taken');
            const bundleDone = bundle.items.filter(i => i.status !== 'pending').length;
            const statusColor = allTaken ? 'var(--green2)' : 'var(--orange)';
            const statusLabel = allTaken ? 'All taken' : `${bundleDone}/${bundleTotal} taken`;
            return (
              <div key={bundle.id} style={{ borderRadius: 6, border: '1px solid var(--border)', overflow: 'clip', marginBottom: 3 }}>
                <button
                  onClick={() => setExpanded(e => ({ ...e, [bundle.id]: !e[bundle.id] }))}
                  style={{ width: '100%', background: 'var(--bg-2,var(--card2))', border: 'none', cursor: 'pointer',
                    padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}
                >
                  <Icons.Package size={12} style={{ flexShrink: 0, color: statusColor }} />
                  <span style={{ fontWeight: 700, fontSize: '0.78rem', flex: 1 }}>{bundle.name}</span>
                  <span style={{ fontSize: '0.7rem', color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                  <Icons.ChevronRight size={11} style={{ color: 'var(--muted)', flexShrink: 0,
                    transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
                {isExp && (
                  <div style={{ padding: '2px 10px 6px 10px', borderTop: '1px solid var(--border)' }}>
                    {bundle.items.map(item => renderMedRow(item, true))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone taken/skipped */}
          {standaloneDone.map(item => renderMedRow(item, false))}

          {/* Divider before pending */}
          {standalonePending.length > 0 && (standaloneDone.length > 0 || bundles.length > 0) && <Divider />}

          {/* Standalone pending */}
          {standalonePending.map(item => renderMedRow(item, false))}
        </div>
      )}
    </SectionCard>
  );
}

function FoodSection({ data }) {
  const totals = data?.totals ?? {};
  const meals = data?.meals ?? {};
  const logCount = data?.logCount ?? 0;
  const loggedMeals = MEAL_TYPES.filter(m => (meals[m]?.length ?? 0) > 0);

  return (
    <SectionCard
      icon={<Icons.Food size={13} />}
      title="Food & Nutrition"
      badge={logCount > 0 ? `${totals.calories?.toFixed(0) ?? 0} kcal` : null}
    >
      {logCount === 0 ? <EmptyRow text="No food logged" /> : (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Calories', val: totals.calories?.toFixed(0) ?? 0, color: 'var(--orange)' },
              { label: 'Protein',  val: `${totals.proteinG?.toFixed(0) ?? 0}g`, color: 'var(--accent2)' },
              { label: 'Carbs',    val: `${totals.carbsG?.toFixed(0) ?? 0}g`, color: 'var(--orange)' },
              { label: 'Fat',      val: `${totals.fatG?.toFixed(0) ?? 0}g`, color: 'var(--green2)' },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div style={{ fontSize: '1rem', fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {loggedMeals.map(meal => {
              const entries = meals[meal] ?? [];
              const mealCals = entries.reduce((s, e) => s + (e.nutritionSnapshot?.calories ?? 0), 0);
              return (
                <div key={meal}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'capitalize', color: MEAL_COLORS[meal] }}>{meal}</span>
                    <span className="mono text-xs text-muted">{mealCals.toFixed(0)} kcal</span>
                  </div>
                  {entries.map(e => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '3px 0 3px 10px', color: 'var(--muted2)', borderBottom: '1px solid var(--border)' }}>
                      <span>
                        {e.foodName}
                        {e.quantity !== 1 && <span className="text-xs text-muted" style={{ marginLeft: 5 }}>×{e.quantity}</span>}
                        {e.loggedAt && <span className="text-xs text-muted" style={{ marginLeft: 8 }}>{fmtTime(e.loggedAt)}</span>}
                      </span>
                      <span className="mono text-xs">{e.nutritionSnapshot?.calories?.toFixed(0)} kcal</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </SectionCard>
  );
}

const STAT_GROUPS = [
  { id: 'sleep',    label: 'Sleep',          color: '#8b5cf6', primaryKey: 'sleep_duration', test: k => k.startsWith('sleep_') || k === 'movement_awakening' },
  { id: 'heart',    label: 'Heart Rate',     color: '#ef4444', primaryKey: 'heart_rate_avg', test: k => k.startsWith('heart_rate') },
  { id: 'bp',       label: 'Blood Pressure', color: '#f97316', primaryKey: 'bp_systolic',    test: k => k.startsWith('bp_') },
  { id: 'stress',   label: 'Stress',         color: '#f59e0b', primaryKey: 'stress_avg',     test: k => k.startsWith('stress_') },
  { id: 'skin_temp',label: 'Skin Temp',      color: '#06b6d4', primaryKey: 'skin_temp_avg',  test: k => k.startsWith('skin_temp') },
  { id: 'recovery', label: 'Recovery',       color: '#10b981', primaryKey: 'physical_recovery', test: k => k === 'mental_recovery' || k === 'physical_recovery' },
  { id: 'activity', label: 'Activity',       color: '#22c55e', primaryKey: 'steps',          test: k => k === 'steps' || k === 'calories_burned' },
  { id: 'body',     label: 'Body',           color: '#a78bfa', primaryKey: 'weight',         test: k => k === 'weight' || k === 'body_fat' },
  { id: 'temp',     label: 'Temperature',    color: '#f43f5e', primaryKey: 'body_temp',      test: k => k === 'body_temp' },
];

function groupReadings(readings) {
  const usedIds = new Set();
  const groups = [];
  for (const grp of STAT_GROUPS) {
    const items = readings.filter(r => grp.test(r.metricKey));
    if (items.length > 0) {
      items.forEach(r => usedIds.add(r.id));
      groups.push({ ...grp, items });
    }
  }
  const standalone = readings.filter(r => !usedIds.has(r.id));
  return { groups, standalone };
}

function StatRow({ r, indent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
      paddingLeft: indent ? 10 : 0, borderBottom: '1px solid var(--border)' }}>
      {r.color && <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0 }} />}
      <span style={{ fontWeight: 600, fontSize: '0.78rem', flex: 1 }}>{r.metricName}</span>
      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: r.color ?? 'var(--accent2)' }}>{r.value}</span>
      <span className="text-xs text-muted">{r.unit}</span>
      {r.takenAt && <span className="text-xs text-muted" style={{ minWidth: 44 }}>{fmtTime(r.takenAt)}</span>}
    </div>
  );
}

function StatsSection({ readings }) {
  const [expanded, setExpanded] = useState({});
  const { groups, standalone } = groupReadings(readings);

  return (
    <SectionCard
      icon={<img src="/icons/heart_cardiogram@2x.png" width={16} height={16} className="png-icon" alt="" />}
      title="Health Stats"
      badge={readings.length > 0 ? `${readings.length} reading${readings.length !== 1 ? 's' : ''}` : null}
    >
      {readings.length === 0 ? <EmptyRow text="No readings logged" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* Grouped categories */}
          {groups.map(grp => {
            if (grp.items.length === 1) {
              return <StatRow key={grp.items[0].id} r={grp.items[0]} indent={false} />;
            }
            const isExp = !!expanded[grp.id];
            const primary = grp.items.find(r => r.metricKey === grp.primaryKey) ?? grp.items[0];
            const bpSys = grp.id === 'bp' && grp.items.find(r => r.metricKey === 'bp_systolic');
            const bpDia = grp.id === 'bp' && grp.items.find(r => r.metricKey === 'bp_diastolic');
            const summary = grp.id === 'bp' && bpSys && bpDia
              ? `${bpSys.value}/${bpDia.value} mmHg`
              : primary ? `${primary.value}${primary.unit ? ' ' + primary.unit : ''}` : `${grp.items.length} readings`;
            return (
              <div key={grp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <button
                  onClick={() => setExpanded(e => ({ ...e, [grp.id]: !e[grp.id] }))}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '7px 0', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: grp.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: '0.78rem', flex: 1, color: 'var(--fg,var(--text))' }}>{grp.label}</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: grp.color }}>{summary}</span>
                  <span className="text-xs text-muted" style={{ marginLeft: 4 }}>+{grp.items.length}</span>
                  <Icons.ChevronRight size={11} style={{ color: 'var(--muted)', flexShrink: 0,
                    transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
                {isExp && (
                  <div style={{ paddingBottom: 4 }}>
                    {grp.items.map(r => <StatRow key={r.id} r={r} indent={true} />)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped standalone readings */}
          {standalone.map(r => <StatRow key={r.id} r={r} indent={false} />)}
        </div>
      )}
    </SectionCard>
  );
}

function WorkoutsSection({ sessions }) {
  const totalDuration = sessions.reduce((s, w) => s + (w.durationSeconds ?? 0), 0);
  return (
    <SectionCard
      icon={<img src="/icons/exercise@2x.png" width={16} height={16} className="png-icon" alt="" />}
      title="Workouts"
      badge={sessions.length > 0 ? (totalDuration > 0 ? fmtDuration(totalDuration) : `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`) : null}
    >
      {sessions.length === 0 ? <EmptyRow text="No workouts logged" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessions.map(s => (
            <div key={s.id} style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{s.name}</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  {s.durationSeconds > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--muted2)' }}>
                      <Icons.Clock size={11} /> {fmtDuration(s.durationSeconds)}
                    </span>
                  )}
                  {s.startedAt && <span className="text-xs text-muted">{fmtTime(s.startedAt)}</span>}
                </div>
              </div>
              {s.exercises?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {s.exercises.slice(0, 5).map((ex, i) => (
                    <span key={i} style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', color: 'var(--purple)', borderRadius: 5, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 600 }}>
                      {ex.exerciseName}
                    </span>
                  ))}
                  {s.exercises.length > 5 && <span className="text-xs text-muted" style={{ alignSelf: 'center' }}>+{s.exercises.length - 5} more</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── Month calendar grid ───────────────────────────────────────────────────────

function DayCell({ day, dateStr, stats, isToday, isFuture, onClick }) {
  const medColor = stats?.medsTotal > 0
    ? stats.medsTaken === stats.medsTotal ? '#10b981'
      : stats.medsTaken > 0 ? '#f59e0b'
      : '#ef4444'
    : null;

  const hasActivity = stats && (stats.logCount > 0 || stats.medsTotal > 0 || stats.workouts > 0 || stats.statsCount > 0);

  return (
    <div
      onClick={isFuture ? undefined : onClick}
      style={{
        background: isToday ? 'rgba(20,184,166,0.06)' : 'var(--bg2)',
        border: `${isToday ? '1.5px' : '1px'} solid ${isToday ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: '7px 9px 8px',
        minHeight: 82,
        cursor: isFuture ? 'default' : 'pointer',
        opacity: isFuture ? 0.28 : 1,
        transition: 'background 0.12s',
        boxSizing: 'border-box',
      }}
      onMouseEnter={e => { if (!isFuture) e.currentTarget.style.background = isToday ? 'rgba(20,184,166,0.1)' : 'var(--bg3)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = isToday ? 'rgba(20,184,166,0.06)' : 'var(--bg2)'; }}
    >
      {/* Day number */}
      <div style={{ marginBottom: hasActivity ? 4 : 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: '50%',
          background: isToday ? 'var(--accent)' : 'transparent',
          color: isToday ? '#fff' : 'var(--fg)',
          fontSize: '0.73rem', fontWeight: isToday ? 700 : 400,
          lineHeight: 1,
        }}>
          {day}
        </span>
      </div>

      {/* Calories */}
      {stats?.calories > 0 && (
        <div style={{ fontSize: '0.6rem', color: '#fb923c', fontWeight: 600, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {stats.calories.toLocaleString()} kcal
        </div>
      )}

      {/* Med compliance */}
      {stats?.medsTotal > 0 && (
        <div style={{ fontSize: '0.6rem', color: medColor, fontWeight: 600, lineHeight: 1.5 }}>
          {stats.medsTaken}/{stats.medsTotal} meds
        </div>
      )}

      {/* Workout + stats chips */}
      {(stats?.workouts > 0 || stats?.statsCount > 0) && (
        <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
          {stats.workouts > 0 && (
            <span style={{ fontSize: '0.55rem', fontWeight: 700, background: 'rgba(168,85,247,0.14)', color: '#a78bfa', borderRadius: 3, padding: '1px 5px' }}>
              {stats.workouts} wkt
            </span>
          )}
          {stats.statsCount > 0 && (
            <span style={{ fontSize: '0.55rem', fontWeight: 700, background: 'rgba(96,165,250,0.14)', color: '#60a5fa', borderRadius: 3, padding: '1px 5px' }}>
              {stats.statsCount} stat{stats.statsCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MonthGrid({ year, month, dayStats, onSelectDay }) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
        {DOW_LABELS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.65rem', fontWeight: 600, color: 'var(--muted)', padding: '4px 0 6px' }}>
            {d}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} style={{ minHeight: 82 }} />;
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          return (
            <DayCell
              key={dateStr}
              day={day}
              dateStr={dateStr}
              stats={dayStats[dateStr]}
              isToday={dateStr === TODAY}
              isFuture={dateStr > TODAY}
              onClick={() => onSelectDay(dateStr)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Day detail modal ──────────────────────────────────────────────────────────

function DayModal({ initialDate, accessToken, onClose }) {
  const [date, setDate] = useState(initialDate);
  const [medsData, setMedsData] = useState(null);
  const [foodData, setFoodData] = useState(null);
  const [statsData, setStatsData] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const tzOffset = new Date().getTimezoneOffset();
      // Build UTC-equivalent ISO strings for the local day boundaries (no Z suffix — backend parses as naive UTC)
      const fromISO = new Date(`${d}T00:00:00`).toISOString().slice(0, 19);
      const toISO   = new Date(`${d}T23:59:59`).toISOString().slice(0, 19);
      const [meds, food, stats, workouts] = await Promise.all([
        api.get(`/medications/today?date=${d}`, accessToken).catch(() => null),
        api.get(`/food/summary?date=${d}&tz_offset=${tzOffset}`, accessToken).catch(() => null),
        api.get(`/stats/readings?date_from=${fromISO}&date_to=${toISO}&limit=100`, accessToken).catch(() => []),
        api.get(`/workouts/sessions?date_from=${fromISO}&date_to=${toISO}&limit=50`, accessToken).catch(() => ({ sessions: [] })),
      ]);
      setMedsData(meds);
      setFoodData(food);
      setStatsData(Array.isArray(stats) ? stats : []);
      setSessions(workouts?.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(date); }, [date, load]);

  const shiftDay = (delta) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const next = d.toLocaleDateString('en-CA');
    if (next <= TODAY) setDate(next);
  };

  const fmtLabel = (d) => {
    const dt = new Date(d + 'T12:00:00');
    if (d === TODAY) return 'Today — ' + dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', padding: 0 }}>
        {/* Sticky header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px', flexShrink: 0 }} onClick={() => shiftDay(-1)}>
            <Icons.ChevronLeft size={13} />
          </button>
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: '0.88rem' }}>
            {fmtLabel(date)}
          </span>
          <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px', flexShrink: 0 }} disabled={date === TODAY} onClick={() => shiftDay(1)}>
            <Icons.ChevronRight size={13} />
          </button>
          <button className="modal-close" style={{ marginLeft: 4, flexShrink: 0 }} onClick={onClose}>
            <Icons.X size={16} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <div className="empty-state"><div className="text-muted">Loading…</div></div>
          ) : (
            <>
              <StatsSection readings={statsData} />
              <FoodSection data={foodData} />
              <WorkoutsSection sessions={sessions} />
              <MedsSection data={medsData} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Calendar() {
  const { accessToken } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [dayStats, setDayStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);

  const loadMonth = useCallback(async (y, m) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await api.get(`/calendar/month?year=${y}&month=${m}&tz_offset=${new Date().getTimezoneOffset()}`, accessToken);
      setDayStats(data.days ?? {});
    } catch {
      setDayStats({});
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { loadMonth(year, month); }, [year, month, loadMonth]);

  const shiftMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (d > currentMonth) return;
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  // Month-level totals for the summary strip
  const monthTotals = Object.values(dayStats).reduce(
    (acc, d) => ({
      activeDays: acc.activeDays + (d.logCount > 0 || d.workouts > 0 ? 1 : 0),
      calories: acc.calories + d.calories,
      workouts: acc.workouts + d.workouts,
      medDays: acc.medDays + (d.medsTotal > 0 && d.medsTaken === d.medsTotal ? 1 : 0),
      medTotalDays: acc.medTotalDays + (d.medsTotal > 0 ? 1 : 0),
    }),
    { activeDays: 0, calories: 0, workouts: 0, medDays: 0, medTotalDays: 0 }
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Calendar</div>
          <div className="text-muted text-sm mt-1">Click any day to view full details</div>
        </div>
      </div>

      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-sec btn-sm" style={{ padding: '5px 10px' }} onClick={() => shiftMonth(-1)}>
          <Icons.ChevronLeft size={14} />
        </button>
        <span style={{ fontSize: '1rem', fontWeight: 700, minWidth: 200, textAlign: 'center' }}>
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button className="btn btn-sec btn-sm" style={{ padding: '5px 10px' }} disabled={isCurrentMonth} onClick={() => shiftMonth(1)}>
          <Icons.ChevronRight size={14} />
        </button>
        {!isCurrentMonth && (
          <button className="btn btn-sec btn-sm" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); }}>
            This month
          </button>
        )}
      </div>

      {/* Month summary strip */}
      {!loading && monthTotals.activeDays > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: 'Active days', val: monthTotals.activeDays, color: 'var(--accent2)' },
            { label: 'Total calories', val: `${Math.round(monthTotals.calories / 1000).toFixed(1)}k`, color: '#fb923c' },
            { label: 'Workouts', val: monthTotals.workouts, color: '#a78bfa' },
            ...(monthTotals.medTotalDays > 0 ? [{ label: 'Meds compliance', val: `${Math.round(monthTotals.medDays / monthTotals.medTotalDays * 100)}%`, color: '#10b981' }] : []),
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: '0.62rem', color: 'var(--muted)', fontWeight: 500 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { color: '#fb923c', label: 'Calories' },
          { color: '#10b981', label: 'All meds taken' },
          { color: '#f59e0b', label: 'Partial meds' },
          { color: '#ef4444', label: 'Meds skipped' },
          { color: '#a78bfa', label: 'Workout' },
          { color: '#60a5fa', label: 'Health reading' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.63rem', color: 'var(--muted2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
            {label}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="empty-state"><div className="text-muted">Loading…</div></div>
      ) : (
        <MonthGrid year={year} month={month} dayStats={dayStats} onSelectDay={setSelectedDate} />
      )}

      {selectedDate && (
        <DayModal
          initialDate={selectedDate}
          accessToken={accessToken}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </>
  );
}
