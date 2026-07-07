import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from './Icons';
import api from '../lib/api';
import { useNotify } from './AppFeedback';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

// ── Notification + audio helpers ──────────────────────────────────────────────

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const schedule = (freq, startT, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startT);
      gain.gain.linearRampToValueAtTime(0.25, startT + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + dur);
      osc.start(startT);
      osc.stop(startT + dur);
    };
    const t = ctx.currentTime;
    schedule(660, t,        0.18);
    schedule(880, t + 0.20, 0.18);
    schedule(990, t + 0.40, 0.28);
  } catch {}
}

function fireDesktopNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body: body || undefined,
      icon: '/icons/coronary_care_unit@2x.png',
      tag: `reminder-${Date.now()}`,
    });
  } catch {}
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ── Floating reminder card ────────────────────────────────────────────────────

function ReminderCard({ reminder, onDismiss, onSnooze, onLog }) {
  const isMed = reminder.reminderType === 'medication';
  const isBundle = reminder.reminderType === 'medication_bundle';

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border2)',
      borderLeft: `3px solid ${isMed ? 'var(--green2)' : isBundle ? '#a78bfa' : 'var(--accent)'}`,
      borderRadius: 10,
      padding: '12px 14px',
      boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
      backdropFilter: 'blur(8px)',
      animation: 'reminderSlideIn 0.25s ease-out',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ fontSize: '1.1rem', flexShrink: 0 }}>🔔</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: reminder.body ? 3 : 8 }}>
            {reminder.title}
          </div>
          {reminder.body && (
            <div className="text-xs text-muted" style={{ marginBottom: 8 }}>{reminder.body}</div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(isMed || isBundle) && (
              <button className="btn btn-sm btn-pri" style={{ fontSize: '0.7rem', padding: '3px 10px' }}
                onClick={onLog}>
                <Icons.Check size={11} /> Log Taken
              </button>
            )}
            <button className="btn btn-sm btn-sec" style={{ fontSize: '0.7rem', padding: '3px 10px' }}
              onClick={onSnooze}>
              <Icons.Clock size={11} /> Snooze
            </button>
            <button className="btn btn-ghost btn-xs" style={{ marginLeft: 'auto', color: 'var(--muted)' }}
              onClick={onDismiss}>
              <Icons.X size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Food plan reminder card ───────────────────────────────────────────────────

function FoodPlanCard({ plan, onLog, onSkip, onSnooze, onModify }) {
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border2)',
      borderLeft: '3px solid var(--orange)',
      borderRadius: 10,
      padding: '12px 14px',
      boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
      animation: 'reminderSlideIn 0.25s ease-out',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ fontSize: '1.1rem', flexShrink: 0 }}>🍽</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 2 }}>
            Planned: {plan.foodName}
          </div>
          <div className="text-xs text-muted" style={{ marginBottom: 8 }}>
            {plan.quantity !== 1 ? `${plan.quantity} serving${plan.quantity !== 1 ? 's' : ''}` : '1 serving'}
            {' · '}
            {plan.mealType?.charAt(0).toUpperCase() + plan.mealType?.slice(1)}
            {' · '}{plan.plannedTime}
          </div>
          <div className="text-xs" style={{ marginBottom: 10, color: 'var(--muted2)' }}>
            Did you eat this?
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-pri" style={{ fontSize: '0.7rem', padding: '3px 10px', background: 'var(--orange)', borderColor: 'var(--orange)' }}
              onClick={onLog}>
              <Icons.Check size={11} /> Yes, Log It
            </button>
            <button className="btn btn-sm btn-sec" style={{ fontSize: '0.7rem', padding: '3px 10px' }}
              onClick={onModify}>
              <Icons.Edit size={11} /> Modify
            </button>
            <button className="btn btn-sm btn-sec" style={{ fontSize: '0.7rem', padding: '3px 10px' }}
              onClick={onSnooze}>
              <Icons.Clock size={11} /> Snooze
            </button>
            <button className="btn btn-ghost btn-xs" style={{ color: 'var(--muted)' }}
              onClick={onSkip}>
              <Icons.X size={12} /> No
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Food plan modify modal ────────────────────────────────────────────────────

