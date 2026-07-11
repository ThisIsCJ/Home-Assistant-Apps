import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icons } from '../components/Icons';
import { api } from '../lib/api';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FREQUENCIES = [
  { value: 'manual', label: 'Manual only' },
  { value: 'hours', label: 'Every few hours' },
  { value: 'days', label: 'Every few days' },
  { value: 'weeks', label: 'Weekly' },
  { value: 'months', label: 'Monthly' },
];

function newSourceDraft() {
  return {
    id: null,
    label: '',
    url: '',
    secret: '',
    enabled: true,
    schedule: { frequency: 'days', interval: 1, time: '03:00', dayOfWeek: 1, dayOfMonth: 1 },
  };
}

// Merge a stored schedule into a full draft so every field has a value for the
// controlled inputs regardless of which frequency was saved.
function draftFromSource(source) {
  const s = source.schedule || {};
  return {
    id: source.id,
    label: source.label || '',
    url: source.url || '',
    secret: source.secret || '',
    enabled: source.enabled !== false,
    schedule: {
      frequency: s.frequency || 'manual',
      interval: s.interval ?? (s.frequency === 'hours' ? 6 : 1),
      time: s.time || '03:00',
      dayOfWeek: s.dayOfWeek ?? 1,
      dayOfMonth: s.dayOfMonth ?? 1,
    },
  };
}

// Only send the fields that matter for the chosen frequency.
function scheduleForSave(schedule) {
  switch (schedule.frequency) {
    case 'hours': return { frequency: 'hours', interval: Number(schedule.interval) || 6 };
    case 'days': return { frequency: 'days', interval: Number(schedule.interval) || 1, time: schedule.time };
    case 'weeks': return { frequency: 'weeks', dayOfWeek: Number(schedule.dayOfWeek), time: schedule.time };
    case 'months': return { frequency: 'months', dayOfMonth: Number(schedule.dayOfMonth) || 1, time: schedule.time };
    default: return { frequency: 'manual' };
  }
}

