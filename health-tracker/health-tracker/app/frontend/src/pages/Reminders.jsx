import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';
import { useConfirm, useNotify } from '../components/AppFeedback';

const TODAY = new Date().toISOString().slice(0, 10);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TYPE_CFG = {
  custom:             { label: 'Custom',     color: '#60a5fa', icon: Icons.AlarmClock },
  medication:         { label: 'Medication', color: '#10b981', icon: Icons.Pill },
  medication_bundle:  { label: 'Bundle',     color: '#a78bfa', icon: Icons.Package },
};

function scheduleLabel(schedule) {
  if (!schedule) return '—';
  const t = schedule.time || '—';
  const fmt = (s) => {
    const [h, m] = s.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  };
  if (schedule.mode === 'once') return `Once on ${schedule.date} at ${fmt(t)}`;
  if (schedule.mode === 'weekly') {
    const days = (schedule.days || []).map(d => DAYS[d]).join(', ');
    return `${days || 'No days'} at ${fmt(t)}`;
  }
  return `Daily at ${fmt(t)}`;
}

// ── Add/Edit Reminder Modal ───────────────────────────────────────────────────

function ReminderModal({ reminder, medications, bundles, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const isEdit = !!reminder;
  const [form, setForm] = useState({
    title: reminder?.title ?? '',
    body: reminder?.body ?? '',
    reminderType: reminder?.reminderType ?? 'custom',
    entityId: reminder?.entityId ?? '',
    snoozeMinutes: reminder?.snoozeMinutes ?? 10,
    enabled: reminder?.enabled ?? true,
  });
  const [schedule, setSchedule] = useState({
    mode: reminder?.schedule?.mode ?? 'daily',
    time: reminder?.schedule?.time ?? '09:00',
    days: reminder?.schedule?.days ?? [0, 1, 2, 3, 4],
    date: reminder?.schedule?.date ?? TODAY,
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const setF = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: '' }));
  };
  const setSch = (k, v) => setSchedule(s => ({ ...s, [k]: v }));

  const toggleDay = (d) => setSch('days', schedule.days.includes(d)
    ? schedule.days.filter(x => x !== d)
    : [...schedule.days, d].sort());

  // Auto-fill title when entity changes
  useEffect(() => {
    if (form.reminderType === 'medication' && form.entityId) {
      const med = medications.find(m => m.id === form.entityId);
      if (med && !form.title) setF('title', `Take ${med.name}${med.dose ? ` ${med.dose}` : ''}`);
    }
    if (form.reminderType === 'medication_bundle' && form.entityId) {
      const bun = bundles.find(b => b.id === form.entityId);
      if (bun && !form.title) setF('title', `Log ${bun.name}`);
    }
  }, [form.entityId, form.reminderType]);

  const handleSave = async () => {
    if (!form.title.trim()) {
      setErrors({ title: 'Title is required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, schedule };
      if (isEdit) {
        await api.put(`/reminders/${reminder.id}`, payload, accessToken);
      } else {
        await api.post('/reminders', payload, accessToken);
      }
      onSaved();
      onClose();
    } catch {
      notify('Failed to save reminder.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title">
            <Icons.AlarmClock size={14} style={{ marginRight: 6 }} />
            {isEdit ? 'Edit Reminder' : 'New Reminder'}
          </span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Type */}
          <div className="input-group">
            <label className="input-label">Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(TYPE_CFG).map(([val, { label }]) => (
                <button key={val} type="button"
                  className={`btn btn-sm ${form.reminderType === val ? 'btn-pri' : 'btn-sec'}`}
                  onClick={() => { setF('reminderType', val); setF('entityId', ''); }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Entity picker */}
          {form.reminderType === 'medication' && (
            <div className="input-group">
              <label className="input-label">Medication</label>
              <select className="input" value={form.entityId} onChange={e => setF('entityId', e.target.value)}>
                <option value="">– pick a medication –</option>
                {medications.map(m => (
                  <option key={m.id} value={m.id}>{m.name}{m.dose ? ` ${m.dose}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          {form.reminderType === 'medication_bundle' && (
            <div className="input-group">
              <label className="input-label">Bundle</label>
              <select className="input" value={form.entityId} onChange={e => setF('entityId', e.target.value)}>
                <option value="">– pick a bundle –</option>
                {bundles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Title */}
          <div className="input-group">
            <label className="input-label">Title *</label>
            <input className={`input ${errors.title ? 'input-error' : ''}`} placeholder="Reminder title" value={form.title}
              onChange={e => setF('title', e.target.value)} autoFocus />
            {errors.title && <div className="field-error">{errors.title}</div>}
          </div>

          {/* Body */}
          <div className="input-group">
            <label className="input-label">Note (optional)</label>
            <input className="input" placeholder="Additional details" value={form.body ?? ''}
              onChange={e => setF('body', e.target.value)} />
          </div>

          {/* Schedule */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: 12 }}>
            <div className="input-label" style={{ marginBottom: 10 }}>Schedule</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['daily', 'weekly', 'once'].map(m => (
                <button key={m} type="button"
                  className={`btn btn-sm ${schedule.mode === m ? 'btn-pri' : 'btn-sec'}`}
                  style={{ textTransform: 'capitalize' }}
                  onClick={() => setSch('mode', m)}>{m}</button>
              ))}
            </div>

            <div className="input-group" style={{ marginBottom: schedule.mode !== 'once' ? 0 : 10 }}>
              <label className="input-label">Time</label>
              <input type="time" className="input mono" value={schedule.time}
                onChange={e => setSch('time', e.target.value)} />
            </div>

            {schedule.mode === 'weekly' && (
              <div style={{ marginTop: 10 }}>
                <label className="input-label" style={{ marginBottom: 6 }}>Days</label>
                <div style={{ display: 'flex', gap: 5 }}>
                  {DAYS.map((d, i) => (
                    <button key={i} type="button"
                      onClick={() => toggleDay(i)}
                      style={{
                        width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--border2)',
                        background: schedule.days.includes(i) ? 'var(--accent)' : 'var(--bg3)',
                        color: schedule.days.includes(i) ? '#fff' : 'var(--muted)',
                        fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer',
                      }}>{d}</button>
                  ))}
                </div>
              </div>
            )}

            {schedule.mode === 'once' && (
              <div className="input-group" style={{ marginTop: 10 }}>
                <label className="input-label">Date</label>
                <input type="date" className="input mono" value={schedule.date}
                  onChange={e => setSch('date', e.target.value)} />
              </div>
            )}
          </div>

          {/* Snooze */}
          <div className="input-group">
            <label className="input-label">Snooze duration (minutes)</label>
            <input type="number" className="input mono" min="1" max="120" value={form.snoozeMinutes}
              onChange={e => setF('snoozeMinutes', parseInt(e.target.value) || 10)} />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Reminder'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Reminders() {
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const [reminders, setReminders] = useState([]);
  const [medications, setMedications] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [toggling, setToggling] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rems, meds, buns] = await Promise.all([
        api.get('/reminders', accessToken),
        api.get('/medications', accessToken).catch(() => []),
        api.get('/medications/bundles/list', accessToken).catch(() => []),
      ]);
      setReminders(rems);
      setMedications(meds.filter(m => m.active));
      setBundles(buns);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { if (accessToken) load(); }, [load, accessToken]);

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete reminder?',
      message: 'This reminder will be removed from your schedule.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/reminders/${id}`, accessToken);
      setReminders(r => r.filter(x => x.id !== id));
    } catch {
      notify('Failed to delete reminder.', 'error');
    }
  };

  const handleToggle = async (rem) => {
    setToggling(t => ({ ...t, [rem.id]: true }));
    try {
      const updated = await api.put(`/reminders/${rem.id}`, { enabled: !rem.enabled }, accessToken);
      setReminders(r => r.map(x => x.id === rem.id ? updated : x));
    } finally {
      setToggling(t => ({ ...t, [rem.id]: false }));
    }
  };

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'Custom' },
    { id: 'medication', label: 'Medication' },
    { id: 'medication_bundle', label: 'Bundle' },
  ];

  const filtered = filter === 'all' ? reminders : reminders.filter(r => r.reminderType === filter);

  const medMap = Object.fromEntries(medications.map(m => [m.id, m]));
  const bunMap = Object.fromEntries(bundles.map(b => [b.id, b]));

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Reminders</div>
          <div className="text-muted text-sm mt-1">Manage medication, health, and custom reminders</div>
        </div>
        <button className="btn btn-pri btn-sm" onClick={() => { setEditingReminder(null); setShowModal(true); }}>
          <Icons.Plus size={13} /> New Reminder
        </button>
      </div>

      {/* Filter tabs */}
      <div className="tabs" style={{ marginBottom: 14 }}>
        {FILTERS.map(f => (
          <button key={f.id} className={`tab${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id !== 'all' && (
              <span style={{ marginLeft: 5, fontSize: '0.65rem', opacity: 0.7 }}>
                {reminders.filter(r => r.reminderType === f.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state"><div className="text-muted">Loading…</div></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Icons.AlarmClock size={32} style={{ opacity: 0.2, marginBottom: 10 }} />
          <div className="empty-state-text">No reminders yet</div>
          <button className="btn btn-pri btn-sm" style={{ marginTop: 10 }}
            onClick={() => { setEditingReminder(null); setShowModal(true); }}>
            <Icons.Plus size={12} /> Create your first reminder
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(rem => {
            const cfg = TYPE_CFG[rem.reminderType] || TYPE_CFG.custom;
            const TypeIcon = cfg.icon;
            const entityName = rem.reminderType === 'medication'
              ? (medMap[rem.entityId]?.name || null)
              : rem.reminderType === 'medication_bundle'
              ? (bunMap[rem.entityId]?.name || null)
              : null;

            return (
              <div key={rem.id} className="card" style={{ opacity: rem.enabled ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {/* Icon */}
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${cfg.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <TypeIcon size={16} style={{ color: cfg.color }} />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>{rem.title}</span>
                      <span style={{ fontSize: '0.62rem', fontWeight: 600, color: cfg.color, background: `${cfg.color}18`, padding: '1px 6px', borderRadius: 4 }}>
                        {cfg.label}
                      </span>
                    </div>
                    {rem.body && <div className="text-xs text-muted" style={{ marginBottom: 3 }}>{rem.body}</div>}
                    {entityName && <div className="text-xs text-muted">{entityName}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                      <Icons.Clock size={11} style={{ color: 'var(--muted)' }} />
                      <span className="text-xs text-muted">{scheduleLabel(rem.schedule)}</span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(rem)}
                      disabled={toggling[rem.id]}
                      style={{
                        width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                        background: rem.enabled ? 'var(--accent)' : 'var(--bg3)',
                        position: 'relative', transition: 'background 0.2s',
                      }}
                      title={rem.enabled ? 'Disable' : 'Enable'}
                    >
                      <span style={{
                        position: 'absolute', top: 3, left: rem.enabled ? 19 : 3,
                        width: 16, height: 16, borderRadius: '50%', background: '#fff',
                        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </button>
                    <button className="btn btn-ghost btn-xs"
                      onClick={() => { setEditingReminder(rem); setShowModal(true); }}>
                      <Icons.Edit size={12} />
                    </button>
                    <button className="btn btn-ghost btn-xs btn-danger" onClick={() => handleDelete(rem.id)}>
                      <Icons.Trash size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <ReminderModal
          reminder={editingReminder}
          medications={medications}
          bundles={bundles}
          accessToken={accessToken}
          onClose={() => { setShowModal(false); setEditingReminder(null); }}
          onSaved={load}
        />
      )}
    </>
  );
}
