import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';
import LogFoodModal from '../components/LogFoodModal';

function localToday() {
  return new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, not UTC
}

function offsetDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

function formatDateLabel(dateStr) {
  const today = localToday();
  if (dateStr === today) return 'Today';
  const yesterday = offsetDate(today, -1);
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Half-circle (semicircle) gauge ────────────────────────────────────────────

function HalfRing({ value, max, color, label, sublabel }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 38;
  const cx = 52, cy = 50;
  const circ = 2 * Math.PI * r;
  const halfCirc = circ / 2;

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="104" height="62" viewBox="0 0 104 62" style={{ overflow: 'visible' }}>
        {/* Rotate -180° so stroke starts at the left end of the semicircle */}
        <g transform={`rotate(-180, ${cx}, ${cy})`}>
          {/* Background track */}
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="var(--bg-3, #1e293b)" strokeWidth="7"
            strokeDasharray={`${halfCirc} ${halfCirc}`} strokeLinecap="round" />
          {/* Fill */}
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={color} strokeWidth="7"
            strokeDasharray={`${pct * halfCirc} ${circ - pct * halfCirc}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        </g>
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="14" fontWeight="700"
          fill={pct >= 1 ? color : 'var(--fg, #f1f5f9)'}>
          {Math.round(value).toLocaleString()}
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize="7" fill="var(--muted, #94a3b8)">
          {sublabel}
        </text>
      </svg>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

// ── Calorie balance card ──────────────────────────────────────────────────────

function CalorieBalanceCard({ caloriesIn, caloriesOut, goal }) {
  const net = Math.round(caloriesIn - caloriesOut);
  const surplus = net > 0;
  const netColor = surplus
    ? (net > 500 ? '#ef4444' : '#f97316')
    : '#22c55e';
  const scale = Math.max(goal, caloriesIn, 1);
  const inPct  = Math.min(100, (caloriesIn  / scale) * 100);
  const outPct = Math.min(100, (caloriesOut / scale) * 100);
  const goalPct = Math.min(100, (goal / scale) * 100);

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 10 }}>
        Calorie Balance
      </div>

      {/* Two gauges + net in centre */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 4 }}>
        <HalfRing value={caloriesIn}  max={scale} color="#f97316" label="Calories In"  sublabel="kcal eaten"  />

        <div style={{ textAlign: 'center', padding: '0 10px' }}>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: netColor, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {surplus ? '+' : ''}{net.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.58rem', color: 'var(--muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            kcal net
          </div>
          <div style={{ fontSize: '0.64rem', fontWeight: 700, color: netColor, marginTop: 3 }}>
            {surplus ? '▲ Surplus' : '▼ Deficit'}
          </div>
        </div>

        <HalfRing value={caloriesOut} max={scale} color="#22c55e" label="Calories Burned" sublabel="kcal burned" />
      </div>

      {/* Combined balance bar */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{ position: 'relative', height: 8, background: 'var(--bg-3, #1e293b)', borderRadius: 4, overflow: 'hidden' }}>
          {/* Calories in — orange, from left */}
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${inPct}%`, background: '#f97316', borderRadius: 4, transition: 'width 0.6s ease' }} />
          {/* Calories out — green, overlaid from left (shows as green stripe within the orange) */}
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${outPct}%`, background: '#22c55e', borderRadius: 4, opacity: 0.85, transition: 'width 0.6s ease' }} />
          {/* Goal marker */}
          <div style={{ position: 'absolute', left: `${goalPct}%`, top: 0, height: '100%', width: 2, background: 'var(--fg)', opacity: 0.35, transform: 'translateX(-1px)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: '0.58rem', color: 'var(--muted)' }}>
          <span style={{ color: '#f97316', fontWeight: 600 }}>{Math.round(caloriesIn).toLocaleString()} eaten</span>
          <span>goal {goal.toLocaleString()} kcal</span>
          <span style={{ color: '#22c55e', fontWeight: 600 }}>{Math.round(caloriesOut).toLocaleString()} burned</span>
        </div>
      </div>
    </div>
  );
}

function RingGauge({ label, value, goal, unit, color }) {
  const pct = goal ? Math.min(1, value / goal) : 0;
  const r = 34;
  const circ = 2 * Math.PI * r;
  const filled = pct * circ;
  const remaining = Math.max(0, (goal || 0) - value);

  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ position: 'relative', width: 86, height: 86, margin: '0 auto' }}>
        <svg width="86" height="86" viewBox="0 0 86 86" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="43" cy="43" r={r} fill="none" stroke="var(--bg3)" strokeWidth="8" />
          <circle cx="43" cy="43" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.2 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: pct >= 1 ? 'var(--red)' : 'var(--fg)' }}>{Math.round(remaining)}</div>
          <div style={{ fontSize: '0.5rem', color: 'var(--muted)', marginTop: 1 }}>{unit} left</div>
        </div>
      </div>
      <div style={{ marginTop: 6, padding: '0 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: 'var(--muted)', marginBottom: 2 }}>
          <span>{Math.round(value)}</span>
          <span>{goal ?? '–'}</span>
        </div>
        <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
        </div>
      </div>
    </div>
  );
}

// ── Activity stats card ───────────────────────────────────────────────────────

function ActivityStatsCard({ steps, caloriesBurned, heartRate, workoutsToday }) {
  const STEP_GOAL = 10000;
  const stepPct = Math.min(1, steps / STEP_GOAL);

  const stats = [
    {
      label: 'Steps',
      value: steps > 0 ? steps.toLocaleString() : '—',
      color: '#10b981',
      icon: Icons.HealthStats,
      bar: steps > 0 ? stepPct : null,
      barColor: '#10b981',
      sub: steps > 0 ? `${Math.round(stepPct * 100)}% of ${STEP_GOAL.toLocaleString()}` : null,
    },
    {
      label: 'Calories Burned',
      value: caloriesBurned > 0 ? `${Math.round(caloriesBurned).toLocaleString()} kcal` : '—',
      color: '#f97316',
      icon: Icons.Flame,
    },
    {
      label: 'Avg Heart Rate',
      value: heartRate > 0 ? `${Math.round(heartRate)} bpm` : '—',
      color: '#ef4444',
      icon: Icons.Heart,
    },
    {
      label: 'Activity',
      value: workoutsToday > 0 ? `${workoutsToday} workout${workoutsToday !== 1 ? 's' : ''}` : '—',
      color: '#a78bfa',
      icon: Icons.Dumbbell,
    },
  ];

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 12 }}>
        Today's Activity
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {stats.map(({ label, value, color, icon: Icon, bar, sub }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 6 }}><Icon size={17} style={{ color }} /></div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: value === '—' ? 'var(--muted)' : 'var(--fg)', lineHeight: 1.2 }}>
              {value}
            </div>
            <div style={{ fontSize: '0.58rem', color: 'var(--muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </div>
            {sub && <div style={{ fontSize: '0.58rem', color: 'var(--muted)', marginTop: 1 }}>{sub}</div>}
            {bar != null && (
              <div style={{ height: 3, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
                <div style={{ height: '100%', width: `${bar * 100}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sleep card ────────────────────────────────────────────────────────────────

function fmtSleep(min) {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Sleep ring constants ──────────────────────────────────────────────────────
const SLEEP_GOAL_MIN   = 480; // 8 h
const DEEP_GOAL_MIN    = 90;
const REM_GOAL_MIN     = 90;

function SleepRings({ total, deep, rem }) {
  const cx = 56, cy = 56;
  const rings = [
    { r: 46, goal: SLEEP_GOAL_MIN, value: total, color: '#a855f7', track: '#a855f722' },
    { r: 34, goal: DEEP_GOAL_MIN,  value: deep,  color: '#7c3aed', track: '#7c3aed22' },
    { r: 22, goal: REM_GOAL_MIN,   value: rem,   color: '#c084fc', track: '#c084fc22' },
  ];
  return (
    <svg width={112} height={112} viewBox="0 0 112 112" style={{ flexShrink: 0 }}>
      {rings.map(({ r, goal, value, color, track }) => {
        const circ = 2 * Math.PI * r;
        const pct  = goal > 0 ? Math.min(1, value / goal) : 0;
        return (
          <g key={r} transform={`rotate(-90, ${cx}, ${cy})`}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={track} strokeWidth={10} />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={`${pct * circ} ${circ}`}
              style={{ transition: 'stroke-dasharray 0.7s ease' }} />
          </g>
        );
      })}
    </svg>
  );
}

function SleepCard({ total, deep, rem, light, date }) {
  const hasData = total > 0;

  const dateLabel = (() => {
    if (!date) return 'Last recorded';
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return 'Last night';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })();

  const rows = [
    { icon: '🌙', label: 'Total sleep',  value: fmtSleep(total), unit: '', color: '#a855f7' },
    { icon: '🔵', label: 'Deep sleep',   value: fmtSleep(deep),  unit: '', color: '#7c3aed' },
    { icon: '◐', label: 'Light sleep',   value: fmtSleep(light), unit: '', color: '#818cf8' },
    { icon: '💜', label: 'REM sleep',    value: fmtSleep(rem),   unit: '', color: '#c084fc' },
  ];

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
          Sleep
        </span>
        {hasData && (
          <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontStyle: 'italic' }}>{dateLabel}</span>
        )}
      </div>

      {!hasData ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.78rem', padding: '8px 0' }}>
          No sleep data recorded
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Left: metric rows */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map(({ icon, label, value, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: color + '22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.85rem' }}>
                  {icon}
                </div>
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: value === '—' ? 'var(--muted)' : 'var(--text)', lineHeight: 1.1 }}>
                    {value}
                  </div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: rings */}
          <SleepRings total={total} deep={deep} rem={rem} />
        </div>
      )}

      {/* Stage bar */}
      {hasData && (light > 0 || deep > 0 || rem > 0) && (
        <div style={{ marginTop: 12, height: 5, borderRadius: 3, overflow: 'hidden', display: 'flex', gap: 1 }}>
          {[
            { value: deep,  color: '#7c3aed' },
            { value: rem,   color: '#c084fc' },
            { value: light, color: '#818cf8' },
            { value: Math.max(0, total - deep - rem - light), color: '#f87171' },
          ].filter(s => s.value > 0).map((s, i) => (
            <div key={i} style={{ height: '100%', flex: s.value, background: s.color, transition: 'flex 0.5s ease' }} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { accessToken, profile } = useAuth();
  const navigate = useNavigate();
  const [viewDate, setViewDate] = useState(localToday);
  const [summary, setSummary] = useState(null);
  const [goals, setGoals] = useState({ caloriesPerDay: 2000, proteinGPerDay: 150, carbsGPerDay: 275, fatGPerDay: 73 });
  const [loading, setLoading] = useState(true);
  const [quickActions, setQuickActions] = useState({ meds: [], bundles: [], templates: [], foods: [], foodMeals: [] });
  const [qaLogging, setQaLogging] = useState({});
  const [qaResult, setQaResult] = useState({});
  const [showLogFood, setShowLogFood] = useState(false);
  const [caloriesOut, setCaloriesOut] = useState(0);
  const [activityStats, setActivityStats] = useState({ steps: 0, caloriesBurned: 0, heartRate: 0, workoutsToday: 0 });
  const [sleepStats, setSleepStats] = useState({ total: 0, deep: 0, rem: 0, light: 0 });
  const [activityRefreshAt, setActivityRefreshAt] = useState(0);

  const isToday = viewDate === localToday();

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      api.get(`/food/summary?date=${viewDate}&tz_offset=${new Date().getTimezoneOffset()}`, accessToken),
      api.get('/me', accessToken),
    ]).then(([s, user]) => {
      setSummary(s);
      const p = user?.preferences ?? {};
      setGoals({
        caloriesPerDay: p.caloriesPerDay || 2000,
        proteinGPerDay: p.proteinGPerDay || 150,
        carbsGPerDay: p.carbsGPerDay || 275,
        fatGPerDay: p.fatGPerDay || 73,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [accessToken, viewDate]);

  // Auto-refresh activity stats every 90s when viewing today so Sparky syncs show up
  useEffect(() => {
    if (!isToday) return;
    const timer = setInterval(() => setActivityRefreshAt(Date.now()), 90000);
    return () => clearInterval(timer);
  }, [isToday]);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      api.get('/medications', accessToken).catch(() => []),
      api.get('/medications/bundles/list', accessToken).catch(() => []),
      api.get('/workouts/templates', accessToken).catch(() => []),
      api.get('/food/items?scope=all&limit=100', accessToken).catch(() => []),
      api.get('/food/meals', accessToken).catch(() => []),
      api.get('/workouts/dashboard', accessToken).catch(() => ({ recentSessions: [] })),
      // Daily totals (steps, calories) are midnight-stamped and few per day.
      // Heart rate can be hundreds of interval samples per day, so it gets its
      // own query — sharing one limited query lets HR crowd the totals out.
      api.get(`/stats/readings?metric_keys=steps,calories_burned&date_from=${viewDate}T00:00:00&date_to=${viewDate}T23:59:59&limit=50`, accessToken).catch(() => []),
      api.get(`/stats/readings?metric_keys=heart_rate_avg,heart_rate&date_from=${viewDate}T00:00:00&date_to=${viewDate}T23:59:59&limit=1000`, accessToken).catch(() => []),
      // Sleep: look back 7 days from viewDate to catch the most recent sleep session
      api.get(`/stats/readings?metric_keys=sleep_duration,sleep_deep,sleep_rem,sleep_light&date_from=${offsetDate(viewDate, -7)}T00:00:00&date_to=${viewDate}T23:59:59&limit=2000`, accessToken).catch(() => []),
    ]).then(([meds, bundles, templates, foods, foodMeals, wkDash, dailyReadings, hrReadings, sleepReadings]) => {
      setQuickActions({
        meds: (Array.isArray(meds) ? meds : []).filter(m => m.active && m.quickAction),
        bundles: (Array.isArray(bundles) ? bundles : []).filter(b => b.quickAction),
        templates: (Array.isArray(templates) ? templates : []).filter(t => t.quickAction),
        foods: (Array.isArray(foods) ? foods : []).filter(f => f.quickAction),
        foodMeals: (Array.isArray(foodMeals) ? foodMeals : []).filter(m => m.quickAction),
      });

      const todayStart = new Date(`${viewDate}T00:00:00`);
      const todayEnd   = new Date(todayStart.getTime() + 86400000);

      // Calories from completed cardio sets (fallback when no health reading)
      const workoutBurned = (wkDash.recentSessions ?? [])
        .filter(s => { const d = new Date(s.startedAt); return d >= todayStart && d < todayEnd; })
        .reduce((tot, s) =>
          tot + (s.exercises ?? []).reduce((ex, e) =>
            ex + (e.sets ?? []).reduce((st, set) =>
              st + (set.completed && set.calories ? set.calories : 0), 0), 0), 0);

      // Latest reading per metric key — today only for cumulative daily metrics.
      // Daily totals are stamped midnight UTC while todayStart is local midnight,
      // so match on the date part of takenAt instead of comparing Date objects.
      const byKey = {};
      (dailyReadings ?? []).filter(r => (r.takenAt || '').slice(0, 10) === viewDate).forEach(r => {
        const prev = byKey[r.metricKey];
        if (!prev || new Date(r.takenAt) > new Date(prev.takenAt)) byKey[r.metricKey] = r;
      });

      // Average the day's heart-rate samples (imports deliver interval samples;
      // "latest sample" would just be whatever was measured most recently).
      const hrSamples = (hrReadings ?? []).filter(r => (r.takenAt || '').slice(0, 10) === viewDate);
      const heartRate = hrSamples.length
        ? Math.round(hrSamples.reduce((t, r) => t + (r.value || 0), 0) / hrSamples.length)
        : 0;

      const steps          = byKey['steps']?.value            || 0;
      const healthBurned   = byKey['calories_burned']?.value  || 0;
      const caloriesBurned = healthBurned > 0 ? healthBurned : workoutBurned;
      const workoutsToday  = (wkDash.recentSessions ?? [])
        .filter(s => { const d = new Date(s.startedAt); return d >= todayStart && d < todayEnd; }).length;

      setCaloriesOut(caloriesBurned);
      setActivityStats({ steps, caloriesBurned, heartRate, workoutsToday });

      // Pick most recent sleep reading per key from the 7-day window
      const sleepByKey = {};
      (sleepReadings ?? []).forEach(r => {
        const prev = sleepByKey[r.metricKey];
        if (!prev || new Date(r.takenAt) > new Date(prev.takenAt)) sleepByKey[r.metricKey] = r;
      });
      setSleepStats({
        total: sleepByKey['sleep_duration']?.value || 0,
        deep:  sleepByKey['sleep_deep']?.value     || 0,
        rem:   sleepByKey['sleep_rem']?.value      || 0,
        light: sleepByKey['sleep_light']?.value    || 0,
        date:  sleepByKey['sleep_duration']?.takenAt || null,
      });
    }).catch(err => console.error('[dashboard] data load error:', err));
  }, [accessToken, viewDate, activityRefreshAt]);

  const logMed = async (med) => {
    const key = `med-${med.id}`;
    setQaLogging(l => ({ ...l, [key]: true }));
    try {
      await api.post('/medications/logs', {
        medicationId: med.id,
        status: 'taken',
        scheduledFor: TODAY,
        takenAt: new Date().toISOString(),
      }, accessToken);
      setQaResult(r => ({ ...r, [key]: 'done' }));
      setTimeout(() => setQaResult(r => ({ ...r, [key]: null })), 2500);
    } finally {
      setQaLogging(l => ({ ...l, [key]: false }));
    }
  };

  const logBundle = async (bundle) => {
    const key = `bundle-${bundle.id}`;
    setQaLogging(l => ({ ...l, [key]: true }));
    try {
      const res = await api.post(`/medications/bundles/${bundle.id}/log`, { status: 'taken' }, accessToken);
      setQaResult(r => ({ ...r, [key]: res }));
      setTimeout(() => setQaResult(r => ({ ...r, [key]: null })), 2500);
    } finally {
      setQaLogging(l => ({ ...l, [key]: false }));
    }
  };

  const logFood = async (food) => {
    const key = `food-${food.id}`;
    setQaLogging(l => ({ ...l, [key]: true }));
    try {
      const h = new Date().getHours();
      const mealType = h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 19 ? 'dinner' : 'snack';
      await api.post('/food/logs', {
        foodItemId: food.id,
        quantity: 1,
        mealType,
        loggedAt: new Date().toISOString(),
      }, accessToken);
      setQaResult(r => ({ ...r, [key]: 'done' }));
      setTimeout(() => setQaResult(r => ({ ...r, [key]: null })), 2500);
    } finally {
      setQaLogging(l => ({ ...l, [key]: false }));
    }
  };

  const logFoodMeal = async (meal) => {
    const key = `foodmeal-${meal.id}`;
    setQaLogging(l => ({ ...l, [key]: true }));
    try {
      const res = await api.post(`/food/meals/${meal.id}/log`, {}, accessToken);
      setQaResult(r => ({ ...r, [key]: res }));
      setTimeout(() => setQaResult(r => ({ ...r, [key]: null })), 2500);
    } finally {
      setQaLogging(l => ({ ...l, [key]: false }));
    }
  };

  const hasQuickActions = quickActions.meds.length + quickActions.bundles.length + quickActions.templates.length +
    quickActions.foods.length + quickActions.foodMeals.length > 0;

  const totals = summary?.totals ?? {};
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{greeting}{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <button
              className="btn btn-sm"
              style={{ padding: '2px 7px', lineHeight: 1 }}
              onClick={() => setViewDate(d => offsetDate(d, -1))}
              aria-label="Previous day"
            >‹</button>
            <span
              className="text-muted text-sm"
              style={{ minWidth: 90, textAlign: 'center', fontWeight: isToday ? 600 : 400, cursor: isToday ? 'default' : 'pointer' }}
              onClick={() => setViewDate(localToday())}
              title={isToday ? '' : 'Back to today'}
            >{formatDateLabel(viewDate)}</span>
            <button
              className="btn btn-sm"
              style={{ padding: '2px 7px', lineHeight: 1 }}
              onClick={() => setViewDate(d => offsetDate(d, 1))}
              disabled={isToday}
              aria-label="Next day"
            >›</button>
          </div>
        </div>
        <button
          className="dash-add-food-btn"
          onClick={() => setShowLogFood(true)}
          title="Log food"
        >
          <Icons.Plus size={22} />
        </button>
      </div>

      {/* Macro Ring Gauges */}
      <div className="card" style={{ padding: '16px 14px', marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <RingGauge label="Calories" value={totals.calories || 0} goal={goals.caloriesPerDay} unit="kcal" color="#14b8a6" />
          <RingGauge label="Carbs" value={totals.carbsG || 0} goal={goals.carbsGPerDay} unit="g" color="#a78bfa" />
          <RingGauge label="Protein" value={totals.proteinG || 0} goal={goals.proteinGPerDay} unit="g" color="#60a5fa" />
          <RingGauge label="Fat" value={totals.fatG || 0} goal={goals.fatGPerDay} unit="g" color="#fb923c" />
        </div>
      </div>

      {/* Calorie Balance Gauge */}
      <CalorieBalanceCard
        caloriesIn={totals.calories || 0}
        caloriesOut={caloriesOut}
        goal={goals.caloriesPerDay}
      />

      {/* Activity Stats */}
      <ActivityStatsCard
        steps={activityStats.steps}
        caloriesBurned={activityStats.caloriesBurned}
        heartRate={activityStats.heartRate}
        workoutsToday={activityStats.workoutsToday}
      />

      {/* Sleep */}
      <SleepCard
        total={sleepStats.total}
        deep={sleepStats.deep}
        rem={sleepStats.rem}
        light={sleepStats.light}
        date={sleepStats.date}
      />

      {/* Quick Actions */}
      {hasQuickActions && (
        <div className="card" style={{ padding: '12px 14px', marginBottom: 4 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginBottom: 10 }}>
            Quick Actions
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {quickActions.meds.map(med => {
              const key = `med-${med.id}`;
              const done = qaResult[key] === 'done';
              return (
                <button
                  key={med.id}
                  className="btn btn-sm qa-tile"
                  style={{ background: done ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--green2)' }}
                  onClick={() => logMed(med)}
                  disabled={qaLogging[key] || done}
                  title={`Log ${med.name}${med.dose ? ` ${med.dose}` : ''} as taken`}
                >
                  {done ? <Icons.Check size={14} /> : <Icons.Pill size={14} />}
                  <span>{qaLogging[key] ? 'Logging…' : done ? 'Taken' : `${med.name}${med.dose ? ` ${med.dose}` : ''}`}</span>
                </button>
              );
            })}
            {quickActions.bundles.map(bundle => {
              const key = `bundle-${bundle.id}`;
              const res = qaResult[key];
              return (
                <button
                  key={bundle.id}
                  className="btn btn-sm qa-tile"
                  style={{ background: res ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--green2)' }}
                  onClick={() => logBundle(bundle)}
                  disabled={qaLogging[key] || !!res}
                  title={`Log all medications in "${bundle.name}" as taken`}
                >
                  {res ? <Icons.Check size={14} /> : <Icons.Package size={14} />}
                  <span>{qaLogging[key]
                    ? 'Logging…'
                    : res
                      ? `${res.logged > 0 ? `${res.logged} logged` : 'All done'}`
                      : bundle.name}</span>
                </button>
              );
            })}
            {quickActions.templates.map(t => (
              <button
                key={t.id}
                className="btn btn-sm qa-tile"
                style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: 'var(--purple)' }}
                onClick={() => navigate(`/workouts?start=${t.id}`)}
                title={`Start workout: ${t.name}`}
              >
                <Icons.Dumbbell size={14} />
                <span>{t.name}</span>
              </button>
            ))}
            {quickActions.foods.map(food => {
              const key = `food-${food.id}`;
              const done = qaResult[key] === 'done';
              return (
                <button
                  key={food.id}
                  className="btn btn-sm qa-tile"
                  style={{ background: done ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'var(--orange)' }}
                  onClick={() => logFood(food)}
                  disabled={qaLogging[key] || done}
                  title={`Log ${food.name} (1 serving)`}
                >
                  {done ? <Icons.Check size={14} /> : <Icons.Food size={14} />}
                  <span>{qaLogging[key] ? 'Logging…' : done ? 'Logged' : food.name}</span>
                </button>
              );
            })}
            {quickActions.foodMeals.map(meal => {
              const key = `foodmeal-${meal.id}`;
              const res = qaResult[key];
              return (
                <button
                  key={meal.id}
                  className="btn btn-sm qa-tile"
                  style={{ background: res ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'var(--orange)' }}
                  onClick={() => logFoodMeal(meal)}
                  disabled={qaLogging[key] || !!res}
                  title={`Log meal: ${meal.name}`}
                >
                  {res ? <Icons.Check size={14} /> : <Icons.List size={14} />}
                  <span>{qaLogging[key] ? 'Logging…' : res ? `${res.logged} logged` : meal.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's Meals Summary */}
      <div className="card">
        <div className="card-header">
          <div className="card-title green"><Icons.Food size={13} /> Today's Meals</div>
          <span className="text-xs text-muted">{summary?.logCount ?? 0} entries</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {['breakfast', 'lunch', 'dinner', 'snack'].map((meal) => {
            const entries = summary?.meals?.[meal] ?? [];
            const mealCals = entries.reduce((s, e) => s + (e.nutritionSnapshot?.calories ?? 0), 0);
            return (
              <div key={meal} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize', color: 'var(--muted2)' }}>{meal}</span>
                  <span className="mono text-xs" style={{ color: 'var(--orange)' }}>{mealCals.toFixed(0)} kcal</span>
                </div>
                {entries.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    {entries.slice(0, 3).map(e => (
                      <div key={e.id} className="text-xs text-muted" style={{ marginTop: 2 }}>
                        {e.foodName}{e.quantity !== 1 ? ` ×${e.quantity}` : ''}
                      </div>
                    ))}
                    {entries.length > 3 && <div className="text-xs text-muted">+{entries.length - 3} more</div>}
                  </div>
                ) : (
                  <div className="text-xs text-muted" style={{ marginTop: 4, fontStyle: 'italic' }}>Nothing logged yet</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid-3 mt-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { label: 'Log Food', img: null, icon: Icons.Food, path: '/food', color: 'var(--accent2)' },
          { label: 'Health Stats', img: '/icons/heart_cardiogram@2x.png', path: '/health', color: 'var(--green2)' },
          { label: 'Workouts', img: '/icons/exercise@2x.png', path: '/workouts', color: 'var(--purple)' },
        ].map(({ label, img, icon: Icon, path, color }) => (
          <a key={path} href={path} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = color}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ color }}>
                {img
                  ? <img src={img} width={18} height={18} className="png-icon" alt="" />
                  : <Icon size={18} />
                }
              </div>
              <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--muted2)' }}>{label}</span>
            </div>
          </a>
        ))}
      </div>

      {showLogFood && (
        <LogFoodModal
          accessToken={accessToken}
          onClose={() => setShowLogFood(false)}
          onLogged={() => {
            setShowLogFood(false);
            Promise.all([
              api.get(`/food/summary?date=${viewDate}&tz_offset=${new Date().getTimezoneOffset()}`, accessToken),
              api.get('/me', accessToken),
            ]).then(([s, user]) => {
              setSummary(s);
              const p = user?.preferences ?? {};
              setGoals({
                caloriesPerDay: p.caloriesPerDay || 2000,
                proteinGPerDay: p.proteinGPerDay || 150,
                carbsGPerDay: p.carbsGPerDay || 275,
                fatGPerDay: p.fatGPerDay || 73,
              });
            }).catch(() => {});
          }}
        />
      )}
    </>
  );
}
