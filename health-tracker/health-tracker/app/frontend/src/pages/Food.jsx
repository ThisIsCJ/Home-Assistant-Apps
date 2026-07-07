import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';
import { useConfirm, useNotify } from '../components/AppFeedback';

const TODAY = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, not UTC
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function NutritionBadge({ n }) {
  return (
    <span className="mono text-xs text-muted">
      {n.calories?.toFixed(0)} kcal · P {n.proteinG?.toFixed(0)}g · C {n.carbsG?.toFixed(0)}g · F {n.fatG?.toFixed(0)}g
    </span>
  );
}

function LogEntryRow({ entry, onDelete, onEdit }) {
  const snap = entry.nutritionSnapshot ?? {};
  const logTime = entry.loggedAt
    ? new Date(entry.loggedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;
  const logDate = entry.loggedAt
    ? new Date(entry.loggedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;
  return (
    <div className="meal-entry">
      <div className="meal-entry-name">
        {entry.foodName}
        {entry.brand && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>{entry.brand}</span>}
        {entry.quantity !== 1 && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>×{entry.quantity}</span>}
      </div>
      <div className="meal-entry-detail">
        <NutritionBadge n={snap} />
        {logTime && (
          <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
            {logDate} · {logTime}
          </span>
        )}
      </div>
      <div className="meal-entry-actions">
        <button className="btn btn-ghost btn-xs" onClick={() => onEdit(entry)} title="Edit">
          <Icons.Edit size={11} />
        </button>
        <button className="btn btn-ghost btn-xs btn-danger" onClick={() => onDelete(entry.id)} title="Delete">
          <Icons.Trash size={11} />
        </button>
      </div>
    </div>
  );
}

// ── Edit food log modal ───────────────────────────────────────────────────────

function EditFoodLogModal({ entry, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const loggedAt = entry.loggedAt ? new Date(entry.loggedAt) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = loggedAt.toLocaleDateString('en-CA');
  const localTime = `${pad(loggedAt.getHours())}:${pad(loggedAt.getMinutes())}`;

  const [form, setForm] = useState({
    quantity: entry.quantity ?? 1,
    mealType: entry.mealType ?? 'other',
    date: localDate,
    time: localTime,
    notes: entry.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const origQty = entry.quantity ?? 1;
  const snap = entry.nutritionSnapshot ?? {};
  const newQty = parseFloat(form.quantity) || 1;
  const scaled = origQty > 0 ? {
    calories: ((snap.calories ?? 0) / origQty * newQty).toFixed(0),
    proteinG: ((snap.proteinG ?? 0) / origQty * newQty).toFixed(1),
    carbsG: ((snap.carbsG ?? 0) / origQty * newQty).toFixed(1),
    fatG: ((snap.fatG ?? 0) / origQty * newQty).toFixed(1),
  } : null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/food/logs/${entry.id}`, {
        quantity: newQty,
        mealType: form.mealType,
        loggedAt: new Date(`${form.date}T${form.time}:00`).toISOString(),
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
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">Edit Log — {entry.foodName}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Servings</label>
              <input type="number" className="input mono" min="0.1" step="0.5"
                value={form.quantity} onChange={e => set('quantity', e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Meal</label>
              <select className="input" value={form.mealType} onChange={e => set('mealType', e.target.value)}>
                {MEAL_TYPES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
              </select>
            </div>
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
          {scaled && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 14px' }}>
              <div className="text-xs text-muted mb-2" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
                Updated Nutrition ({form.quantity} serving{parseFloat(form.quantity) !== 1 ? 's' : ''})
              </div>
              <div className="macro-grid">
                <div className="macro-item"><div className="macro-name">Calories</div><div className="macro-val" style={{ color: 'var(--orange)' }}>{scaled.calories}</div></div>
                <div className="macro-item"><div className="macro-name">Protein</div><div className="macro-val protein">{scaled.proteinG}g</div></div>
                <div className="macro-item"><div className="macro-name">Carbs</div><div className="macro-val carbs">{scaled.carbsG}g</div></div>
              </div>
            </div>
          )}
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

// ── Food search dropdown (shared by LogModal and MealModal) ───────────────────

// meals prop: optional array — when provided, meals are shown in the dropdown
// alongside food items. Tag meal results with _isMeal:true via onSelect so
// the caller can handle them differently.
function FoodSearch({ accessToken, onSelect, placeholder = 'Search food…', autoFocus = false, meals = [] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    timer.current = setTimeout(() => {
      setSearching(true);
      api.get(`/food/items?q=${encodeURIComponent(query)}&limit=20`, accessToken)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => {
          setHasSearched(true);
          setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, accessToken]);

  const handleSelect = (item) => {
    onSelect(item);
    setQuery('');
    setResults([]);
    setHasSearched(false);
  };

  const q = query.trim().toLowerCase();
  const mealHits = q.length > 0
    ? meals.filter(m => m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)).slice(0, 5)
    : [];

  const hasAny = mealHits.length > 0 || results.length > 0;
  const showEmpty = q.length > 1 && hasSearched && !searching && !hasAny;

  return (
    <div style={{ position: 'relative' }}>
      <Icons.Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
      <input
        className="input"
        style={{ paddingLeft: 30 }}
        placeholder={placeholder}
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus={autoFocus}
      />
      {searching && (
        <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: '0.65rem', color: 'var(--muted)' }}>…</span>
      )}
      {hasAny && (
        <div className="search-results">
          {mealHits.length > 0 && (
            <>
              <div style={{ padding: '5px 10px 3px', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', background: 'var(--bg-2)' }}>
                Meals
              </div>
              {mealHits.map(meal => (
                <div key={meal.id} className="search-result-item"
                  onClick={() => handleSelect({ ...meal, _isMeal: true })}>
                  <div className="search-result-name">
                    <Icons.List size={11} style={{ marginRight: 5, opacity: 0.6, flexShrink: 0 }} />
                    {meal.name}
                  </div>
                  <div className="search-result-cals">
                    {meal.items?.length ?? 0} item{meal.items?.length !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
            </>
          )}
          {results.length > 0 && (
            <>
              {mealHits.length > 0 && (
                <div style={{ padding: '5px 10px 3px', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', background: 'var(--bg-2)' }}>
                  Foods
                </div>
              )}
              {results.map(item => (
                <div key={item.id} className="search-result-item" onClick={() => handleSelect(item)}>
                  <div className="search-result-name">
                    {item.name}
                    {item.brand && !item.brand.startsWith('http') && (
                      <span className="text-xs text-muted" style={{ marginLeft: 6 }}>{item.brand}</span>
                    )}
                  </div>
                  <div className="search-result-cals">{item.nutritionPerServing.calories} kcal / {item.servingSize.amount}{item.servingSize.unit}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {showEmpty && (
        <div className="search-results">
          <div className="search-empty">No results found.</div>
        </div>
      )}
    </div>
  );
}

// ── Log Food modal ────────────────────────────────────────────────────────────

function LogModal({ onClose, onLogged, accessToken, defaultMealType, defaultDate, preSelected }) {
  const notify = useNotify();
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();

  const [selected, setSelected]           = useState(preSelected ?? null); // food item
  const [selectedMeal, setSelectedMeal]   = useState(null);               // meal template
  const [allMeals, setAllMeals]           = useState([]);
  const [mealFoodItems, setMealFoodItems] = useState([]);                 // enriched items for selected meal
  const [mealExpanded, setMealExpanded]   = useState(false);
  const [quantity, setQuantity]           = useState(1);
  const [mealType, setMealType]           = useState(defaultMealType ?? 'other');
  const [date, setDate]                   = useState(defaultDate ?? TODAY);
  const [time, setTime]                   = useState(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
  const [saving, setSaving]               = useState(false);

  useEffect(() => {
    api.get('/food/meals', accessToken).then(setAllMeals).catch(() => {});
  }, [accessToken]);

  // Fetch food items for the selected meal so we can show nutrition totals
  useEffect(() => {
    if (!selectedMeal?.items?.length) { setMealFoodItems([]); return; }
    Promise.all(
      selectedMeal.items.map(item =>
        api.get(`/food/items/${item.foodItemId}`, accessToken).catch(() => null)
      )
    ).then(foods => {
      setMealFoodItems(selectedMeal.items.map((item, i) => ({ ...item, _food: foods[i] })));
      setMealExpanded(false);
    });
  }, [selectedMeal, accessToken]);

  const mealTotals = mealFoodItems.reduce((acc, item) => {
    if (!item._food) return acc;
    const n = item._food.nutritionPerServing;
    const q = item.quantity || 1;
    return {
      calories: acc.calories + (n.calories || 0) * q,
      proteinG: acc.proteinG + (n.proteinG || 0) * q,
      carbsG:   acc.carbsG   + (n.carbsG   || 0) * q,
      fatG:     acc.fatG     + (n.fatG     || 0) * q,
    };
  }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  const hasMealNutrition = mealTotals.calories > 0 || mealTotals.proteinG > 0;

  const handleSearchSelect = (item) => {
    if (item._isMeal) {
      setSelectedMeal(item);
      setSelected(null);
    } else {
      setSelected(item);
      setSelectedMeal(null);
    }
  };

  const handleLogFood = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.post('/food/logs', {
        foodItemId: selected.id,
        quantity,
        mealType,
        loggedAt: new Date(`${date}T${time}:00`).toISOString(),
      }, accessToken);
      onLogged();
      onClose();
    } catch {
      notify('Failed to log food. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLogMeal = async () => {
    if (!selectedMeal) return;
    setSaving(true);
    try {
      await api.post(`/food/meals/${selectedMeal.id}/log`, {}, accessToken);
      onLogged();
      onClose();
    } catch {
      notify('Failed to log meal. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const n = selected ? {
    calories: (selected.nutritionPerServing.calories * quantity).toFixed(0),
    proteinG: (selected.nutritionPerServing.proteinG * quantity).toFixed(1),
    carbsG: (selected.nutritionPerServing.carbsG * quantity).toFixed(1),
    fatG: (selected.nutritionPerServing.fatG * quantity).toFixed(1),
  } : null;

  const canLog = selected || (selectedMeal && selectedMeal.items?.length > 0);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Log Food</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div className="input-group mb-3">
          <label className="input-label">Search Food or Meal</label>
          <FoodSearch
            accessToken={accessToken}
            onSelect={handleSearchSelect}
            placeholder="e.g. Chicken breast, Morning Oats…"
            autoFocus
            meals={allMeals}
          />
        </div>

        {/* Meal selected */}
        {selectedMeal && (
          <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '10px 12px', marginBottom: 14 }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Icons.List size={13} style={{ color: 'var(--accent2)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: '0.82rem', flex: 1 }}>{selectedMeal.name}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setSelectedMeal(null)}>Change</button>
            </div>

            {selectedMeal.items?.length > 0 ? (
              <>
                {/* Nutrition totals */}
                {hasMealNutrition && (
                  <div className="macro-grid" style={{ marginBottom: 8 }}>
                    <div className="macro-item">
                      <div className="macro-name">Calories</div>
                      <div className="macro-val" style={{ color: 'var(--orange)' }}>{mealTotals.calories.toFixed(0)}</div>
                    </div>
                    <div className="macro-item">
                      <div className="macro-name">Protein</div>
                      <div className="macro-val protein">{mealTotals.proteinG.toFixed(1)}g</div>
                    </div>
                    <div className="macro-item">
                      <div className="macro-name">Carbs</div>
                      <div className="macro-val carbs">{mealTotals.carbsG.toFixed(1)}g</div>
                    </div>
                    <div className="macro-item">
                      <div className="macro-name">Fat</div>
                      <div className="macro-val">{mealTotals.fatG.toFixed(1)}g</div>
                    </div>
                  </div>
                )}

                {/* Expand toggle */}
                <button
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--muted)', padding: '2px 0' }}
                  onClick={() => setMealExpanded(e => !e)}
                >
                  <Icons.ChevronDown size={11} style={{ transition: 'transform 0.2s', transform: mealExpanded ? 'rotate(180deg)' : 'none' }} />
                  {mealExpanded ? 'Hide foods' : `Show ${selectedMeal.items.length} food${selectedMeal.items.length !== 1 ? 's' : ''}`}
                </button>

                {/* Expanded food list */}
                {mealExpanded && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {mealFoodItems.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: '0.74rem', padding: '3px 0', borderTop: '1px solid var(--border)' }}>
                        <span style={{ flex: 1, color: 'var(--fg)' }}>
                          {item.foodName ?? item.foodItemId}
                          {item.quantity !== 1 && <span className="text-muted" style={{ marginLeft: 4 }}>×{item.quantity}</span>}
                        </span>
                        {item._food && (
                          <span className="mono text-muted" style={{ fontSize: '0.68rem', flexShrink: 0 }}>
                            {((item._food.nutritionPerServing.calories || 0) * (item.quantity || 1)).toFixed(0)} kcal
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted" style={{ fontStyle: 'italic' }}>This meal has no items — add some in the Meals tab first.</div>
            )}
          </div>
        )}

        {/* Food item selected */}
        {selected && (
          <>
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: '0.78rem', flex: 1 }}>{selected.name}</span>
                <button className="btn btn-ghost btn-xs" onClick={() => setSelected(null)}>Change</button>
              </div>
              <div className="text-xs text-muted mt-1">
                Per {selected.servingSize.amount}{selected.servingSize.unit}: {selected.nutritionPerServing.calories} kcal · P {selected.nutritionPerServing.proteinG}g · C {selected.nutritionPerServing.carbsG}g · F {selected.nutritionPerServing.fatG}g
              </div>
            </div>

            <div className="grid-2 mb-3">
              <div className="input-group">
                <label className="input-label">Servings</label>
                <input type="number" className="input mono" min="0.1" step="0.5" value={quantity}
                  onChange={e => setQuantity(parseFloat(e.target.value) || 1)} />
              </div>
              <div className="input-group">
                <label className="input-label">Meal</label>
                <select className="input" value={mealType} onChange={e => setMealType(e.target.value)}>
                  {MEAL_TYPES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                </select>
              </div>
            </div>

            <div className="grid-2 mb-3">
              <div className="input-group">
                <label className="input-label">Date</label>
                <input type="date" className="input mono" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">Time</label>
                <input type="time" className="input mono" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>

            {n && (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 14px', marginBottom: 14 }}>
                <div className="text-xs text-muted mb-2" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Nutrition ({quantity} serving{quantity !== 1 ? 's' : ''})</div>
                <div className="macro-grid">
                  <div className="macro-item"><div className="macro-name">Calories</div><div className="macro-val" style={{ color: 'var(--orange)' }}>{n.calories}</div></div>
                  <div className="macro-item"><div className="macro-name">Protein</div><div className="macro-val protein">{n.proteinG}g</div></div>
                  <div className="macro-item"><div className="macro-name">Carbs</div><div className="macro-val carbs">{n.carbsG}g</div></div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri"
            onClick={selectedMeal ? handleLogMeal : handleLogFood}
            disabled={!canLog || saving}>
            {saving ? 'Logging…' : selectedMeal ? 'Log Meal' : 'Log Food'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Food item modal (create + edit) ──────────────────────────────────────────

function FoodItemModal({ item, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: item?.name ?? '',
    brand: item?.brand ?? '',
    servingAmount: item?.servingSize?.amount ?? 100,
    servingUnit: item?.servingSize?.unit ?? 'g',
    calories: item?.nutritionPerServing?.calories ?? 0,
    proteinG: item?.nutritionPerServing?.proteinG ?? 0,
    carbsG: item?.nutritionPerServing?.carbsG ?? 0,
    fatG: item?.nutritionPerServing?.fatG ?? 0,
    fiberG: item?.nutritionPerServing?.fiberG ?? 0,
    sugarG: item?.nutritionPerServing?.sugarG ?? 0,
    sodiumMg: item?.nutritionPerServing?.sodiumMg ?? 0,
  });
  const [customNutrition, setCustomNutrition] = useState(item?.customNutrition ?? {});
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: '' }));
  };

  useEffect(() => {
    api.get('/custom-fields?entity=food', accessToken)
      .then(setCustomFieldDefs)
      .catch(() => {});
  }, [accessToken]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      setErrors({ name: 'Food name is required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        brand: form.brand || null,
        servingSize: { amount: parseFloat(form.servingAmount), unit: form.servingUnit },
        nutritionPerServing: {
          calories: parseFloat(form.calories) || 0,
          proteinG: parseFloat(form.proteinG) || 0,
          carbsG: parseFloat(form.carbsG) || 0,
          fatG: parseFloat(form.fatG) || 0,
          fiberG: parseFloat(form.fiberG) || 0,
          sugarG: parseFloat(form.sugarG) || 0,
          sodiumMg: parseFloat(form.sodiumMg) || 0,
        },
        customNutrition,
      };
      if (isEdit) {
        await api.put(`/food/items/${item.id}`, payload, accessToken);
      } else {
        await api.post('/food/items', payload, accessToken);
      }
      onSaved();
      onClose();
    } catch {
      notify('Failed to save food item.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const numField = (label, key, unit = '') => (
    <div className="input-group">
      <label className="input-label">{label}{unit && ` (${unit})`}</label>
      <input type="number" className="input mono" min="0" step="any" value={form[key]}
        onChange={e => set(key, e.target.value)} />
    </div>
  );

  const nutritionCustomFields = customFieldDefs.filter(f => f.section === 'nutrition');
  const generalCustomFields = customFieldDefs.filter(f => f.section === 'general');

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Food' : 'Add Custom Food'}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div className="input-group mb-3">
          <label className="input-label">Food Name *</label>
          <input className={`input ${errors.name ? 'input-error' : ''}`} placeholder="e.g. Homemade Granola" value={form.name}
            onChange={e => set('name', e.target.value)} autoFocus />
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>
        <div className="input-group mb-3">
          <label className="input-label">Brand (optional)</label>
          <input className="input" placeholder="Brand name" value={form.brand}
            onChange={e => set('brand', e.target.value)} />
        </div>

        {/* General custom fields */}
        {generalCustomFields.map(f => (
          <div key={f.id} className="input-group mb-3">
            <label className="input-label">{f.name}{f.unit ? ` (${f.unit})` : ''}</label>
            <input className="input" value={customNutrition[f.fieldKey] ?? ''}
              onChange={e => setCustomNutrition(c => ({ ...c, [f.fieldKey]: e.target.value }))} />
          </div>
        ))}

        <div className="grid-2 mb-3">
          <div className="input-group">
            <label className="input-label">Serving Amount</label>
            <input type="number" className="input mono" value={form.servingAmount}
              onChange={e => set('servingAmount', e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">Unit</label>
            <select className="input" value={form.servingUnit} onChange={e => set('servingUnit', e.target.value)}>
              {['g', 'ml', 'oz', 'cup', 'tbsp', 'tsp', 'piece', 'serving'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
          {numField('Calories', 'calories', 'kcal')}
          {numField('Protein', 'proteinG', 'g')}
          {numField('Carbs', 'carbsG', 'g')}
          {numField('Fat', 'fatG', 'g')}
          {numField('Fiber', 'fiberG', 'g')}
          {numField('Sugar', 'sugarG', 'g')}
          {/* Custom nutrition fields */}
          {nutritionCustomFields.map(f => (
            <div key={f.id} className="input-group">
              <label className="input-label">{f.name}{f.unit ? ` (${f.unit})` : ''}</label>
              <input type="number" className="input mono" min="0" step="any"
                value={customNutrition[f.fieldKey] ?? ''}
                onChange={e => setCustomNutrition(c => ({ ...c, [f.fieldKey]: e.target.value === '' ? '' : parseFloat(e.target.value) }))} />
            </div>
          ))}
        </div>
        {numField('Sodium', 'sodiumMg', 'mg')}

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Food'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Meal modal (create + edit) ────────────────────────────────────────────────

function MealModal({ meal, onClose, onSaved, accessToken }) {
  const notify = useNotify();
  const isEdit = !!meal;
  const [name, setName] = useState(meal?.name ?? '');
  const [description, setDescription] = useState(meal?.description ?? '');
  const [mealType, setMealType] = useState(meal?.mealType ?? 'other');
  const [items, setItems] = useState(
    (meal?.items ?? []).map(i => ({ ...i, _food: null }))
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // Resolve food items for existing meal on open
  useEffect(() => {
    if (!meal?.items?.length) return;
    Promise.all(
      meal.items.map(i =>
        api.get(`/food/items/${i.foodItemId}`, accessToken).catch(() => null)
      )
    ).then(foods => {
      setItems(meal.items.map((i, idx) => ({ ...i, _food: foods[idx] })));
    });
  }, []);

  const addFood = (foodItem) => {
    if (items.find(i => i.foodItemId === foodItem.id)) return;
    setItems(prev => [...prev, { foodItemId: foodItem.id, quantity: 1, _food: foodItem }]);
  };

  const removeItem = (foodItemId) => setItems(prev => prev.filter(i => i.foodItemId !== foodItemId));

  const updateQty = (foodItemId, qty) =>
    setItems(prev => prev.map(i => i.foodItemId === foodItemId ? { ...i, quantity: qty } : i));

  const totalNutrition = items.reduce((acc, i) => {
    const n = i._food?.nutritionPerServing;
    if (!n) return acc;
    const q = i.quantity || 1;
    return {
      calories: acc.calories + n.calories * q,
      proteinG: acc.proteinG + n.proteinG * q,
      carbsG: acc.carbsG + n.carbsG * q,
      fatG: acc.fatG + n.fatG * q,
    };
  }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });

  const handleSave = async () => {
    if (!name.trim()) {
      setErrors({ name: 'Meal name is required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        description: description || null,
        mealType,
        items: items.map(i => ({ foodItemId: i.foodItemId, quantity: i.quantity, foodName: i._food?.name ?? null })),
      };
      if (isEdit) {
        await api.put(`/food/meals/${meal.id}`, payload, accessToken);
      } else {
        await api.post('/food/meals', payload, accessToken);
      }
      onSaved();
      onClose();
    } catch {
      notify('Failed to save meal.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const available = items.map(i => i.foodItemId);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Meal' : 'Create Meal'}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div className="grid-2 mb-3">
          <div className="input-group">
            <label className="input-label">Meal Name *</label>
            <input className={`input ${errors.name ? 'input-error' : ''}`} placeholder="e.g. Morning Oats" value={name}
              onChange={e => { setName(e.target.value); if (errors.name) setErrors({}); }} autoFocus />
            {errors.name && <div className="field-error">{errors.name}</div>}
          </div>
          <div className="input-group">
            <label className="input-label">Logs as</label>
            <select className="input" value={mealType} onChange={e => setMealType(e.target.value)}>
              {MEAL_TYPES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div className="input-group mb-3">
          <label className="input-label">Description (optional)</label>
          <input className="input" placeholder="Optional description" value={description}
            onChange={e => setDescription(e.target.value)} />
        </div>

        <div className="input-group mb-3">
          <label className="input-label">Add Food to Meal</label>
          <FoodSearch
            accessToken={accessToken}
            onSelect={addFood}
            placeholder="Search and select food…"
          />
        </div>

        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            <div className="input-label" style={{ marginBottom: 2 }}>Meal Contents</div>
            {items.map(item => (
              <div key={item.foodItemId} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 7, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item._food?.name ?? item.foodItemId}
                  </div>
                  {item._food && (
                    <div className="text-xs text-muted mt-1">
                      {(item._food.nutritionPerServing.calories * item.quantity).toFixed(0)} kcal · P {(item._food.nutritionPerServing.proteinG * item.quantity).toFixed(0)}g
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <label className="input-label" style={{ marginBottom: 0 }}>×</label>
                  <input
                    type="number" className="input mono" min="0.1" step="0.5"
                    style={{ width: 64, padding: '4px 8px' }}
                    value={item.quantity}
                    onChange={e => updateQty(item.foodItemId, parseFloat(e.target.value) || 1)}
                  />
                  <button className="btn btn-ghost btn-xs btn-danger" onClick={() => removeItem(item.foodItemId)}>
                    <Icons.X size={11} />
                  </button>
                </div>
              </div>
            ))}
            {items.some(i => i._food) && (
              <div style={{ fontSize: '0.7rem', color: 'var(--muted2)', padding: '6px 2px', display: 'flex', gap: 16 }}>
                <span>Total: <strong>{totalNutrition.calories.toFixed(0)} kcal</strong></span>
                <span>P <strong>{totalNutrition.proteinG.toFixed(0)}g</strong></span>
                <span>C <strong>{totalNutrition.carbsG.toFixed(0)}g</strong></span>
                <span>F <strong>{totalNutrition.fatG.toFixed(0)}g</strong></span>
              </div>
            )}
          </div>
        )}

        {items.length === 0 && (
          <div className="empty-state" style={{ padding: '16px', minHeight: 'unset', marginBottom: 12 }}>
            <div className="empty-state-text" style={{ fontSize: '0.76rem' }}>No foods added yet</div>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Meal' : 'Create Meal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── USDA Import Modal ─────────────────────────────────────────────────────────

function USDAImportModal({ onClose, onImported, accessToken }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    setResults([]);
    setSelected(null);
    setError('');
    if (!query.trim() || query.trim().length < 2) return;
    timer.current = setTimeout(() => {
      setSearching(true);
      api.get(`/food/usda/search?q=${encodeURIComponent(query)}`, accessToken)
        .then(setResults)
        .catch(() => setError('Search failed. Check your API key or network.'))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer.current);
  }, [query, accessToken]);

  const handleImport = async () => {
    if (!selected) return;
    setImporting(true);
    setError('');
    try {
      const item = await api.post('/food/usda/import', { fdcId: selected.fdcId }, accessToken);
      setImported(true);
      onImported(item);
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e.detail || e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const n = selected?.nutrients;
  const serving = selected ? `${selected.servingSize ?? 100}${selected.servingSizeUnit ?? 'g'}` : null;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span className="modal-title">
            <Icons.Download size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Import from USDA FoodData Central
          </span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div className="input-group mb-3">
          <label className="input-label">Search USDA Database</label>
          <div style={{ position: 'relative' }}>
            <Icons.Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="e.g. chicken breast, greek yogurt, oats…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
            {searching && (
              <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: '0.65rem', color: 'var(--muted)' }}>Searching…</span>
            )}
          </div>
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: '0.75rem', marginBottom: 10 }}>{error}</div>}

        {/* Results list */}
        {results.length > 0 && !selected && (
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7, marginBottom: 14 }}>
            {results.map(item => (
              <div key={item.fdcId}
                className="search-result-item"
                onClick={() => setSelected(item)}
                style={{ borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="search-result-name" style={{ fontWeight: 600 }}>{item.name}</div>
                    {item.brand && <div className="text-xs text-muted">{item.brand}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                    <div className="search-result-cals">
                      {item.nutrients.calories?.toFixed(0) ?? '?'} kcal
                    </div>
                    {item.servingSize && (
                      <div className="text-xs text-muted">per {item.servingSize}{item.servingSizeUnit ?? 'g'}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Selected food preview */}
        {selected && (
          <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fg)', marginBottom: 2 }}>{selected.name}</div>
                {selected.brand && <div className="text-xs text-muted">{selected.brand}</div>}
                {serving && <div className="text-xs text-muted mt-1">Serving: {serving}</div>}
              </div>
              <button className="btn btn-ghost btn-xs" onClick={() => setSelected(null)} style={{ marginLeft: 8 }}>
                Change
              </button>
            </div>
            <div className="macro-grid">
              <div className="macro-item">
                <div className="macro-name">Calories</div>
                <div className="macro-val" style={{ color: 'var(--orange)' }}>{n.calories?.toFixed(0)}</div>
              </div>
              <div className="macro-item">
                <div className="macro-name">Protein</div>
                <div className="macro-val protein">{n.proteinG?.toFixed(1)}g</div>
              </div>
              <div className="macro-item">
                <div className="macro-name">Carbs</div>
                <div className="macro-val carbs">{n.carbsG?.toFixed(1)}g</div>
              </div>
              <div className="macro-item">
                <div className="macro-name">Fat</div>
                <div className="macro-val">{n.fatG?.toFixed(1)}g</div>
              </div>
            </div>
            {(n.fiberG > 0 || n.sodiumMg > 0) && (
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.7rem', color: 'var(--muted2)' }}>
                {n.fiberG > 0 && <span>Fiber: <strong>{n.fiberG?.toFixed(1)}g</strong></span>}
                {n.sugarG > 0 && <span>Sugar: <strong>{n.sugarG?.toFixed(1)}g</strong></span>}
                {n.sodiumMg > 0 && <span>Sodium: <strong>{n.sodiumMg?.toFixed(0)}mg</strong></span>}
              </div>
            )}
          </div>
        )}

        {imported && (
          <div style={{ color: 'var(--green2)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Icons.Check size={14} /> Imported successfully
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleImport}
            disabled={!selected || importing || imported}>
            {importing ? 'Importing…' : imported ? 'Imported!' : 'Import to My Foods'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Food detail popup ─────────────────────────────────────────────────────────

function FoodDetailModal({ item, onClose, onLog }) {
  const n = item.nutritionPerServing ?? {};
  const isUrl = (item.brand || '').startsWith('http');

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{item.name}</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        {/* Brand / source link */}
        {item.brand && (
          <div style={{ marginBottom: 10 }}>
            {isUrl
              ? <a href={item.brand} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.74rem', color: 'var(--accent2)', wordBreak: 'break-all' }}>
                  {item.brand}
                </a>
              : <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>{item.brand}</span>
            }
          </div>
        )}

        <div style={{ fontSize: '0.71rem', color: 'var(--muted)', marginBottom: 14 }}>
          Per serving: {item.servingSize?.amount} {item.servingSize?.unit}
          {item.estimated && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>(nutrition estimated)</span>}
        </div>

        {/* Nutrition facts */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
          <div className="macro-grid">
            <div className="macro-item">
              <div className="macro-name">Calories</div>
              <div className="macro-val" style={{ color: 'var(--orange)' }}>{(n.calories ?? 0).toFixed(0)}</div>
            </div>
            <div className="macro-item">
              <div className="macro-name">Protein</div>
              <div className="macro-val protein">{(n.proteinG ?? 0).toFixed(1)}g</div>
            </div>
            <div className="macro-item">
              <div className="macro-name">Carbs</div>
              <div className="macro-val carbs">{(n.carbsG ?? 0).toFixed(1)}g</div>
            </div>
            <div className="macro-item">
              <div className="macro-name">Fat</div>
              <div className="macro-val">{(n.fatG ?? 0).toFixed(1)}g</div>
            </div>
          </div>
          {(n.fiberG > 0 || n.sugarG > 0 || n.sodiumMg > 0) && (
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: '0.7rem', color: 'var(--muted2)', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              {n.fiberG > 0  && <span>Fiber <strong>{n.fiberG.toFixed(1)}g</strong></span>}
              {n.sugarG > 0  && <span>Sugar <strong>{n.sugarG.toFixed(1)}g</strong></span>}
              {n.sodiumMg > 0 && <span>Sodium <strong>{n.sodiumMg.toFixed(0)}mg</strong></span>}
            </div>
          )}
        </div>

        {/* Tags */}
        {item.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
            {item.tags.map(t => (
              <span key={t} style={{ fontSize: '0.64rem', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', color: 'var(--muted)' }}>{t}</span>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Close</button>
          <button className="btn btn-pri" onClick={onLog}>
            <Icons.Plus size={13} /> Log This Food
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Meal detail popup ─────────────────────────────────────────────────────────

function MealDetailModal({ meal, onClose, onLog, logging }) {
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div>
            <span className="modal-title">{meal.name}</span>
            {meal.mealType && (
              <span style={{ marginLeft: 8, fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 400, textTransform: 'capitalize' }}>{meal.mealType}</span>
            )}
          </div>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 20px' }}>
          {/* Description / ingredient list */}
          {meal.description && (
            <div style={{ fontSize: '0.76rem', color: 'var(--muted)', lineHeight: 1.7, marginBottom: 14, whiteSpace: 'pre-line' }}>
              {meal.description}
            </div>
          )}

          {/* Named food items (for locally-built meals) */}
          {meal.items?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginBottom: 8 }}>
                Contents
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {meal.items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ flex: 1 }}>{item.foodName || item.foodItemId}</span>
                    {item.quantity !== 1 && <span className="mono text-xs text-muted">×{item.quantity}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recipe source link */}
          {meal.cookbookSourceUrl && (
            <a href={meal.cookbookSourceUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.74rem', color: 'var(--accent2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              View original recipe ↗
            </a>
          )}
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-sec" onClick={onClose}>Close</button>
          {meal.items?.length > 0 && (
            <button className="btn btn-pri" onClick={onLog} disabled={logging}>
              {logging ? 'Logging…' : <><Icons.Check size={13} /> Log Meal</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Foods tab ─────────────────────────────────────────────────────────────────

function FoodsTab({ accessToken }) {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showUSDA, setShowUSDA] = useState(false);
  const [toggling, setToggling] = useState({});
  const [detailItem, setDetailItem] = useState(null);
  const [logItem, setLogItem] = useState(null);
  const timer = useRef(null);

  const search = useCallback(async (q) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100, scope: 'all' });
      if (q.trim()) params.set('q', q);
      const data = await api.get(`/food/items?${params}`, accessToken);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(query), query ? 300 : 0);
    return () => clearTimeout(timer.current);
  }, [query, search]);

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: 'Delete food',
      message: `Delete "${item.name}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await api.delete(`/food/items/${item.id}`, accessToken);
    search(query);
  };

  const handleToggleQuickAction = async (item) => {
    setToggling(t => ({ ...t, [item.id]: true }));
    try {
      await api.put(`/food/items/${item.id}`, { quickAction: !item.quickAction }, accessToken);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, quickAction: !i.quickAction } : i));
    } finally {
      setToggling(t => ({ ...t, [item.id]: false }));
    }
  };

  const SOURCE_FILTERS = ['all', 'cookbook', 'global', 'user'];
  const visibleItems = items.filter(item =>
    sourceFilter === 'all' ||
    (sourceFilter === 'cookbook' && item.source === 'cookbook') ||
    (sourceFilter === 'global'   && item.scope === 'global') ||
    (sourceFilter === 'user'     && item.scope === 'user' && item.source !== 'cookbook')
  );

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Icons.Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input className="input" style={{ paddingLeft: 30 }} placeholder="Search foods…"
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {SOURCE_FILTERS.map(f => (
            <button key={f} className={`btn btn-sm ${sourceFilter === f ? 'btn-pri' : 'btn-ghost'}`}
              onClick={() => setSourceFilter(f)} style={{ textTransform: 'capitalize', padding: '4px 10px' }}>
              {f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button className="btn btn-sec btn-sm" onClick={() => setShowUSDA(true)}>
            <Icons.Download size={13} /> Import
          </button>
          <button className="btn btn-pri btn-sm" onClick={() => { setEditing(null); setShowModal(true); }}>
            <Icons.Plus size={13} /> Add
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="text-muted">Loading…</div></div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div className="empty-state-icon"><Icons.Food size={32} /></div>
          <div className="empty-state-text">{query || sourceFilter !== 'all' ? 'No results' : 'No foods yet'}</div>
          {!query && sourceFilter === 'all' && <div className="empty-state-sub">Click "Add" to create a food entry</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleItems.map(item => {
            const n = item.nutritionPerServing;
            return (
              <div key={item.id} className="card" style={{ padding: '11px 14px', cursor: 'default' }}>
                <div className="flex justify-between items-center">
                  {/* Clickable info area */}
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setDetailItem(item)}>
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{item.name}</span>
                      {item.brand && !item.brand.startsWith('http') && (
                        <span className="text-xs text-muted">{item.brand}</span>
                      )}
                      {item.source === 'cookbook' && (
                        <span style={{ fontSize: '0.6rem', background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>cookbook</span>
                      )}
                    </div>
                    <div className="mt-1">
                      <span className="text-xs text-muted">Per {item.servingSize?.amount}{item.servingSize?.unit}: </span>
                      <NutritionBadge n={n} />
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1" style={{ flexShrink: 0, marginLeft: 8 }}>
                    <button className="btn btn-ghost btn-xs" title="Log this food"
                      onClick={e => { e.stopPropagation(); setLogItem(item); }}
                      style={{ color: 'var(--accent2)' }}>
                      <Icons.Plus size={12} />
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => handleToggleQuickAction(item)}
                      disabled={toggling[item.id]} title={item.quickAction ? 'Remove from quick actions' : 'Add to quick actions'}>
                      <Icons.Star size={12} style={{ fill: item.quickAction ? 'var(--accent)' : 'none', color: item.quickAction ? 'var(--accent)' : 'var(--muted)' }} />
                    </button>
                    {item.scope === 'user' && (
                      <>
                        <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(item); setShowModal(true); }} title="Edit">
                          <Icons.Edit size={12} />
                        </button>
                        <button className="btn btn-ghost btn-xs btn-danger" onClick={() => handleDelete(item)} title="Delete">
                          <Icons.Trash size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailItem && (
        <FoodDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onLog={() => { setLogItem(detailItem); setDetailItem(null); }}
        />
      )}

      {logItem && (
        <LogModal
          accessToken={accessToken}
          preSelected={logItem}
          onClose={() => setLogItem(null)}
          onLogged={() => { setLogItem(null); search(query); }}
        />
      )}

      {showModal && (
        <FoodItemModal
          item={editing}
          accessToken={accessToken}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={() => search(query)}
        />
      )}

      {showUSDA && (
        <USDAImportModal
          accessToken={accessToken}
          onClose={() => setShowUSDA(false)}
          onImported={() => search(query)}
        />
      )}
    </>
  );
}

// ── Meals tab ─────────────────────────────────────────────────────────────────

function MealsTab({ accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [logging, setLogging] = useState({});
  const [logResult, setLogResult] = useState({});
  const [detailMeal, setDetailMeal] = useState(null);

  const fetchMeals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/food/meals', accessToken);
      setMeals(data);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchMeals(); }, [fetchMeals]);

  const handleDelete = async (meal) => {
    const ok = await confirm({
      title: 'Delete meal',
      message: `Delete meal "${meal.name}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await api.delete(`/food/meals/${meal.id}`, accessToken);
    fetchMeals();
  };

  const handleToggleQuickAction = async (meal) => {
    await api.put(`/food/meals/${meal.id}`, { quickAction: !meal.quickAction }, accessToken);
    fetchMeals();
  };

  const handleLog = async (meal) => {
    setLogging(l => ({ ...l, [meal.id]: true }));
    setLogResult(r => ({ ...r, [meal.id]: null }));
    try {
      const res = await api.post(`/food/meals/${meal.id}/log`, {}, accessToken);
      setLogResult(r => ({ ...r, [meal.id]: res }));
      setTimeout(() => setLogResult(r => ({ ...r, [meal.id]: null })), 3000);
    } catch {
      notify('Failed to log meal.', 'error');
    } finally {
      setLogging(l => ({ ...l, [meal.id]: false }));
    }
  };

  const MEAL_TYPE_COLORS = {
    breakfast: 'var(--orange)', lunch: 'var(--accent2)', dinner: 'var(--purple)',
    snack: 'var(--green2)', other: 'var(--muted)',
  };

  const visibleMeals = meals.filter(m =>
    !query.trim() || m.name.toLowerCase().includes(query.toLowerCase()) ||
    (m.description || '').toLowerCase().includes(query.toLowerCase())
  );

  if (loading) return <div className="empty-state"><div className="text-muted">Loading…</div></div>;

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Icons.Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input className="input" style={{ paddingLeft: 30 }} placeholder="Search meals…"
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <button className="btn btn-pri btn-sm" onClick={() => { setEditing(null); setShowModal(true); }}>
          <Icons.Plus size={13} /> New Meal
        </button>
      </div>

      {visibleMeals.length === 0 && meals.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 200 }}>
          <div className="empty-state-icon"><Icons.Food size={32} /></div>
          <div className="empty-state-text">No meals yet</div>
          <div className="empty-state-sub">Create a meal to group foods you eat together regularly</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(query.trim() ? visibleMeals : meals).map(meal => {
            const res = logResult[meal.id];
            return (
              <div key={meal.id} className="card" style={{ cursor: 'default' }}>
                <div style={{ padding: '12px 14px' }}>
                  <div className="flex justify-between items-center mb-2">
                    {/* Clickable name/description */}
                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setDetailMeal(meal)}>
                      <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{meal.name}</span>
                        <span style={{ fontSize: '0.68rem', color: MEAL_TYPE_COLORS[meal.mealType] ?? 'var(--muted)', fontWeight: 600, textTransform: 'capitalize' }}>
                          {meal.mealType}
                        </span>
                        {meal.source === 'cookbook' && (
                          <span style={{ fontSize: '0.6rem', background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>cookbook</span>
                        )}
                      </div>
                      {meal.description && (
                        <div className="text-xs text-muted mt-1" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {meal.description}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 items-center" style={{ flexShrink: 0, marginLeft: 8 }}>
                      {res && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--green2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icons.Check size={11} /> {res.logged} logged
                        </span>
                      )}
                      {meal.items?.length > 0 && (
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--green2)' }}
                          onClick={() => handleLog(meal)}
                          disabled={logging[meal.id]}
                          title="Log all foods in this meal"
                        >
                          <Icons.Check size={12} />
                          {logging[meal.id] ? 'Logging…' : 'Log Now'}
                        </button>
                      )}
                      <button className="btn btn-ghost btn-xs" onClick={() => handleToggleQuickAction(meal)}
                        title={meal.quickAction ? 'Remove from quick actions' : 'Add to quick actions'}>
                        <Icons.Star size={12} style={{ fill: meal.quickAction ? 'var(--accent)' : 'none', color: meal.quickAction ? 'var(--accent)' : 'var(--muted)' }} />
                      </button>
                      <button className="btn btn-ghost btn-xs" onClick={() => { setEditing(meal); setShowModal(true); }}>
                        <Icons.Edit size={12} />
                      </button>
                      <button className="btn btn-ghost btn-xs btn-danger" onClick={() => handleDelete(meal)}>
                        <Icons.Trash size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Items preview */}
                  {meal.items?.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                      {meal.items.slice(0, 5).map((item, i) => (
                        <span key={i} style={{ fontSize: '0.68rem', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', color: 'var(--muted)' }}>
                          {item.foodName ?? item.foodItemId}{item.quantity !== 1 ? ` ×${item.quantity}` : ''}
                        </span>
                      ))}
                      {meal.items.length > 5 && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--muted)', padding: '2px 4px' }}>+{meal.items.length - 5} more</span>
                      )}
                    </div>
                  ) : !meal.description ? (
                    <span className="text-xs text-muted italic">No foods in this meal</span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {query.trim() && visibleMeals.length === 0 && (
            <div className="empty-state" style={{ minHeight: 100 }}>
              <div className="empty-state-text">No meals match "{query}"</div>
            </div>
          )}
        </div>
      )}

      {detailMeal && (
        <MealDetailModal
          meal={detailMeal}
          logging={logging[detailMeal.id]}
          onClose={() => setDetailMeal(null)}
          onLog={() => { handleLog(detailMeal); setDetailMeal(null); }}
        />
      )}

      {showModal && (
        <MealModal
          meal={editing}
          accessToken={accessToken}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={fetchMeals}
        />
      )}
    </>
  );
}

// ── Log tab (today's food diary) ──────────────────────────────────────────────

function LogTab({ accessToken }) {
  const confirm = useConfirm();
  const [date, setDate] = useState(TODAY);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState(false);
  const [activeMeal, setActiveMeal] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [calGoal, setCalGoal] = useState(2000);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/me', accessToken)
      .then(user => {
        const p = user?.preferences ?? {};
        if (p.caloriesPerDay) setCalGoal(p.caloriesPerDay);
      })
      .catch(() => {});
  }, [accessToken]);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const data = await api.get(`/food/summary?date=${date}&tz_offset=${tzOffset}`, accessToken);
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }, [accessToken, date]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const handleDelete = async (logId) => {
    const ok = await confirm({
      title: 'Remove food log',
      message: 'Remove this food log entry?',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.delete(`/food/logs/${logId}`, accessToken);
    fetchSummary();
  };

  const totals = summary?.totals ?? {};

  const hour = new Date().getHours();
  const defaultMealType = hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 19 ? 'dinner' : 'snack';

  const shiftDay = (delta) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  const isToday = date === TODAY;

  return (
    <>
      {/* Date + actions */}
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px' }} onClick={() => shiftDay(-1)}>
            <Icons.ChevronLeft size={13} />
          </button>
          <input type="date" className="input mono" style={{ width: 'auto' }} value={date} onChange={e => setDate(e.target.value)} />
          <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px' }} disabled={isToday} onClick={() => shiftDay(1)}>
            <Icons.ChevronRight size={13} />
          </button>
          {!isToday && (
            <button className="btn btn-sec btn-sm" onClick={() => setDate(TODAY)}>Today</button>
          )}
        </div>
        <button className="btn btn-pri btn-sm" onClick={() => { setActiveMeal(null); setShowLogModal(true); }}>
          <Icons.Plus size={13} /> Log Food
        </button>
      </div>

      {/* Nutrition summary */}
      <div className="kpi-grid mb-4">
        <div className="kpi">
          <div className="lbl">Calories</div>
          <div className="val" style={{ color: (totals.calories || 0) > calGoal ? 'var(--red)' : 'var(--accent2)' }}>
            {totals.calories?.toFixed(0) ?? 0}
          </div>
          <div className="sub">/ {calGoal} kcal</div>
        </div>
        <div className="kpi">
          <div className="lbl">Protein</div>
          <div className="val" style={{ color: 'var(--accent2)' }}>{totals.proteinG?.toFixed(0) ?? 0}<span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>g</span></div>
        </div>
        <div className="kpi">
          <div className="lbl">Carbs</div>
          <div className="val orange">{totals.carbsG?.toFixed(0) ?? 0}<span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>g</span></div>
        </div>
        <div className="kpi">
          <div className="lbl">Fat</div>
          <div className="val green">{totals.fatG?.toFixed(0) ?? 0}<span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>g</span></div>
        </div>
      </div>

      {/* Calorie progress */}
      <div className="card mb-4">
        <div className="card-body" style={{ padding: '12px 16px' }}>
          <div className="flex justify-between mb-2">
            <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Daily Calorie Goal</span>
            <span className="mono text-xs">{totals.calories?.toFixed(0) ?? 0} / {calGoal} kcal</span>
          </div>
          <div className="progress-bar" style={{ height: 8 }}>
            <div className={`progress-fill ${(totals.calories || 0) > calGoal ? 'red' : 'blue'}`}
              style={{ width: `${Math.min(100, ((totals.calories || 0) / calGoal) * 100)}%` }} />
          </div>
          <div className="macro-grid mt-3">
            <div className="macro-item">
              <div className="macro-name">Fiber</div>
              <div className="macro-val" style={{ color: 'var(--green2)', fontSize: '0.8rem' }}>{totals.fiberG?.toFixed(0) ?? 0}g</div>
            </div>
            <div className="macro-item">
              <div className="macro-name">Sugar</div>
              <div className="macro-val" style={{ color: 'var(--orange)', fontSize: '0.8rem' }}>{totals.sugarG?.toFixed(0) ?? 0}g</div>
            </div>
            <div className="macro-item">
              <div className="macro-name">Sodium</div>
              <div className="macro-val" style={{ color: 'var(--red)', fontSize: '0.8rem' }}>{totals.sodiumMg?.toFixed(0) ?? 0}mg</div>
            </div>
          </div>
        </div>
      </div>

      {/* Meal sections */}
      {loading ? (
        <div className="empty-state"><div className="text-muted">Loading…</div></div>
      ) : (
        MEAL_TYPES.map((meal) => {
          const entries = summary?.meals?.[meal] ?? [];
          const mealCals = entries.reduce((s, e) => s + (e.nutritionSnapshot?.calories ?? 0), 0);
          return (
            <div key={meal} className="meal-section">
              <div className="meal-header">
                <div className="meal-title">{meal.charAt(0).toUpperCase() + meal.slice(1)}</div>
                <div className="meal-cals">{mealCals.toFixed(0)} kcal</div>
                <button className="btn btn-ghost btn-xs" style={{ marginLeft: 8 }}
                  onClick={() => { setActiveMeal(meal); setShowLogModal(true); }}>
                  <Icons.Plus size={11} />
                </button>
              </div>
              <div className="meal-entries">
                {entries.length === 0
                  ? <div className="meal-entry-empty">No entries — click + to log</div>
                  : entries.map(e => <LogEntryRow key={e.id} entry={e} onDelete={handleDelete} onEdit={setEditingEntry} />)
                }
              </div>
            </div>
          );
        })
      )}

      {showLogModal && (
        <LogModal
          accessToken={accessToken}
          defaultMealType={activeMeal ?? defaultMealType}
          defaultDate={date}
          onClose={() => { setShowLogModal(false); setActiveMeal(null); }}
          onLogged={fetchSummary}
        />
      )}

      {editingEntry && (
        <EditFoodLogModal
          entry={editingEntry}
          accessToken={accessToken}
          onClose={() => setEditingEntry(null)}
          onSaved={() => { setEditingEntry(null); fetchSummary(); }}
        />
      )}
    </>
  );
}

// ── Weekly overview tab ───────────────────────────────────────────────────────

const METRIC_CFG = [
  { key: 'calories', goalKey: 'caloriesPerDay', label: 'Calories', unit: 'kcal', color: '#14b8a6' },
  { key: 'carbsG',   goalKey: 'carbsGPerDay',   label: 'Carbs',    unit: 'g',    color: '#a78bfa' },
  { key: 'proteinG', goalKey: 'proteinGPerDay',  label: 'Protein',  unit: 'g',    color: '#60a5fa' },
  { key: 'fatG',     goalKey: 'fatGPerDay',      label: 'Fat',      unit: 'g',    color: '#fb923c' },
];

function GroupedBarChart({ days, goals }) {
  const CW = 560, CH = 180;
  const pad = { top: 12, bottom: 28, left: 32, right: 8 };
  const innerW = CW - pad.left - pad.right;
  const innerH = CH - pad.top - pad.bottom;
  const groupW = innerW / 7;
  const barW = (groupW - 6) / 4;

  return (
    <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} style={{ display: 'block' }}>
      {[0.25, 0.5, 0.75, 1.0].map(pct => {
        const y = pad.top + innerH * (1 - pct);
        return (
          <g key={pct}>
            <line x1={pad.left} y1={y} x2={CW - pad.right} y2={y}
              stroke="var(--border)" strokeWidth="0.5"
              strokeDasharray={pct === 1.0 ? '4 2' : undefined} />
            <text x={pad.left - 4} y={y + 3} textAnchor="end" fontSize="7" fill="var(--muted)">
              {Math.round(pct * 100)}%
            </text>
          </g>
        );
      })}
      {days.map((day, di) => {
        const gx = pad.left + di * groupW + 3;
        return (
          <g key={day.date}>
            {METRIC_CFG.map((m, mi) => {
              const goal = goals[m.goalKey] || 1;
              const pct = Math.min(1.05, (day.totals[m.key] || 0) / goal);
              const bh = pct * innerH;
              return (
                <rect key={m.key}
                  x={gx + mi * barW} y={pad.top + innerH - bh}
                  width={barW - 1} height={bh}
                  fill={m.color} opacity="0.8" rx="1.5"
                />
              );
            })}
            <text x={pad.left + di * groupW + groupW / 2} y={CH - 6}
              textAnchor="middle" fontSize="8.5" fill="var(--muted)">{day.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ days, metricKey, goal, color }) {
  const CW = 560, CH = 110;
  const pad = { top: 10, bottom: 24, left: 38, right: 10 };
  const innerW = CW - pad.left - pad.right;
  const innerH = CH - pad.top - pad.bottom;
  const maxVal = Math.max(goal * 1.25, ...days.map(d => d.totals[metricKey] || 0), 1);

  const pts = days.map((d, i) => ({
    x: pad.left + (i / 6) * innerW,
    y: pad.top + innerH * (1 - (d.totals[metricKey] || 0) / maxVal),
    v: d.totals[metricKey] || 0,
  }));

  const linePts = pts.map(p => `${p.x},${p.y}`).join(' ');
  const areaPath = `M${pts[0].x},${pad.top + innerH} ${pts.map(p => `L${p.x},${p.y}`).join(' ')} L${pts[pts.length - 1].x},${pad.top + innerH} Z`;
  const goalY = pad.top + innerH * (1 - goal / maxVal);

  const yTicks = [0, 0.5, 1].map(pct => ({
    val: Math.round(maxVal * pct),
    y: pad.top + innerH * (1 - pct),
  }));

  return (
    <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} style={{ display: 'block' }}>
      {yTicks.map(t => (
        <g key={t.y}>
          <line x1={pad.left} y1={t.y} x2={CW - pad.right} y2={t.y}
            stroke="var(--border)" strokeWidth="0.5" />
          <text x={pad.left - 4} y={t.y + 3} textAnchor="end" fontSize="7" fill="var(--muted)">{t.val}</text>
        </g>
      ))}
      <line x1={pad.left} y1={goalY} x2={CW - pad.right} y2={goalY}
        stroke={color} strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
      <path d={areaPath} fill={color} opacity="0.1" />
      <polyline points={linePts} fill="none" stroke={color} strokeWidth="2" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
      ))}
      {days.map((d, i) => {
        if (i !== 0 && i !== 3 && i !== 6) return null;
        return (
          <text key={i} x={pts[i].x} y={CH - 4}
            textAnchor="middle" fontSize="8" fill="var(--muted)">{d.label}</text>
        );
      })}
    </svg>
  );
}

function WeeklyTab({ accessToken }) {
  const getMonday = () => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().slice(0, 10);
  };

  const [weekStart, setWeekStart] = useState(getMonday);
  const [data, setData] = useState(null);
  const [goals, setGoals] = useState({ caloriesPerDay: 2000, proteinGPerDay: 150, carbsGPerDay: 275, fatGPerDay: 73 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const tzOffset = new Date().getTimezoneOffset();
    Promise.all([
      api.get(`/food/weekly?week_start=${weekStart}&tz_offset=${tzOffset}`, accessToken),
      api.get('/me', accessToken),
    ]).then(([weekly, user]) => {
      setData(weekly);
      const p = user?.preferences ?? {};
      setGoals({
        caloriesPerDay: p.caloriesPerDay || 2000,
        proteinGPerDay: p.proteinGPerDay || 150,
        carbsGPerDay: p.carbsGPerDay || 275,
        fatGPerDay: p.fatGPerDay || 73,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [accessToken, weekStart]);

  const shiftWeek = (delta) => {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  const currentWeek = weekStart === getMonday();

  if (loading) return <div className="empty-state"><div className="text-muted">Loading…</div></div>;
  if (!data) return null;

  const days = data.days;
  const avg = data.weeklyAvg;

  const weekEnd = new Date(weekStart + 'T12:00:00');
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekLabel = `${new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <>
      {/* Week navigation */}
      <div className="flex items-center gap-3 mb-4">
        <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px' }} onClick={() => shiftWeek(-1)}>
          <Icons.ChevronLeft size={13} />
        </button>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--fg)' }}>{weekLabel}</span>
        <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px' }} disabled={currentWeek} onClick={() => shiftWeek(1)}>
          <Icons.ChevronRight size={13} />
        </button>
        {!currentWeek && (
          <button className="btn btn-sec btn-sm" onClick={() => setWeekStart(getMonday())}>This week</button>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
        {METRIC_CFG.map(m => (
          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: 'var(--muted2)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: m.color, display: 'inline-block' }} />
            {m.label}
          </div>
        ))}
      </div>

      {/* Grouped bar chart */}
      <div className="card mb-4">
        <div className="card-header">
          <div className="card-title">Weekly Intake Overview</div>
          <span className="text-xs text-muted">% of daily goal</span>
        </div>
        <div className="card-body" style={{ padding: '8px 4px 4px' }}>
          <GroupedBarChart days={days} goals={goals} />
        </div>
      </div>

      {/* Data table */}
      <div className="card mb-4" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Metric</th>
              <th style={{ padding: '8px 8px', color: 'var(--muted)', fontWeight: 600 }}>Target</th>
              {days.map(d => (
                <th key={d.date} style={{ padding: '8px 6px', color: 'var(--muted)', fontWeight: 600, textAlign: 'center' }}>{d.label}</th>
              ))}
              <th style={{ padding: '8px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Avg</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_CFG.map(m => (
              <tr key={m.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{m.label}</span>
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'center', color: 'var(--muted)' }} className="mono">
                  {goals[m.goalKey]}{m.key === 'calories' ? '' : ' g'}
                </td>
                {days.map(d => {
                  const val = d.totals[m.key] || 0;
                  const goal = goals[m.goalKey] || 1;
                  const over = val > goal * 1.05;
                  return (
                    <td key={d.date} style={{ padding: '7px 6px', textAlign: 'center', color: over ? 'var(--red)' : 'var(--fg)', fontWeight: over ? 600 : 400 }} className="mono">
                      {m.key === 'calories' ? Math.round(val) : val.toFixed(1)}
                    </td>
                  );
                })}
                <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--accent2)' }} className="mono">
                  {m.key === 'calories' ? Math.round(avg[m.key]) : avg[m.key]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Line charts */}
      {METRIC_CFG.filter(m => m.key !== 'calories').map(m => (
        <div key={m.key} className="card mb-4">
          <div className="card-header">
            <div className="card-title" style={{ color: m.color }}>{m.label}</div>
            <span className="text-xs text-muted">goal: {goals[m.goalKey]}{m.unit}</span>
          </div>
          <div className="card-body" style={{ padding: '8px 4px 4px' }}>
            <LineChart days={days} metricKey={m.key} goal={goals[m.goalKey] || 1} color={m.color} />
          </div>
        </div>
      ))}
    </>
  );
}

// ── Food Plan tab ─────────────────────────────────────────────────────────────

function AddPlanModal({ date, accessToken, onClose, onSaved }) {
  const notify = useNotify();
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [mealType, setMealType] = useState('lunch');
  const [plannedDate, setPlannedDate] = useState(date);
  const [plannedTime, setPlannedTime] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 30);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!query.trim()) { setResults([]); return; }
    timer.current = setTimeout(() => {
      setSearching(true);
      api.get(`/food/items?q=${encodeURIComponent(query)}&limit=20`, accessToken)
        .then(setResults).catch(() => {}).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, accessToken]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.post('/food-plans', {
        foodItemId: selected.id,
        quantity,
        mealType,
        plannedDate,
        plannedTime,
      }, accessToken);
      onSaved();
      onClose();
    } catch {
      notify('Failed to add to plan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const n = selected ? {
    calories: (selected.nutritionPerServing.calories * quantity).toFixed(0),
    proteinG: (selected.nutritionPerServing.proteinG * quantity).toFixed(1),
    carbsG: (selected.nutritionPerServing.carbsG * quantity).toFixed(1),
    fatG: (selected.nutritionPerServing.fatG * quantity).toFixed(1),
  } : null;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <span className="modal-title"><Icons.ClipboardList size={14} style={{ marginRight: 6 }} />Plan a Meal</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Food search */}
          <div className="input-group">
            <label className="input-label">Search Food</label>
            <div style={{ position: 'relative' }}>
              <Icons.Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
              <input className="input" style={{ paddingLeft: 30 }} placeholder="Search food…"
                value={query} onChange={e => setQuery(e.target.value)} autoFocus />
              {searching && <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: '0.65rem', color: 'var(--muted)' }}>…</span>}
              {results.length > 0 && (
                <div className="search-results">
                  {results.map(item => (
                    <div key={item.id} className="search-result-item"
                      onClick={() => { setSelected(item); setQuery(item.name); setResults([]); }}>
                      <div className="search-result-name">{item.name}{item.brand && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>{item.brand}</span>}</div>
                      <div className="search-result-cals">{item.nutritionPerServing.calories} kcal</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {selected && (
            <>
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
              {n && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px', display: 'flex', gap: 16 }}>
                  {[['Cal', n.calories, 'kcal'], ['P', n.proteinG, 'g'], ['C', n.carbsG, 'g'], ['F', n.fatG, 'g']].map(([l, v, u]) => (
                    <div key={l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase' }}>{l}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{v}<span style={{ fontSize: '0.58rem', color: 'var(--muted)' }}>{u}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label">Date</label>
              <input type="date" className="input mono" value={plannedDate}
                onChange={e => setPlannedDate(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Time</label>
              <input type="time" className="input mono" value={plannedTime}
                onChange={e => setPlannedTime(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave} disabled={!selected || saving}>
            {saving ? 'Saving…' : 'Add to Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_CFG = {
  pending: { label: 'Planned', color: 'var(--muted)', bg: 'var(--bg3)' },
  logged:  { label: 'Eaten ✓', color: 'var(--green2)', bg: 'rgba(16,185,129,0.1)' },
  skipped: { label: 'Skipped', color: 'var(--red)', bg: 'rgba(239,68,68,0.08)' },
};

function PlanTab({ accessToken }) {
  const confirm = useConfirm();
  const [date, setDate] = useState(TODAY);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [logging, setLogging] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/food-plans?date=${date}`, accessToken);
      setPlans(data);
    } finally {
      setLoading(false);
    }
  }, [accessToken, date]);

  useEffect(() => { load(); }, [load]);

  const shiftDay = (delta) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  const handleLog = async (plan) => {
    setLogging(l => ({ ...l, [plan.id]: true }));
    try {
      await api.post(`/food-plans/${plan.id}/log`, {}, accessToken);
      setPlans(ps => ps.map(p => p.id === plan.id ? { ...p, status: 'logged' } : p));
    } finally {
      setLogging(l => ({ ...l, [plan.id]: false }));
    }
  };

  const handleSkip = async (plan) => {
    await api.post(`/food-plans/${plan.id}/skip`, {}, accessToken);
    setPlans(ps => ps.map(p => p.id === plan.id ? { ...p, status: 'skipped' } : p));
  };

  const handleDelete = async (plan) => {
    const ok = await confirm({
      title: 'Remove planned meal',
      message: 'Remove this planned meal?',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.delete(`/food-plans/${plan.id}`, accessToken);
    setPlans(ps => ps.filter(p => p.id !== plan.id));
  };

  const isToday = date === TODAY;
  const groupedByMeal = MEAL_TYPES.reduce((acc, m) => {
    acc[m] = plans.filter(p => p.mealType === m);
    return acc;
  }, {});

  // Total planned nutrition for the day
  const totals = plans.reduce((acc, p) => {
    const n = p.nutritionPerServing || {};
    const q = p.quantity || 1;
    acc.calories += (n.calories || 0) * q;
    acc.proteinG += (n.proteinG || 0) * q;
    acc.carbsG += (n.carbsG || 0) * q;
    acc.fatG += (n.fatG || 0) * q;
    return acc;
  }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });

  return (
    <>
      {/* Date nav */}
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px' }} onClick={() => shiftDay(-1)}>
            <Icons.ChevronLeft size={13} />
          </button>
          <input type="date" className="input mono" style={{ width: 'auto' }} value={date}
            onChange={e => setDate(e.target.value)} />
          <button className="btn btn-sec btn-sm" style={{ padding: '4px 8px' }} disabled={isToday} onClick={() => shiftDay(1)}>
            <Icons.ChevronRight size={13} />
          </button>
          {!isToday && <button className="btn btn-sec btn-sm" onClick={() => setDate(TODAY)}>Today</button>}
        </div>
        <button className="btn btn-pri btn-sm" onClick={() => setShowAdd(true)}>
          <Icons.Plus size={13} /> Plan Meal
        </button>
      </div>

      {/* Day summary */}
      {plans.length > 0 && (
        <div className="kpi-grid mb-4">
          <div className="kpi"><div className="lbl">Planned Cal</div><div className="val">{totals.calories.toFixed(0)}</div></div>
          <div className="kpi"><div className="lbl">Protein</div><div className="val" style={{ color: 'var(--accent2)' }}>{totals.proteinG.toFixed(0)}<span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>g</span></div></div>
          <div className="kpi"><div className="lbl">Carbs</div><div className="val orange">{totals.carbsG.toFixed(0)}<span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>g</span></div></div>
          <div className="kpi"><div className="lbl">Fat</div><div className="val green">{totals.fatG.toFixed(0)}<span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>g</span></div></div>
        </div>
      )}

      {/* Meal sections */}
      {loading ? (
        <div className="empty-state"><div className="text-muted">Loading…</div></div>
      ) : plans.length === 0 ? (
        <div className="empty-state">
          <Icons.ClipboardList size={32} style={{ opacity: 0.2, marginBottom: 10 }} />
          <div className="empty-state-text">No meals planned for this day</div>
          <button className="btn btn-pri btn-sm" style={{ marginTop: 10 }} onClick={() => setShowAdd(true)}>
            <Icons.Plus size={12} /> Plan a meal
          </button>
        </div>
      ) : (
        MEAL_TYPES.map(meal => {
          const entries = groupedByMeal[meal];
          if (!entries.length) return null;
          const mealCals = entries.reduce((s, p) => s + ((p.nutritionPerServing?.calories || 0) * (p.quantity || 1)), 0);
          return (
            <div key={meal} className="meal-section">
              <div className="meal-header">
                <div className="meal-title">{meal.charAt(0).toUpperCase() + meal.slice(1)}</div>
                <div className="meal-cals">{mealCals.toFixed(0)} kcal planned</div>
              </div>
              <div className="meal-entries">
                {entries.map(p => {
                  const sc = STATUS_CFG[p.status] || STATUS_CFG.pending;
                  const n = p.nutritionPerServing || {};
                  const q = p.quantity || 1;
                  return (
                    <div key={p.id} className="meal-entry" style={{ opacity: p.status === 'skipped' ? 0.55 : 1 }}>
                      <div className="meal-entry-name">
                        {p.foodName}
                        {q !== 1 && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>×{q}</span>}
                      </div>
                      <div className="meal-entry-detail">
                        <span className="mono text-xs text-muted">
                          {((n.calories || 0) * q).toFixed(0)} kcal
                        </span>
                        <span style={{ fontSize: '0.62rem', color: 'var(--muted)', marginLeft: 6 }}>{p.plannedTime}</span>
                        <span style={{ marginLeft: 8, fontSize: '0.62rem', fontWeight: 600, color: sc.color, background: sc.bg, padding: '1px 6px', borderRadius: 4 }}>{sc.label}</span>
                      </div>
                      <div className="meal-entry-actions">
                        {p.status === 'pending' && (
                          <>
                            <button className="btn btn-ghost btn-xs" style={{ color: 'var(--green2)' }}
                              onClick={() => handleLog(p)} disabled={logging[p.id]} title="Log as eaten">
                              <Icons.Check size={11} />
                            </button>
                            <button className="btn btn-ghost btn-xs btn-danger"
                              onClick={() => handleSkip(p)} title="Skip">
                              <Icons.X size={11} />
                            </button>
                          </>
                        )}
                        <button className="btn btn-ghost btn-xs btn-danger"
                          onClick={() => handleDelete(p)} title="Delete">
                          <Icons.Trash size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {showAdd && (
        <AddPlanModal
          date={date}
          accessToken={accessToken}
          onClose={() => setShowAdd(false)}
          onSaved={load}
        />
      )}
    </>
  );
}

// ── Advanced Edit tab (food logs history) ────────────────────────────────────

function AdvancedFoodTab({ accessToken }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [limit, setLimit] = useState(25);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enable, setEnable] = useState({ mealType: false, date: false, notes: false });
  const [bulk, setBulk] = useState({ mealType: 'breakfast', date: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const data = await api.get(`/food/logs?limit=${limit}`, accessToken);
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
  const anyEnabled = enable.mealType || enable.date || enable.notes;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(logs.map(l => l.id)));

  const handleApply = async () => {
    if (!anyEnabled) return;
    setApplying(true);
    try {
      await Promise.all([...selected].map(id => {
        const updates = {};
        if (enable.mealType) updates.mealType = bulk.mealType;
        if (enable.notes) updates.notes = bulk.notes || null;
        if (enable.date && bulk.date) {
          const log = logs.find(l => l.id === id);
          const origTime = log?.loggedAt
            ? new Date(log.loggedAt).toTimeString().slice(0, 5)
            : '00:00';
          updates.loggedAt = new Date(`${bulk.date}T${origTime}:00`).toISOString();
        }
        return Object.keys(updates).length > 0
          ? api.put(`/food/logs/${id}`, updates, accessToken)
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
      title: 'Delete food logs',
      message: `Delete ${selected.size} food log entr${selected.size !== 1 ? 'ies' : 'y'}?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await Promise.all([...selected].map(id => api.delete(`/food/logs/${id}`, accessToken)));
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
            Bulk Edit — {selected.size} {selected.size === 1 ? 'entry' : 'entries'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={enable.mealType}
                onChange={e => setEnable(v => ({ ...v, mealType: e.target.checked }))} />
              <span style={{ color: 'var(--muted2)' }}>Meal type:</span>
              <select className="input" style={{ width: 'auto', padding: '4px 8px' }} disabled={!enable.mealType}
                value={bulk.mealType} onChange={e => setBulk(v => ({ ...v, mealType: e.target.value }))}>
                {MEAL_TYPES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
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
          <div className="empty-state-icon"><Icons.Food size={32} /></div>
          <div className="empty-state-text">No food logs yet</div>
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
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Food</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Meal</th>
                <th style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>Qty</th>
                <th style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>Kcal</th>
                <th style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>Protein</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const sel = selected.has(log.id);
                const dt = log.loggedAt ? new Date(log.loggedAt) : null;
                const snap = log.nutritionSnapshot ?? {};
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
                    <td style={{ padding: '7px 10px', fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.foodName}
                      {log.brand && <span style={{ color: 'var(--muted)', marginLeft: 5, fontWeight: 400, fontSize: '0.7rem' }}>{log.brand}</span>}
                    </td>
                    <td style={{ padding: '7px 10px', textTransform: 'capitalize' }}>{log.mealType}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }} className="mono">{log.quantity}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }} className="mono">{snap.calories?.toFixed(0) ?? '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }} className="mono">
                      {snap.proteinG != null ? `${snap.proteinG.toFixed(0)}g` : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

export default function Food() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState('log');

  const TABS = [
    { id: 'log', icon: Icons.Calendar, label: 'Log' },
    { id: 'plan', icon: Icons.ClipboardList, label: 'Plan' },
    { id: 'weekly', icon: Icons.BarChart, label: 'Weekly' },
    { id: 'foods', icon: Icons.Food, label: 'Foods' },
    { id: 'meals', icon: Icons.List, label: 'Meals' },
    { id: 'advanced', icon: Icons.FileText, label: 'Advanced' },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Food & Nutrition</div>
          <div className="text-muted text-sm mt-1">Track daily intake, manage your food library, and build meal templates</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'log' && <LogTab accessToken={accessToken} />}
      {tab === 'plan' && <PlanTab accessToken={accessToken} />}
      {tab === 'weekly' && <WeeklyTab accessToken={accessToken} />}
      {tab === 'foods' && <FoodsTab accessToken={accessToken} />}
      {tab === 'meals' && <MealsTab accessToken={accessToken} />}
      {tab === 'advanced' && <AdvancedFoodTab accessToken={accessToken} />}
    </>
  );
}