function describeSchedule(schedule) {
  const s = schedule || {};
  switch (s.frequency) {
    case 'hours': return `Every ${s.interval} hour${s.interval === 1 ? '' : 's'}`;
    case 'days': return `Every ${s.interval} day${s.interval === 1 ? '' : 's'} at ${s.time}`;
    case 'weeks': return `Weekly on ${WEEKDAYS[s.dayOfWeek] || 'Monday'} at ${s.time}`;
    case 'months': return `Monthly on day ${s.dayOfMonth} at ${s.time}`;
    default: return 'Manual only';
  }
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export function AdminCookbookSync({ me }) {
  const [config, setConfig] = useState({ inbound: [], outbound: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const [linkLabel, setLinkLabel] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);

  const [draft, setDraft] = useState(null); // outbound add/edit form, null = closed
  const [savingSource, setSavingSource] = useState(false);
  const [busySourceId, setBusySourceId] = useState('');
  const [runResult, setRunResult] = useState({}); // sourceId → message

  const reload = () => api.get('/cookbook/sync')
    .then((res) => setConfig({ inbound: res.inbound || [], outbound: res.outbound || [] }))
    .catch((err) => setError(err.message));

  useEffect(() => {
    if (!me.isAdmin) return;
    reload().finally(() => setLoading(false));
  }, [me.isAdmin]);

  if (!me.isAdmin) {
    return (
      <div className="panel">
        <div className="panel__body">
          <div className="empty-inline">This page is only available to cookbook admins.</div>
        </div>
      </div>
    );
  }

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
    } catch { /* clipboard blocked — the value is visible for manual copy */ }
  };

  const createLink = async () => {
    setCreatingLink(true);
    setError('');
    try {
      await api.post('/cookbook/sync/inbound', { label: linkLabel.trim() });
      setLinkLabel('');
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingLink(false);
    }
  };

  const revokeLink = async (token) => {
    if (!window.confirm(`Revoke "${token.label}"? Any peer using it will lose access.`)) return;
    setError('');
    try {
      await api.delete(`/cookbook/sync/inbound/${token.id}`);
      await reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveSource = async () => {
    if (!draft.url.trim()) { setError('A pull URL is required.'); return; }
    setSavingSource(true);
    setError('');
    const body = {
      label: draft.label.trim(),
      url: draft.url.trim(),
      secret: draft.secret.trim(),
      enabled: draft.enabled,
      schedule: scheduleForSave(draft.schedule),
    };
    try {
      if (draft.id) await api.put(`/cookbook/sync/outbound/${draft.id}`, body);
      else await api.post('/cookbook/sync/outbound', body);
      setDraft(null);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSource(false);
    }
  };

  const removeSource = async (source) => {
    if (!window.confirm(`Remove sync source "${source.label}"? Already-synced recipes stay.`)) return;
    setBusySourceId(source.id);
    setError('');
    try {
      await api.delete(`/cookbook/sync/outbound/${source.id}`);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusySourceId('');
    }
  };

  const runSource = async (source) => {
    setBusySourceId(source.id);
    setError('');
    setRunResult((prev) => ({ ...prev, [source.id]: '' }));
    try {
      const res = await api.post(`/cookbook/sync/outbound/${source.id}/run`, {});
      setRunResult((prev) => ({ ...prev, [source.id]: res.message || 'Synced.' }));
      await reload();
    } catch (err) {
      setRunResult((prev) => ({ ...prev, [source.id]: err.message }));
    } finally {
      setBusySourceId('');
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <Link className="btn cookbook-back" to="/admin">
            <Icons.ChevronLeft size={14} /> Back to admin
          </Link>
          <h1 className="page__title">Recipe sync</h1>
        </div>
      </div>

      {error && <div className="inline-alert inline-alert--error">{error}</div>}
      {loading ? (
        <div className="panel"><div className="panel__body"><div className="empty-inline">Loading sync config…</div></div></div>
      ) : (
        <div className="admin-panels">
          {/* --- Inbound ---------------------------------------------------- */}
          <div className="panel">
            <div className="panel__header">
              <div className="panel__title"><Icons.ArrowUp size={14} /> Sync my recipes</div>
              <div className="panel__meta">let other instances pull from here</div>
            </div>
            <div className="panel__body sync-section">
              <p className="admin-transfer__hint">
                Create a sync link to publish this cookbook. Anyone holding the link's secret can
                read every recipe here, so use a separate link per peer — you can revoke one without
                disturbing the others.
              </p>

              <div className="admin-access__add-row">
                <input
                  className="input"
                  type="text"
                  placeholder="Label (e.g. Cabin instance)"
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createLink(); } }}
                />
                <button className="btn btn--primary" onClick={createLink} disabled={creatingLink}>
                  <Icons.Plus size={13} /> {creatingLink ? 'Creating…' : 'Create link'}
                </button>
              </div>

              {config.inbound.length === 0 ? (
                <div className="empty-inline">No sync links yet.</div>
              ) : (
                <div className="sync-list">
                  {config.inbound.map((token) => (
                    <div className="sync-link" key={token.id}>
                      <div className="sync-link__head">
                        <div className="sync-link__label"><Icons.Link size={13} /> {token.label}</div>
                        <button className="btn btn--danger btn--sm" onClick={() => revokeLink(token)}>
                          <Icons.Trash size={12} /> Revoke
                        </button>
                      </div>
                      <SecretField label="Pull URL" value={token.url} copyKey={`u-${token.id}`} copied={copied} onCopy={copy} />
                      <SecretField label="Secret" value={token.secret} copyKey={`s-${token.id}`} copied={copied} onCopy={copy} secret />
                      <div className="cookbook-list__meta">
                        {token.lastUsedAt ? `Last used ${formatDateTime(token.lastUsedAt)}` : 'Never used'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* --- Outbound -------------------------------------------------- */}
          <div className="panel">
            <div className="panel__header">
              <div className="panel__title"><Icons.ArrowDown size={14} /> Sync other recipes</div>
              <div className="panel__meta">pull from other instances</div>
            </div>
            <div className="panel__body sync-section">
              <p className="admin-transfer__hint">
                Add another instance's pull URL and secret to copy its recipes here. Syncs merge by
                recipe id — updates happen in place and never create duplicates. Recipes deleted on
                the source are kept here.
              </p>

              {config.outbound.length === 0 && !draft && (
                <div className="empty-inline">No sync sources yet.</div>
              )}

              <div className="sync-list">
                {config.outbound.map((source) => (
                  <div className="sync-source" key={source.id}>
                    <div className="sync-source__head">
                      <div className="sync-source__title">
                        {source.label}
                        {source.enabled === false && <span className="sync-badge">paused</span>}
                      </div>
                      <div className="sync-source__actions">
                        <button
                          className="btn btn--sm"
                          onClick={() => runSource(source)}
                          disabled={busySourceId === source.id}
                        >
                          <Icons.RefreshCw size={12} /> {busySourceId === source.id ? 'Syncing…' : 'Sync now'}
                        </button>
                        <button className="btn btn--sm" onClick={() => setDraft(draftFromSource(source))}>
                          <Icons.Settings size={12} /> Edit
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => removeSource(source)}
                          disabled={busySourceId === source.id}
                        >
                          <Icons.Trash size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="sync-source__url">{source.url}</div>
                    <div className="cookbook-list__meta">
                      <Icons.Clock size={11} /> {describeSchedule(source.schedule)}
                      {source.nextRunAt && source.enabled !== false && source.schedule?.frequency !== 'manual'
                        ? ` · next ${formatDateTime(source.nextRunAt)}` : ''}
                    </div>
                    {(source.lastStatus || runResult[source.id]) && (
                      <div className={`sync-status sync-status--${source.lastStatus === 'error' ? 'error' : 'ok'}`}>
                        {runResult[source.id]
                          || `${source.lastMessage || source.lastStatus}${source.lastRunAt ? ` · ${formatDateTime(source.lastRunAt)}` : ''}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {draft ? (
                <OutboundForm
                  draft={draft}
                  setDraft={setDraft}
                  onSave={saveSource}
                  onCancel={() => { setDraft(null); setError(''); }}
                  saving={savingSource}
                />
              ) : (
                <button className="btn" onClick={() => setDraft(newSourceDraft())}>
                  <Icons.Plus size={13} /> Add sync source
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SecretField({ label, value, copyKey, copied, onCopy, secret }) {
  return (
    <div className="sync-field">
      <div className="field__label">{label}</div>
      <div className="sync-field__row">
        <input className="input sync-field__input" type={secret ? 'password' : 'text'} value={value} readOnly />
        <button className="btn btn--sm" onClick={() => onCopy(value, copyKey)} title={`Copy ${label.toLowerCase()}`}>
          {copied === copyKey ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

function OutboundForm({ draft, setDraft, onSave, onCancel, saving }) {
  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const setSchedule = (key, value) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, [key]: value } }));
  const freq = draft.schedule.frequency;

  return (
    <div className="sync-form">
      <div className="sync-form__title">{draft.id ? 'Edit sync source' : 'New sync source'}</div>

      <div className="field">
        <div className="field__label">Label</div>
        <input className="input" type="text" placeholder="Cabin instance"
          value={draft.label} onChange={(e) => setField('label', e.target.value)} />
      </div>

      <div className="field">
        <div className="field__label">Pull URL</div>
        <input className="input" type="text" placeholder="https://host/api/cookbook/sync/pull"
          value={draft.url} onChange={(e) => setField('url', e.target.value)} />
      </div>

      <div className="field">
        <div className="field__label">Secret</div>
        <input className="input" type="text" placeholder="sync_…"
          value={draft.secret} onChange={(e) => setField('secret', e.target.value)} />
      </div>

      <div className="field">
        <div className="field__label">Schedule</div>
        <div className="sync-schedule">
          <select className="input" value={freq} onChange={(e) => setSchedule('frequency', e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>

          {freq === 'hours' && (
            <label className="sync-schedule__inline">
              every
              <input className="input sync-schedule__num" type="number" min="1" max="8760"
                value={draft.schedule.interval} onChange={(e) => setSchedule('interval', e.target.value)} />
              hours
            </label>
          )}

          {freq === 'days' && (
            <label className="sync-schedule__inline">
              every
              <input className="input sync-schedule__num" type="number" min="1" max="365"
                value={draft.schedule.interval} onChange={(e) => setSchedule('interval', e.target.value)} />
              days at
              <input className="input sync-schedule__num" type="time"
                value={draft.schedule.time} onChange={(e) => setSchedule('time', e.target.value)} />
            </label>
          )}

          {freq === 'weeks' && (
            <label className="sync-schedule__inline">
              on
              <select className="input" value={draft.schedule.dayOfWeek}
                onChange={(e) => setSchedule('dayOfWeek', Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
              at
              <input className="input sync-schedule__num" type="time"
                value={draft.schedule.time} onChange={(e) => setSchedule('time', e.target.value)} />
            </label>
          )}

          {freq === 'months' && (
            <label className="sync-schedule__inline">
              on day
              <input className="input sync-schedule__num" type="number" min="1" max="31"
                value={draft.schedule.dayOfMonth} onChange={(e) => setSchedule('dayOfMonth', e.target.value)} />
              at
              <input className="input sync-schedule__num" type="time"
                value={draft.schedule.time} onChange={(e) => setSchedule('time', e.target.value)} />
            </label>
          )}
        </div>
      </div>

      <label className="sync-form__toggle">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setField('enabled', e.target.checked)} />
        Enabled (runs on its schedule)
      </label>

      <div className="sync-form__actions">
        <button className="btn btn--primary" onClick={onSave} disabled={saving}>
          <Icons.Check size={13} /> {saving ? 'Saving…' : 'Save source'}
        </button>
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
