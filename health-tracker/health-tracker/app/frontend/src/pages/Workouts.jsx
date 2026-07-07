import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';
import { useConfirm, useNotify } from '../components/AppFeedback';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORIES = ['strength', 'cardio', 'mobility', 'stretching', 'sport', 'recovery', 'plyometrics', 'powerlifting', 'olympic weightlifting', 'strongman', 'custom'];
const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'e-z curl bar', 'exercise ball', 'foam roll', 'medicine ball', 'other'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

const CAT_COLORS = {
  strength: '#3b82f6', cardio: '#ef4444', mobility: '#10b981',
  stretching: '#a855f7', sport: '#f59e0b', recovery: '#06b6d4',
  plyometrics: '#f97316', powerlifting: '#dc2626', 'olympic weightlifting': '#7c3aed',
  strongman: '#92400e', custom: '#64748b',
};

function fmtDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isCardio(category) {
  return category === 'cardio';
}

function makeSet(num, prev) {
  return {
    setNumber: num,
    completed: false,
    reps: prev?.reps ?? null,
    weight: prev?.weight ?? null,
    weightUnit: prev?.weightUnit ?? 'lb',
    rpe: null,
    durationSeconds: prev?.durationSeconds ?? null,
    distance: prev?.distance ?? null,
    distanceUnit: prev?.distanceUnit ?? 'mi',
    averageHeartRate: null,
    calories: null,
  };
}

function emptyExercise(ex) {
  return {
    exerciseId: ex.id,
    exerciseName: ex.name,
    category: ex.category,
    sets: [makeSet(1, null)],
    notes: '',
  };
}

function sessionVolume(session) {
  let v = 0;
  for (const ex of session.exercises || []) {
    for (const s of ex.sets || []) {
      if (s.completed) v += (s.weight || 0) * (s.reps || 0);
    }
  }
  return Math.round(v);
}

function sessionSetCount(session) {
  return (session.exercises || []).reduce((a, ex) =>
    a + (ex.sets || []).filter(s => s.completed).length, 0);
}

const _EX_IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

// ── Shared sub-components ─────────────────────────────────────────────────────

function CatBadge({ cat }) {
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
      padding: '2px 6px', borderRadius: 4,
      background: (CAT_COLORS[cat] || '#64748b') + '22',
      color: CAT_COLORS[cat] || '#64748b',
    }}>{cat}</span>
  );
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted2)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Exercise Detail Modal ──────────────────────────────────────────────────────

const _detailTagStyle = { fontSize: '0.6rem', color: 'var(--muted2)', padding: '2px 7px', background: 'var(--card2)', borderRadius: 4, border: '1px solid var(--border)', textTransform: 'capitalize' };
const _detailSecStyle = { fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginBottom: 5 };

