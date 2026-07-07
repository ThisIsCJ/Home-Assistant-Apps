import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';
import { useConfirm, useNotify } from '../components/AppFeedback';

const FORMS = ['tablet', 'capsule', 'liquid', 'injection', 'patch', 'other'];
const ROUTES = ['oral', 'topical', 'injection', 'inhaled', 'other'];
const FREQUENCIES = [
  'Once daily', 'Twice daily', 'Three times daily', 'Four times daily',
  'Every morning', 'Every evening', 'Every 8 hours', 'Every 12 hours',
  'As needed (PRN)', 'Weekly', 'Monthly', 'Other',
];

const FORM_BADGE_COLOR = {
  tablet: 'badge-blue', capsule: 'badge-purple', liquid: 'badge-green',
  injection: 'badge-orange', patch: 'badge-muted', other: 'badge-muted',
};

function StatusDot({ status }) {
  const colors = { taken: 'var(--green)', skipped: 'var(--red)', pending: 'var(--muted)' };
  const labels = { taken: 'Taken', skipped: 'Skipped', pending: 'Pending' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: colors[status] }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors[status], display: 'inline-block' }} />
      {labels[status]}
    </span>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────

const MED_TYPE_CFG = {
  prescribed: { label: 'Prescribed', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.35)',  iconFilter: 'invert(0.5) sepia(1) saturate(5) hue-rotate(185deg)' },
  otc:        { label: 'OTC',        color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  iconFilter: 'invert(0.5) sepia(1) saturate(6) hue-rotate(5deg)'   },
  supplement: { label: 'Supplement', color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)',  iconFilter: 'invert(0.6) sepia(1) saturate(3) hue-rotate(90deg)'  },
};

const DEFAULT_MED_CFG = { color: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.28)', iconFilter: 'invert(0.6) sepia(1) saturate(3) hue-rotate(90deg)' };
const getMedCfg = (medType) => MED_TYPE_CFG[medType] ?? DEFAULT_MED_CFG;

const MED_TYPES = [
  { value: 'prescribed', label: 'Prescribed' },
  { value: 'otc', label: 'Over the Counter' },
  { value: 'supplement', label: 'Supplement' },
];

function CustomFieldInput({ field, value, onChange }) {
  if (field.fieldType === 'dropdown') {
    return (
      <select className="input" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">– select –</option>
        {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.fieldType === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.76rem', cursor: 'pointer', paddingTop: 6 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
        {field.name}
      </label>
    );
  }
  if (field.fieldType === 'number') {
    return (
      <input type="number" className="input mono" step="any"
        placeholder={field.unit ? `0 ${field.unit}` : '0'}
        value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))} />
    );
  }
  return (
    <input className="input" placeholder={field.name}
      value={value ?? ''} onChange={e => onChange(e.target.value)} />
  );
}

