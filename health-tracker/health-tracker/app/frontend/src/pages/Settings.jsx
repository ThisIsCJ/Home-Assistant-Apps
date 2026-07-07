import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';
import { SKINS, applySkin, applyCustomVars, currentSkinId, CUSTOM_SKIN_DEFAULTS } from '../lib/skins';
import { useConfirm, useNotify } from '../components/AppFeedback';

// ── Cookbook section ──────────────────────────────────────────────────────────

function CookbookSection({ accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [config, setConfig]       = useState(null);   // null = loading, false = none saved
  const [url, setUrl]             = useState('');
  const [apiKey, setApiKey]       = useState('');
  const [showKey, setShowKey]     = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [testing, setTesting]     = useState(false);
  const [importing, setImporting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [error, setError]         = useState('');

  const load = useCallback(() => {
    api.get('/cookbook/config', accessToken)
      .then(d => { setConfig(d || false); })
      .catch(() => setConfig(false));
  }, [accessToken]);

  useEffect(() => { if (accessToken) load(); }, [load, accessToken]);

  const handleSave = async () => {
    if (!url.trim() || !apiKey.trim()) { setError('URL and API key are required'); return; }
    setError('');
    try {
      await api.put('/cookbook/config', { url: url.trim(), apiKey: apiKey.trim() }, accessToken);
      setApiKey('');
      setShowForm(false);
      setTestResult(null);
      setImportResult(null);
      load();
    } catch (e) {
      setError(e.message || 'Failed to save');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const r = await api.post('/cookbook/test', {}, accessToken);
      setTestResult({ ok: true, message: `Connected — ${r.recipeCount} recipe${r.recipeCount !== 1 ? 's' : ''} found` });
    } catch (e) {
      setTestResult({ ok: false, message: e.message || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    setError('');
    try {
      const r = await api.post('/cookbook/import', {}, accessToken);
      setImportResult(r);
      load();
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleRemove = async () => {
    const ok = await confirm({
      title: 'Remove cookbook connection?',
      message: 'Recipe syncing will stop until you connect it again.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete('/cookbook/config', accessToken);
      setConfig(false);
      setTestResult(null);
      setImportResult(null);
    } catch {
      notify('Failed to remove cookbook connection.', 'error');
    }
  };

  const lastSync = config?.lastSyncedAt;
  const lastStats = config?.lastSyncStats;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.BookOpen size={13} /> Cookbook</div>
        {config && !showForm && (
          <button className="btn btn-pri btn-xs" onClick={handleImport} disabled={importing}>
            {importing ? 'Importing…' : <><Icons.Refresh size={11} /> Sync Recipes</>}
          </button>
        )}
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          Connect to an external cookbook API to import your recipes as meal templates in the Food section.
        </div>

        {/* Saved connection status */}
        {config && !showForm && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green2)', flexShrink: 0, display: 'inline-block' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--fg)', wordBreak: 'break-all' }}>{config.url}</div>
              {lastSync && (
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 2 }}>
                  Last synced {lastSync.slice(0, 10)}
                  {lastStats && ` — ${lastStats.created} created, ${lastStats.updated} updated`}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button className="btn btn-ghost btn-xs" onClick={handleTest} disabled={testing} title="Test connection">
                {testing ? '…' : <Icons.Refresh size={11} />}
              </button>
              <button className="btn btn-ghost btn-xs" onClick={() => { setUrl(config.url); setShowForm(true); }} title="Edit">
                <Icons.Edit size={11} />
              </button>
              <button className="btn btn-ghost btn-xs btn-danger" onClick={handleRemove} title="Remove">
                <Icons.Trash size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Add / edit form */}
        {(!config || showForm) && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: '0.76rem' }}>
              {config ? 'Update Connection' : 'Connect a Cookbook'}
            </div>

            <div className="input-group">
              <label className="input-label">Cookbook API URL</label>
              <input
                className="input mono"
                placeholder="https://app.cjsaba.com"
                value={url}
                onChange={e => { setUrl(e.target.value); setTestResult(null); }}
              />
              <div style={{ fontSize: '0.67rem', color: 'var(--muted)', marginTop: 3 }}>
                Base URL — the integration will try <span className="mono">/api/recipes</span> and <span className="mono">/recipes</span> automatically.
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">{config?.hasApiKey ? 'New API Key (leave blank to keep current)' : 'API Key'}</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input mono"
                  type={showKey ? 'text' : 'password'}
                  placeholder={config?.hasApiKey ? '••••••••' : 'key_…'}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestResult(null); }}
                  style={{ paddingRight: 36 }}
                />
                <button
                  onClick={() => setShowKey(s => !s)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}
                  tabIndex={-1}
                >
                  {showKey ? <Icons.X size={13} /> : <Icons.Info size={13} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {config && (
                <button className="btn btn-ghost btn-sm" style={{ marginRight: 'auto' }} onClick={() => { setShowForm(false); setError(''); }}>
                  Cancel
                </button>
              )}
              <button className="btn btn-sec btn-sm" disabled={!url.trim() || !apiKey.trim() || testing}
                onClick={async () => {
                  setTesting(true); setTestResult(null); setError('');
                  try {
                    // Save first so /test can decrypt the key, then report result
                    await api.put('/cookbook/config', { url: url.trim(), apiKey: apiKey.trim() }, accessToken);
                    const r = await api.post('/cookbook/test', {}, accessToken);
                    setTestResult({ ok: true, message: `Connected — ${r.recipeCount} recipe${r.recipeCount !== 1 ? 's' : ''} found` });
                    setShowForm(false);
                    setApiKey('');
                    load();
                  } catch (e) {
                    setTestResult({ ok: false, message: e.message || 'Failed' });
                  } finally { setTesting(false); }
                }}>
                {testing ? 'Testing…' : <><Icons.Refresh size={12} /> Test & Save</>}
              </button>
              <button
                className="btn btn-pri btn-sm"
                disabled={!url.trim() || (!apiKey.trim() && !config?.hasApiKey)}
                onClick={handleSave}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Test / import result */}
        {(testResult || importResult) && (
          <div style={{
            fontSize: '0.72rem', padding: '8px 12px', borderRadius: 7,
            background: (testResult?.ok ?? true) ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${(testResult?.ok ?? true) ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
            color: (testResult?.ok ?? true) ? 'var(--green2)' : 'var(--red)',
          }}>
            {testResult && (testResult.ok ? `✓ ${testResult.message}` : `✗ ${testResult.message}`)}
            {importResult && (
              <>
                ✓ Import complete — {importResult.created} recipe{importResult.created !== 1 ? 's' : ''} created,{' '}
                {importResult.updated} updated
                {importResult.skipped > 0 && `, ${importResult.skipped} skipped`}
                {importResult.errors?.length > 0 && (
                  <div style={{ marginTop: 4, opacity: 0.8 }}>
                    {importResult.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Custom Fields section ─────────────────────────────────────────────────────

const ENTITY_SECTIONS = {
  food:       [{ value: 'nutrition', label: 'Nutrition' }, { value: 'general', label: 'General' }],
  medication: [{ value: 'general', label: 'General' }, { value: 'details', label: 'Details' }],
};

const FIELD_TYPES = [
  { value: 'number',   label: 'Number' },
  { value: 'text',     label: 'Text' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'boolean',  label: 'Yes/No' },
];

const ENTITY_COLORS = {
  food: 'var(--orange)',
  medication: 'var(--green2)',
};

const TYPE_BADGE = {
  number: '#60a5fa', text: 'var(--muted)', dropdown: '#a78bfa', boolean: '#10b981',
};

function CustomFieldsSection({ accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [entity, setEntity] = useState('food');
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ section: 'nutrition', name: '', fieldType: 'number', unit: '', options: '' });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editOptions, setEditOptions] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/custom-fields', accessToken)
      .then(setFields)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => { if (accessToken) load(); }, [load, accessToken]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.post('/custom-fields', {
        entity,
        section: form.section,
        name: form.name.trim(),
        fieldType: form.fieldType,
        unit: form.unit.trim() || null,
        options: form.fieldType === 'dropdown'
          ? form.options.split(',').map(s => s.trim()).filter(Boolean)
          : [],
      }, accessToken);
      setForm({ section: form.section, name: '', fieldType: 'number', unit: '', options: '' });
      setShowAdd(false);
      load();
    } catch {
      notify('Failed to save field.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete custom field?',
      message: 'Values stored on existing records will remain but will not be editable.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/custom-fields/${id}`, accessToken);
      load();
    } catch {
      notify('Failed to delete field.', 'error');
    }
  };

  const handleSaveOptions = async (id) => {
    const options = editOptions.split(',').map(s => s.trim()).filter(Boolean);
    await api.put(`/custom-fields/${id}`, { options }, accessToken);
    setEditingId(null);
    load();
  };

  const entityFields = fields.filter(f => f.entity === entity);
  const sections = ENTITY_SECTIONS[entity];

  // Group by section
  const bySection = sections.reduce((acc, s) => {
    acc[s.value] = entityFields.filter(f => f.section === s.value);
    return acc;
  }, {});

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.Settings size={13} /> Custom Fields</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['food', 'medication'].map(e => (
            <button key={e} className={`btn btn-sm ${entity === e ? 'btn-pri' : 'btn-sec'}`}
              style={entity === e ? { background: ENTITY_COLORS[e], borderColor: ENTITY_COLORS[e] } : {}}
              onClick={() => { setEntity(e); setShowAdd(false); setForm(f => ({ ...f, section: ENTITY_SECTIONS[e][0].value })); }}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          Add custom fields that appear when creating or editing {entity === 'food' ? 'food items' : 'medications'}.
          Choose which section the field appears in.
        </div>

        {/* Existing fields grouped by section */}
        {loading ? (
          <div className="text-xs text-muted">Loading…</div>
        ) : (
          sections.map(sec => (
            <div key={sec.value}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 6 }}>
                {sec.label}
              </div>
              {bySection[sec.value].length === 0 ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic', padding: '2px 0' }}>No custom fields</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {bySection[sec.value].map(f => (
                    <div key={f.id} style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.78rem' }}>{f.name}</span>
                          {f.unit && <span className="mono text-xs text-muted">({f.unit})</span>}
                          <span style={{ fontSize: '0.65rem', fontWeight: 600, color: TYPE_BADGE[f.fieldType], background: `${TYPE_BADGE[f.fieldType]}18`, padding: '1px 6px', borderRadius: 4 }}>
                            {FIELD_TYPES.find(t => t.value === f.fieldType)?.label || f.fieldType}
                          </span>
                          {f.required && <span className="badge badge-red" style={{ fontSize: '0.6rem' }}>required</span>}
                        </div>
                        <button className="btn btn-ghost btn-xs btn-danger" onClick={() => handleDelete(f.id)}>
                          <Icons.Trash size={11} />
                        </button>
                      </div>

                      {/* Dropdown options editor */}
                      {f.fieldType === 'dropdown' && (
                        <div style={{ marginTop: 8 }}>
                          {editingId === f.id ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input className="input" style={{ flex: 1, fontSize: '0.72rem' }}
                                placeholder="Comma-separated options"
                                value={editOptions}
                                onChange={e => setEditOptions(e.target.value)} />
                              <button className="btn btn-pri btn-xs" onClick={() => handleSaveOptions(f.id)}>Save</button>
                              <button className="btn btn-sec btn-xs" onClick={() => setEditingId(null)}>Cancel</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {(f.options || []).length === 0 ? (
                                <span className="text-xs text-muted" style={{ fontStyle: 'italic' }}>No options yet</span>
                              ) : (
                                (f.options || []).map(o => (
                                  <span key={o} style={{ fontSize: '0.68rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px' }}>{o}</span>
                                ))
                              )}
                              <button className="btn btn-ghost btn-xs" style={{ marginLeft: 4 }}
                                onClick={() => { setEditingId(f.id); setEditOptions((f.options || []).join(', ')); }}>
                                <Icons.Edit size={10} /> Edit options
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {/* Add field form */}
        {showAdd ? (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: '0.76rem' }}>New Field for {entity.charAt(0).toUpperCase() + entity.slice(1)}</div>
            <div className="grid-2">
              <div className="input-group">
                <label className="input-label">Section</label>
                <select className="input" value={form.section} onChange={e => setF('section', e.target.value)}>
                  {sections.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Field Type</label>
                <select className="input" value={form.fieldType} onChange={e => setF('fieldType', e.target.value)}>
                  {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="input-group">
                <label className="input-label">Field Name *</label>
                <input className="input" placeholder="e.g. Potassium, Color" value={form.name}
                  onChange={e => setF('name', e.target.value)} autoFocus />
              </div>
              {form.fieldType === 'number' && (
                <div className="input-group">
                  <label className="input-label">Unit (optional)</label>
                  <input className="input" placeholder="e.g. mg, IU" value={form.unit}
                    onChange={e => setF('unit', e.target.value)} />
                </div>
              )}
            </div>
            {form.fieldType === 'dropdown' && (
              <div className="input-group">
                <label className="input-label">Options (comma-separated)</label>
                <input className="input" placeholder="e.g. Red, White, Yellow, Pink"
                  value={form.options} onChange={e => setF('options', e.target.value)} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sec btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-pri btn-sm" onClick={handleAdd} disabled={!form.name.trim() || saving}>
                {saving ? 'Saving…' : 'Add Field'}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-sec btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAdd(true)}>
            <Icons.Plus size={12} /> Add Field
          </button>
        )}
      </div>
    </div>
  );
}

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Halifax', 'America/Toronto', 'America/Vancouver',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Sao_Paulo',
  'America/Santiago', 'America/Buenos_Aires',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna',
  'Europe/Zurich', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Helsinki',
  'Europe/Warsaw', 'Europe/Prague', 'Europe/Budapest', 'Europe/Bucharest', 'Europe/Athens',
  'Europe/Istanbul', 'Europe/Kyiv', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Colombo',
  'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Kuala_Lumpur',
  'Asia/Manila', 'Asia/Taipei', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Hong_Kong',
  'Asia/Riyadh', 'Asia/Tehran', 'Asia/Jerusalem', 'Asia/Tashkent', 'Asia/Almaty',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide',
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu',
];

const CUSTOM_VAR_LABELS = [
  { v: '--bg',      label: 'Background' },
  { v: '--surface', label: 'Surface' },
  { v: '--card',    label: 'Card' },
  { v: '--card2',   label: 'Card Raised' },
  { v: '--border',  label: 'Border' },
  { v: '--border2', label: 'Border Strong' },
  { v: '--text',    label: 'Text' },
  { v: '--muted',   label: 'Muted Text' },
  { v: '--muted2',  label: 'Muted 2' },
  { v: '--accent',  label: 'Accent' },
  { v: '--accent2', label: 'Accent Light' },
];

const PROVIDER_DEFAULTS = {
  openai:     { label: 'OpenAI',      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'], baseUrl: 'https://api.openai.com/v1' },
  anthropic:  { label: 'Anthropic',   models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7'], baseUrl: 'https://api.anthropic.com' },
  gemini:     { label: 'Google Gemini', models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-pro'], baseUrl: 'https://generativelanguage.googleapis.com' },
  openrouter: { label: 'OpenRouter',  models: ['google/gemini-flash-1.5', 'openai/gpt-4o-mini', 'anthropic/claude-haiku'], baseUrl: 'https://openrouter.ai/api/v1' },
  ollama:     { label: 'Ollama (local)', models: ['llama3.2', 'qwen2.5', 'mistral', 'gemma2'], baseUrl: 'http://localhost:11434/v1' },
};

const PROVIDER_COLORS = {
  openai: '#10a37f', anthropic: '#d97706', gemini: '#4285f4', openrouter: '#7c3aed', ollama: '#6b7280',
};

// ── Add provider form ─────────────────────────────────────────────────────────

function AddProviderForm({ onSaved, onCancel, accessToken }) {
  const [form, setForm] = useState({
    provider: 'gemini',
    displayName: 'My Gemini',
    defaultModel: 'gemini-2.0-flash',
    baseUrl: PROVIDER_DEFAULTS.gemini.baseUrl,
    apiKey: '',
    enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onProviderChange = (p) => {
    const def = PROVIDER_DEFAULTS[p];
    setForm(f => ({
      ...f,
      provider: p,
      displayName: `My ${def.label}`,
      defaultModel: def.models[0],
      baseUrl: def.baseUrl,
    }));
  };

  const handleSave = async () => {
    if (!form.apiKey.trim()) { setError('API key is required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/ai/providers', form, accessToken);
      onSaved();
    } catch (e) {
      setError(e.detail?.detail || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const def = PROVIDER_DEFAULTS[form.provider];

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icons.Sparkle size={13} style={{ color: 'var(--purple)' }} /> Add AI Provider
      </div>

      <div className="grid-2">
        <div className="input-group">
          <label className="input-label">Provider</label>
          <select className="input" value={form.provider} onChange={e => onProviderChange(e.target.value)}>
            {Object.entries(PROVIDER_DEFAULTS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Display Name</label>
          <input className="input" value={form.displayName} onChange={e => set('displayName', e.target.value)} placeholder="My Provider" />
        </div>
      </div>

      <div className="grid-2">
        <div className="input-group">
          <label className="input-label">Model</label>
          <select className="input" value={form.defaultModel} onChange={e => set('defaultModel', e.target.value)}>
            {def.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Base URL</label>
          <input className="input mono" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} />
        </div>
      </div>

      <div className="input-group">
        <label className="input-label">API Key</label>
        <input
          type="password"
          className="input mono"
          placeholder={form.provider === 'gemini' ? 'AIza…' : form.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
          value={form.apiKey}
          onChange={e => set('apiKey', e.target.value)}
        />
        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 4 }}>
          Stored encrypted on your server. Never sent to third parties by this app.
        </div>
      </div>

      {error && <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-sec btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-pri btn-sm" onClick={handleSave} disabled={saving || !form.apiKey.trim()}>
          {saving ? 'Saving…' : 'Save Provider'}
        </button>
      </div>
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, isDefault, onSetDefault, onDelete, onRefresh, accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post(`/ai/providers/${provider.id}/test`, {}, accessToken);
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Remove AI provider?',
      message: `Remove provider "${provider.displayName}"?`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete(`/ai/providers/${provider.id}`, accessToken);
      onRefresh();
    } catch {
      notify('Failed to delete provider.', 'error');
    }
  };

  const color = PROVIDER_COLORS[provider.provider] || '#6b7280';
  const label = PROVIDER_DEFAULTS[provider.provider]?.label || provider.provider;

  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 9, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{provider.displayName}</span>
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>{label}</span>
          {isDefault && <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>Default</span>}
          {!provider.enabled && <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>Disabled</span>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-xs" onClick={handleTest} disabled={testing} title="Test connection">
            {testing ? '…' : <Icons.Refresh size={11} />}
          </button>
          {!isDefault && (
            <button className="btn btn-ghost btn-xs" onClick={() => onSetDefault(provider.id)} title="Set as default">
              <Icons.Check size={11} />
            </button>
          )}
          <button className="btn btn-ghost btn-xs btn-danger" onClick={handleDelete} title="Remove provider">
            <Icons.Trash size={11} />
          </button>
        </div>
      </div>

      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'flex', gap: 12 }}>
        <span className="mono">{provider.defaultModel}</span>
        <span style={{ opacity: 0.6 }}>{provider.baseUrl?.replace('https://', '')}</span>
      </div>

      {testResult && (
        <div style={{
          fontSize: '0.7rem',
          padding: '5px 8px',
          borderRadius: 5,
          background: testResult.success ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          color: testResult.success ? 'var(--green2)' : 'var(--red)',
          border: `1px solid ${testResult.success ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
        }}>
          {testResult.success
            ? `✓ Connected — ${testResult.response}`
            : `✗ ${testResult.error}`}
        </div>
      )}
    </div>
  );
}

// ── AI Providers section ──────────────────────────────────────────────────────

function AIProvidersSection({ accessToken }) {
  const notify = useNotify();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [defaultId, setDefaultId] = useState(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const [provList, user] = await Promise.all([
        api.get('/ai/providers', accessToken),
        api.get('/me', accessToken),
      ]);
      setProviders(provList);
      setDefaultId(user?.preferences?.defaultAiProviderId || null);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { if (accessToken) fetchProviders(); }, [fetchProviders, accessToken]);

  const setDefault = async (id) => {
    try {
      await api.put('/me', { preferences: { defaultAiProviderId: id } }, accessToken);
      setDefaultId(id);
    } catch {
      notify('Failed to set default provider.', 'error');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title purple"><Icons.Sparkle size={13} /> AI Providers</div>
        <button className="btn btn-pri btn-xs" onClick={() => setShowAdd(s => !s)}>
          {showAdd ? 'Cancel' : <><Icons.Plus size={11} /> Add</>}
        </button>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          Bring your own API keys. Keys are encrypted at rest and never logged. Used for medication interaction checks, food analysis, and health reports.
        </div>

        {showAdd && (
          <AddProviderForm
            accessToken={accessToken}
            onSaved={() => { setShowAdd(false); fetchProviders(); }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {loading ? (
          <div className="text-muted text-xs" style={{ padding: '8px 0' }}>Loading…</div>
        ) : providers.length === 0 && !showAdd ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)', fontSize: '0.75rem' }}>
            <Icons.Sparkle size={22} style={{ opacity: 0.3, marginBottom: 6, display: 'block', margin: '0 auto 6px' }} />
            No AI providers configured
          </div>
        ) : (
          providers.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              isDefault={p.id === defaultId}
              onSetDefault={setDefault}
              onDelete={() => {}}
              onRefresh={fetchProviders}
              accessToken={accessToken}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── API Tokens section ────────────────────────────────────────────────────────

function APITokensSection({ accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [newCopied, setNewCopied] = useState(false);

  const load = useCallback(() => {
    api.get('/tokens', accessToken).then(setTokens).catch(() => {});
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await api.post('/tokens', { name }, accessToken);
      setNewToken(result.token);
      setName('');
      load();
    } catch {
      notify('Failed to create token.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id) => {
    const ok = await confirm({
      title: 'Revoke token?',
      message: 'Any clients using this token will lose access.',
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    try {
      await api.delete(`/tokens/${id}`, accessToken);
      load();
    } catch {
      notify('Failed to revoke token.', 'error');
    }
  };

  const handleCopyNew = () => {
    navigator.clipboard.writeText(newToken);
    setNewCopied(true);
    setTimeout(() => setNewCopied(false), 2000);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.Key size={13} /> API Tokens</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.73rem', color: 'var(--muted2)', lineHeight: 1.5 }}>
          API tokens let external tools (like the MCP server or Sparky) access your data without browser login.
        </div>

        {newToken && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--green2)', marginBottom: 6, fontWeight: 600 }}>Token created:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1, fontSize: '0.68rem', wordBreak: 'break-all', color: 'var(--fg)', background: 'var(--card)', borderRadius: 5, padding: '4px 8px', border: '1px solid var(--border)' }}>{newToken}</code>
              <button className="btn btn-sm btn-sec" onClick={handleCopyNew}>{newCopied ? '✓ Copied' : 'Copy'}</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="Token name (e.g. Sparky, MCP Server)" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          <button className="btn btn-pri btn-sm" onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>

        {tokens.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tokens.map(t => (
              <div key={t.id} style={{ background: 'var(--bg-2)', borderRadius: 7, border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--fg)' }}>{t.name}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--muted2)', marginTop: 1 }}>
                      {(t.prefix || 'ht_...')} · {t.lastUsedAt ? `Last used ${t.lastUsedAt.slice(0, 10)}` : 'Never used'} · Created {t.createdAt?.slice(0, 10)}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)', padding: '3px 8px', fontSize: '0.68rem' }} onClick={() => handleRevoke(t.id)}>Revoke</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tokens.length === 0 && !newToken && (
          <div style={{ fontSize: '0.72rem', color: 'var(--muted2)', textAlign: 'center', padding: '8px 0' }}>No tokens yet.</div>
        )}
      </div>
    </div>
  );
}

// ── Database section ──────────────────────────────────────────────────────────

function DatabaseSection({ accessToken }) {
  const confirm = useConfirm();
  const [info, setInfo] = useState(null);
  const [url, setUrl] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/db-config', accessToken).then(setInfo).catch(() => {});
  }, [accessToken]);

  useEffect(() => { if (accessToken) load(); }, [load, accessToken]);

  const handleTest = async () => {
    if (!url.trim()) return;
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const r = await api.post('/db-config/test', { url: url.trim() }, accessToken);
      setTestResult(r);
    } catch (e) {
      setError(e.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!url.trim()) return;
    setSaving(true);
    setTestResult(null);
    setError('');
    try {
      const r = await api.put('/db-config', { url: url.trim() }, accessToken);
      setTestResult({ ok: true, version: r.version });
      setUrl('');
      load();
    } catch (e) {
      setError(e.detail || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Reset database connection?',
      message: 'Remove the saved connection and revert to the environment variable?',
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    setResetting(true);
    setError('');
    try {
      await api.delete('/db-config', accessToken);
      setUrl('');
      setTestResult(null);
      load();
    } catch (e) {
      setError(e.message || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.Database size={13} /> Database</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Current connection */}
        {info && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green2)', flexShrink: 0, display: 'inline-block' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: 2 }}>
                {info.source === 'config' ? 'Custom connection (saved)' : 'Default connection (environment variable)'}
              </div>
              <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--fg)', wordBreak: 'break-all' }}>
                {info.maskedUrl}
              </div>
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 -2px' }} />

        {/* New URL input */}
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.76rem', marginBottom: 6 }}>
            {info?.hasOverride ? 'Update connection' : 'Set external connection'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Enter a MongoDB connection string. Atlas, Cosmos DB, DocumentDB, or any MongoDB-compatible URI.
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                className="input mono"
                type={showUrl ? 'text' : 'password'}
                placeholder="mongodb+srv://user:pass@cluster.mongodb.net/"
                value={url}
                onChange={e => { setUrl(e.target.value); setTestResult(null); setError(''); }}
                style={{ paddingRight: 36, fontSize: '0.72rem' }}
              />
              <button
                onClick={() => setShowUrl(s => !s)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}
                tabIndex={-1}
              >
                {showUrl ? <Icons.X size={13} /> : <Icons.Info size={13} />}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sec btn-sm" onClick={handleTest} disabled={!url.trim() || testing || saving}>
              <Icons.Refresh size={12} /> {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button className="btn btn-pri btn-sm" onClick={handleSave} disabled={!url.trim() || saving || testing}>
              <Icons.Database size={12} /> {saving ? 'Connecting…' : 'Save & Connect'}
            </button>
            {info?.hasOverride && (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--muted)', marginLeft: 'auto' }}
                onClick={handleReset} disabled={resetting}>
                {resetting ? 'Resetting…' : 'Reset to env var'}
              </button>
            )}
          </div>
        </div>

        {testResult && (
          <div style={{
            fontSize: '0.72rem', padding: '8px 12px', borderRadius: 7,
            background: testResult.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${testResult.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
            color: testResult.ok ? 'var(--green2)' : 'var(--red)',
          }}>
            {testResult.ok
              ? `✓ Connected${testResult.version ? ` — MongoDB ${testResult.version}` : ''}`
              : `✗ ${testResult.error}`}
          </div>
        )}

        {error && (
          <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '7px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7 }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          The connection string is saved to a persistent volume on the server — not exposed to other users.
          Changes take effect immediately without a restart.
        </div>
      </div>
    </div>
  );
}

// ── Refresh from database section ────────────────────────────────────────────

function RefreshSection({ accessToken }) {
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus]         = useState(null); // null | 'done' | 'reloading'
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState('');

  const handleRefresh = async () => {
    setRefreshing(true);
    setResult(null);
    setError('');
    setStatus(null);
    try {
      const r = await api.post('/data/refresh', {}, accessToken);
      setResult(r);
      setStatus('done');

      // Clear any service-worker / Cache-API entries
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }

      // Brief pause so the user sees the success message, then hard-reload
      // to flush React state and force fresh API fetches for every page.
      setStatus('reloading');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError(e.message || 'Refresh failed');
      setRefreshing(false);
    }
    // Don't clear refreshing on success — the page is about to reload anyway
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.Refresh size={13} /> Refresh from Database</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          Force-updates all global health metric types, foods, and exercises to the latest
          built-in definitions, flushes the auth-key cache, clears browser caches, and
          reloads the page so every view shows current data.
        </div>

        <button className="btn btn-sec btn-sm" style={{ alignSelf: 'flex-start' }}
          onClick={handleRefresh} disabled={refreshing}>
          <Icons.Refresh size={13} />{' '}
          {status === 'reloading' ? 'Reloading page…' : refreshing ? 'Refreshing…' : 'Refresh Now'}
        </button>

        {result && (status === 'done' || status === 'reloading') && (
          <div style={{ fontSize: '0.72rem', padding: '8px 12px', borderRadius: 7, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--green2)' }}>
            ✓ Updated — {result.metricTypes} metric types · {result.foods} foods · {result.exercises} exercises · reloading…
          </div>
        )}
        {error && (
          <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Data export / import section ─────────────────────────────────────────────

function DataSection({ accessToken }) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // Clear by type state
  const [metricTypes, setMetricTypes] = useState([]);
  const [selectedMetricKey, setSelectedMetricKey] = useState('');
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/stats/metric-types', accessToken)
      .then(types => setMetricTypes(types.sort((a, b) => a.displayName.localeCompare(b.displayName))))
      .catch(() => {});
  }, [accessToken]);

  const handleClearByType = async () => {
    if (!selectedMetricKey) return;
    const type = metricTypes.find(t => t.key === selectedMetricKey);
    const ok = await confirm({
      title: `Clear all ${type?.displayName ?? selectedMetricKey} data?`,
      message: 'This will permanently delete all readings of this type. This cannot be undone.',
      confirmLabel: 'Delete All',
    });
    if (!ok) return;
    setClearing(true);
    try {
      const result = await api.delete(`/stats/readings/by-type/${selectedMetricKey}`, accessToken);
      notify(`Deleted ${result.deleted} reading${result.deleted !== 1 ? 's' : ''} of type "${type?.displayName ?? selectedMetricKey}".`, 'success');
      setSelectedMetricKey('');
    } catch (e) {
      notify(e.message || 'Failed to clear data.', 'error');
    } finally {
      setClearing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/data/export', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : 'health_export.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify('Export failed. Please try again.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/data/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Import failed');
      setImportResult(data.imported);
    } catch (e) {
      setImportError(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImportFile(file);
  };

  const totalImported = importResult ? Object.values(importResult).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.FileText size={13} /> Data</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Export */}
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.76rem', marginBottom: 4 }}>Export</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Download all your data as a ZIP archive containing CSV files for food logs, medications, health readings, and workouts.
          </div>
          <button className="btn btn-sec btn-sm" onClick={handleExport} disabled={exporting}>
            <Icons.Download size={13} /> {exporting ? 'Preparing…' : 'Export All Data'}
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 -2px' }} />

        {/* Clear by type */}
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.76rem', marginBottom: 4 }}>Clear Health Data by Type</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Permanently delete all readings for a specific metric type. Useful when re-importing with corrected data.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ flex: 1, minWidth: 180, fontSize: '0.76rem', padding: '6px 10px' }}
              value={selectedMetricKey}
              onChange={e => setSelectedMetricKey(e.target.value)}
            >
              <option value="">Select a metric type…</option>
              {metricTypes.map(t => (
                <option key={t.id} value={t.key}>{t.displayName} ({t.unit})</option>
              ))}
            </select>
            <button
              className="btn btn-sm"
              style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)', flexShrink: 0 }}
              disabled={!selectedMetricKey || clearing}
              onClick={handleClearByType}
            >
              <Icons.Trash size={13} /> {clearing ? 'Clearing…' : 'Clear All'}
            </button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 -2px' }} />

        {/* Import */}
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.76rem', marginBottom: 4 }}>Import</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Import a ZIP export or individual CSV files. Supported: <span className="mono" style={{ fontSize: '0.68rem' }}>food_logs.csv</span>, <span className="mono" style={{ fontSize: '0.68rem' }}>food_items.csv</span>, <span className="mono" style={{ fontSize: '0.68rem' }}>medications.csv</span>, <span className="mono" style={{ fontSize: '0.68rem' }}>health_readings.csv</span>.
          </div>

          <div
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border2)'}`,
              borderRadius: 10,
              padding: '24px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
              background: dragOver ? 'rgba(20,184,166,0.05)' : 'transparent',
            }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <input ref={fileRef} type="file" accept=".zip,.csv" style={{ display: 'none' }} onChange={onFileChange} />
            {importing ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Importing…</div>
            ) : (
              <>
                <Icons.Upload size={22} style={{ opacity: 0.35, display: 'block', margin: '0 auto 8px' }} />
                <div style={{ fontSize: '0.76rem', color: 'var(--fg)', marginBottom: 3 }}>Drop a file here or click to browse</div>
                <div style={{ fontSize: '0.67rem', color: 'var(--muted)' }}>.zip or .csv</div>
              </>
            )}
          </div>

          {importResult && (
            <div style={{ marginTop: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--green2)', marginBottom: 6 }}>
                Import complete — {totalImported} row{totalImported !== 1 ? 's' : ''} added
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {Object.entries(importResult).map(([file, count]) => (
                  <div key={file} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--muted)' }}>
                    <span className="mono">{file}</span>
                    <span>{count} row{count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importError && (
            <div style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--red)', padding: '7px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7 }}>
              {importError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sync Sources section ──────────────────────────────────────────────────────
// Controls which pipeline is authoritative when Sparky and the Health Sync →
// Google Drive CSVs both deliver the same metric.

const SPARKY_METRIC_GROUPS = [
  { label: 'Steps', keys: ['steps'] },
  { label: 'Heart rate', keys: ['heart_rate_avg'] },
  { label: 'Sleep', keys: ['sleep_duration', 'sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_awake'] },
  { label: 'Weight', keys: ['weight'] },
  { label: 'Blood pressure', keys: ['bp_systolic', 'bp_diastolic'] },
  { label: 'Blood glucose', keys: ['blood_glucose'] },
  { label: 'SpO₂', keys: ['spo2'] },
  { label: 'Body temperature', keys: ['body_temp'] },
  { label: 'Calories burned', keys: ['calories_burned'] },
  { label: 'Body fat', keys: ['body_fat'] },
];

const GDRIVE_VARIANTS = [
  { value: 'samsung_health', label: 'Samsung Health files only' },
  { value: 'health_connect', label: 'Health Connect files only' },
  { value: 'both', label: 'Both (values may conflict)' },
];

function SyncSourcesSection({ accessToken }) {
  const notify = useNotify();
  const [prefs, setPrefs] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/sync-preferences', accessToken).then(setPrefs).catch(() => {});
  }, [accessToken]);

  const save = (next) => {
    setPrefs(next);
    api.put('/sync-preferences', next, accessToken)
      .catch(() => notify('Failed to save sync sources.', 'error'));
  };

  const groupEnabled = (g) => !g.keys.some(k => (prefs?.sparkyIgnoredMetrics ?? []).includes(k));

  const toggleGroup = (g) => {
    const cur = new Set(prefs?.sparkyIgnoredMetrics ?? []);
    if (groupEnabled(g)) g.keys.forEach(k => cur.add(k));
    else g.keys.forEach(k => cur.delete(k));
    save({ ...prefs, sparkyIgnoredMetrics: [...cur] });
  };

  if (!prefs) return null;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.Refresh size={13} /> Sync Sources</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          When Sparky and the Google Drive CSVs both deliver the same metric, they overwrite
          each other. Choose which source is allowed to write each metric.
        </div>

        <div>
          <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>
            Sparky may sync
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {SPARKY_METRIC_GROUPS.map(g => (
              <Toggle
                key={g.label}
                checked={groupEnabled(g)}
                onChange={() => toggleGroup(g)}
                label={g.label}
                sub={groupEnabled(g) ? null : 'Ignored — another source owns this'}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap' }}>
            Google Drive: when Health Sync exports both file variants, import
          </label>
          <select
            className="input"
            style={{ width: 'auto', fontSize: '0.73rem', padding: '4px 8px' }}
            value={prefs.gdriveFileVariant ?? 'both'}
            onChange={e => save({ ...prefs, gdriveFileVariant: e.target.value })}
          >
            {GDRIVE_VARIANTS.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          Tip: Health Connect step counts often run high when both a watch and phone record
          steps. If your numbers look inflated, use Samsung Health files and turn off Steps
          for Sparky.
        </div>
      </div>
    </div>
  );
}


// ── Google Drive Sync section ─────────────────────────────────────────────────

function GoogleDriveSyncSection({ accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [status, setStatus] = useState(null);
  const [folders, setFolders] = useState(null);
  const [config, setConfig] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  // Credential entry form state
  const [editingCreds, setEditingCreds] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const loadStatus = useCallback(() => {
    api.get('/gdrive/status', accessToken).then(setStatus).catch(() => {});
  }, [accessToken]);

  const loadConfig = useCallback(() => {
    api.get('/gdrive/config', accessToken).then(setConfig).catch(() => {});
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    loadStatus();
    loadConfig();
    // Check if returning from OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('gdrive') === 'connected') {
      window.history.replaceState({}, '', window.location.pathname);
      notify('Google Drive connected successfully.', 'success');
      loadStatus();
      loadConfig();
    } else if (params.get('gdrive') === 'error') {
      window.history.replaceState({}, '', window.location.pathname);
      notify(`Google Drive connection failed: ${params.get('reason') || 'unknown error'}`, 'error');
    }
  }, [accessToken, loadStatus, loadConfig, notify]);

  const handleSaveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError('Both Client ID and Client Secret are required.');
      return;
    }
    setSavingCreds(true);
    setError('');
    try {
      await api.put('/gdrive/credentials', { clientId: clientId.trim(), clientSecret: clientSecret.trim() }, accessToken);
      setClientId('');
      setClientSecret('');
      setEditingCreds(false);
      notify('Credentials saved.', 'success');
      loadStatus();
    } catch (e) {
      setError(e.message || 'Failed to save credentials');
    } finally {
      setSavingCreds(false);
    }
  };

  const handleRemoveCredentials = async () => {
    const ok = await confirm({
      title: 'Remove Google Drive credentials?',
      message: 'This will delete your OAuth client credentials and disconnect your account. Your imported health data will not be deleted.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete('/gdrive/credentials', accessToken);
      setStatus(null);
      setConfig(null);
      setFolders(null);
      setEditingCreds(false);
      notify('Credentials removed.', 'success');
      loadStatus();
    } catch {
      notify('Failed to remove credentials.', 'error');
    }
  };

  const handleConnect = async () => {
    setError('');
    try {
      const { url } = await api.get('/gdrive/auth-url', accessToken);
      window.location.href = url;
    } catch (e) {
      setError(e.message || 'Failed to start Google authorization');
    }
  };

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Google Drive?',
      message: 'Sync will stop. Your client credentials will be kept so you can reconnect easily. Your imported health data will not be deleted.',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    try {
      await api.delete('/gdrive/disconnect', accessToken);
      setFolders(null);
      setConfig({ folderMappings: [], syncIntervalHours: 6 });
      notify('Disconnected from Google Drive.', 'success');
      loadStatus();
    } catch {
      notify('Failed to disconnect.', 'error');
    }
  };

  const handleLoadFolders = async () => {
    setLoadingFolders(true);
    setError('');
    try {
      const { folders: f } = await api.get('/gdrive/folders', accessToken);
      setFolders(f);
    } catch (e) {
      setError(e.message || 'Failed to load folders');
    } finally {
      setLoadingFolders(false);
    }
  };

  const toggleFolder = (folder) => {
    if (!config) return;
    const existing = config.folderMappings.find(m => m.folderId === folder.id);
    let updated;
    if (existing) {
      updated = config.folderMappings.map(m =>
        m.folderId === folder.id ? { ...m, enabled: !m.enabled } : m
      );
    } else {
      updated = [...config.folderMappings, { folderId: folder.id, folderName: folder.name, enabled: true }];
    }
    setConfig(c => ({ ...c, folderMappings: updated }));
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setError('');
    try {
      await api.put('/gdrive/config', config, accessToken);
      notify('Sync configuration saved.', 'success');
      loadStatus();
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const result = await api.post('/gdrive/sync', {}, accessToken);
      notify(`Sync complete — ${result.inserted} new, ${result.updated} updated, ${result.files} file${result.files !== 1 ? 's' : ''} processed.`, 'success');
      loadStatus();
    } catch (e) {
      setError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleShowHistory = async () => {
    try {
      const h = await api.get('/gdrive/sync-history', accessToken);
      setHistory(h);
      setShowHistory(true);
    } catch {
      notify('Failed to load sync history.', 'error');
    }
  };

  const isFolderEnabled = (folderId) => {
    if (!config) return false;
    const m = config.folderMappings.find(m => m.folderId === folderId);
    return m ? m.enabled : false;
  };

  const hasCredentials = status?.hasCredentials;
  const isConnected = status?.connected;
  const needsReauth = isConnected && status?.syncStatus === 'reauth_required';
  const showCredForm = !hasCredentials || editingCreds;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><Icons.Cloud size={13} /> Google Drive Sync</div>
        {isConnected && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-xs" onClick={handleShowHistory} title="Sync history">
              <Icons.Clock size={11} />
            </button>
            <button className="btn btn-pri btn-xs" onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing…' : <><Icons.Refresh size={11} /> Sync Now</>}
            </button>
          </div>
        )}
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          Import health data exported by <strong>Health Sync</strong> from Google Drive. Syncs CSV files automatically on your chosen schedule.
        </div>

        {/* ── Step 1: Credentials ── */}
        {showCredForm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--fg)' }}>
              {editingCreds ? 'Update Google OAuth credentials' : 'Set up Google OAuth credentials'}
            </div>
            <div style={{ fontSize: '0.70rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              Create a project at <strong>console.cloud.google.com</strong>, enable the Drive API, and create an OAuth 2.0 Client ID (Web application type).
              Add this as an Authorized Redirect URI:
            </div>
            {status?.redirectUri && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--fg)', background: 'var(--bg3,var(--bg))', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', wordBreak: 'break-all' }}>
                {status.redirectUri}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                className="input"
                style={{ fontSize: '0.73rem' }}
                placeholder="Client ID (e.g. 123456789-abc….apps.googleusercontent.com)"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                autoComplete="off"
              />
              <input
                className="input"
                style={{ fontSize: '0.73rem' }}
                type="password"
                placeholder="Client Secret"
                value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {error && (
              <div style={{ fontSize: '0.70rem', color: 'var(--red)', padding: '5px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: 5 }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-pri btn-sm" onClick={handleSaveCredentials} disabled={savingCreds}>
                {savingCreds ? 'Saving…' : 'Save Credentials'}
              </button>
              {editingCreds && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditingCreds(false); setClientId(''); setClientSecret(''); setError(''); }}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ── Step 2 / 3: Credentials saved ── */
          <>
            {/* Credential info row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: needsReauth ? 'var(--red,#ef4444)' : isConnected ? 'var(--green,#22c55e)' : 'var(--yellow,#f59e0b)', flexShrink: 0, display: 'inline-block' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.73rem', fontWeight: 600, color: needsReauth ? 'var(--red,#ef4444)' : 'var(--fg)' }}>
                  {needsReauth ? 'Reconnect required' : isConnected ? 'Connected' : 'Credentials saved'}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
                  {status?.maskedClientId}
                  {isConnected && status?.lastSyncAt && ` · last sync ${new Date(status.lastSyncAt).toLocaleString()}`}
                  {isConnected && !status?.lastSyncAt && ' · never synced'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-xs" title="Edit credentials" onClick={() => { setEditingCreds(true); setError(''); }}>
                  <Icons.Edit size={11} />
                </button>
                {isConnected ? (
                  <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red,#ef4444)' }} title="Disconnect" onClick={handleDisconnect}>
                    <Icons.X size={11} />
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red,#ef4444)' }} title="Remove credentials" onClick={handleRemoveCredentials}>
                    <Icons.Trash size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Google revoked/expired the grant → sync is paused until reconnect */}
            {needsReauth && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid var(--red,#ef4444)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--red,#ef4444)' }}>
                  Google Drive sync is paused — authorization expired
                </div>
                <div style={{ fontSize: '0.70rem', color: 'var(--fg)', lineHeight: 1.5 }}>
                  Google rejected the saved authorization
                  {status?.lastErrorAt && ` (since ${new Date(status.lastErrorAt).toLocaleString()})`}.
                  This usually happens when the OAuth consent screen is in “Testing” mode, where tokens expire
                  after 7 days. Publish the app to <strong>Production</strong> in Google Cloud Console
                  (APIs &amp; Services → OAuth consent screen), then reconnect.
                </div>
                <button className="btn btn-pri btn-sm" style={{ alignSelf: 'flex-start' }} onClick={handleConnect}>
                  <Icons.Link size={13} /> Reconnect Google Drive
                </button>
              </div>
            )}

            {/* Not connected → connect button */}
            {!isConnected && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-sec btn-sm" style={{ alignSelf: 'flex-start' }} onClick={handleConnect}>
                  <Icons.Link size={13} /> Connect Google Drive
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  style={{ alignSelf: 'flex-start', color: 'var(--red,#ef4444)', fontSize: '0.68rem' }}
                  onClick={handleRemoveCredentials}
                >
                  Remove credentials
                </button>
              </div>
            )}

            {/* Connected → full sync config */}
            {isConnected && (
              <>
                {/* Sync schedule */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label style={{ fontSize: '0.73rem', color: 'var(--fg)', whiteSpace: 'nowrap' }}>Sync every</label>
                  <select
                    className="input"
                    style={{ width: 'auto', fontSize: '0.73rem', padding: '4px 8px' }}
                    value={config?.syncIntervalHours ?? 6}
                    onChange={e => setConfig(c => ({ ...c, syncIntervalHours: parseInt(e.target.value) }))}
                  >
                    {[1, 2, 4, 6, 12, 24].map(h => (
                      <option key={h} value={h}>{h === 1 ? '1 hour' : `${h} hours`}</option>
                    ))}
                  </select>
                  {status?.nextSyncAt && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
                      next {new Date(status.nextSyncAt).toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Folder selection */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--fg)' }}>Folders to sync</div>
                    <button className="btn btn-ghost btn-xs" onClick={handleLoadFolders} disabled={loadingFolders}>
                      {loadingFolders ? '…' : <><Icons.Folder size={11} /> Browse</>}
                    </button>
                  </div>

                  {/* Currently enabled folders */}
                  {config?.folderMappings?.filter(m => m.enabled).length > 0 && !folders && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {config.folderMappings.filter(m => m.enabled).map(m => (
                        <div key={m.folderId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg2)', borderRadius: 6, fontSize: '0.72rem' }}>
                          <Icons.Folder size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                          <span style={{ flex: 1, color: 'var(--fg)' }}>{m.folderName}</span>
                          <button className="btn btn-ghost btn-xs" style={{ padding: '1px 4px' }} onClick={() => toggleFolder({ id: m.folderId, name: m.folderName })}>
                            <Icons.X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drive folder browser */}
                  {folders && (
                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg2)' }}>
                      {folders.length === 0 && (
                        <div style={{ padding: '16px', fontSize: '0.72rem', color: 'var(--muted)', textAlign: 'center' }}>No folders found in your Drive</div>
                      )}
                      {folders.map(f => {
                        const enabled = isFolderEnabled(f.id);
                        return (
                          <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: enabled ? 'rgba(20,184,166,0.06)' : 'transparent' }}>
                            <input type="checkbox" checked={enabled} onChange={() => toggleFolder(f)} style={{ accentColor: 'var(--accent)' }} />
                            <Icons.Folder size={12} style={{ color: f.isHealthSync ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: '0.73rem', color: 'var(--fg)' }}>{f.name}</span>
                            {f.isHealthSync && (
                              <span style={{ fontSize: '0.62rem', color: 'var(--accent)', background: 'rgba(20,184,166,0.12)', padding: '1px 6px', borderRadius: 4 }}>Health Sync</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {!folders && config?.folderMappings?.filter(m => m.enabled).length === 0 && (
                    <div style={{ fontSize: '0.71rem', color: 'var(--muted)' }}>Click Browse to pick Drive folders to sync from.</div>
                  )}
                </div>

                {error && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                    {error}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    className="btn btn-ghost btn-xs"
                    style={{ color: 'var(--red,#ef4444)', fontSize: '0.68rem' }}
                    onClick={handleRemoveCredentials}
                  >
                    Remove credentials &amp; disconnect
                  </button>
                  <button className="btn btn-pri btn-sm" onClick={handleSaveConfig} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Configuration'}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* Error shown outside the cred form when already have creds */}
        {!showCredForm && error && (
          <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
            {error}
          </div>
        )}

        {/* Sync history modal */}
        {showHistory && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setShowHistory(false)}>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 460, maxHeight: '70vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Sync History</div>
                <button className="btn btn-ghost btn-xs" onClick={() => setShowHistory(false)}><Icons.X size={13} /></button>
              </div>
              {history.length === 0 ? (
                <div style={{ fontSize: '0.73rem', color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>No syncs yet</div>
              ) : history.map((h, i) => (
                <div key={i} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--fg)' }}>
                    {new Date(h.startedAt).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 3 }}>
                    {h.filesProcessed} file{h.filesProcessed !== 1 ? 's' : ''} · {h.inserted} new · {h.updated} updated · {h.skipped} skipped
                  </div>
                  {h.errors?.length > 0 && (
                    <div style={{ fontSize: '0.67rem', color: 'var(--red)', marginTop: 4 }}>
                      {h.errors.length} error{h.errors.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, sub }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--fg)' }}>{label}</div>
        {sub && <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div
        onClick={onChange}
        style={{
          width: 40, height: 22, borderRadius: 11, flexShrink: 0,
          background: checked ? 'var(--accent)' : 'var(--bg-3,var(--bg2))',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
          position: 'relative', cursor: 'pointer', transition: 'background 0.18s, border-color 0.18s',
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 19 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: checked ? '#fff' : 'var(--muted)',
          transition: 'left 0.18s',
        }} />
      </div>
    </label>
  );
}

export default function Settings() {
  const { accessToken } = useAuth();
  const notify = useNotify();
  const [activeTab, setActiveTab] = useState('app');
  const [prefs, setPrefs] = useState({ timezone: 'America/New_York', units: 'imperial' });
  const [userInfo, setUserInfo] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);
  const [refreshError, setRefreshError] = useState('');
  const [skin, setSkin] = useState(currentSkinId);
  const [customVars, setCustomVars] = useState({ ...CUSTOM_SKIN_DEFAULTS });
  const saveTimer = useRef(null);

  const isAdmin = userInfo?.roles?.includes('admin');

  useEffect(() => {
    if (!accessToken) return;
    setUserLoading(true);
    api.get('/me', accessToken)
      .then(user => {
        if (user?.preferences) {
          setPrefs(p => ({ ...p, ...user.preferences }));
          if (user.preferences.skin === 'custom' && user.preferences.customSkinVars) {
            const merged = { ...CUSTOM_SKIN_DEFAULTS, ...user.preferences.customSkinVars };
            setCustomVars(merged);
            setSkin('custom');
            applyCustomVars(merged);
          } else if (user.preferences.skin) {
            setSkin(user.preferences.skin);
            applySkin(user.preferences.skin);
          }
        }
        if (user) setUserInfo({ id: user.id, roles: user.roles ?? [], name: user.displayName ?? '', email: user.email ?? '' });
      })
      .catch(() => setUserInfo(null))
      .finally(() => setUserLoading(false));
  }, [accessToken]);

  const scheduleSave = (next) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.put('/me', { preferences: next }, accessToken);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch {}
    }, 800);
  };

  const update = (key, val) => {
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    scheduleSave(next);
  };

  const selectSkin = (id) => {
    setSkin(id);
    if (id === 'custom') {
      applyCustomVars(customVars);
    } else {
      applySkin(id);
    }
    const next = { ...prefs, skin: id };
    setPrefs(next);
    scheduleSave(next);
  };

  const updateCustomVar = (cssVar, value) => {
    const next = { ...customVars, [cssVar]: value };
    setCustomVars(next);
    applyCustomVars(next);
    setSkin('custom');
    const nextPrefs = { ...prefs, skin: 'custom', customSkinVars: next };
    setPrefs(nextPrefs);
    scheduleSave(nextPrefs);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshStatus(null);
    setRefreshResult(null);
    setRefreshError('');
    try {
      const result = await api.post('/data/refresh', {}, accessToken);
      setRefreshResult(result);
      setRefreshStatus('done');
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      notify('Refresh complete. Reloading…', 'success');
      setRefreshStatus('reloading');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      const message = e.message || 'Refresh failed.';
      setRefreshError(message);
      notify(message, 'error');
      setRefreshing(false);
    }
  };

  const TABS = [
    { id: 'app', label: 'App' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'data', label: 'Data' },
  ];

  return (
    <>
      <div className="page-header">
        <div className="page-title">Settings</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span className="badge badge-green"><Icons.Check size={10} /> Saved</span>}
          <button className="btn btn-sec btn-sm" onClick={handleRefresh} disabled={refreshing} title="Force-refresh global data and reload">
            <Icons.Refresh size={13} /> {refreshStatus === 'reloading' ? 'Reloading…' : refreshing ? 'Refreshing…' : 'Refresh Data'}
          </button>
        </div>
      </div>

      {refreshResult && (refreshStatus === 'done' || refreshStatus === 'reloading') && (
        <div style={{ maxWidth: 640, marginBottom: 12, fontSize: '0.72rem', padding: '8px 12px', borderRadius: 7, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--green2)' }}>
          Updated — {refreshResult.metricTypes} metric types · {refreshResult.foods} foods · {refreshResult.exercises} exercises · reloading…
        </div>
      )}
      {refreshError && (
        <div style={{ maxWidth: 640, marginBottom: 12, fontSize: '0.72rem', padding: '8px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)' }}>
          {refreshError}
        </div>
      )}

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--card)', borderRadius: 9, padding: 3, border: '1px solid var(--border)', width: 'fit-content' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '5px 18px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.78rem',
              fontWeight: activeTab === t.id ? 600 : 400,
              background: activeTab === t.id ? 'var(--card2,var(--surface))' : 'transparent',
              color: activeTab === t.id ? 'var(--text,var(--fg))' : 'var(--muted)',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── App tab ─────────────────────────────────────────────────────── */}
        {activeTab === 'app' && (
          <>
            {/* User Details */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><Icons.Profile size={13} /> User Details</div>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Name',  value: userInfo?.name },
                  { label: 'Email', value: userInfo?.email },
                  { label: 'ID',    value: userInfo?.id, mono: true },
                ].map(({ label, value, mono }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)', width: 40, flexShrink: 0 }}>{label}</span>
                    {mono ? (
                      <code style={{ fontSize: '0.7rem', color: 'var(--fg)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', flex: 1, wordBreak: 'break-all' }}>
                        {userLoading ? 'Loading…' : value ?? '—'}
                      </code>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--fg)' }}>{userLoading ? 'Loading…' : value || '—'}</span>
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)', width: 40, flexShrink: 0 }}>Roles</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(userInfo?.roles ?? []).map(role => (
                      <span key={role} style={{
                        fontSize: '0.68rem', fontWeight: 600, padding: '2px 9px', borderRadius: 5,
                        background: role === 'admin' ? 'rgba(239,68,68,0.12)' : 'rgba(96,165,250,0.12)',
                        color: role === 'admin' ? 'var(--red)' : 'var(--accent2)',
                        border: `1px solid ${role === 'admin' ? 'rgba(239,68,68,0.25)' : 'rgba(96,165,250,0.25)'}`,
                        textTransform: 'capitalize',
                      }}>
                        {role}
                      </span>
                    ))}
                    {userLoading && <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Loading…</span>}
                    {!userLoading && !userInfo && <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>—</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* General */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><Icons.Settings size={13} /> General</div>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="input-group">
                  <label className="input-label">Timezone</label>
                  <select className="input" value={prefs.timezone} onChange={e => update('timezone', e.target.value)}>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Units</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['metric', 'imperial', 'mixed'].map(u => (
                      <button key={u} onClick={() => update('units', u)}
                        className={`btn btn-sm ${prefs.units === u ? 'btn-pri' : 'btn-sec'}`}
                        style={{ textTransform: 'capitalize' }}
                      >{u}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Nutrition Goals */}
            <div className="card">
              <div className="card-header">
                <div className="card-title green"><Icons.Flame size={13} /> Nutrition Goals</div>
              </div>
              <div className="card-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { key: 'caloriesPerDay', label: 'Calories', unit: 'kcal' },
                    { key: 'proteinGPerDay', label: 'Protein', unit: 'g' },
                    { key: 'carbsGPerDay', label: 'Carbs', unit: 'g' },
                    { key: 'fatGPerDay', label: 'Fat', unit: 'g' },
                  ].map(({ key, label, unit }) => (
                    <div key={key} className="input-group">
                      <label className="input-label">{label} ({unit}/day)</label>
                      <input
                        type="number"
                        className="input mono"
                        min="0"
                        placeholder="–"
                        value={prefs[key] ?? ''}
                        onChange={e => update(key, e.target.value ? parseFloat(e.target.value) : null)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Skin */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><Icons.Settings size={13} /> Skin</div>
              </div>
              <div className="card-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                  {SKINS.map(s => {
                    const active = skin === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => selectSkin(s.id)}
                        style={{
                          background: 'var(--bg-2,var(--card))',
                          border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 10, padding: '10px 8px', cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = 'var(--border2)'; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = 'var(--border)'; }}
                      >
                        <div style={{ display: 'flex', gap: 5 }}>
                          {s.dots.map((c, i) => (
                            <span key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
                          ))}
                        </div>
                        <span style={{ fontSize: '0.68rem', fontWeight: active ? 700 : 400, color: active ? 'var(--accent2)' : 'var(--muted2)', whiteSpace: 'nowrap' }}>
                          {s.name}
                        </span>
                      </button>
                    );
                  })}

                  {/* Custom skin tile */}
                  {(() => {
                    const active = skin === 'custom';
                    return (
                      <button
                        onClick={() => selectSkin('custom')}
                        style={{
                          background: 'var(--bg-2,var(--card))',
                          border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 10, padding: '10px 8px', cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = 'var(--border2)'; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = 'var(--border)'; }}
                      >
                        <div style={{ display: 'flex', gap: 5 }}>
                          {[customVars['--accent'] || '#888', customVars['--card'] || '#222', customVars['--text'] || '#eee'].map((c, i) => (
                            <span key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
                          ))}
                        </div>
                        <span style={{ fontSize: '0.68rem', fontWeight: active ? 700 : 400, color: active ? 'var(--accent2)' : 'var(--muted2)', whiteSpace: 'nowrap' }}>
                          Custom
                        </span>
                      </button>
                    );
                  })()}
                </div>

                {/* Custom color editor */}
                {skin === 'custom' && (
                  <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--surface,var(--bg2))', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.73rem', fontWeight: 600, marginBottom: 12, color: 'var(--text,var(--fg))' }}>Custom Colors</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {CUSTOM_VAR_LABELS.map(({ v, label }) => (
                        <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input
                            type="color"
                            value={customVars[v] || '#000000'}
                            onChange={e => updateCustomVar(v, e.target.value)}
                            style={{ width: 34, height: 30, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 5, padding: '2px', background: 'none', flexShrink: 0 }}
                          />
                          <div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text,var(--fg))', lineHeight: 1.2 }}>{label}</div>
                            <div style={{ fontSize: '0.61rem', color: 'var(--muted)', fontFamily: 'monospace' }}>{customVars[v]}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>Copy from:</span>
                      {SKINS.slice(0, 5).map(s => (
                        <button
                          key={s.id}
                          className="btn btn-ghost btn-xs"
                          onClick={() => {
                            const next = { ...s.vars };
                            setCustomVars(next);
                            applyCustomVars(next);
                            const nextPrefs = { ...prefs, skin: 'custom', customSkinVars: next };
                            setPrefs(nextPrefs);
                            scheduleSave(nextPrefs);
                          }}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Alerts */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><Icons.Bell size={13} /> Alerts</div>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column' }}>
                <Toggle
                  checked={!!prefs.browserAlerts && ('Notification' in window ? Notification.permission === 'granted' : false)}
                  onChange={async () => {
                    const currentlyOn = !!prefs.browserAlerts && Notification.permission === 'granted';
                    if (!currentlyOn) {
                      if (!('Notification' in window)) return;
                      if (Notification.permission === 'denied') return;
                      const permission = await Notification.requestPermission();
                      if (permission !== 'granted') return;
                      update('browserAlerts', true);
                    } else {
                      update('browserAlerts', false);
                    }
                  }}
                  label="Browser Alerts"
                  sub={
                    !('Notification' in window)
                      ? 'Not supported in this browser'
                      : Notification.permission === 'denied'
                        ? 'Blocked by browser — open site settings to re-enable notifications'
                        : 'Show desktop notifications for reminders and medication schedules'
                  }
                />
                <Toggle
                  checked={!!prefs.emailNotifications}
                  onChange={() => update('emailNotifications', !prefs.emailNotifications)}
                  label="Email Notifications"
                  sub="Receive weekly digests and health summaries by email"
                />
              </div>
            </div>
          </>
        )}

        {/* ── Integrations tab ─────────────────────────────────────────────── */}
        {activeTab === 'integrations' && (
          <>
            <AIProvidersSection accessToken={accessToken} />
            <APITokensSection accessToken={accessToken} />
            <CookbookSection accessToken={accessToken} />
            <SyncSourcesSection accessToken={accessToken} />
            <GoogleDriveSyncSection accessToken={accessToken} />
          </>
        )}

        {/* ── Data tab ─────────────────────────────────────────────────────── */}
        {activeTab === 'data' && (
          <>
            {isAdmin && <DatabaseSection accessToken={accessToken} />}
            <CustomFieldsSection accessToken={accessToken} />
            <DataSection accessToken={accessToken} />
          </>
        )}

      </div>
    </>
  );
}