function FoodPlanModifyModal({ plan, accessToken, onClose, onLogged }) {
  const notify = useNotify();
  const [quantity, setQuantity] = useState(plan.quantity ?? 1);
  const [mealType, setMealType] = useState(plan.mealType ?? 'other');
  const [saving, setSaving] = useState(false);
  const snap = plan.nutritionPerServing || {};
  const scaled = {
    calories: ((snap.calories || 0) * quantity).toFixed(0),
    proteinG: ((snap.proteinG || 0) * quantity).toFixed(1),
    carbsG: ((snap.carbsG || 0) * quantity).toFixed(1),
    fatG: ((snap.fatG || 0) * quantity).toFixed(1),
  };

  const handleLog = async () => {
    setSaving(true);
    try {
      await api.post(`/food-plans/${plan.id}/log`, { quantity, mealType }, accessToken);
      onLogged();
    } catch {
      notify('Failed to log.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <span className="modal-title">Log — {plan.foodName}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Servings</label>
              <input type="number" className="input mono" min="0.1" step="0.5"
                value={quantity} onChange={e => setQuantity(parseFloat(e.target.value) || 1)} />
            </div>
            <div className="input-group">
              <label className="input-label">Meal</label>
              <select className="input" value={mealType} onChange={e => setMealType(e.target.value)}>
                {MEAL_TYPES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 14px' }}>
            <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 8 }}>
              Nutrition ({quantity} serving{quantity !== 1 ? 's' : ''})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center' }}>
              {[['Calories', scaled.calories, 'kcal'], ['Protein', scaled.proteinG, 'g'], ['Carbs', scaled.carbsG, 'g'], ['Fat', scaled.fatG, 'g']].map(([lbl, val, unit]) => (
                <div key={lbl}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase' }}>{lbl}</div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{val}<span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>{unit}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleLog} disabled={saving}>
            {saving ? 'Logging…' : 'Log Food'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main manager component ────────────────────────────────────────────────────

export default function ReminderManager() {
  const { accessToken } = useAuth();
  const [dueReminders, setDueReminders] = useState([]);
  const [dueFoodPlans, setDueFoodPlans] = useState([]);
  const [modifyingPlan, setModifyingPlan] = useState(null);
  const pollRef = useRef(null);
  const seenRef = useRef(new Set());

  // Request browser notification permission once on mount
  useEffect(() => { requestNotificationPermission(); }, []);

  const poll = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [reminders, foodPlans] = await Promise.all([
        api.get('/reminders/due', accessToken).catch(() => []),
        api.get('/food-plans/due', accessToken).catch(() => []),
      ]);
      setDueReminders(prev => {
        const next = reminders.filter(r => !seenRef.current.has(`rem-${r.id}`));
        if (next.length > 0) {
          next.forEach(r => {
            seenRef.current.add(`rem-${r.id}`);
            fireDesktopNotification(r.title, r.body || null);
          });
          playAlertSound();
        }
        return [...prev, ...next];
      });
      setDueFoodPlans(prev => {
        const next = foodPlans.filter(p => !seenRef.current.has(`fp-${p.id}`));
        if (next.length > 0) {
          next.forEach(p => {
            seenRef.current.add(`fp-${p.id}`);
            fireDesktopNotification(`Meal reminder: ${p.foodName}`, `Did you eat your ${p.mealType}?`);
          });
          playAlertSound();
        }
        return [...prev, ...next];
      });
    } catch {}
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    poll();
    pollRef.current = setInterval(poll, 60000);
    return () => clearInterval(pollRef.current);
  }, [poll, accessToken]);

  const dismissReminder = useCallback(async (id) => {
    await api.post(`/reminders/${id}/acknowledge`, {}, accessToken).catch(() => {});
    setDueReminders(r => r.filter(x => x.id !== id));
  }, [accessToken]);

  const snoozeReminder = useCallback(async (id) => {
    await api.post(`/reminders/${id}/snooze`, {}, accessToken).catch(() => {});
    setDueReminders(r => r.filter(x => x.id !== id));
  }, [accessToken]);

  const logMedReminder = useCallback(async (rem) => {
    if (rem.entityId && rem.reminderType === 'medication') {
      const today = new Date().toISOString().slice(0, 10);
      await api.post('/medications/logs', {
        medicationId: rem.entityId,
        status: 'taken',
        scheduledFor: today,
        takenAt: new Date().toISOString(),
      }, accessToken).catch(() => {});
    }
    if (rem.entityId && rem.reminderType === 'medication_bundle') {
      await api.post(`/medications/bundles/${rem.entityId}/log`, { status: 'taken' }, accessToken).catch(() => {});
    }
    await dismissReminder(rem.id);
  }, [accessToken, dismissReminder]);

  const logFoodPlan = useCallback(async (plan) => {
    await api.post(`/food-plans/${plan.id}/log`, {}, accessToken).catch(() => {});
    setDueFoodPlans(fp => fp.filter(x => x.id !== plan.id));
  }, [accessToken]);

  const skipFoodPlan = useCallback(async (plan) => {
    await api.post(`/food-plans/${plan.id}/skip`, {}, accessToken).catch(() => {});
    setDueFoodPlans(fp => fp.filter(x => x.id !== plan.id));
  }, [accessToken]);

  const snoozeFoodPlan = useCallback((plan) => {
    // Hide from this session's reminder queue; will not re-appear (window already passed after snooze)
    setDueFoodPlans(fp => fp.filter(x => x.id !== plan.id));
  }, []);

  const total = dueReminders.length + dueFoodPlans.length;
  if (total === 0 && !modifyingPlan) return null;

  return (
    <>
      <div style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 1500,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 320,
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
      }}>
        {dueReminders.map(r => (
          <ReminderCard
            key={r.id}
            reminder={r}
            onDismiss={() => dismissReminder(r.id)}
            onSnooze={() => snoozeReminder(r.id)}
            onLog={() => logMedReminder(r)}
          />
        ))}
        {dueFoodPlans.map(p => (
          <FoodPlanCard
            key={p.id}
            plan={p}
            onLog={() => logFoodPlan(p)}
            onSkip={() => skipFoodPlan(p)}
            onSnooze={() => snoozeFoodPlan(p)}
            onModify={() => setModifyingPlan(p)}
          />
        ))}
      </div>

      {modifyingPlan && (
        <FoodPlanModifyModal
          plan={modifyingPlan}
          accessToken={accessToken}
          onClose={() => setModifyingPlan(null)}
          onLogged={() => {
            setDueFoodPlans(fp => fp.filter(x => x.id !== modifyingPlan.id));
            setModifyingPlan(null);
          }}
        />
      )}
    </>
  );
}
