import { useState, useEffect, useRef } from 'react';
import { Icons } from './Icons';
import api from '../lib/api';
import { useNotify } from './AppFeedback';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

function CombinedSearch({ accessToken, onSelect, autoFocus = false }) {
  const [query, setQuery] = useState('');
  const [foodResults, setFoodResults] = useState([]);
  const [mealResults, setMealResults] = useState([]);
  const [allMeals, setAllMeals] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const timer = useRef(null);

  // Load all meals once
  useEffect(() => {
    if (!accessToken) return;
    api.get('/food/meals', accessToken).then(setAllMeals).catch(() => {});
  }, [accessToken]);

  // Debounced search for food items + filter meals
  useEffect(() => {
    clearTimeout(timer.current);
    if (!query.trim()) {
      setFoodResults([]);
      setMealResults([]);
      setHasSearched(false);
      return;
    }
    const q = query.toLowerCase();

    // Filter meals client-side immediately
    setMealResults(allMeals.filter(m => m.name.toLowerCase().includes(q)));

    // Fetch food items from server
    timer.current = setTimeout(() => {
      setSearching(true);
      api.get(`/food/items?q=${encodeURIComponent(query)}&limit=20`, accessToken)
        .then(setFoodResults)
        .catch(() => setFoodResults([]))
        .finally(() => {
          setHasSearched(true);
          setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, accessToken, allMeals]);

  const handleSelect = (item) => {
    onSelect(item);
    setQuery('');
    setFoodResults([]);
    setMealResults([]);
    setHasSearched(false);
  };

  const hasResults = foodResults.length > 0 || mealResults.length > 0;
  const showEmpty = query.trim().length > 1 && hasSearched && !searching && !hasResults;

  return (
    <div style={{ position: 'relative' }}>
      <Icons.Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
      <input
        className="input"
        style={{ paddingLeft: 30 }}
        placeholder="Search food or meals…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus={autoFocus}
      />
      {searching && (
        <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: '0.65rem', color: 'var(--muted)' }}>…</span>
      )}
      {hasResults && (
        <div className="search-results">
          {mealResults.length > 0 && (
            <>
              <div style={{ padding: '5px 10px 3px', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', background: 'var(--bg3)' }}>
                Meals
              </div>
              {mealResults.map(meal => (
                <div key={meal.id} className="search-result-item" onClick={() => handleSelect({ ...meal, _type: 'meal' })}>
                  <div className="search-result-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icons.List size={11} style={{ color: 'var(--accent2)', flexShrink: 0 }} />
                    {meal.name}
                    {meal.description && <span className="text-xs text-muted" style={{ marginLeft: 4 }}>{meal.description}</span>}
                  </div>
                  <div className="search-result-cals">
                    {meal.items?.length ?? 0} item{meal.items?.length !== 1 ? 's' : ''}
                    {meal.mealType && meal.mealType !== 'other' && <span style={{ marginLeft: 6, textTransform: 'capitalize' }}>{meal.mealType}</span>}
                  </div>
                </div>
              ))}
            </>
          )}
          {foodResults.length > 0 && (
            <>
              {mealResults.length > 0 && (
                <div style={{ padding: '5px 10px 3px', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', background: 'var(--bg3)' }}>
                  Foods
                </div>
              )}
              {foodResults.map(item => (
                <div key={item.id} className="search-result-item" onClick={() => handleSelect({ ...item, _type: 'item' })}>
                  <div className="search-result-name">
                    {item.name}
                    {item.brand && <span className="text-xs text-muted" style={{ marginLeft: 6 }}>{item.brand}</span>}
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

export default function LogFoodModal({ onClose, onLogged, accessToken }) {
  const notify = useNotify();
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const hour = now.getHours();
  const defaultMeal = hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 19 ? 'dinner' : 'snack';

  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [mealType, setMealType] = useState(defaultMeal);
  const [date, setDate] = useState(now.toLocaleDateString('en-CA'));
  const [time, setTime] = useState(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
  const [saving, setSaving] = useState(false);

  const isMeal = selected?._type === 'meal';

  const handleLog = async () => {
    if (!selected) return;
    setSaving(true);
    const loggedAt = new Date(`${date}T${time}:00`).toISOString();
    try {
      if (isMeal) {
        await api.post(`/food/meals/${selected.id}/log`, { loggedAt, mealType }, accessToken);
      } else {
        await api.post('/food/logs', {
          foodItemId: selected.id,
          quantity,
          mealType,
          loggedAt,
        }, accessToken);
      }
      onLogged?.();
      onClose();
    } catch {
      notify('Failed to log. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const n = selected && !isMeal ? {
    calories: (selected.nutritionPerServing.calories * quantity).toFixed(0),
    proteinG: (selected.nutritionPerServing.proteinG * quantity).toFixed(1),
    carbsG: (selected.nutritionPerServing.carbsG * quantity).toFixed(1),
    fatG: (selected.nutritionPerServing.fatG * quantity).toFixed(1),
  } : null;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Log Food</span>
          <button className="modal-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>

        <div className="input-group mb-3">
          <label className="input-label">Search Food or Meal</label>
          <CombinedSearch accessToken={accessToken} onSelect={setSelected} autoFocus />
        </div>

        {selected && (
          <>
            {isMeal ? (
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '10px 12px', marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Icons.List size={14} style={{ color: 'var(--accent2)', marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>{selected.name}</div>
                  <div className="text-xs text-muted mt-1">
                    {selected.items?.length ?? 0} item{selected.items?.length !== 1 ? 's' : ''} — all will be logged at once
                    {selected.description && <span style={{ marginLeft: 6 }}>{selected.description}</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '10px 12px', marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: '0.78rem' }}>{selected.name}</div>
                <div className="text-xs text-muted mt-1">
                  Per {selected.servingSize.amount}{selected.servingSize.unit}: {selected.nutritionPerServing.calories} kcal · P {selected.nutritionPerServing.proteinG}g · C {selected.nutritionPerServing.carbsG}g · F {selected.nutritionPerServing.fatG}g
                </div>
              </div>
            )}

            <div className="grid-2 mb-3">
              {!isMeal && (
                <div className="input-group">
                  <label className="input-label">Servings</label>
                  <input type="number" className="input mono" min="0.1" step="0.5" value={quantity}
                    onChange={e => setQuantity(parseFloat(e.target.value) || 1)} />
                </div>
              )}
              <div className="input-group" style={isMeal ? { gridColumn: '1 / -1' } : {}}>
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
          <button className="btn btn-pri" onClick={handleLog} disabled={!selected || saving}>
            {saving ? 'Logging…' : isMeal ? 'Log Meal' : 'Log Food'}
          </button>
        </div>
      </div>
    </div>
  );
}