function MedModal({ med, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const isEdit = !!med;
  const [form, setForm] = useState({
    name: med?.name ?? '',
    genericName: med?.genericName ?? '',
    dose: med?.dose ?? '',
    form: med?.form ?? 'tablet',
    route: med?.route ?? 'oral',
    frequency: med?.frequency ?? '',
    startDate: med?.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: med?.endDate ?? '',
    active: med?.active ?? true,
    medType: med?.medType ?? '',
    prescriber: med?.prescriber ?? '',
    pharmacy: med?.pharmacy ?? '',
    reason: med?.reason ?? '',
    sideEffects: med?.sideEffects ?? '',
    refillInfo: med?.refillInfo ?? '',
    notes: med?.notes ?? '',
  });
  const [ingredients, setIngredients] = useState(med?.ingredients ?? []);
  const [customFields, setCustomFields] = useState(med?.customFields ?? {});
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    api.get('/custom-fields?entity=medication', accessToken)
      .then(setCustomFieldDefs)
      .catch(() => {});
  }, [accessToken]);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: '' }));
  };
  const setCF = (key, val) => setCustomFields(c => ({ ...c, [key]: val }));

  const addIngredient = () => setIngredients(i => [...i, { name: '', amount: '', unit: '' }]);
  const removeIngredient = (idx) => setIngredients(i => i.filter((_, j) => j !== idx));
  const updateIngredient = (idx, key, val) =>
    setIngredients(i => i.map((it, j) => j === idx ? { ...it, [key]: val } : it));

  const handleSave = async () => {
    if (!form.name.trim()) {
      setErrors({ name: 'Medication name is required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        endDate: form.endDate || null,
        genericName: form.genericName || null,
        medType: form.medType || null,
        ingredients: ingredients.filter(i => i.name.trim()),
        customFields,
      };
      if (isEdit) {
        await api.put(`/medications/${med.id}`, payload, accessToken);
      } else {
        await api.post('/medications', payload, accessToken);
      }
      onSaved();
      onClose();
    } catch {
      notify('Failed to save medication.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cfBySection = customFieldDefs.reduce((acc, f) => {
    (acc[f.section] = acc[f.section] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Medication' : 'Add Medication'}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Type selector */}
          <div className="input-group">
            <label className="input-label">Type</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MED_TYPES.map(t => {
                const cfg = MED_TYPE_CFG[t.value];
                const active = form.medType === t.value;
                return (
                  <button key={t.value} type="button"
                    className="btn btn-sm"
                    style={active ? {
                      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, fontWeight: 700,
                    } : {}}
                    onClick={() => set('medType', active ? '' : t.value)}
                  >{t.label}</button>
                );
              })}
            </div>
          </div>

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Medication Name *</label>
              <input className={`input ${errors.name ? 'input-error' : ''}`} placeholder="e.g. Lisinopril" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
              {errors.name && <div className="field-error">{errors.name}</div>}
            </div>
            <div className="input-group">
              <label className="input-label">Generic Name</label>
              <input className="input" placeholder="Generic / active ingredient" value={form.genericName} onChange={e => set('genericName', e.target.value)} />
            </div>
          </div>

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Dose</label>
              <input className="input" placeholder="e.g. 10 mg" value={form.dose} onChange={e => set('dose', e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Form</label>
              <select className="input" value={form.form} onChange={e => set('form', e.target.value)}>
                {FORMS.map(f => <option key={f} value={f} style={{ textTransform: 'capitalize' }}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Route</label>
              <select className="input" value={form.route} onChange={e => set('route', e.target.value)}>
                {ROUTES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Frequency</label>
              <select className="input" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
                <option value="">– select –</option>
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Start Date</label>
              <input type="date" className="input mono" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">End Date (optional)</label>
              <input type="date" className="input mono" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
            </div>
          </div>

          {/* Custom fields — general section */}
          {(cfBySection['general'] || []).map(f => (
            <div key={f.id} className="input-group">
              <label className="input-label">
                {f.name}{f.unit ? ` (${f.unit})` : ''}
                {f.required && <span style={{ color: 'var(--red)' }}> *</span>}
              </label>
              <CustomFieldInput field={f} value={customFields[f.fieldKey]} onChange={v => setCF(f.fieldKey, v)} />
            </div>
          ))}

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Prescriber</label>
              <input className="input" placeholder="Doctor / clinician" value={form.prescriber} onChange={e => set('prescriber', e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Pharmacy</label>
              <input className="input" placeholder="Pharmacy name" value={form.pharmacy} onChange={e => set('pharmacy', e.target.value)} />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Reason / Condition Treated</label>
            <input className="input" placeholder="What is this medication for?" value={form.reason} onChange={e => set('reason', e.target.value)} />
          </div>

          <div className="input-group">
            <label className="input-label">Known Side Effects</label>
            <input className="input" placeholder="Side effects to watch for" value={form.sideEffects} onChange={e => set('sideEffects', e.target.value)} />
          </div>

          <div className="input-group">
            <label className="input-label">Refill Info</label>
            <input className="input" placeholder="Refills remaining, next refill date…" value={form.refillInfo} onChange={e => set('refillInfo', e.target.value)} />
          </div>

          <div className="input-group">
            <label className="input-label">Notes</label>
            <input className="input" placeholder="Any additional notes" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          {/* Ingredients */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="input-label" style={{ margin: 0 }}>Ingredients / Active Compounds</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={addIngredient}>
                <Icons.Plus size={11} /> Add
              </button>
            </div>
            {ingredients.length === 0 ? (
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic', padding: '4px 0' }}>No ingredients added</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ingredients.map((ing, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px auto', gap: 6, alignItems: 'center' }}>
                    <input className="input" placeholder="Ingredient name" value={ing.name}
                      onChange={e => updateIngredient(idx, 'name', e.target.value)} />
                    <input className="input mono" placeholder="Amount" value={ing.amount}
                      onChange={e => updateIngredient(idx, 'amount', e.target.value)} />
                    <input className="input" placeholder="Unit" value={ing.unit}
                      onChange={e => updateIngredient(idx, 'unit', e.target.value)} />
                    <button type="button" className="btn btn-ghost btn-xs btn-danger" onClick={() => removeIngredient(idx)}>
                      <Icons.X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Custom fields — details section */}
          {(cfBySection['details'] || []).length > 0 && (
            <div>
              <div className="input-label" style={{ marginBottom: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {(cfBySection['details'] || []).map(f => (
                  <div key={f.id} className="input-group" style={{ gridColumn: f.fieldType === 'boolean' ? 'span 2' : undefined }}>
                    {f.fieldType !== 'boolean' && (
                      <label className="input-label">
                        {f.name}{f.unit ? ` (${f.unit})` : ''}
                        {f.required && <span style={{ color: 'var(--red)' }}> *</span>}
                      </label>
                    )}
                    <CustomFieldInput field={f} value={customFields[f.fieldKey]} onChange={v => setCF(f.fieldKey, v)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isEdit && (
            <div className="flex items-center gap-2" style={{ paddingTop: 4 }}>
              <label style={{ fontSize: '0.76rem', color: 'var(--muted2)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
                Active medication
              </label>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Medication'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bundle modal ──────────────────────────────────────────────────────────────

function BundleModal({ bundle, medications, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const isEdit = !!bundle;
  const [name, setName] = useState(bundle?.name ?? '');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [items, setItems] = useState(bundle?.items ?? []);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const addItem = (medId) => {
    if (!medId || items.find(i => i.medicationId === medId)) return;
    setItems(prev => [...prev, { medicationId: medId, doseOverride: null, instructions: '' }]);
  };

  const removeItem = (medId) => setItems(prev => prev.filter(i => i.medicationId !== medId));

  const updateItem = (medId, key, val) =>
    setItems(prev => prev.map(i => i.medicationId === medId ? { ...i, [key]: val } : i));

  const medMap = Object.fromEntries(medications.map(m => [m.id, m]));

  const handleSave = async () => {
    if (!name.trim()) {
      setErrors({ name: 'Bundle name is required.' });
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/medications/bundles/${bundle.id}`, { name, description, items }, accessToken);
      } else {
        await api.post('/medications/bundles', { name, description, items }, accessToken);
      }
      onSaved();
      onClose();
    } catch {
      notify('Failed to save bundle.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const available = medications.filter(m => !items.find(i => i.medicationId === m.id));

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Bundle' : 'Create Bundle'}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div className="input-group mb-3">
          <label className="input-label">Bundle Name *</label>
          <input className={`input ${errors.name ? 'input-error' : ''}`} placeholder="e.g. Morning Pills" value={name}
            onChange={e => { setName(e.target.value); if (errors.name) setErrors({}); }} autoFocus />
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>
        <div className="input-group mb-3">
          <label className="input-label">Description</label>
          <input className="input" placeholder="Optional description" value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        {/* Add meds to bundle */}
        {available.length > 0 && (
          <div className="input-group mb-3">
            <label className="input-label">Add Medication to Bundle</label>
            <select className="input" defaultValue="" onChange={e => { addItem(e.target.value); e.target.value = ''; }}>
              <option value="">– select medication –</option>
              {available.map(m => <option key={m.id} value={m.id}>{m.name}{m.dose ? ` ${m.dose}` : ''}</option>)}
            </select>
          </div>
        )}

        {/* Bundle items */}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <div className="input-label" style={{ marginBottom: 2 }}>Bundle Contents</div>
            {items.map(item => {
              const m = medMap[item.medicationId];
              return (
                <div key={item.medicationId} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 7, padding: '10px 12px' }}>
                  <div className="flex justify-between items-center mb-2">
                    <span style={{ fontWeight: 600, fontSize: '0.76rem' }}>
                      {m?.name ?? item.medicationId}{m?.dose ? ` — ${m.dose}` : ''}
                    </span>
                    <button className="btn btn-ghost btn-xs btn-danger" onClick={() => removeItem(item.medicationId)}>
                      <Icons.X size={11} />
                    </button>
                  </div>
                  <div className="grid-2">
                    <div className="input-group">
                      <label className="input-label">Dose Override</label>
                      <input className="input" placeholder="Leave blank to use default" value={item.doseOverride ?? ''} onChange={e => updateItem(item.medicationId, 'doseOverride', e.target.value || null)} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Instructions</label>
                      <input className="input" placeholder="e.g. Take with food" value={item.instructions ?? ''} onChange={e => updateItem(item.medicationId, 'instructions', e.target.value)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {items.length === 0 && (
          <div className="empty-state" style={{ padding: '20px', minHeight: 'unset' }}>
            <div className="empty-state-text">No medications added yet</div>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Bundle' : 'Create Bundle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Medication photo modal ────────────────────────────────────────────────────

const NORM_FORM = (v) => {
  if (!v) return 'tablet';
  const n = v.toLowerCase().replace(/s$/, '');
  return FORMS.includes(n) ? n : 'other';
};
const NORM_ROUTE = (v) => {
  if (!v) return 'oral';
  const n = v.toLowerCase();
  return ROUTES.includes(n) ? n : 'other';
};
const NORM_FREQ = (v) => {
  if (!v) return '';
  return FREQUENCIES.includes(v) ? v : v;
};

function MedPhotoModal({ onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const [step, setStep] = useState('photos');
  const [photos, setPhotos] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [aiMeta, setAiMeta] = useState(null);
  const [form, setForm] = useState({
    name: '', genericName: '', dose: '', form: 'tablet', route: 'oral',
    frequency: '', startDate: new Date().toISOString().slice(0, 10),
    endDate: '', active: true, prescriber: '', pharmacy: '',
    reason: '', sideEffects: '', refillInfo: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const addFiles = (files) => {
    const next = Array.from(files).slice(0, 4 - photos.length).map(file => ({
      id: Math.random().toString(36).slice(2),
      file,
      url: URL.createObjectURL(file),
    }));
    setPhotos(prev => [...prev, ...next].slice(0, 4));
  };

  const removePhoto = (id) => {
    setPhotos(prev => {
      const p = prev.find(x => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter(x => x.id !== id);
    });
  };

  const analyse = async () => {
    if (!photos.length) return;
    setAnalyzing(true);
    setError('');
    try {
      const fd = new FormData();
      photos.forEach(p => fd.append('images', p.file));
      const res = await fetch('/api/ai/tasks/medication-photo', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Analysis failed');
      }
      const data = await res.json();
      setAiMeta({ confidence: data.confidence, provider: data.provider, model: data.model });
      setForm({
        name: data.name || '',
        genericName: data.genericName || '',
        dose: data.dose || '',
        form: NORM_FORM(data.form),
        route: NORM_ROUTE(data.route),
        frequency: NORM_FREQ(data.frequency),
        startDate: new Date().toISOString().slice(0, 10),
        endDate: '',
        active: true,
        prescriber: data.prescriber || '',
        pharmacy: data.pharmacy || '',
        reason: data.reason || '',
        sideEffects: Array.isArray(data.warnings) ? data.warnings.join('; ') : (data.warnings || ''),
        refillInfo: data.refillInfo || '',
        notes: data.notes || '',
      });
      setStep('review');
    } catch (e) {
      setError(e.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: '' }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setErrors({ name: 'Medication name is required.' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/medications', {
        ...form,
        endDate: form.endDate || null,
        genericName: form.genericName || null,
        source: 'ai_photo',
      }, accessToken);
      onSaved();
      onClose();
    } catch {
      notify('Failed to save medication.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confColor = aiMeta?.confidence >= 0.75
    ? 'var(--green2)' : aiMeta?.confidence >= 0.45
    ? 'var(--orange)' : 'var(--red)';

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <span className="modal-title">
            {step === 'photos'
              ? <><Icons.Camera size={14} style={{ marginRight: 6 }} />Add Medication from Photo</>
              : <><Icons.Sparkle size={14} style={{ marginRight: 6, color: 'var(--purple)' }} />Review Extracted Details</>
            }
          </span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        {/* ── Step 1: Photos ── */}
        {step === 'photos' && (
          <>
            {/* Drop zone */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: '2px dashed var(--border2)', borderRadius: 10, padding: '28px 20px',
                textAlign: 'center', cursor: 'pointer', color: 'var(--muted)', marginBottom: 10,
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border2)'}
            >
              <Icons.Upload size={26} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.45 }} />
              <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>Drop label photos here or click to browse</div>
              <div style={{ fontSize: '0.7rem', marginTop: 4, opacity: 0.7 }}>
                Add up to 4 photos · JPG, PNG, HEIC
              </div>
            </div>

            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button className="btn btn-sec btn-sm" style={{ flex: 1 }} onClick={e => { e.stopPropagation(); cameraRef.current?.click(); }}>
                <Icons.Camera size={12} /> Take Photo
              </button>
              <button className="btn btn-sec btn-sm" style={{ flex: 1 }} onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
                <Icons.Upload size={12} /> Choose Files
              </button>
            </div>

            {/* Photo grid */}
            {photos.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                {photos.map(p => (
                  <div key={p.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border2)' }}>
                    <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={() => removePhoto(p.id)} style={{
                      position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', color: '#fff',
                      border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}>
                      <Icons.X size={10} />
                    </button>
                  </div>
                ))}
                {photos.length < 4 && (
                  <div onClick={() => fileRef.current?.click()} style={{
                    aspectRatio: '1', borderRadius: 8, border: '2px dashed var(--border2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'var(--muted)',
                  }}>
                    <Icons.Plus size={18} />
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
              Tip: Photograph the front label clearly. Add the back or side panel if directions or warnings are not visible on the front.
            </div>

            {error && (
              <div style={{ fontSize: '0.72rem', color: 'var(--red)', padding: '8px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6, marginBottom: 10 }}>
                {error}
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-sec" onClick={onClose}>Cancel</button>
              <button className="btn btn-pri" onClick={analyse} disabled={!photos.length || analyzing}>
                <Icons.Sparkle size={13} />
                {analyzing ? 'Analysing…' : `Analyse Photo${photos.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Review ── */}
        {step === 'review' && (
          <>
            {/* AI metadata bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 10px', background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.22)', borderRadius: 7, fontSize: '0.72rem' }}>
              <Icons.Sparkle size={12} style={{ color: 'var(--purple)', flexShrink: 0 }} />
              <span style={{ color: 'var(--muted2)' }}>Extracted by {aiMeta?.provider}/{aiMeta?.model} · review all fields before saving</span>
              {aiMeta?.confidence != null && (
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: confColor, whiteSpace: 'nowrap' }}>
                  {Math.round(aiMeta.confidence * 100)}% confidence
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '54vh', overflowY: 'auto', paddingRight: 2 }}>
              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Medication Name *</label>
                  <input className={`input ${errors.name ? 'input-error' : ''}`} value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
                  {errors.name && <div className="field-error">{errors.name}</div>}
                </div>
                <div className="input-group">
                  <label className="input-label">Generic Name</label>
                  <input className="input" value={form.genericName} onChange={e => set('genericName', e.target.value)} />
                </div>
              </div>

              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Dose / Strength</label>
                  <input className="input" placeholder="e.g. 10 mg" value={form.dose} onChange={e => set('dose', e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Form</label>
                  <select className="input" value={form.form} onChange={e => set('form', e.target.value)}>
                    {FORMS.map(f => <option key={f} value={f} style={{ textTransform: 'capitalize' }}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Route</label>
                  <select className="input" value={form.route} onChange={e => set('route', e.target.value)}>
                    {ROUTES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Frequency</label>
                  <select className="input" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
                    <option value="">– select –</option>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid-2">
                <div className="input-group">
                  <label className="input-label">Prescriber</label>
                  <input className="input" value={form.prescriber} onChange={e => set('prescriber', e.target.value)} placeholder="Doctor name" />
                </div>
                <div className="input-group">
                  <label className="input-label">Pharmacy</label>
                  <input className="input" value={form.pharmacy} onChange={e => set('pharmacy', e.target.value)} />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Reason / Condition</label>
                <input className="input" value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="What is this medication for?" />
              </div>

              <div className="input-group">
                <label className="input-label">Warnings / Side Effects</label>
                <input className="input" value={form.sideEffects} onChange={e => set('sideEffects', e.target.value)} placeholder="From label warnings" />
              </div>

              <div className="input-group">
                <label className="input-label">Refill Info</label>
                <input className="input" value={form.refillInfo} onChange={e => set('refillInfo', e.target.value)} />
              </div>

              {form.notes && (
                <div className="input-group">
                  <label className="input-label">Additional Notes</label>
                  <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
              )}
            </div>

            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.5, borderTop: '1px solid var(--border)', margin: '12px 0 0', paddingTop: 10 }}>
              Always verify AI-extracted medication details against your prescription label or pharmacist before saving.
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setStep('photos'); setError(''); }}>
                <Icons.ChevronLeft size={13} /> Back to Photos
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sec" onClick={onClose}>Cancel</button>
                <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Add Medication'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Medication detail card ────────────────────────────────────────────────────

function MedTypeBadge({ type }) {
  const cfg = MED_TYPE_CFG[type];
  if (!cfg) return null;
  return (
    <span style={{
      fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: 5,
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
      letterSpacing: '0.02em',
    }}>
      {cfg.label}
    </span>
  );
}

function MedCard({ med, onEdit, onDelete, onToggleQuickAction }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = med.reason || med.prescriber || med.pharmacy || med.sideEffects || med.refillInfo || med.notes;
  const typeCfg = MED_TYPE_CFG[med.medType];
  const borderColor = !med.active ? 'var(--muted)' : typeCfg ? typeCfg.color : 'var(--accent)';

  return (
    <div className="card" style={{ borderLeft: `3px solid ${borderColor}` }}>
      <div style={{ padding: '12px 14px' }}>
        <div className="flex justify-between items-center">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '0.84rem' }}>{med.name}</span>
              {med.dose && <span className="mono text-xs" style={{ color: 'var(--accent2)' }}>{med.dose}</span>}
              {med.medType && <MedTypeBadge type={med.medType} />}
              <span className={`badge ${FORM_BADGE_COLOR[med.form] ?? 'badge-muted'}`}>{med.form}</span>
              {!med.active && <span className="badge badge-muted">Inactive</span>}
            </div>
            {med.genericName && <div className="text-xs text-muted mt-1">{med.genericName}</div>}
            <div className="flex gap-3 mt-1" style={{ flexWrap: 'wrap' }}>
              {med.frequency && (
                <span className="flex items-center gap-1 text-xs text-muted">
                  <Icons.Clock size={11} /> {med.frequency}
                </span>
              )}
              {med.startDate && (
                <span className="flex items-center gap-1 text-xs text-muted">
                  <Icons.Calendar size={11} /> Since {med.startDate}
                </span>
              )}
              {med.route && med.route !== 'oral' && (
                <span className="text-xs text-muted" style={{ textTransform: 'capitalize' }}>{med.route}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
            {hasDetail && (
              <button className="btn btn-ghost btn-xs" onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse' : 'Expand'}>
                {expanded ? <Icons.ChevronDown size={12} style={{ transform: 'rotate(180deg)' }} /> : <Icons.ChevronDown size={12} />}
              </button>
            )}
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => onToggleQuickAction(med)}
              title={med.quickAction ? 'Remove from dashboard quick actions' : 'Add to dashboard quick actions'}
            >
              <Icons.Star size={12} style={{ fill: med.quickAction ? 'var(--accent)' : 'none', color: med.quickAction ? 'var(--accent)' : 'var(--muted)' }} />
            </button>
            <button className="btn btn-xs" style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }} onClick={() => onEdit(med)} title="Edit">
              <Icons.Edit size={12} />
            </button>
            <button className="btn btn-xs btn-danger" onClick={() => onDelete(med)} title="Delete">
              <Icons.Trash size={12} />
            </button>
          </div>
        </div>

        {expanded && hasDetail && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
            {[
              ['Reason', med.reason],
              ['Prescriber', med.prescriber],
              ['Pharmacy', med.pharmacy],
              ['Side Effects', med.sideEffects],
              ['Refill Info', med.refillInfo],
              ['Notes', med.notes],
            ].filter(([, v]) => v).map(([label, val]) => (
              <div key={label} style={{ gridColumn: val?.length > 40 ? '1 / -1' : 'auto' }}>
                <div className="text-xs" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: '0.76rem' }}>{val}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit med log modal ────────────────────────────────────────────────────────

function EditMedLogModal({ log, medication, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const takenAtDate = log.takenAt ? new Date(log.takenAt) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const localTime = `${pad(takenAtDate.getHours())}:${pad(takenAtDate.getMinutes())}`;
  const localDate = takenAtDate.toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz

  const [form, setForm] = useState({
    status: log.status ?? 'taken',
    date: localDate,
    time: localTime,
    notes: log.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const takenAt = new Date(`${form.date}T${form.time}:00`).toISOString();
      await api.put(`/medications/logs/${log.id}`, {
        status: form.status,
        takenAt,
        scheduledFor: form.date,
        notes: form.notes || null,
      }, accessToken);
      onSaved();
      onClose();
    } catch {
      notify('Failed to update log entry.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <span className="modal-title">Edit Log — {medication.name}{medication.dose ? ` ${medication.dose}` : ''}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="input-group">
            <label className="input-label">Status</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="taken">Taken</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Date</label>
              <input type="date" className="input mono" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Time</label>
              <input type="time" className="input mono" value={form.time} onChange={e => set('time', e.target.value)} />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">Notes</label>
            <input className="input" placeholder="Optional notes" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bundle grouping helpers ───────────────────────────────────────────────────

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

// ── Today tab ─────────────────────────────────────────────────────────────────

function TodayTab({ accessToken }) {
  const notify = useNotify();
  const [data, setData] = useState(null);
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState({});
  const [bundleLogging, setBundleLogging] = useState({});
  const [bundleResult, setBundleResult] = useState({});
  const [editingLog, setEditingLog] = useState(null);
  const [expandedBundles, setExpandedBundles] = useState({});
  const today = new Date().toISOString().slice(0, 10);
  const toggleBundle = (id) => setExpandedBundles(e => ({ ...e, [id]: !e[id] }));

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [result, bundleData] = await Promise.all([
        api.get(`/medications/today?date=${today}`, accessToken),
        api.get('/medications/bundles/list', accessToken).catch(() => []),
      ]);
      setData(result);
      setBundles(bundleData.filter(b => b.items?.length > 0));
    } finally {
      setLoading(false);
    }
  }, [accessToken, today]);

  useEffect(() => { fetch(); }, [fetch]);

  const logStatus = async (medId, status) => {
    setLogging(l => ({ ...l, [medId]: true }));
    try {
      await api.post('/medications/logs', {
        medicationId: medId,
        status,
        scheduledFor: today,
        takenAt: new Date().toISOString(),
      }, accessToken);
      await fetch();
    } finally {
      setLogging(l => ({ ...l, [medId]: false }));
    }
  };

  const logBundle = async (bundle) => {
    setBundleLogging(l => ({ ...l, [bundle.id]: true }));
    setBundleResult(r => ({ ...r, [bundle.id]: null }));
    try {
      const result = await api.post(`/medications/bundles/${bundle.id}/log`, { status: 'taken' }, accessToken);
      setBundleResult(r => ({ ...r, [bundle.id]: result }));
      await fetch();
      setTimeout(() => setBundleResult(r => ({ ...r, [bundle.id]: null })), 3000);
    } catch {
      notify('Failed to log bundle.', 'error');
    } finally {
      setBundleLogging(l => ({ ...l, [bundle.id]: false }));
    }
  };

  if (loading) return <div className="empty-state"><div className="text-muted">Loading…</div></div>;

  if (!data?.items?.length) {
    return (
      <div className="empty-state" style={{ minHeight: 200 }}>
        <div className="empty-state-icon"><Icons.Pill size={32} /></div>
        <div className="empty-state-text">No active medications</div>
        <div className="empty-state-sub">Add medications in the My Medications tab</div>
      </div>
    );
  }

  const pending = data.items.filter(i => i.status === 'pending');
  const done = data.items.filter(i => i.status !== 'pending');
  const { bundles: doneBundles, standalone: doneStandalone } = _groupByBundle(done);
  const { bundles: pendingBundles, standalone: pendingStandalone } = _groupByBundle(pending);

  const renderMedCard = ({ medication, status, logs }) => {
    const cfg = getMedCfg(medication.medType);
    return (
      <div key={medication.id} className="card" style={{ padding: '12px 14px', borderLeft: `3px solid ${cfg.color}` }}>
        <div className="flex justify-between items-center" style={{ marginBottom: logs.length ? 8 : 0 }}>
          <div className="flex items-center gap-2">
            <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{medication.name}</span>
            {medication.dose && <span className="mono text-xs text-muted">{medication.dose}</span>}
          </div>
          <button className="btn btn-sm" style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
            onClick={() => logStatus(medication.id, 'taken')} disabled={logging[medication.id]}>
            <Icons.Plus size={11} /> Log again
          </button>
        </div>
        {logs.map(log => {
          const t = log.takenAt ? new Date(log.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
          return (
            <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
              <StatusDot status={log.status} />
              {t && <span className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Icons.Clock size={10} /> {t}</span>}
              <div style={{ marginLeft: 'auto' }}>
                <button className="btn btn-ghost btn-xs" onClick={() => setEditingLog({ log, medication })} title="Edit this log entry">
                  <Icons.Edit size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderPendingTile = ({ medication }) => {
    const cfg = getMedCfg(medication.medType);
    return (
      <div key={medication.id} style={{ position: 'relative' }}>
        <button className="btn btn-sm qa-tile"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
          onClick={() => logStatus(medication.id, 'taken')} disabled={logging[medication.id]}
          title={`Log ${medication.name}${medication.dose ? ` ${medication.dose}` : ''} as taken`}>
          <img src="/icons/medicines@2x.png" width={18} height={18} className="png-icon" alt="" style={{ filter: cfg.iconFilter }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
            <span>{medication.name}</span>
            {medication.dose && <span style={{ fontSize: '0.6rem', opacity: 0.75 }}>{medication.dose}</span>}
          </div>
          <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.65, marginLeft: 2 }}>
            {logging[medication.id] ? '…' : 'Take'}
          </span>
        </button>
        <button style={{ position: 'absolute', top: 3, right: 3, background: 'none', border: 'none', color: cfg.color, cursor: 'pointer', fontSize: '0.62rem', padding: '1px 3px', lineHeight: 1, opacity: 0.6 }}
          onClick={() => logStatus(medication.id, 'skipped')} disabled={logging[medication.id]} title="Skip">
          skip
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Done section */}
      {done.length > 0 && (
        <>
          <div className="input-label" style={{ marginBottom: 4 }}>Taken / Skipped</div>

          {/* Done bundle groups */}
          {doneBundles.map(bundle => {
            const isExp = !!expandedBundles[bundle.id];
            const takenCount = bundle.items.filter(i => i.status === 'taken').length;
            const statusColor = takenCount === bundle.items.length ? 'var(--green2)' : 'var(--orange)';
            const res = bundleResult[bundle.id];
            return (
              <div key={bundle.id} className="card" style={{ overflow: 'clip', padding: 0 }}>
                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icons.Package size={14} style={{ color: statusColor, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1 }}>{bundle.name}</span>
                  <span style={{ fontSize: '0.7rem', color: statusColor, fontWeight: 600 }}>
                    {takenCount}/{bundle.items.length} taken
                  </span>
                  <button className="btn btn-ghost btn-xs" onClick={() => toggleBundle(bundle.id)}>
                    <Icons.ChevronDown size={12} style={{ transform: isExp ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
                  </button>
                </div>
                {isExp && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {bundle.items.map(({ medication, status, logs }) => {
                      const cfg = getMedCfg(medication.medType);
                      const firstLog = logs?.[0];
                      const t = firstLog?.takenAt ? new Date(firstLog.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
                      return (
                        <div key={medication.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: status === 'taken' ? 'var(--green)' : 'var(--red)', flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, fontSize: '0.78rem', flex: 1 }}>{medication.name}</span>
                          {medication.dose && <span className="mono text-xs text-muted">{medication.dose}</span>}
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: status === 'taken' ? 'var(--green2)' : 'var(--red)' }}>
                            {status === 'taken' ? 'Taken' : 'Skipped'}
                          </span>
                          {t && <span className="text-xs text-muted"><Icons.Clock size={10} /> {t}</span>}
                          {firstLog && (
                            <button className="btn btn-ghost btn-xs" onClick={() => setEditingLog({ log: firstLog, medication })}>
                              <Icons.Edit size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone done items */}
          {doneStandalone.map(item => renderMedCard(item))}
        </>
      )}

      {/* Pending section */}
      {pending.length > 0 && (
        <>
          <div className="input-label" style={{ marginTop: done.length ? 12 : 0, marginBottom: 8 }}>Medications</div>

          {/* Pending bundle groups */}
          {pendingBundles.map(bundle => {
            const isExp = !!expandedBundles['p_' + bundle.id];
            const res = bundleResult[bundle.id];
            const matchedBundle = bundles.find(b => b.id === bundle.id);
            return (
              <div key={bundle.id} className="card" style={{ overflow: 'clip', padding: 0, marginBottom: 4 }}>
                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icons.Package size={14} style={{ color: 'var(--accent2)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1 }}>{bundle.name}</span>
                  <span className="text-xs text-muted">{bundle.items.length} med{bundle.items.length !== 1 ? 's' : ''}</span>
                  {matchedBundle && (
                    <button className="btn btn-sm"
                      style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.28)', color: 'var(--green2)' }}
                      onClick={() => logBundle(matchedBundle)} disabled={bundleLogging[matchedBundle.id]}>
                      {bundleLogging[matchedBundle.id] ? 'Logging…' : res ? (res.logged > 0 ? `${res.logged} logged` : 'All done') : 'Take All'}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-xs" onClick={() => toggleBundle('p_' + bundle.id)}>
                    <Icons.ChevronDown size={12} style={{ transform: isExp ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
                  </button>
                </div>
                {isExp && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {bundle.items.map(item => renderPendingTile(item))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone pending tiles */}
          {pendingStandalone.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {pendingStandalone.map(item => renderPendingTile(item))}
            </div>
          )}
        </>
      )}

      {editingLog && (
        <EditMedLogModal
          log={editingLog.log}
          medication={editingLog.medication}
          accessToken={accessToken}
          onClose={() => setEditingLog(null)}
          onSaved={() => { setEditingLog(null); fetch(); }}
        />
      )}
    </div>
  );
}

// ── Interactions tab ──────────────────────────────────────────────────────────

function InteractionsTab({ accessToken }) {
  const notify = useNotify();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [noProvider, setNoProvider] = useState(false);
  const [error, setError] = useState(null);

  const check = async () => {
    setLoading(true);
    setNoProvider(false);
    setError(null);
    try {
      const data = await api.post('/ai/tasks/medication-interactions', {}, accessToken);
      setResult(data);
    } catch (e) {
      if (e.status === 400 && e.detail?.detail?.includes('No AI provider')) {
        setNoProvider(true);
      } else {
        const msg = e.message || 'An unexpected error occurred. Please try again.';
        setError(msg);
        notify(`Interaction check failed: ${msg}`, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Safety disclaimer */}
      <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 9, padding: '12px 14px', marginBottom: 16, display: 'flex', gap: 10 }}>
        <div style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 1 }}><Icons.AlertTriangle size={15} /></div>
        <div style={{ fontSize: '0.73rem', color: 'var(--muted2)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--orange)' }}>Medical Disclaimer</strong><br />
          Interaction information is for personal reference only and is <strong>not medical advice</strong>.
          Always consult a qualified clinician or pharmacist before making any changes to your medications.
        </div>
      </div>

      <button className="btn btn-pri mb-4" onClick={check} disabled={loading}>
        <Icons.Refresh size={13} />
        {loading ? 'Checking with AI…' : 'Check Interactions with AI'}
      </button>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: '0.75rem', color: 'var(--red)', lineHeight: 1.6 }}>
          <strong>Check failed:</strong> {error}
        </div>
      )}

      {noProvider && (
        <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: '0.75rem', color: 'var(--muted2)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--purple)' }}>No AI provider configured.</strong>{' '}
          Go to <a href="/settings" style={{ color: 'var(--accent)' }}>Settings → AI Providers</a> to add your API key.
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.source === 'ai' && (
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icons.Sparkle size={11} style={{ color: 'var(--purple)' }} />
              Analysed by {result.provider}/{result.model} · {new Date(result.checkedAt).toLocaleTimeString()}
            </div>
          )}
          {/* Medication list */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><Icons.Pill size={13} /> Medications Reviewed</div>
              <span className="mono text-xs text-muted">{result.medications.length} active</span>
            </div>
            <div className="card-body" style={{ padding: '10px 14px' }}>
              {result.medications.length === 0
                ? <div className="text-xs text-muted">No active medications found.</div>
                : result.medications.map((name, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < result.medications.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
                      <span style={{ fontSize: '0.76rem' }}>{name}</span>
                    </div>
                  ))
              }
            </div>
          </div>

          {/* Summary */}
          <div className="card">
            <div className="card-header">
              <div className="card-title blue"><Icons.Info size={13} /> Summary</div>
            </div>
            <div className="card-body" style={{ fontSize: '0.76rem', color: 'var(--muted2)', lineHeight: 1.6 }}>
              {result.summary}
            </div>
          </div>

          {/* Interactions */}
          {result.possibleInteractions.length > 0 && (
            <div className="card">
              <div className="card-header">
                <div className="card-title orange"><Icons.AlertTriangle size={13} /> Possible Interactions</div>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {result.possibleInteractions.map((interaction, i) => (
                  <div key={i} style={{ padding: '12px 14px', borderBottom: i < result.possibleInteractions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="badge badge-orange">{interaction.severity}</span>
                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{interaction.medications.join(' + ')}</span>
                    </div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--muted2)' }}>{interaction.explanation || interaction.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Questions for clinician */}
          {result.questionsForClinician?.length > 0 && (
            <div className="card">
              <div className="card-header">
                <div className="card-title purple"><Icons.Info size={13} /> Questions for Your Clinician</div>
              </div>
              <div className="card-body" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.questionsForClinician.map((q, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: '0.76rem', color: 'var(--muted2)', padding: '5px 0', borderBottom: i < result.questionsForClinician.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ color: 'var(--purple)', flexShrink: 0 }}>?</span>
                    {q}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.5, padding: '8px 0' }}>
            {result.disclaimer}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bundles tab ───────────────────────────────────────────────────────────────

function BundlesTab({ medications, accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [logging, setLogging] = useState({});
  const [logResult, setLogResult] = useState({});

  const fetchBundles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/medications/bundles/list', accessToken);
      setBundles(data);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchBundles(); }, [fetchBundles]);

  const handleDelete = async (bundle) => {
    const ok = await confirm({
      title: 'Delete medication bundle?',
      message: `Delete bundle "${bundle.name}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/medications/bundles/${bundle.id}`, accessToken);
      fetchBundles();
    } catch {
      notify('Failed to delete bundle.', 'error');
    }
  };

  const handleToggleQuickAction = async (bundle) => {
    await api.put(`/medications/bundles/${bundle.id}`, { quickAction: !bundle.quickAction }, accessToken);
    fetchBundles();
  };

  const handleLogBundle = async (bundle) => {
    setLogging(l => ({ ...l, [bundle.id]: true }));
    setLogResult(r => ({ ...r, [bundle.id]: null }));
    try {
      const result = await api.post(`/medications/bundles/${bundle.id}/log`, { status: 'taken' }, accessToken);
      setLogResult(r => ({ ...r, [bundle.id]: result }));
      setTimeout(() => setLogResult(r => ({ ...r, [bundle.id]: null })), 3000);
    } catch {
      notify('Failed to log bundle.', 'error');
    } finally {
      setLogging(l => ({ ...l, [bundle.id]: false }));
    }
  };

  const medMap = Object.fromEntries(medications.map(m => [m.id, m]));

  if (loading) return <div className="empty-state"><div className="text-muted">Loading…</div></div>;

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="text-muted text-sm">Group medications into reusable bundles (e.g. Morning Pills)</div>
        <button className="btn btn-pri btn-sm" onClick={() => { setEditing(null); setShowModal(true); }}>
          <Icons.Plus size={13} /> New Bundle
        </button>
      </div>

      {bundles.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div className="empty-state-icon"><Icons.Package size={32} /></div>
          <div className="empty-state-text">No bundles yet</div>
          <div className="empty-state-sub">Create a bundle to group medications taken together</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bundles.map(bundle => {
            const result = logResult[bundle.id];
            return (
              <div key={bundle.id} className="card">
                <div style={{ padding: '12px 14px' }}>
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{bundle.name}</span>
                      {bundle.description && <div className="text-xs text-muted mt-1">{bundle.description}</div>}
                    </div>
                    <div className="flex gap-1 items-center">
                      {result && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--green2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icons.Check size={11} />
                          {result.logged > 0
                            ? `${result.logged} logged${result.skipped > 0 ? `, ${result.skipped} already taken` : ''}`
                            : 'All already taken'}
                        </span>
                      )}
                      {bundle.items?.length > 0 && (
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--green2)' }}
                          onClick={() => handleLogBundle(bundle)}
                          disabled={logging[bundle.id]}
                          title="Mark all medications in this bundle as taken"
                        >
                          <Icons.Check size={12} />
                          {logging[bundle.id] ? 'Logging…' : 'Take All'}
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => handleToggleQuickAction(bundle)}
                        title={bundle.quickAction ? 'Remove from dashboard quick actions' : 'Add to dashboard quick actions'}
                      >
                        <Icons.Star size={12} style={{ fill: bundle.quickAction ? 'var(--accent)' : 'none', color: bundle.quickAction ? 'var(--accent)' : 'var(--muted)' }} />
                      </button>
                      <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(bundle); setShowModal(true); }}>
                        <Icons.Edit size={12} />
                      </button>
                      <button className="btn btn-ghost btn-xs btn-danger" onClick={() => handleDelete(bundle)}>
                        <Icons.Trash size={12} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {bundle.items?.length === 0
                      ? <span className="text-xs text-muted italic">No medications in this bundle</span>
                      : bundle.items?.map((item, i) => {
                          const m = medMap[item.medicationId];
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.74rem', padding: '3px 0' }}>
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent2)', display: 'inline-block', flexShrink: 0 }} />
                              <span>{m?.name ?? item.medicationId}</span>
                              {(item.doseOverride || m?.dose) && (
                                <span className="mono text-xs text-muted">{item.doseOverride ?? m?.dose}</span>
                              )}
                              {item.instructions && <span className="text-xs text-muted">— {item.instructions}</span>}
                            </div>
                          );
                        })
                    }
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <BundleModal
          bundle={editing}
          medications={medications}
          accessToken={accessToken}
          onClose={() => setShowModal(false)}
          onSaved={fetchBundles}
        />
      )}
    </>
  );
}

// ── Advanced Edit tab (medication logs history) ───────────────────────────────

function AdvancedMedTab({ accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [limit, setLimit] = useState(25);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enable, setEnable] = useState({ status: false, date: false, notes: false });
  const [bulk, setBulk] = useState({ status: 'taken', date: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const data = await api.get(`/medications/logs/list?limit=${limit}`, accessToken);
      setLogs(data);
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

  const allSelected = logs.length > 0 && selected.size === logs.length;
  const someSelected = selected.size > 0;
  const anyEnabled = enable.status || enable.date || enable.notes;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(logs.map(l => l.id)));

  const handleApply = async () => {
    if (!anyEnabled) return;
    setApplying(true);
    try {
      await Promise.all([...selected].map(id => {
        const updates = {};
        if (enable.status) updates.status = bulk.status;
        if (enable.notes) updates.notes = bulk.notes || null;
        if (enable.date && bulk.date) {
          const log = logs.find(l => l.id === id);
          const origTime = log?.takenAt
            ? new Date(log.takenAt).toTimeString().slice(0, 5)
            : '00:00';
          updates.takenAt = new Date(`${bulk.date}T${origTime}:00`).toISOString();
          updates.scheduledFor = bulk.date;
        }
        return Object.keys(updates).length > 0
          ? api.put(`/medications/logs/${id}`, updates, accessToken)
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
      title: 'Delete medication logs?',
      message: `Delete ${selected.size} medication log entr${selected.size !== 1 ? 'ies' : 'y'}?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await Promise.all([...selected].map(id => api.delete(`/medications/logs/${id}`, accessToken)));
      await load();
    } catch {
      notify('Some deletes failed.', 'error');
      await load();
    } finally {
      setDeleting(false);
    }
  };

  const STATUS_COLORS = { taken: 'var(--green2)', skipped: 'var(--red)', pending: 'var(--muted)' };

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
            Bulk Edit — {selected.size} {selected.size === 1 ? 'entry' : 'entries'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={enable.status}
                onChange={e => setEnable(v => ({ ...v, status: e.target.checked }))} />
              <span style={{ color: 'var(--muted2)' }}>Status:</span>
              <select className="input" style={{ width: 'auto', padding: '4px 8px' }} disabled={!enable.status}
                value={bulk.status} onChange={e => setBulk(v => ({ ...v, status: e.target.value }))}>
                <option value="taken">Taken</option>
                <option value="skipped">Skipped</option>
              </select>
            </label>
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
      ) : logs.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div className="empty-state-icon"><Icons.Pill size={32} /></div>
          <div className="empty-state-text">No medication logs yet</div>
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
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Date / Time</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Medication</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Dose</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const sel = selected.has(log.id);
                const dt = log.takenAt ? new Date(log.takenAt) : null;
                return (
                  <tr key={log.id} onClick={() => toggle(log.id)}
                    style={{
                      cursor: 'pointer',
                      background: sel ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                    }}>
                    <td style={{ padding: '7px 10px' }}>
                      <input type="checkbox" checked={sel} onChange={() => {}}
                        onClick={e => { e.stopPropagation(); toggle(log.id); }} />
                    </td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }} className="mono">
                      {dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                      <span style={{ color: 'var(--muted)', marginLeft: 5 }}>
                        {dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </td>
                    <td style={{ padding: '7px 10px', fontWeight: 500 }}>{log.medicationName}</td>
                    <td style={{ padding: '7px 10px', color: 'var(--muted)' }} className="mono">{log.dose || '—'}</td>
                    <td style={{ padding: '7px 10px' }}>
                      <span style={{ color: STATUS_COLORS[log.status] ?? 'var(--muted)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'capitalize' }}>
                        {log.status ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 10px', color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.notes || ''}
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Medications() {
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const [tab, setTab] = useState('today');
  const [medications, setMedications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [editingMed, setEditingMed] = useState(null);

  const fetchMeds = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await api.get('/medications', accessToken);
      setMedications(data);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchMeds(); }, [fetchMeds]);

  const handleDelete = async (med) => {
    const ok = await confirm({
      title: 'Remove medication?',
      message: `Remove "${med.name}" from your medications?`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete(`/medications/${med.id}`, accessToken);
      fetchMeds();
    } catch {
      notify('Failed to remove medication.', 'error');
    }
  };

  const handleToggleQuickAction = async (med) => {
    await api.put(`/medications/${med.id}`, { quickAction: !med.quickAction }, accessToken);
    fetchMeds();
  };

  const activeMeds = medications.filter(m => m.active);
  const inactiveMeds = medications.filter(m => !m.active);
  const displayed = filter === 'active' ? activeMeds : filter === 'inactive' ? inactiveMeds : medications;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Medications</div>
          <div className="text-muted text-sm mt-1">
            {activeMeds.length} active medication{activeMeds.length !== 1 ? 's' : ''}
          </div>
        </div>
        {tab === 'meds' && (
          <div className="page-actions">
            <button className="btn btn-sec btn-sm" onClick={() => setShowPhotoModal(true)}>
              <Icons.Camera size={13} /> From Photo
            </button>
            <button className="btn btn-pri btn-sm" onClick={() => { setEditingMed(null); setShowAddModal(true); }}>
              <Icons.Plus size={13} /> Add Medication
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {[
          { id: 'meds', icon: Icons.Pill, label: 'My Medications' },
          { id: 'today', icon: Icons.Calendar, label: "Today's Log" },
          { id: 'bundles', icon: Icons.Package, label: 'Bundles' },
          { id: 'interactions', icon: Icons.AlertTriangle, label: 'Interactions' },
          { id: 'advanced', icon: Icons.FileText, label: 'Advanced' },
        ].map(({ id, icon: Icon, label }) => (
          <button key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            {label}
          </button>
        ))}
      </div>

      {/* My Medications tab */}
      {tab === 'meds' && (
        <>
          {/* Filter strip */}
          <div className="flex items-center gap-2 mb-4">
            {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([val, label]) => (
              <button key={val} className={`btn btn-sm ${filter === val ? 'btn-pri' : 'btn-sec'}`} onClick={() => setFilter(val)}>
                {label}
                {val === 'active' && activeMeds.length > 0 && (
                  <span style={{ marginLeft: 5, background: 'rgba(255,255,255,0.2)', padding: '1px 5px', borderRadius: 10, fontSize: '0.6rem' }}>
                    {activeMeds.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="empty-state"><div className="text-muted">Loading…</div></div>
          ) : displayed.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 240 }}>
              <div className="empty-state-icon"><Icons.Pill size={32} /></div>
              <div className="empty-state-text">
                {filter === 'active' ? 'No active medications' : filter === 'inactive' ? 'No inactive medications' : 'No medications yet'}
              </div>
              <div className="empty-state-sub">
                {filter === 'active' && 'Click "Add Medication" to get started'}
              </div>
            </div>
          ) : (() => {
            const TYPE_ORDER = ['prescribed', 'otc', 'supplement', ''];
            const UNTYPED_CFG = { label: 'Other', color: 'var(--fg-muted)', bg: 'var(--bg-3)', border: 'var(--border)' };
            const groups = TYPE_ORDER
              .map(type => ({ type, meds: displayed.filter(m => (m.medType ?? '') === type) }))
              .filter(g => g.meds.length > 0);

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {groups.map(({ type, meds }) => {
                  const cfg = MED_TYPE_CFG[type] ?? UNTYPED_CFG;
                  const fullLabel = type === 'otc' ? 'Over the Counter' : cfg.label;
                  return (
                    <div key={type || 'other'}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
                        paddingBottom: 7, borderBottom: `2px solid ${cfg.color}`,
                      }}>
                        <span style={{
                          fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.07em',
                          textTransform: 'uppercase', color: cfg.color,
                        }}>
                          {fullLabel}
                        </span>
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 600, padding: '1px 7px',
                          borderRadius: 10, background: cfg.bg,
                          border: `1px solid ${cfg.border}`, color: cfg.color,
                        }}>
                          {meds.length}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {meds.map(med => (
                          <MedCard
                            key={med.id}
                            med={med}
                            onEdit={(m) => { setEditingMed(m); setShowAddModal(true); }}
                            onDelete={handleDelete}
                            onToggleQuickAction={handleToggleQuickAction}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {tab === 'today' && <TodayTab accessToken={accessToken} />}
      {tab === 'bundles' && <BundlesTab medications={activeMeds} accessToken={accessToken} />}
      {tab === 'interactions' && <InteractionsTab accessToken={accessToken} />}
      {tab === 'advanced' && <AdvancedMedTab accessToken={accessToken} />}

      {showAddModal && (
        <MedModal
          med={editingMed}
          accessToken={accessToken}
          onClose={() => { setShowAddModal(false); setEditingMed(null); }}
          onSaved={fetchMeds}
        />
      )}

      {showPhotoModal && (
        <MedPhotoModal
          accessToken={accessToken}
          onClose={() => setShowPhotoModal(false)}
          onSaved={fetchMeds}
        />
      )}
    </>
  );
}