function ExerciseDetailModal({ exercise, onClose }) {
  const [imgIdx, setImgIdx] = useState(0);

  const images = exercise.images?.length
    ? exercise.images.map(p => _EX_IMG_BASE + p)
    : exercise.imageUrl
    ? [exercise.imageUrl]
    : [];

  const instructions = exercise.instructions
    ? exercise.instructions.split('\n').filter(s => s.trim())
    : [];

  const prev = () => setImgIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setImgIdx(i => (i + 1) % images.length);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}>

        {/* Image gallery */}
        {images.length > 0 && (
          <div style={{ position: 'relative', flexShrink: 0, background: '#000' }}>
            <img src={images[imgIdx]} alt={exercise.name}
              style={{ width: '100%', height: 260, objectFit: 'contain', display: 'block' }}
              onError={e => { e.target.parentElement.style.display = 'none'; }} />
            {images.length > 1 && <>
              <button onClick={prev} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', borderRadius: 6, padding: '8px 13px', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>‹</button>
              <button onClick={next} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', borderRadius: 6, padding: '8px 13px', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>›</button>
              <div style={{ position: 'absolute', bottom: 8, right: 10, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '0.68rem', padding: '2px 8px', borderRadius: 10 }}>
                {imgIdx + 1} / {images.length}
              </div>
            </>}
          </div>
        )}

        {/* Thumbnail strip */}
        {images.length > 1 && (
          <div style={{ display: 'flex', gap: 4, padding: '6px 10px', background: 'var(--card2)', borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto' }}>
            {images.map((img, i) => (
              <img key={i} src={img} alt="" onClick={() => setImgIdx(i)}
                style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                  outline: i === imgIdx ? '2px solid var(--accent)' : '2px solid transparent' }}
                onError={e => { e.target.style.display = 'none'; }} />
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div style={{ padding: '16px 20px 20px', overflowY: 'auto', flex: 1 }}>
          {/* Title + close */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)', lineHeight: 1.3, flex: 1 }}>{exercise.name}</div>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px', marginLeft: 10, flexShrink: 0 }}>✕</button>
          </div>

          {/* Badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <CatBadge cat={exercise.category} />
            {exercise.difficulty && <span style={_detailTagStyle}>{exercise.difficulty}</span>}
            {exercise.equipment && <span style={_detailTagStyle}>{exercise.equipment}</span>}
            {exercise.force && <span style={_detailTagStyle}>Force: {exercise.force}</span>}
            {exercise.mechanic && <span style={_detailTagStyle}>{exercise.mechanic}</span>}
          </div>

          {/* Muscles */}
          {(exercise.primaryMuscles?.length > 0 || exercise.secondaryMuscles?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16, padding: '10px 12px', background: 'var(--card2)', borderRadius: 6 }}>
              {exercise.primaryMuscles?.length > 0 && (
                <div>
                  <div style={_detailSecStyle}>Primary Muscles</div>
                  <div style={{ fontSize: '0.77rem', color: 'var(--text)' }}>{exercise.primaryMuscles.join(', ')}</div>
                </div>
              )}
              {exercise.secondaryMuscles?.length > 0 && (
                <div>
                  <div style={_detailSecStyle}>Secondary Muscles</div>
                  <div style={{ fontSize: '0.77rem', color: 'var(--muted2)' }}>{exercise.secondaryMuscles.join(', ')}</div>
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          {instructions.length > 0 && (
            <div>
              <div style={_detailSecStyle}>Instructions</div>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {instructions.map((step, i) => (
                  <li key={i} style={{ fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.55 }}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Exercise Modal ─────────────────────────────────────────────────────────────

function ExerciseModal({ exercise, onClose, onSave }) {
  const [form, setForm] = useState({
    name: exercise?.name || '',
    category: exercise?.category || 'strength',
    equipment: exercise?.equipment || 'bodyweight',
    difficulty: exercise?.difficulty || 'beginner',
    primaryMuscles: exercise?.primaryMuscles?.join(', ') || '',
    secondaryMuscles: exercise?.secondaryMuscles?.join(', ') || '',
    instructions: exercise?.instructions || '',
    imageUrl: exercise?.imageUrl || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return setError('Name is required');
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        primaryMuscles: form.primaryMuscles.split(',').map(s => s.trim()).filter(Boolean),
        secondaryMuscles: form.secondaryMuscles.split(',').map(s => s.trim()).filter(Boolean),
      };
      await onSave(payload);
      onClose();
    } catch (e) {
      setError(e.detail || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{exercise ? 'Edit Exercise' : 'Add Custom Exercise'}</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</div>}
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Category</label>
              <select className="input" value={form.category} onChange={e => set('category', e.target.value)} style={{ width: '100%' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Equipment</label>
              <select className="input" value={form.equipment} onChange={e => set('equipment', e.target.value)} style={{ width: '100%' }}>
                {EQUIPMENT.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Difficulty</label>
              <select className="input" value={form.difficulty} onChange={e => set('difficulty', e.target.value)} style={{ width: '100%' }}>
                {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Primary Muscles (comma-separated)</label>
            <input className="input" value={form.primaryMuscles} onChange={e => set('primaryMuscles', e.target.value)} style={{ width: '100%' }} placeholder="chest, triceps" />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Secondary Muscles (comma-separated)</label>
            <input className="input" value={form.secondaryMuscles} onChange={e => set('secondaryMuscles', e.target.value)} style={{ width: '100%' }} placeholder="shoulders, core" />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Instructions</label>
            <textarea className="input" value={form.instructions} onChange={e => set('instructions', e.target.value)}
              style={{ width: '100%', minHeight: 70, resize: 'vertical' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Image URL</label>
            <input className="input" value={form.imageUrl} onChange={e => set('imageUrl', e.target.value)}
              style={{ width: '100%' }} placeholder="https://…" />
            {form.imageUrl && (
              <img src={form.imageUrl} alt="" style={{ marginTop: 6, height: 80, borderRadius: 4, objectFit: 'cover' }}
                onError={e => { e.target.style.display = 'none'; }} />
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Template exercise row (shared between flat + grouped modes) ──────────────

function TERow({ te, idx, total, onUpdate, onRemove, onMove }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 6, padding: '7px 10px',
      display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)' }}>
      {/* Reorder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
        <button className="btn btn-ghost" disabled={idx === 0} onClick={() => onMove(-1)}
          style={{ padding: '0 4px', fontSize: '0.6rem', lineHeight: 1.2, color: idx === 0 ? 'var(--muted)' : 'var(--muted2)' }}>▲</button>
        <button className="btn btn-ghost" disabled={idx >= total - 1} onClick={() => onMove(1)}
          style={{ padding: '0 4px', fontSize: '0.6rem', lineHeight: 1.2, color: idx >= total - 1 ? 'var(--muted)' : 'var(--muted2)' }}>▼</button>
      </div>
      <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 500, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {te.exerciseName}
      </span>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
        {isCardio(te.category) ? <>
          <input type="number" className="input"
            value={te.targetDurationSeconds != null ? Math.round(te.targetDurationSeconds / 60) : ''}
            onChange={e => onUpdate('targetDurationSeconds', e.target.value ? Math.round(+e.target.value * 60) : null)}
            style={{ width: 50, textAlign: 'center', padding: '3px 5px' }} placeholder="min" min={0} />
          <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>min</span>
        </> : <>
          <input type="number" className="input" value={te.targetSets}
            onChange={e => onUpdate('targetSets', +e.target.value)}
            style={{ width: 40, textAlign: 'center', padding: '3px 5px' }} title="Sets" />
          <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>×</span>
          <input type="number" className="input" value={te.targetReps || ''}
            onChange={e => onUpdate('targetReps', e.target.value ? +e.target.value : null)}
            style={{ width: 42, textAlign: 'center', padding: '3px 5px' }} placeholder="reps" />
          <input type="number" className="input" value={te.targetWeight || ''}
            onChange={e => onUpdate('targetWeight', e.target.value ? +e.target.value : null)}
            style={{ width: 50, textAlign: 'center', padding: '3px 5px' }} placeholder="lb" />
        </>}
      </div>
      <button className="btn btn-ghost" onClick={onRemove}
        style={{ padding: '2px 6px', fontSize: '0.7rem', color: '#ef4444', flexShrink: 0 }}>✕</button>
    </div>
  );
}

const _uid = () => Math.random().toString(36).slice(2, 8);

// Defined at module level so React never sees a new component type on re-render
// (defining it inside TemplateModal would reset focus after every keystroke)
function TemplateExSearch({ search, searchTarget, targetKey, filtered, onSearchChange, onPick }) {
  const isActive = searchTarget === targetKey;
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        value={isActive ? search : ''}
        onChange={e => onSearchChange(e.target.value)}
        style={{ width: '100%', fontSize: '0.73rem' }}
        placeholder="Search and add exercise…"
      />
      {isActive && search && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 6,
          marginTop: 2, maxHeight: 160, overflowY: 'auto' }}>
          {filtered.length === 0
            ? <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--muted)' }}>No exercises found</div>
            : filtered.map(ex => (
                <div key={ex.id}
                  style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', gap: 8, alignItems: 'center' }}
                  onMouseDown={e => { e.preventDefault(); onPick(ex); }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--border)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {ex.name} <CatBadge cat={ex.category} />
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

function _mkTE(ex) {
  return {
    exerciseId: ex.id, exerciseName: ex.name, category: ex.category,
    targetSets: 3, targetReps: null, targetWeight: null,
    weightUnit: 'lb', targetDurationSeconds: null, notes: '',
  };
}

function _arrMove(arr, from, dir) {
  const to = from + dir;
  if (to < 0 || to >= arr.length) return arr;
  const a = [...arr];
  [a[from], a[to]] = [a[to], a[from]];
  return a;
}

// ── Template Modal ─────────────────────────────────────────────────────────────

function TemplateModal({ template, exercises: preloaded, onClose, onSave }) {
  const { accessToken } = useAuth();
  const [name, setName] = useState(template?.name || '');
  const [desc, setDesc] = useState(template?.description || '');
  const initHasGroups = !!(template?.groups?.length > 0);
  const [useGroups, setUseGroups] = useState(initHasGroups);

  // Flat mode state
  const [flatExs, setFlatExs] = useState(() => (template?.exercises || []).map(e => ({ ...e })));

  // Groups mode state
  const [groups, setGroups] = useState(() =>
    initHasGroups
      ? template.groups.map(g => ({ id: g.id || _uid(), name: g.name || '', exercises: (g.exercises || []).map(e => ({ ...e })) }))
      : [{ id: _uid(), name: 'Group 1', exercises: [] }]
  );

  const [search, setSearch] = useState('');
  const [searchTarget, setSearchTarget] = useState(null);
  const [filtered, setFiltered] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Live search — queries the API so results are always complete regardless of preloaded list size
  useEffect(() => {
    if (!search.trim()) { setFiltered([]); return; }
    const q = search.trim();
    // First filter the preloaded list instantly for responsiveness
    const local = preloaded.filter(e => e.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
    setFiltered(local);
    // Then fetch from API for complete results
    api.get(`/workouts/exercises?search=${encodeURIComponent(q)}`, accessToken)
      .then(res => setFiltered(res.slice(0, 12)))
      .catch(() => {});
  }, [search, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flat helpers ──────────────────────────────────────────────────────────────
  const flatAdd    = (ex) => { if (flatExs.find(t => t.exerciseId === ex.id)) return; setFlatExs(p => [...p, _mkTE(ex)]); setSearch(''); setSearchTarget(null); };
  const flatUpdate = (i, k, v) => setFlatExs(p => p.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const flatRemove = (i) => setFlatExs(p => p.filter((_, j) => j !== i));
  const flatMove   = (i, d) => setFlatExs(p => _arrMove(p, i, d));

  // ── Groups helpers ────────────────────────────────────────────────────────────
  const addGroup    = () => setGroups(p => [...p, { id: _uid(), name: `Group ${p.length + 1}`, exercises: [] }]);
  const moveGroup   = (i, d) => setGroups(p => _arrMove(p, i, d));
  const delGroup    = (id) => setGroups(p => p.filter(g => g.id !== id));
  const renameGrp   = (id, n) => setGroups(p => p.map(g => g.id === id ? { ...g, name: n } : g));
  const grpAdd      = (gid, ex) => { setGroups(p => p.map(g => g.id === gid ? (g.exercises.find(e => e.exerciseId === ex.id) ? g : { ...g, exercises: [...g.exercises, _mkTE(ex)] }) : g)); setSearch(''); setSearchTarget(null); };
  const grpUpdate   = (gid, i, k, v) => setGroups(p => p.map(g => g.id !== gid ? g : { ...g, exercises: g.exercises.map((e, j) => j === i ? { ...e, [k]: v } : e) }));
  const grpRemove   = (gid, i) => setGroups(p => p.map(g => g.id !== gid ? g : { ...g, exercises: g.exercises.filter((_, j) => j !== i) }));
  const grpMove     = (gid, i, d) => setGroups(p => p.map(g => g.id !== gid ? g : { ...g, exercises: _arrMove(g.exercises, i, d) }));

  const handleSave = async () => {
    if (!name.trim()) return setError('Name is required');
    setSaving(true); setError('');
    try {
      const payload = useGroups
        ? { name, description: desc || null, groups, exercises: [] }
        : { name, description: desc || null, exercises: flatExs, groups: [] };
      await onSave(payload);
      onClose();
    } catch (e) {
      const msg = typeof e.detail === 'string' ? e.detail
        : e.detail?.detail ? JSON.stringify(e.detail.detail)
        : e.message || 'Failed to save';
      setError(msg);
    }
    finally { setSaving(false); }
  };

  const toggleGroups = (on) => {
    if (on && !useGroups) {
      // Migrate existing flat exercises into the first group instead of discarding them
      setGroups([{ id: _uid(), name: 'Group 1', exercises: flatExs }]);
    }
    if (!on && useGroups) {
      // Flatten all group exercises back into the flat list
      setFlatExs(groups.flatMap(g => g.exercises));
    }
    setUseGroups(on);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 580, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}>

        <div className="modal-header" style={{ flexShrink: 0 }}>
          <span>{template ? 'Edit Template' : 'New Template'}</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</div>}

          {/* Name + description */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Name *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} placeholder="Push Day" />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Description</label>
              <input className="input" value={desc} onChange={e => setDesc(e.target.value)} style={{ width: '100%' }} placeholder="Optional" />
            </div>
          </div>

          {/* Mode toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted2)', userSelect: 'none' }}>
            <input type="checkbox" checked={useGroups} onChange={e => toggleGroups(e.target.checked)} />
            Organize exercises into groups
          </label>

          {/* ── FLAT MODE ── */}
          {!useGroups && (
            <>
              {/* Inline search — no sub-component so focus is never lost */}
              <TemplateExSearch
                search={search} searchTarget={searchTarget} targetKey="flat"
                filtered={filtered}
                onSearchChange={(v) => { setSearch(v); setSearchTarget('flat'); }}
                onPick={flatAdd}
              />
              {flatExs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {flatExs.map((te, i) => (
                    <TERow key={i} te={te} idx={i} total={flatExs.length}
                      onUpdate={(k, v) => flatUpdate(i, k, v)}
                      onRemove={() => flatRemove(i)}
                      onMove={d => flatMove(i, d)} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── GROUPS MODE ── */}
          {useGroups && (
            <>
              {groups.map((grp, gi) => (
                <div key={grp.id} style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'clip', background: 'var(--card2)' }}>
                  {/* Group header */}
                  <div style={{ padding: '8px 12px', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                      <button className="btn btn-ghost" disabled={gi === 0} onClick={() => moveGroup(gi, -1)}
                        style={{ padding: '0 4px', fontSize: '0.58rem', lineHeight: 1.3, color: gi === 0 ? 'var(--muted)' : 'var(--muted2)' }}>▲</button>
                      <button className="btn btn-ghost" disabled={gi >= groups.length - 1} onClick={() => moveGroup(gi, 1)}
                        style={{ padding: '0 4px', fontSize: '0.58rem', lineHeight: 1.3, color: gi >= groups.length - 1 ? 'var(--muted)' : 'var(--muted2)' }}>▼</button>
                    </div>
                    <input className="input" value={grp.name} onChange={e => renameGrp(grp.id, e.target.value)}
                      style={{ flex: 1, fontWeight: 700, fontSize: '0.8rem', background: 'transparent', border: 'none', boxShadow: 'none', padding: '2px 4px' }}
                      placeholder="Group name" />
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', flexShrink: 0 }}>{grp.exercises.length} ex</span>
                    <button className="btn btn-ghost" onClick={() => delGroup(grp.id)}
                      style={{ padding: '2px 6px', fontSize: '0.68rem', color: '#ef4444', flexShrink: 0 }}>Remove</button>
                  </div>

                  {/* Exercises in group */}
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {grp.exercises.map((te, i) => (
                      <TERow key={i} te={te} idx={i} total={grp.exercises.length}
                        onUpdate={(k, v) => grpUpdate(grp.id, i, k, v)}
                        onRemove={() => grpRemove(grp.id, i)}
                        onMove={d => grpMove(grp.id, i, d)} />
                    ))}
                    <TemplateExSearch
                      search={search} searchTarget={searchTarget} targetKey={grp.id}
                      filtered={filtered}
                      onSearchChange={(v) => { setSearch(v); setSearchTarget(grp.id); }}
                      onPick={ex => grpAdd(grp.id, ex)}
                    />
                  </div>
                </div>
              ))}

              <button className="btn btn-sec btn-sm" onClick={addGroup} style={{ alignSelf: 'flex-start' }}>
                + Add Group
              </button>
            </>
          )}
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Template'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Session Modal ────────────────────────────────────────────────────────

function EditSessionModal({ session, onClose, onSaved }) {
  const { accessToken } = useAuth();
  const [name, setName]               = useState(session.name || '');
  const [startedAt, setStartedAt]     = useState(
    session.startedAt ? new Date(session.startedAt).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16)
  );
  const [durationMinutes, setDuration] = useState(
    session.durationSeconds ? String(Math.round(session.durationSeconds / 60)) : ''
  );
  const [exercises, setExercises]     = useState(session.exercises || []);
  const [workoutNotes, setNotes]      = useState(session.notes || '');
  const [exerciseMap, setExerciseMap] = useState({});
  const [search, setSearch]           = useState('');
  const [searchResults, setResults]   = useState([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || !accessToken) return setResults([]);
    try {
      const res = await api.get(`/workouts/exercises?search=${encodeURIComponent(q)}`, accessToken);
      setResults(res.slice(0, 10));
    } catch { setResults([]); }
  }, [accessToken]);

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 300);
    return () => clearTimeout(t);
  }, [search, doSearch]);

  const addExercise = (ex) => {
    setExercises(prev => [...prev, emptyExercise(ex)]);
    setExerciseMap(prev => ({ ...prev, [ex.id]: ex }));
    setSearch(''); setResults([]);
  };
  const updateExercise = (idx, updated) => setExercises(prev => prev.map((e, i) => i === idx ? updated : e));
  const removeExercise = (idx)          => setExercises(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await api.put(`/workouts/sessions/${session.id}`, {
        name,
        startedAt:       new Date(startedAt).toISOString(),
        durationSeconds: durationMinutes ? Math.round(+durationMinutes * 60) : null,
        notes:           workoutNotes || null,
        exercises,
      }, accessToken);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.detail || e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal"
        style={{ maxWidth: 760, width: '95vw', maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}>

        <div className="modal-header" style={{ flexShrink: 0 }}>
          <span>Edit Workout</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Session metadata */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Workout Name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Start Time</label>
              <input type="datetime-local" className="input" value={startedAt} onChange={e => setStartedAt(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Duration (min)</label>
              <input type="number" className="input" value={durationMinutes} onChange={e => setDuration(e.target.value)}
                style={{ width: '100%' }} placeholder="Optional" min={0} />
            </div>
          </div>

          {/* Add exercise search */}
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Add Exercise</label>
            <div style={{ position: 'relative' }}>
              <input className="input" value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: '100%' }} placeholder="Search exercises by name…" />
              {searchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2, maxHeight: 200, overflowY: 'auto' }}>
                  {searchResults.map(ex => (
                    <div key={ex.id}
                      style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.78rem' }}
                      onClick={() => addExercise(ex)}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--border)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {ex.imageUrl && (
                        <img src={ex.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                          onError={e => { e.target.style.display = 'none'; }} />
                      )}
                      <span style={{ flex: 1, color: 'var(--text)', fontWeight: 500 }}>{ex.name}</span>
                      <CatBadge cat={ex.category} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Exercise blocks */}
          <div>
            {exercises.map((ex, idx) => (
              <ExerciseBlock key={idx} ex={ex} exIdx={idx} exerciseMap={exerciseMap}
                onUpdate={updateExercise} onRemove={removeExercise} />
            ))}
            {exercises.length === 0 && (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: '0.78rem', background: 'var(--card)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                No exercises yet — search above to add one.
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Workout Notes</label>
            <textarea className="input" value={workoutNotes} onChange={e => setNotes(e.target.value)}
              style={{ width: '100%', minHeight: 60, resize: 'vertical' }} placeholder="How did it go? Any PRs?" />
          </div>

          {error && <div style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</div>}
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Session Detail Modal ──────────────────────────────────────────────────────

function SessionDetailModal({ session, onClose, onEdit }) {
  const vol    = sessionVolume(session);
  const sets   = sessionSetCount(session);
  const exList = session.exercises || [];

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680, width: '96vw', maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)', marginBottom: 3 }}>{session.name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>
              {fmtDate(session.startedAt)}
              {session.durationSeconds > 0 && <span style={{ marginLeft: 10 }}>⏱ {fmtDuration(session.durationSeconds)}</span>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); onEdit(session); }}
            style={{ fontSize: '0.72rem', flexShrink: 0 }}>
            <Icons.Edit size={12} /> Edit
          </button>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px', flexShrink: 0 }}>✕</button>
        </div>

        {/* Summary stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { label: 'Exercises', value: exList.length },
            { label: 'Sets done', value: sets },
            { label: 'Volume', value: vol > 0 ? `${vol.toLocaleString()} lb` : '—' },
            { label: 'Duration', value: session.durationSeconds > 0 ? fmtDuration(session.durationSeconds) : '—' },
          ].map(({ label, value }, idx) => (
            <div key={label} style={{ padding: '10px 8px', textAlign: 'center', borderRight: idx < 3 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent2)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.1, wordBreak: 'break-all' }}>{value}</div>
              <div style={{ fontSize: '0.58rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Exercise list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {exList.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.78rem', padding: 20 }}>No exercises recorded.</div>
          )}

          {(() => {
            let lastGroup = undefined;
            return exList.map((ex, i) => {
              const showGrp = !!(ex.groupName && ex.groupName !== lastGroup);
              lastGroup = ex.groupName ?? lastGroup;
              return <GroupedExBlock key={i} ex={ex} showGroupHeader={showGrp} />;
            });
          })()}

          {/* Session notes */}
          {session.notes && (
            <div style={{ padding: '10px 14px', background: 'var(--card2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 5 }}>Session Notes</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted2)', lineHeight: 1.5 }}>{session.notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupedExBlock({ ex, showGroupHeader }) {
            const cardio = isCardio(ex.category);
            const completedSets = (ex.sets || []).filter(s => s.completed);
            const exVol = (ex.sets || []).reduce((t, s) => t + (s.completed ? (s.weight || 0) * (s.reps || 0) : 0), 0);

            return (
              <>
              {showGroupHeader && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent2)', flexShrink: 0 }}>
                    {ex.groupName}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}
              <div style={{ background: 'var(--card2)', borderRadius: 8, overflow: 'clip', border: '1px solid var(--border)' }}>
                {/* Exercise header */}
                <div style={{ padding: '9px 12px', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <CatBadge cat={ex.category} />
                  <span style={{ fontWeight: 600, fontSize: '0.83rem', color: 'var(--text)', flex: 1, minWidth: 0 }}>{ex.exerciseName}</span>
                  {!cardio && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted2)' }}>
                      {completedSets.length}/{(ex.sets || []).length} sets
                      {exVol > 0 && <span style={{ marginLeft: 8, color: 'var(--accent2)', fontFamily: 'monospace' }}>{exVol.toLocaleString()} lb</span>}
                    </span>
                  )}
                </div>

                {/* Cardio layout */}
                {cardio && (() => {
                  const s = ex.sets?.[0] || {};
                  const hasData = s.durationSeconds > 0 || s.distance > 0 || s.averageHeartRate > 0 || s.calories > 0;
                  if (!hasData) return <div style={{ padding: '10px 12px', fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>No data logged</div>;
                  return (
                    <div style={{ padding: '10px 12px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      {s.durationSeconds > 0 && <div><div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--accent2)', fontFamily: 'monospace' }}>{fmtDuration(s.durationSeconds)}</div><div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Duration</div></div>}
                      {s.distance > 0 && <div><div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--accent2)', fontFamily: 'monospace' }}>{s.distance} {s.distanceUnit || 'mi'}</div><div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Distance</div></div>}
                      {s.averageHeartRate > 0 && <div><div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#ef4444', fontFamily: 'monospace' }}>{s.averageHeartRate} bpm</div><div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Avg HR</div></div>}
                      {s.calories > 0 && <div><div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f97316', fontFamily: 'monospace' }}>{s.calories} kcal</div><div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Calories</div></div>}
                      {s.completed && <div style={{ alignSelf: 'center' }}><span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--green2)' }}>✓ Completed</span></div>}
                    </div>
                  );
                })()}

                {/* Strength sets table */}
                {!cardio && (ex.sets || []).length > 0 && (
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', minWidth: 260 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['#', 'Reps', 'Weight', 'RPE', ''].map(h => (
                            <th key={h} style={{ padding: '5px 8px', textAlign: 'center', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ex.sets.map((s, j) => (
                          <tr key={j} style={{ borderBottom: '1px solid var(--border)', opacity: s.completed ? 1 : 0.45 }}>
                            <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--muted2)', width: 32 }}>{s.setNumber ?? j + 1}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text)' }}>{s.reps ?? '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent2)' }}>
                              {s.weight != null ? `${s.weight} ${s.weightUnit || 'lb'}` : '—'}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--muted2)' }}>{s.rpe ?? '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', width: 28 }}>
                              {s.completed
                                ? <span style={{ color: 'var(--green2)', fontWeight: 700 }}>✓</span>
                                : <span style={{ color: 'var(--muted)' }}>–</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Exercise notes */}
                {ex.notes && (
                  <div style={{ padding: '6px 12px 10px', fontSize: '0.72rem', color: 'var(--muted2)', fontStyle: 'italic', borderTop: '1px solid var(--border)' }}>
                    {ex.notes}
                  </div>
                )}
              </div>
              </>
            );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab({ onNewWorkout, onEditSession, onDeleteSession }) {
  const { accessToken } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailSession, setDetailSession] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/workouts/dashboard', accessToken)
      .then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>;
  if (!data) return null;

  const h = Math.floor((data.weekDurationSeconds || 0) / 3600);
  const m = Math.floor(((data.weekDurationSeconds || 0) % 3600) / 60);
  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {detailSession && (
        <SessionDetailModal
          session={detailSession}
          onClose={() => setDetailSession(null)}
          onEdit={(s) => { setDetailSession(null); onEditSession(s); }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard label="Sessions This Week" value={data.weekSessions} />
        <KpiCard label="Volume This Week" value={data.weekVolumeLb > 0 ? `${data.weekVolumeLb.toLocaleString()} lb` : '—'} sub="total weight × reps" />
        <KpiCard label="Time This Week" value={data.weekDurationSeconds > 0 ? timeStr : '—'} />
        <KpiCard label="Sessions This Month" value={data.monthSessions} />
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Recent Workouts</span>
          <button className="btn btn-pri" onClick={onNewWorkout} style={{ fontSize: '0.72rem' }}>+ New Workout</button>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {data.recentSessions.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.78rem' }}>
              No workouts logged yet. Start your first session!
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Workout', 'Exercises', 'Sets', 'Volume', 'Duration', ''].map((h, i) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentSessions.map(s => (
                  <tr key={s.id}
                    onClick={() => setDetailSession(s)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--card2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '9px 12px', fontSize: '0.75rem', color: 'var(--muted2)', whiteSpace: 'nowrap' }}>{fmtDate(s.startedAt)}</td>
                    <td style={{ padding: '9px 12px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent2)' }}>{s.name}</td>
                    <td style={{ padding: '9px 12px', fontSize: '0.75rem', color: 'var(--muted2)' }}>{(s.exercises || []).length}</td>
                    <td style={{ padding: '9px 12px', fontSize: '0.75rem', color: 'var(--muted2)', fontFamily: 'monospace' }}>{sessionSetCount(s)}</td>
                    <td style={{ padding: '9px 12px', fontSize: '0.75rem', color: 'var(--muted2)', fontFamily: 'monospace' }}>{sessionVolume(s) > 0 ? `${sessionVolume(s).toLocaleString()} lb` : '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: '0.75rem', color: 'var(--muted2)' }}>{fmtDuration(s.durationSeconds)}</td>
                    <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost" onClick={() => onEditSession(s)}
                        style={{ padding: '2px 8px', fontSize: '0.7rem', marginRight: 4 }}>Edit</button>
                      <button className="btn btn-ghost" onClick={() => onDeleteSession(s.id)}
                        style={{ padding: '2px 8px', fontSize: '0.7rem', color: '#ef4444' }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Log Tab ───────────────────────────────────────────────────────────────────

function SetRow({ set, idx, category, onChange, onRemove }) {
  const cardio = isCardio(category);
  const set_ = (k, v) => onChange(idx, k, v);

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 8px', fontSize: '0.72rem', color: 'var(--muted2)', textAlign: 'center', width: 28 }}>{set.setNumber}</td>
      {cardio ? <>
        <td style={{ padding: '5px 8px' }}>
          <input type="number" className="input" value={set.durationSeconds || ''} onChange={e => set_('durationSeconds', e.target.value ? +e.target.value : null)}
            style={{ width: 70, padding: '4px 6px', textAlign: 'center' }} placeholder="secs" />
        </td>
        <td style={{ padding: '5px 8px' }}>
          <input type="number" className="input" value={set.distance || ''} onChange={e => set_('distance', e.target.value ? +e.target.value : null)}
            style={{ width: 70, padding: '4px 6px', textAlign: 'center' }} placeholder="mi" />
        </td>
        <td style={{ padding: '5px 8px' }}>
          <input type="number" className="input" value={set.averageHeartRate || ''} onChange={e => set_('averageHeartRate', e.target.value ? +e.target.value : null)}
            style={{ width: 60, padding: '4px 6px', textAlign: 'center' }} placeholder="bpm" />
        </td>
        <td style={{ padding: '5px 8px' }}>
          <input type="number" className="input" value={set.calories || ''} onChange={e => set_('calories', e.target.value ? +e.target.value : null)}
            style={{ width: 60, padding: '4px 6px', textAlign: 'center' }} placeholder="kcal" />
        </td>
      </> : <>
        <td style={{ padding: '5px 8px' }}>
          <input type="number" className="input" value={set.reps || ''} onChange={e => set_('reps', e.target.value ? +e.target.value : null)}
            style={{ width: 60, padding: '4px 6px', textAlign: 'center' }} placeholder="0" />
        </td>
        <td style={{ padding: '5px 8px' }}>
          <input type="number" className="input" value={set.weight || ''} onChange={e => set_('weight', e.target.value ? +e.target.value : null)}
            style={{ width: 70, padding: '4px 6px', textAlign: 'center' }} placeholder="0" />
        </td>
        <td style={{ padding: '5px 8px' }}>
          <select className="input" value={set.weightUnit} onChange={e => set_('weightUnit', e.target.value)} style={{ padding: '4px 6px', width: 50 }}>
            <option>lb</option><option>kg</option>
          </select>
        </td>
        <td style={{ padding: '5px 8px' }}>
          <input type="number" className="input" value={set.rpe || ''} onChange={e => set_('rpe', e.target.value ? +e.target.value : null)}
            style={{ width: 50, padding: '4px 6px', textAlign: 'center' }} placeholder="—" min={1} max={10} step={0.5} />
        </td>
      </>}
      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
        <input type="checkbox" checked={set.completed} onChange={e => set_('completed', e.target.checked)} />
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
        <button className="btn btn-ghost" onClick={onRemove} style={{ padding: '1px 6px', fontSize: '0.65rem', color: 'var(--muted)' }}>✕</button>
      </td>
    </tr>
  );
}

function ExerciseBlock({ ex, exIdx, exerciseMap, onUpdate, onRemove }) {
  const { accessToken } = useAuth();
  const [detailEx, setDetailEx] = useState(null);
  const cardio = isCardio(ex.category);
  const imageUrl = exerciseMap?.[ex.exerciseId]?.imageUrl;

  const openDetail = async () => {
    const cached = exerciseMap?.[ex.exerciseId];
    if (cached?.images !== undefined || cached?.instructions !== undefined) {
      setDetailEx(cached);
    } else {
      try {
        const data = await api.get(`/workouts/exercises/${ex.exerciseId}`, accessToken);
        setDetailEx(data);
      } catch {
        setDetailEx({ name: ex.exerciseName, category: ex.category });
      }
    }
  };

  const blockHeader = (rightContent) => (
    <div style={{ padding: '10px 14px', background: 'var(--card2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {imageUrl && (
        <img src={imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }}
          onClick={openDetail} onError={e => { e.target.style.display = 'none'; }} />
      )}
      <CatBadge cat={ex.category} />
      <span onClick={openDetail} style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
        {ex.exerciseName}
      </span>
      {rightContent}
      <button className="btn btn-ghost" onClick={() => onRemove(exIdx)} style={{ padding: '2px 8px', fontSize: '0.7rem', color: '#ef4444', flexShrink: 0 }}>Remove</button>
    </div>
  );

  // ── Cardio (duration-based) layout ──────────────────────────────────────────
  if (cardio) {
    const s = ex.sets[0] || makeSet(1, null);
    const setField = (k, v) => onUpdate(exIdx, { ...ex, sets: [{ ...s, [k]: v }] });

    const totalSecs = s.durationSeconds ?? null;
    const durMins = totalSecs != null ? String(Math.floor(totalSecs / 60)) : '';
    const durSecs = totalSecs != null ? String(totalSecs % 60).padStart(2, '0') : '';

    const onDurMins = (v) => {
      const m = parseInt(v) || 0;
      const sec = parseInt(durSecs) || 0;
      setField('durationSeconds', m * 60 + sec || null);
    };
    const onDurSecs = (v) => {
      const sec = Math.min(59, parseInt(v) || 0);
      const m = parseInt(durMins) || 0;
      setField('durationSeconds', m * 60 + sec || null);
    };

    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'clip', marginBottom: 12 }}>
        {detailEx && <ExerciseDetailModal exercise={detailEx} onClose={() => setDetailEx(null)} />}
        {blockHeader(
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.72rem',
            color: s.completed ? '#10b981' : 'var(--muted2)', fontWeight: s.completed ? 600 : 400 }}>
            <input type="checkbox" checked={!!s.completed} onChange={e => setField('completed', e.target.checked)} />
            {s.completed ? 'Done ✓' : 'Mark done'}
          </label>
        )}
        <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
          <div>
            <div style={cardioLabelStyle}>Duration</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" className="input" value={durMins} onChange={e => onDurMins(e.target.value)}
                style={{ width: 54, padding: '5px 7px', textAlign: 'center' }} placeholder="0" min={0} />
              <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>m</span>
              <input type="number" className="input" value={durSecs} onChange={e => onDurSecs(e.target.value)}
                style={{ width: 46, padding: '5px 7px', textAlign: 'center' }} placeholder="00" min={0} max={59} />
              <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>s</span>
            </div>
          </div>
          <div>
            <div style={cardioLabelStyle}>Distance</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" className="input" value={s.distance ?? ''} onChange={e => setField('distance', e.target.value ? +e.target.value : null)}
                style={{ width: 68, padding: '5px 7px', textAlign: 'center' }} placeholder="0" min={0} step={0.01} />
              <select className="input" value={s.distanceUnit ?? 'mi'} onChange={e => setField('distanceUnit', e.target.value)}
                style={{ padding: '5px 6px', width: 52 }}>
                <option>mi</option><option>km</option>
              </select>
            </div>
          </div>
          <div>
            <div style={cardioLabelStyle}>Avg HR (bpm)</div>
            <input type="number" className="input" value={s.averageHeartRate ?? ''} onChange={e => setField('averageHeartRate', e.target.value ? +e.target.value : null)}
              style={{ width: 80, padding: '5px 7px', textAlign: 'center' }} placeholder="—" min={0} />
          </div>
          <div>
            <div style={cardioLabelStyle}>Calories (kcal)</div>
            <input type="number" className="input" value={s.calories ?? ''} onChange={e => setField('calories', e.target.value ? +e.target.value : null)}
              style={{ width: 80, padding: '5px 7px', textAlign: 'center' }} placeholder="—" min={0} />
          </div>
        </div>
        <div style={{ padding: '0 14px 10px' }}>
          <input className="input" value={ex.notes} onChange={e => onUpdate(exIdx, { ...ex, notes: e.target.value })}
            placeholder="Notes (pace, intensity, how you felt…)" style={{ width: '100%', padding: '4px 8px', fontSize: '0.73rem' }} />
        </div>
      </div>
    );
  }

  // ── Strength / sets-based layout ─────────────────────────────────────────────
  const updateSet = (setIdx, k, v) => {
    const sets = ex.sets.map((s, i) => i === setIdx ? { ...s, [k]: v } : s);
    onUpdate(exIdx, { ...ex, sets });
  };

  const addSet = () => {
    const prev = ex.sets[ex.sets.length - 1];
    onUpdate(exIdx, { ...ex, sets: [...ex.sets, makeSet(ex.sets.length + 1, prev)] });
  };

  const removeSet = (setIdx) => {
    const sets = ex.sets.filter((_, i) => i !== setIdx).map((s, i) => ({ ...s, setNumber: i + 1 }));
    onUpdate(exIdx, { ...ex, sets });
  };

  const completedCount = ex.sets.filter(s => s.completed).length;

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'clip', marginBottom: 12 }}>
      {detailEx && <ExerciseDetailModal exercise={detailEx} onClose={() => setDetailEx(null)} />}
      {blockHeader(
        <span style={{ fontSize: '0.7rem', color: 'var(--muted2)' }}>{completedCount}/{ex.sets.length} sets done</span>
      )}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 300 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Reps</th>
              <th style={thStyle}>Weight</th>
              <th style={thStyle}>Unit</th>
              <th style={thStyle}>RPE</th>
              <th style={thStyle}>Done</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {ex.sets.map((s, i) => (
              <SetRow key={i} set={s} idx={i} category={ex.category}
                onChange={updateSet} onRemove={() => removeSet(i)} />
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '8px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-sec" onClick={addSet} style={{ fontSize: '0.72rem', padding: '4px 10px' }}>+ Add Set</button>
        <input className="input" value={ex.notes} onChange={e => onUpdate(exIdx, { ...ex, notes: e.target.value })}
          placeholder="Notes for this exercise…" style={{ flex: 1, padding: '4px 8px', fontSize: '0.73rem' }} />
      </div>
    </div>
  );
}

const cardioLabelStyle = { fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted2)', marginBottom: 5 };

const thStyle = { padding: '6px 8px', textAlign: 'center', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted2)' };

function LogTab({ initialExercises, onSaved }) {
  const { accessToken } = useAuth();
  const [name, setName] = useState(() => {
    const d = new Date();
    return `Workout — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  });
  const [startedAt, setStartedAt] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 16);
  });
  const [exercises, setExercises] = useState(initialExercises || []);
  const [exerciseMap, setExerciseMap] = useState({});
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    if (initialExercises?.length) setExercises(initialExercises);
  }, [initialExercises]);

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || !accessToken) return setSearchResults([]);
    try {
      const res = await api.get(`/workouts/exercises?search=${encodeURIComponent(q)}`, accessToken);
      setSearchResults(res.slice(0, 10));
    } catch {
      setSearchResults([]);
    }
  }, [accessToken]);

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 300);
    return () => clearTimeout(t);
  }, [search, doSearch]);

  const addExercise = (ex) => {
    setExercises(prev => [...prev, emptyExercise(ex)]);
    setExerciseMap(prev => ({ ...prev, [ex.id]: ex }));
    setSearch('');
    setSearchResults([]);
  };

  const updateExercise = (idx, updated) => setExercises(prev => prev.map((e, i) => i === idx ? updated : e));
  const removeExercise = (idx) => setExercises(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/workouts/sessions', {
        name,
        startedAt: new Date(startedAt).toISOString(),
        durationSeconds: durationMinutes ? Math.round(+durationMinutes * 60) : null,
        notes: workoutNotes || null,
        exercises,
      }, accessToken);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved && onSaved();
      setExercises([]);
      setWorkoutNotes('');
      setDurationMinutes('');
      const d = new Date();
      setName(`Workout — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
      setStartedAt(d.toISOString().slice(0, 16));
    } catch (e) {
      setError(e.detail || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">Session Info</div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Workout Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Start Time</label>
            <input type="datetime-local" className="input" value={startedAt} onChange={e => setStartedAt(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted2)', display: 'block', marginBottom: 4 }}>Duration (min)</label>
            <input type="number" className="input" value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)}
              style={{ width: '100%' }} placeholder="Optional" min={0} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Add Exercise</div>
        <div className="card-body">
          <div style={{ position: 'relative' }}>
            <input ref={searchRef} className="input" value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%' }} placeholder="Search exercises by name…" />
            {searchResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2, maxHeight: 220, overflowY: 'auto' }}>
                {searchResults.map(ex => (
                  <div key={ex.id} style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.78rem' }}
                    onClick={() => addExercise(ex)}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--border)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {ex.imageUrl && (
                      <img src={ex.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                        onError={e => { e.target.style.display = 'none'; }} />
                    )}
                    <span style={{ flex: 1, color: 'var(--text)', fontWeight: 500 }}>{ex.name}</span>
                    <CatBadge cat={ex.category} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{ex.equipment}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {exercises.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)', fontSize: '0.78rem', background: 'var(--card)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          Search for exercises above to add them to your workout
        </div>
      )}

      {(() => {
        let lastGroup = undefined;
        return exercises.map((ex, idx) => {
          const showHeader = ex.groupName && ex.groupName !== lastGroup;
          lastGroup = ex.groupName || lastGroup;
          return (
            <div key={idx}>
              {showHeader && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 4px', padding: '0 2px' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent2)', flexShrink: 0 }}>
                    {ex.groupName}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}
              <ExerciseBlock ex={ex} exIdx={idx} exerciseMap={exerciseMap} onUpdate={updateExercise} onRemove={removeExercise} />
            </div>
          );
        });
      })()}

      <div className="card">
        <div className="card-header">Workout Notes</div>
        <div className="card-body">
          <textarea className="input" value={workoutNotes} onChange={e => setWorkoutNotes(e.target.value)}
            style={{ width: '100%', minHeight: 60, resize: 'vertical' }} placeholder="How did it go? Any PRs? How was recovery?" />
        </div>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-pri" onClick={handleSave} disabled={saving || exercises.length === 0}
          style={{ fontSize: '0.8rem', padding: '8px 20px' }}>
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Workout'}
        </button>
      </div>
    </div>
  );
}

// ── Exercises Tab ─────────────────────────────────────────────────────────────

function ExercisesTab() {
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailEx, setDetailEx] = useState(null);
  const [progressEx, setProgressEx] = useState(null);
  const [progressData, setProgressData] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [addingTo, setAddingTo] = useState(null);   // exercise id with picker open
  const [addStatus, setAddStatus] = useState({});   // { [exId_tmplId]: 'saving'|'done'|'exists' }
  const pickerRef = useRef(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (catFilter !== 'all') params.set('category', catFilter);
      if (search) params.set('search', search);
      const [exRes, tmplRes] = await Promise.all([
        api.get(`/workouts/exercises?${params}`, accessToken),
        api.get('/workouts/templates', accessToken),
      ]);
      setExercises(exRes);
      setTemplates(tmplRes);
    } catch {
      setExercises([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, catFilter, search]);

  useEffect(() => { load(); }, [load]);

  // Close picker on outside click
  useEffect(() => {
    if (!addingTo) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setAddingTo(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addingTo]);

  const handleSave = async (payload) => {
    if (editing) {
      await api.put(`/workouts/exercises/${editing.id}`, payload, accessToken);
    } else {
      await api.post('/workouts/exercises', payload, accessToken);
    }
    load();
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete exercise?',
      message: 'This exercise will be removed from your exercise list.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/workouts/exercises/${id}`, accessToken);
      load();
    } catch {
      notify('Failed to delete exercise.', 'error');
    }
  };

  const showProgress = async (ex) => {
    setProgressEx(ex);
    try {
      const res = await api.get(`/workouts/progress?exercise_id=${ex.id}&days=90`, accessToken);
      setProgressData(res.data || []);
    } catch {
      setProgressData([]);
    }
  };

  const addToTemplate = async (ex, template) => {
    const key = `${ex.id}_${template.id}`;
    setAddStatus(s => ({ ...s, [key]: 'saving' }));
    setAddingTo(null);
    try {
      const current = await api.get(`/workouts/templates/${template.id}`, accessToken);
      if (current.exercises?.find(te => te.exerciseId === ex.id)) {
        setAddStatus(s => ({ ...s, [key]: 'exists' }));
      } else {
        await api.put(`/workouts/templates/${template.id}`, {
          exercises: [...(current.exercises || []), {
            exerciseId: ex.id,
            exerciseName: ex.name,
            category: ex.category,
            targetSets: 3,
            targetReps: null,
            targetWeight: null,
            weightUnit: 'lb',
            targetDurationSeconds: null,
            notes: '',
          }],
        }, accessToken);
        setAddStatus(s => ({ ...s, [key]: 'done' }));
      }
    } catch {
      setAddStatus(s => { const n = { ...s }; delete n[key]; return n; });
    }
    setTimeout(() => setAddStatus(s => { const n = { ...s }; delete n[key]; return n; }), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showModal && (
        <ExerciseModal exercise={editing} onClose={() => { setShowModal(false); setEditing(null); }} onSave={handleSave} />
      )}
      {detailEx && <ExerciseDetailModal exercise={detailEx} onClose={() => setDetailEx(null)} />}
      {progressEx && (
        <div className="modal-backdrop" onClick={() => setProgressEx(null)}>
          <div className="modal" style={{ width: 580 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{progressEx.name} — Progress (90 days)</span>
              <button className="btn btn-ghost" onClick={() => setProgressEx(null)} style={{ padding: '2px 8px' }}>✕</button>
            </div>
            <div className="modal-body">
              {progressData.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.78rem', padding: 24 }}>No data yet for this exercise.</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={progressData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tickFormatter={fmtShortDate} tick={{ fill: 'var(--muted2)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--muted2)', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.73rem' }}
                      labelFormatter={v => fmtDate(v)}
                      formatter={(v, n) => [v, n === 'maxWeight' ? 'Max Weight (lb)' : n]} />
                    <Line type="monotone" dataKey="maxWeight" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search…" style={{ width: 220 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['all', ...CATEGORIES].map(c => (
            <button key={c} className={`btn ${catFilter === c ? 'btn-pri' : 'btn-ghost'}`}
              onClick={() => setCatFilter(c)} style={{ fontSize: '0.7rem', padding: '4px 10px', textTransform: 'capitalize' }}>{c}</button>
          ))}
        </div>
        <button className="btn btn-pri" onClick={() => { setEditing(null); setShowModal(true); }} style={{ marginLeft: 'auto', fontSize: '0.72rem' }}>+ Custom Exercise</button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {exercises.map(ex => (
            <div key={ex.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {ex.imageUrl && (
                <img src={ex.imageUrl} alt={ex.name}
                  style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                  onClick={() => setDetailEx(ex)}
                  onError={e => { e.target.style.display = 'none'; }} />
              )}
              <div style={{ padding: '12px 14px' }}>
                <div style={{ marginBottom: 8 }}>
                  <div onClick={() => setDetailEx(ex)} style={{ fontWeight: 600, fontSize: '0.83rem', color: 'var(--text)', marginBottom: 4, cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{ex.name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <CatBadge cat={ex.category} />
                    <span style={{ fontSize: '0.6rem', color: 'var(--muted2)', padding: '2px 6px', background: 'var(--card2)', borderRadius: 4 }}>{ex.equipment}</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--muted)', padding: '2px 6px', background: 'var(--card2)', borderRadius: 4 }}>{ex.difficulty}</span>
                  </div>
                </div>
                {ex.primaryMuscles?.length > 0 && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted2)', marginBottom: 8 }}>
                    <span style={{ color: 'var(--muted)' }}>Primary: </span>{ex.primaryMuscles.join(', ')}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost" onClick={() => setDetailEx(ex)} style={{ fontSize: '0.68rem', padding: '3px 8px' }}>Details</button>
                  <button className="btn btn-ghost" onClick={() => showProgress(ex)} style={{ fontSize: '0.68rem', padding: '3px 8px' }}>Progress</button>
                  {ex.scope === 'user' && <>
                    <button className="btn btn-ghost" onClick={() => { setEditing(ex); setShowModal(true); }} style={{ fontSize: '0.68rem', padding: '3px 8px' }}>Edit</button>
                    <button className="btn btn-ghost" onClick={() => handleDelete(ex.id)} style={{ fontSize: '0.68rem', padding: '3px 8px', color: '#ef4444' }}>Delete</button>
                  </>}

                  {/* Add to template */}
                  <div style={{ position: 'relative', marginLeft: 'auto' }}>
                    {/* Status feedback */}
                    {Object.entries(addStatus).filter(([k]) => k.startsWith(ex.id + '_')).map(([k, st]) => (
                      <span key={k} style={{ fontSize: '0.65rem', color: st === 'done' ? 'var(--green2)' : 'var(--muted)', marginRight: 4 }}>
                        {st === 'done' ? '✓ Added' : st === 'exists' ? 'Already in template' : '…'}
                      </span>
                    ))}
                    <button
                      className="btn btn-ghost"
                      title="Add to template"
                      onClick={() => setAddingTo(id => id === ex.id ? null : ex.id)}
                      style={{ fontSize: '0.75rem', padding: '3px 8px', fontWeight: 700, color: 'var(--accent2)' }}
                    >
                      +
                    </button>
                    {addingTo === ex.id && (
                      <div ref={pickerRef} style={{
                        position: 'absolute', bottom: '100%', right: 0, marginBottom: 4,
                        background: 'var(--card2)', border: '1px solid var(--border)',
                        borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                        minWidth: 180, zIndex: 100, overflow: 'hidden',
                      }}>
                        <div style={{ padding: '6px 10px', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                          Add to template
                        </div>
                        {templates.length === 0 ? (
                          <div style={{ padding: '10px 12px', fontSize: '0.73rem', color: 'var(--muted)' }}>No templates yet</div>
                        ) : (
                          templates.map(t => (
                            <div key={t.id}
                              onClick={() => addToTemplate(ex, t)}
                              style={{ padding: '8px 12px', fontSize: '0.76rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--border)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <span style={{ fontWeight: 500 }}>{t.name}</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{(t.exercises || []).length} ex</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function templateExToSessionEx(te, groupName = null) {
  const base = { exerciseId: te.exerciseId, exerciseName: te.exerciseName,
                  category: te.category, notes: te.notes || '',
                  ...(groupName ? { groupName } : {}) };
  if (isCardio(te.category)) {
    return { ...base, sets: [{ setNumber: 1, completed: false,
      durationSeconds: te.targetDurationSeconds || null,
      distance: null, distanceUnit: 'mi', averageHeartRate: null, calories: null }] };
  }
  return { ...base, sets: Array.from({ length: te.targetSets || 3 }, (_, i) =>
    makeSet(i + 1, { reps: te.targetReps, weight: te.targetWeight, weightUnit: te.weightUnit || 'lb' })
  )};
}

function templateToExercises(template) {
  if (template.groups?.length > 0) {
    return template.groups.flatMap(g =>
      (g.exercises || []).map(te => templateExToSessionEx(te, g.name || null))
    );
  }
  return (template.exercises || []).map(te => templateExToSessionEx(te));
}

// ── Templates Tab ─────────────────────────────────────────────────────────────

function TemplatesTab({ allExercises, onUseTemplate }) {
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api.get('/workouts/templates', accessToken);
      setTemplates(res);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    if (editing) {
      await api.put(`/workouts/templates/${editing.id}`, payload, accessToken);
    } else {
      await api.post('/workouts/templates', payload, accessToken);
    }
    load();
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete workout template?',
      message: 'This workout template will be removed.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/workouts/templates/${id}`, accessToken);
      load();
    } catch {
      notify('Failed to delete template.', 'error');
    }
  };

  const handleToggleQuickAction = async (t) => {
    await api.put(`/workouts/templates/${t.id}`, { quickAction: !t.quickAction }, accessToken);
    load();
  };

  const handleUse = (template) => {
    onUseTemplate(template.name, templateToExercises(template));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showModal && (
        <TemplateModal template={editing} exercises={allExercises}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={handleSave} />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-pri" onClick={() => { setEditing(null); setShowModal(true); }} style={{ fontSize: '0.72rem' }}>+ New Template</button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>Loading…</div>
      ) : templates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', fontSize: '0.78rem', background: 'var(--card)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          No templates yet. Create one to save and reuse your favourite workouts.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {templates.map(t => (
            <div key={t.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)', marginBottom: 4 }}>{t.name}</div>
              {t.description && <div style={{ fontSize: '0.73rem', color: 'var(--muted2)', marginBottom: 8 }}>{t.description}</div>}
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: 12 }}>
                {t.groups?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {t.groups.map(g => (
                      <div key={g.id || g.name} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 600, color: 'var(--accent2)', fontSize: '0.68rem' }}>{g.name || 'Group'}</span>
                        <span style={{ color: 'var(--muted)' }}>– {(g.exercises || []).map(e => e.exerciseName).join(', ')}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {(t.exercises || []).length} exercise{(t.exercises || []).length !== 1 ? 's' : ''}
                    {t.exercises?.length > 0 && ': ' + t.exercises.map(e => e.exerciseName).join(', ')}
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-pri" onClick={() => handleUse(t)} style={{ fontSize: '0.72rem', padding: '4px 12px' }}>Start Workout</button>
                <button className="btn btn-ghost" onClick={() => { setEditing(t); setShowModal(true); }} style={{ fontSize: '0.72rem', padding: '4px 10px' }}>Edit</button>
                <button className="btn btn-ghost" onClick={() => handleDelete(t.id)} style={{ fontSize: '0.72rem', padding: '4px 10px', color: '#ef4444' }}>Delete</button>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleToggleQuickAction(t)}
                  title={t.quickAction ? 'Remove from dashboard quick actions' : 'Add to dashboard quick actions'}
                  style={{ padding: '4px 8px' }}
                >
                  <Icons.Star size={13} style={{ fill: t.quickAction ? 'var(--accent)' : 'none', color: t.quickAction ? 'var(--accent)' : 'var(--muted)' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Advanced Edit tab (workout sessions history) ──────────────────────────────

function AdvancedWorkoutTab({ onEditSession }) {
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const [limit, setLimit] = useState(25);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enable, setEnable] = useState({ date: false, notes: false });
  const [bulk, setBulk] = useState({ date: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const data = await api.get(`/workouts/sessions?limit=${limit}`, accessToken);
      setSessions(data.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, [accessToken, limit]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const allSelected = sessions.length > 0 && selected.size === sessions.length;
  const someSelected = selected.size > 0;
  const anyEnabled = enable.date || enable.notes;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(sessions.map(s => s.id)));

  const handleApply = async () => {
    if (!anyEnabled) return;
    setApplying(true);
    try {
      await Promise.all([...selected].map(id => {
        const updates = {};
        if (enable.notes) updates.notes = bulk.notes || null;
        if (enable.date && bulk.date) {
          const session = sessions.find(s => s.id === id);
          const origTime = session?.startedAt
            ? new Date(session.startedAt).toTimeString().slice(0, 5)
            : '00:00';
          updates.startedAt = new Date(`${bulk.date}T${origTime}:00`).toISOString();
        }
        return Object.keys(updates).length > 0
          ? api.put(`/workouts/sessions/${id}`, updates, accessToken)
          : Promise.resolve();
      }));
      await load();
    } catch {
      notify('Some updates failed.', 'error');
      await load();
    } finally {
      setApplying(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete workout sessions?',
      message: `Delete ${selected.size} workout session${selected.size !== 1 ? 's' : ''}?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await Promise.all([...selected].map(id => api.delete(`/workouts/sessions/${id}`, accessToken)));
      await load();
    } catch {
      notify('Some deletes failed.', 'error');
      await load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Show</span>
          {[25, 50, 100].map(n => (
            <button key={n} className={`btn btn-sm ${limit === n ? 'btn-pri' : 'btn-sec'}`}
              onClick={() => setLimit(n)}>{n}</button>
          ))}
          <span className="text-xs text-muted">most recent</span>
        </div>
        {someSelected && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--accent)' }}>{selected.size} selected</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {someSelected && (
        <div className="card mb-4" style={{ padding: '12px 14px', border: '1px solid var(--accent)' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted2)', marginBottom: 10 }}>
            Bulk Edit — {selected.size} session{selected.size !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={enable.date}
                onChange={e => setEnable(v => ({ ...v, date: e.target.checked }))} />
              <span style={{ color: 'var(--muted2)' }}>Date:</span>
              <input type="date" className="input mono" style={{ width: 'auto', padding: '4px 8px' }} disabled={!enable.date}
                value={bulk.date} onChange={e => setBulk(v => ({ ...v, date: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={enable.notes}
                onChange={e => setEnable(v => ({ ...v, notes: e.target.checked }))} />
              <span style={{ color: 'var(--muted2)' }}>Notes:</span>
              <input className="input" style={{ width: 160, padding: '4px 8px' }} disabled={!enable.notes}
                placeholder="Set notes…" value={bulk.notes}
                onChange={e => setBulk(v => ({ ...v, notes: e.target.value }))} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-pri btn-sm" onClick={handleApply} disabled={applying || !anyEnabled}>
              {applying ? 'Applying…' : `Apply to ${selected.size}`}
            </button>
            <button className="btn btn-sm"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)' }}
              onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : `Delete ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><div className="text-muted">Loading…</div></div>
      ) : sessions.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div className="empty-state-icon"><Icons.Dumbbell size={32} /></div>
          <div className="empty-state-text">No workout sessions yet</div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 10px', width: 32 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }} />
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Date</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Session</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Duration</th>
                <th style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>Sets</th>
                <th style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>Volume</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Notes</th>
                <th style={{ padding: '8px 10px', width: 48 }}></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => {
                const sel = selected.has(session.id);
                const dt = session.startedAt ? new Date(session.startedAt) : null;
                return (
                  <tr key={session.id} onClick={() => toggle(session.id)}
                    style={{
                      cursor: 'pointer',
                      background: sel ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                    }}>
                    <td style={{ padding: '7px 10px' }}>
                      <input type="checkbox" checked={sel} onChange={() => {}}
                        onClick={e => { e.stopPropagation(); toggle(session.id); }} />
                    </td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }} className="mono">
                      {dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.name || 'Unnamed workout'}
                    </td>
                    <td style={{ padding: '7px 10px' }} className="mono">
                      {session.durationSeconds ? fmtDuration(session.durationSeconds) : '—'}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }} className="mono">
                      {sessionSetCount(session)}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }} className="mono">
                      {sessionVolume(session) > 0 ? sessionVolume(session).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.notes || ''}
                    </td>
                    <td style={{ padding: '7px 8px' }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-xs"
                        onClick={() => onEditSession(session)}
                        style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = ['Dashboard', 'Log Workout', 'Exercises', 'Templates', 'Advanced'];

export default function Workouts() {
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(0);
  const [logExercises, setLogExercises] = useState([]);
  const [logName, setLogName] = useState('');
  const [allExercises, setAllExercises] = useState([]);
  const [dashKey, setDashKey] = useState(0);
  const [editingSession, setEditingSession] = useState(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/workouts/exercises', accessToken).then(setAllExercises).catch(() => {});
  }, [accessToken]);

  const handleUseTemplate = (name, exercises) => {
    setLogName(name);
    setLogExercises(exercises);
    setTab(1);
  };

  // Auto-start a template when navigated from the dashboard (?start=templateId)
  useEffect(() => {
    const startId = searchParams.get('start');
    if (!startId || autoStarted.current || !accessToken) return;
    autoStarted.current = true;
    api.get(`/workouts/templates/${startId}`, accessToken).then(template => {
      handleUseTemplate(template.name, templateToExercises(template));
    }).catch(() => {});
  }, [searchParams, accessToken]);

  const handleNewWorkout = () => {
    setLogExercises([]);
    setLogName('');
    setTab(1);
  };

  const handleDeleteSession = async (id) => {
    const ok = await confirm({
      title: 'Delete workout session?',
      message: 'This workout session will be removed.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/workouts/sessions/${id}`, accessToken);
      setDashKey(k => k + 1);
    } catch {
      notify('Failed to delete session.', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Workouts</h1>
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`tab${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {editingSession && (
        <EditSessionModal
          session={editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={() => { setEditingSession(null); setDashKey(k => k + 1); }}
        />
      )}

      {tab === 0 && <DashboardTab key={dashKey} onNewWorkout={handleNewWorkout} onEditSession={setEditingSession} onDeleteSession={handleDeleteSession} />}
      {tab === 1 && <LogTab key={logName + logExercises.length} initialExercises={logExercises}
        onSaved={() => setDashKey(k => k + 1)} />}
      {tab === 2 && <ExercisesTab />}
      {tab === 3 && <TemplatesTab allExercises={allExercises} onUseTemplate={handleUseTemplate} />}
      {tab === 4 && <AdvancedWorkoutTab onEditSession={setEditingSession} />}
    </div>
  );
}
