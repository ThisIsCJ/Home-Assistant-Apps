import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ImageInput } from '../components/ImageInput';
import { Icons } from '../components/Icons';
import { api } from '../lib/api';
import { getViewerKey, useCookbookRecipeQuery, useCookbookRecipesQuery } from '../lib/appQueries';
import { getEnv } from '../lib/env';
import { queryKeys } from '../lib/queryKeys';

const EMPTY_RECIPE = {
  title: '',
  description: '',
  sourceUrl: '',
  imageUrl: '',
  prepTime: '',
  cookTime: '',
  totalTime: '',
  servings: '',
  categories: [],
  tags: [],
  ingredients: [{ amount: '', measurement: '', ingredient: '' }],
  nutritionFacts: [],
  steps: [{ text: '', imageUrl: '' }],
  notes: '',
  ownerId: '',
  ownerName: '',
  canEdit: true,
  ratingAverage: 0,
  ratingCount: 0,
  reviews: [],
};
const EMPTY_RECIPES = [];

export function Cookbook({ accessToken, user, dbUser, siteConfig }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { recipeId } = useParams();
  const [activeRecipe, setActiveRecipe] = useState(EMPTY_RECIPE);
  const [saving, setSaving] = useState(false);
  const [editingDetail, setEditingDetail] = useState(false);
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  const searchParams = new URLSearchParams(location.search);
  const searchQuery = searchParams.get('q') || '';
  const activeCategory = searchParams.get('category') || '';
  const mode = useMemo(() => {
    if (location.pathname === '/cookbook/import') return 'import';
    if (location.pathname === '/cookbook/new') return 'new';
    if (recipeId) return 'detail';
    return 'landing';
  }, [location.pathname, recipeId]);
  const viewerKey = getViewerKey(user);
  const recipesQuery = useCookbookRecipesQuery({ accessToken, viewerKey });
  const recipeQuery = useCookbookRecipeQuery({
    accessToken,
    viewerKey,
    recipeId,
    enabled: mode === 'detail',
  });
  const recipes = recipesQuery.data?.recipes ?? EMPTY_RECIPES;
  const cookbookCategories = useMemo(
    () => getCookbookCategories(siteConfig?.cookbookCategories, recipes),
    [siteConfig?.cookbookCategories, recipes]
  );
  const siteLabel = useMemo(() => {
    const configured = siteConfig?.siteName || getEnv('ORG_NAME') || getEnv('APP_NAME');
    if (configured) return configured.toLowerCase();
    const host = window.location.hostname.split('.')[0] || 'atlas';
    return host.toLowerCase();
  }, [siteConfig?.siteName]);
  const listLoading = Boolean(accessToken && !recipesQuery.isFetched && !recipesQuery.isError);
  const listError = recipesQuery.error?.message || '';
  const recipeLoading = mode === 'detail'
    ? Boolean(accessToken && recipeId && !recipeQuery.isFetched && !recipeQuery.isError)
    : false;
  const [recipeError, setRecipeError] = useState('');
  const visibleRecipeError = recipeError || recipeQuery.error?.message || '';

  useEffect(() => {
    if (mode === 'new') {
      setActiveRecipe(normalizeRecipeForForm(location.state?.seed || EMPTY_RECIPE, true));
      setEditingDetail(true);
      setRecipeError('');
      return;
    }

    if (!accessToken || !recipeId) return;
    setRecipeError('');
    if (recipeQuery.data?.recipe) {
      setActiveRecipe(normalizeRecipeForForm(recipeQuery.data.recipe, false));
      setEditingDetail(false);
    }
  }, [accessToken, recipeId, mode, location.state, recipeQuery.data]);

  useEffect(() => {
    const detail = mode === 'detail'
      ? [
          { label: siteLabel, path: '/' },
          { label: 'cookbook', path: '/cookbook' },
          { label: 'recipes', path: '/cookbook' },
          { label: activeRecipe.title || 'Untitled recipe', path: recipeId ? `/cookbook/${recipeId}` : '/cookbook' },
        ]
      : null;

    window.dispatchEvent(new CustomEvent('atlas:set-breadcrumbs', { detail }));

    return () => {
      window.dispatchEvent(new CustomEvent('atlas:set-breadcrumbs', { detail: null }));
    };
  }, [mode, siteLabel, activeRecipe.title, recipeId]);

  const categoryCards = useMemo(() => buildCategoryCards(recipes, cookbookCategories), [recipes, cookbookCategories]);
  const filteredRecipes = useMemo(
    () => filterRecipes(recipes, { query: searchQuery, category: activeCategory }),
    [recipes, searchQuery, activeCategory]
  );

  const saveRecipe = async () => {
    setSaving(true);
    setRecipeError('');

    try {
      const payload = {
        ...activeRecipe,
        categories: normalizeTags(activeRecipe.categories),
        tags: normalizeTags(activeRecipe.tags),
        ingredients: normalizeIngredients(activeRecipe.ingredients),
        nutritionFacts: normalizeStringList(activeRecipe.nutritionFacts),
        steps: normalizeSteps(activeRecipe.steps),
      };

      const res = recipeId
        ? await api.put(`/cookbook/recipes/${recipeId}`, payload, accessToken)
        : await api.post('/cookbook/recipes', payload, accessToken);

      const recipe = normalizeRecipeForForm(res.recipe, false);
      upsertCookbookRecipe(queryClient, viewerKey, recipe);
      setActiveRecipe(recipe);
      setEditingDetail(false);

      if (!recipeId) navigate(`/cookbook/${recipe.id}`);
    } catch (err) {
      setRecipeError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecipe = async () => {
    if (!recipeId || !activeRecipe.canEdit) return;
    if (!window.confirm('Delete this recipe?')) return;

    setRecipeError('');
    try {
      await api.delete(`/cookbook/recipes/${recipeId}`, accessToken);
      removeCookbookRecipe(queryClient, viewerKey, recipeId);
      navigate('/cookbook');
    } catch (err) {
      setRecipeError(err.message);
    }
  };

  const scrapeRecipe = async () => {
    if (!scrapeUrl.trim()) return;

    setScraping(true);
    setScrapeError('');
    try {
      const res = await api.post('/cookbook/scrape', { url: scrapeUrl }, accessToken);
      navigate('/cookbook/new', { state: { seed: res.recipe || EMPTY_RECIPE } });
    } catch (err) {
      setScrapeError(err.message);
    } finally {
      setScraping(false);
    }
  };

  const syncRecipe = (recipe) => {
    const normalized = normalizeRecipeForForm(recipe, false);
    setActiveRecipe(normalized);
    upsertCookbookRecipe(queryClient, viewerKey, normalized);
  };

  const createReview = async ({ rating, comment }) => {
    if (!recipeId) return;
    setRecipeError('');

    try {
      const res = await api.post(`/cookbook/recipes/${recipeId}/reviews`, { rating, comment }, accessToken);
      if (res.recipe) syncRecipe(res.recipe);
    } catch (err) {
      setRecipeError(err.message);
    }
  };

  const updateReview = async (reviewId, { rating, comment }) => {
    if (!recipeId) return;
    setRecipeError('');

    try {
      const res = await api.put(`/cookbook/recipes/${recipeId}/reviews/${reviewId}`, { rating, comment }, accessToken);
      if (res.recipe) syncRecipe(res.recipe);
    } catch (err) {
      setRecipeError(err.message);
    }
  };

  const deleteReview = async (reviewId) => {
    if (!recipeId) return;
    if (!window.confirm('Delete this comment?')) return;
    setRecipeError('');

    try {
      const res = await api.delete(`/cookbook/recipes/${recipeId}/reviews/${reviewId}`, accessToken);
      if (res.recipe) syncRecipe(res.recipe);
    } catch (err) {
      setRecipeError(err.message);
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Cookbook</h1>
        </div>
        <div className="page__actions">
          <Link className="btn" to="/cookbook/import"><Icons.Download size={14} /> Import URL</Link>
          <Link className="btn btn--primary" to="/cookbook/new"><Icons.Plus size={14} /> New recipe</Link>
        </div>
      </div>

      {mode === 'import' && (
        <div className="panel cookbook-import">
          <div className="panel__header">
            <div className="panel__title">Recipe scraper</div>
            <div className="panel__meta">Import title, image, ingredients, and steps from a recipe URL</div>
          </div>
          <div className="panel__body cookbook-import__body">
            <input
              className="input"
              style={{ width: '100%' }}
              placeholder="https://example.com/recipe"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={scrapeRecipe} disabled={scraping || !scrapeUrl.trim()}>
                {scraping ? 'Scraping…' : 'Import recipe'}
              </button>
              <Link className="btn" to="/cookbook/new">Skip and enter manually</Link>
            </div>
            {scrapeError && <div className="inline-alert inline-alert--error">{scrapeError}</div>}
          </div>
        </div>
      )}

      {mode === 'landing' ? (
        <CookbookLanding
          recipes={recipes}
          filteredRecipes={filteredRecipes}
          categoryCards={categoryCards}
          listLoading={listLoading}
          listError={listError}
          searchQuery={searchQuery}
          activeCategory={activeCategory}
          categoryOptions={cookbookCategories}
          onSearch={(value) => navigateToBrowse(navigate, { q: value, category: activeCategory })}
          onCategory={(value) => navigateToBrowse(navigate, { q: searchQuery, category: value })}
          onClear={() => navigate('/cookbook')}
        />
      ) : (
        <div className={`cookbook-layout ${mode === 'detail' ? 'cookbook-layout--detail' : ''}`}>
          <div className="panel">
            <div className="panel__header">
              <div className="panel__title">
                {mode === 'new' ? 'New recipe' : mode === 'detail' ? 'Recipe details' : 'Import recipe'}
              </div>
              <div className="panel__meta">
                {mode === 'new' ? 'draft' : recipeId ? 'shared recipe' : 'import'}
              </div>
            </div>
            <div className="panel__body">
              {mode === 'new' && (
                <RecipeEditor
                  recipe={activeRecipe}
                  accessToken={accessToken}
                  onChange={setActiveRecipe}
                  saving={saving}
                  loading={recipeLoading}
                  error={visibleRecipeError}
                  onSave={saveRecipe}
                  onDelete={deleteRecipe}
                  isNew
                  categoryOptions={cookbookCategories}
                />
              )}
              {mode === 'detail' && (
                editingDetail ? (
                  <RecipeEditor
                    recipe={activeRecipe}
                    accessToken={accessToken}
                    onChange={setActiveRecipe}
                    saving={saving}
                    loading={recipeLoading}
                    error={visibleRecipeError}
                    onSave={saveRecipe}
                    onDelete={deleteRecipe}
                    isNew={false}
                    categoryOptions={cookbookCategories}
                    onCancel={() => setEditingDetail(false)}
                  />
                ) : (
                  <RecipeDetail
                    recipe={activeRecipe}
                    loading={recipeLoading}
                    error={visibleRecipeError}
                    currentUserName={dbUser?.name || user?.name || user?.email || 'You'}
                    onEdit={() => setEditingDetail(true)}
                    onCreateReview={createReview}
                    onUpdateReview={updateReview}
                    onDeleteReview={deleteReview}
                  />
                )
              )}
              {mode === 'import' && (
                <div className="empty-inline">Paste a recipe URL above to import it, or choose a saved recipe from the list.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CookbookLanding({
  recipes,
  filteredRecipes,
  categoryCards,
  listLoading,
  listError,
  searchQuery,
  activeCategory,
  categoryOptions,
  onSearch,
  onCategory,
  onClear,
}) {
  return (
    <div className="cookbook-home">
      <div className="panel">
        <div className="panel__header">
          <div className="panel__title">Browse recipes</div>
          <div className="panel__meta">{listLoading ? 'loading' : `${recipes.length} shared recipes`}</div>
        </div>
        <div className="panel__body cookbook-home__search">
          <label className="field">
            <span className="field__label">Search</span>
            <input
              className="input"
              value={searchQuery}
              placeholder="Search by title, description, or ingredient"
              onChange={(e) => onSearch(e.target.value)}
            />
          </label>
          {(searchQuery || activeCategory) && (
            <div className="cookbook-home__filters">
              {activeCategory && <span className="pill pill--info">{activeCategory}</span>}
              {searchQuery && <span className="pill">"{searchQuery}"</span>}
              <button className="btn" onClick={onClear}>Clear filters</button>
            </div>
          )}
          {listError && <div className="inline-alert inline-alert--error">{listError}</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <div className="panel__title">Categories</div>
          <div className="panel__meta">{categoryCards.length} groups</div>
        </div>
        <div className="panel__body">
          <label className="field cookbook-categories-select">
            <span className="field__label">Category</span>
            <select
              className="input"
              value={activeCategory}
              onChange={(e) => onCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categoryCards.map((category) => (
                <option key={category.name} value={category.name}>
                  {category.name} ({category.count})
                </option>
              ))}
            </select>
          </label>

          <div className="cookbook-categories">
            {categoryCards.map((category) => (
              <button
                key={category.name}
                className={`cookbook-category ${activeCategory === category.name ? 'is-active' : ''}`}
                onClick={() => onCategory(category.name)}
              >
                <div className="cookbook-category__title">{category.name}</div>
                <div className="cookbook-category__meta">{category.count} recipes</div>
              </button>
            ))}
            {categoryOptions.length === 0 && (
              <div className="empty-inline">No categories configured yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <div className="panel__title">
            {searchQuery || activeCategory ? 'Matching recipes' : 'Recently added'}
          </div>
          <div className="panel__meta">{filteredRecipes.length} results</div>
        </div>
        <div className="panel__body cookbook-results">
          {!listLoading && filteredRecipes.length === 0 && (
            <div className="empty-inline">No recipes matched that filter.</div>
          )}
          {filteredRecipes.map((recipe) => (
            <Link key={recipe.id} className="cookbook-result" to={`/cookbook/${recipe.id}`}>
              {recipe.imageUrl ? (
                <img src={recipe.imageUrl} alt={recipe.title} className="cookbook-result__image" />
              ) : (
                <div className="cookbook-result__image cookbook-result__image--empty">No image</div>
              )}
              <div className="cookbook-result__body">
                <div className="cookbook-result__title">{recipe.title}</div>
                <div className="cookbook-list__meta">by {recipe.ownerName || 'Unknown user'}</div>
                <div className="cookbook-result__desc">{recipe.description || 'No description yet.'}</div>
                <div className="pill-list">
                  {(recipe.categories || []).slice(0, 2).map((category) => <span className="pill pill--info" key={category}>{category}</span>)}
                  {recipe.tags?.slice(0, 3).map((tag) => <span className="pill" key={tag}>{tag}</span>)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecipeEditor({ recipe, accessToken, onChange, saving, loading, error, onSave, onDelete, isNew, onCancel, categoryOptions = [] }) {
  const canEdit = true;
  const [openStepMedia, setOpenStepMedia] = useState({});
  const [tagDraft, setTagDraft] = useState('');
  const stepInputRefs = useRef([]);
  const baseServingsRef = useRef(parseServingsValue(recipe.servings));
  useEffect(() => {
    baseServingsRef.current = parseServingsValue(recipe.servings);
  }, [recipe.id, recipe.servings]);
  const set = (key, value) => onChange((prev) => ({ ...prev, [key]: value }));
  const handleServingsChange = (newValue) => {
    const newNumeric = parseServingsValue(newValue);
    const base = baseServingsRef.current;
    if (base && newNumeric && Math.abs(newNumeric / base - 1) > 0.001) {
      const scale = newNumeric / base;
      baseServingsRef.current = newNumeric;
      onChange((prev) => ({
        ...prev,
        servings: newValue,
        ingredients: (prev.ingredients || []).map((ing) => ({
          ...ing,
          amount: scaleIngredientAmount(ing.amount, scale),
        })),
      }));
    } else {
      set('servings', newValue);
      if (newNumeric) baseServingsRef.current = newNumeric;
    }
  };
  const setIngredient = (index, key, value) => onChange((prev) => ({
    ...prev,
    ingredients: prev.ingredients.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
  }));
  const addIngredient = () => onChange((prev) => ({
    ...prev,
    ingredients: [...prev.ingredients, { amount: '', measurement: '', ingredient: '' }],
  }));
  const removeIngredient = (index) => onChange((prev) => ({
    ...prev,
    ingredients: prev.ingredients.filter((_, itemIndex) => itemIndex !== index),
  }));

  const setStep = (index, key, value) => onChange((prev) => ({
    ...prev,
    steps: prev.steps.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
  }));
  const addStep = () => onChange((prev) => ({
    ...prev,
    steps: [...prev.steps, { text: '', imageUrl: '' }],
  }));
  const removeStep = (index) => onChange((prev) => ({
    ...prev,
    steps: prev.steps.filter((_, itemIndex) => itemIndex !== index),
  }));
  const toggleStepMedia = (index) => setOpenStepMedia((prev) => ({ ...prev, [index]: !prev[index] }));
  const addTag = (rawValue = tagDraft) => {
    const nextTag = `${rawValue || ''}`.trim();
    if (!nextTag) return;
    const existing = new Set((recipe.tags || []).map((tag) => tag.toLowerCase()));
    if (existing.has(nextTag.toLowerCase())) {
      setTagDraft('');
      return;
    }
    set('tags', [...(recipe.tags || []), nextTag]);
    setTagDraft('');
  };
  const removeTag = (tagToRemove) => {
    set('tags', (recipe.tags || []).filter((tag) => tag !== tagToRemove));
  };

  if (loading) return <div className="empty-inline">Loading recipe…</div>;

  return (
    <div className="cookbook-form">
      {error && <div className="inline-alert inline-alert--error">{error}</div>}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary" onClick={onSave} disabled={saving}>
            <Icons.Check size={13} /> {saving ? 'Saving…' : isNew ? 'Create recipe' : 'Save changes'}
          </button>
          {!isNew && onCancel && (
            <button className="btn" onClick={onCancel}>Cancel</button>
          )}
          {!isNew && (
            <button className="btn btn--danger" onClick={onDelete}>Delete recipe</button>
          )}
        </div>
      )}
      <div className="cookbook-form__hero">
        {recipe.imageUrl
          ? <img src={recipe.imageUrl} alt={recipe.title || 'Recipe'} className="cookbook-form__image" />
          : <div className="cookbook-form__image cookbook-form__image--empty">No image</div>
        }
        <div className="cookbook-form__hero-meta">
          {!isNew && (
            <div className="cookbook-owner mono subtle">Added by {recipe.ownerName || 'Unknown user'}</div>
          )}
          {canEdit ? (
            <ImageInput
              value={recipe.imageUrl || ''}
              onChange={(value) => set('imageUrl', value)}
              accessToken={accessToken}
              placeholder="https://example.com/food.jpg"
            />
          ) : null}
        </div>
      </div>

      <div className="cookbook-form__grid">
        <label className="field">
          <span className="field__label">Title</span>
          <input className="input" value={recipe.title || ''} onChange={(e) => set('title', e.target.value)} disabled={!canEdit} />
        </label>

        <label className="field">
          <span className="field__label">Source URL</span>
          <input className="input" value={recipe.sourceUrl || ''} onChange={(e) => set('sourceUrl', e.target.value)} disabled={!canEdit} />
        </label>

        <label className="field">
          <span className="field__label">Servings</span>
          <input
            className="input"
            value={recipe.servings || ''}
            onChange={(e) => handleServingsChange(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Categories</span>
          <div className="cookbook-category-picker">
            {categoryOptions.map((category) => {
              const active = (recipe.categories || []).includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  className={`access-chip ${active ? 'is-active' : ''}`}
                  onClick={() => set('categories', active
                    ? (recipe.categories || []).filter((item) => item !== category)
                    : [...(recipe.categories || []), category])}
                >
                  <span>{category}</span>
                </button>
              );
            })}
          </div>
        </label>

        <label className="field">
          <span className="field__label">Tags</span>
          <div className="cookbook-tag-editor">
            <div className="pill-list">
              {(recipe.tags || []).map((tag) => (
                <span className="pill" key={tag}>
                  {tag}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: 0, minHeight: 'auto' }}
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove ${tag}`}
                  >
                    <Icons.X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag"
                disabled={!canEdit}
              />
              <button type="button" className="btn" onClick={() => addTag()} disabled={!canEdit || !tagDraft.trim()}>
                <Icons.Plus size={13} /> Add tag
              </button>
            </div>
          </div>
        </label>

        <label className="field">
          <span className="field__label">Prep time</span>
          <input className="input" value={recipe.prepTime || ''} onChange={(e) => set('prepTime', e.target.value)} disabled={!canEdit} />
        </label>

        <label className="field">
          <span className="field__label">Cook time</span>
          <input className="input" value={recipe.cookTime || ''} onChange={(e) => set('cookTime', e.target.value)} disabled={!canEdit} />
        </label>

        <label className="field">
          <span className="field__label">Total time</span>
          <input className="input" value={recipe.totalTime || ''} onChange={(e) => set('totalTime', e.target.value)} disabled={!canEdit} />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Description</span>
        <textarea className="textarea" rows="3" value={recipe.description || ''} onChange={(e) => set('description', e.target.value)} disabled={!canEdit} />
      </label>

      <div className="panel">
        <div className="panel__header">
          <div className="panel__title">Ingredients</div>
          {canEdit && <button className="btn" onClick={addIngredient}><Icons.Plus size={13} /> Add ingredient</button>}
        </div>
        <div className="panel__body cookbook-ingredients">
          {(recipe.ingredients || []).map((ingredient, index) => (
            <div className="cookbook-ingredient-row" key={`ingredient-${index}`}>
              <input
                className="input"
                placeholder="Amount"
                value={ingredient.amount || ''}
                onChange={(e) => setIngredient(index, 'amount', e.target.value)}
                disabled={!canEdit}
              />
              <input
                className="input"
                placeholder="Measurement"
                value={ingredient.measurement || ''}
                onChange={(e) => setIngredient(index, 'measurement', e.target.value)}
                disabled={!canEdit}
              />
              <input
                className="input"
                placeholder="Ingredient"
                value={ingredient.ingredient || ''}
                onChange={(e) => setIngredient(index, 'ingredient', e.target.value)}
                disabled={!canEdit}
              />
              {canEdit && (recipe.ingredients || []).length > 1 && (
                <button className="btn" onClick={() => removeIngredient(index)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field__label">Nutrition facts</span>
        <textarea
          className="textarea"
          rows="5"
          value={(recipe.nutritionFacts || []).join('\n')}
          onChange={(e) => set('nutritionFacts', e.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))}
          placeholder={'Calories: 420\nProtein: 18g\nCarbs: 51g'}
        />
      </label>

      <div className="panel">
        <div className="panel__header">
          <div className="panel__title">Steps</div>
          {canEdit && <button className="btn" onClick={addStep}><Icons.Plus size={13} /> Add step</button>}
        </div>
        <div className="panel__body cookbook-steps">
          {(recipe.steps || []).map((step, index) => (
            <div className="cookbook-step" key={`step-${index}`}>
              <div className="cookbook-step__header">
                <strong>Step {index + 1}</strong>
                {canEdit && (recipe.steps || []).length > 1 && (
                  <button className="btn" onClick={() => removeStep(index)}>Remove</button>
                )}
              </div>
              <textarea
                ref={(node) => {
                  stepInputRefs.current[index] = node;
                }}
                className="textarea"
                rows="4"
                placeholder="Describe this step. Markdown is supported."
                value={step.text || ''}
                onChange={(e) => setStep(index, 'text', e.target.value)}
                disabled={!canEdit}
              />
              <MarkdownToolbar
                onAction={(action) => applyMarkdownAction(stepInputRefs.current[index], action, (nextValue) => {
                  setStep(index, 'text', nextValue);
                })}
              />
              {canEdit && (
                <div className="cookbook-step__media-actions">
                  <button className="btn" onClick={() => toggleStepMedia(index)}>
                    {openStepMedia[index] || !step.imageUrl ? 'Edit step image' : 'Change step image'}
                  </button>
                </div>
              )}
              <div className="cookbook-step__preview">
                <div className="field__label">Preview</div>
                <div
                  className="rich-text cookbook-step__preview-body"
                  dangerouslySetInnerHTML={{ __html: renderRecipeMarkdown(step.text || 'No instruction provided.') }}
                />
              </div>
              {canEdit && (openStepMedia[index] || !step.imageUrl) ? (
                <ImageInput
                  value={step.imageUrl || ''}
                  onChange={(value) => setStep(index, 'imageUrl', value)}
                  accessToken={accessToken}
                  placeholder="https://example.com/step-image.jpg"
                />
              ) : null}
              {step.imageUrl && <img src={step.imageUrl} alt={`Step ${index + 1}`} className="cookbook-step__image" />}
            </div>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field__label">Notes</span>
        <textarea className="textarea" rows="5" value={recipe.notes || ''} onChange={(e) => set('notes', e.target.value)} disabled={!canEdit} />
      </label>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary" onClick={onSave} disabled={saving}>
            <Icons.Check size={13} /> {saving ? 'Saving…' : isNew ? 'Create recipe' : 'Save changes'}
          </button>
          {!isNew && onCancel && (
            <button className="btn" onClick={onCancel}>Cancel</button>
          )}
          {!isNew && (
            <button className="btn btn--danger" onClick={onDelete}>Delete recipe</button>
          )}
        </div>
      )}
    </div>
  );
}

function RecipeDetail({ recipe, loading, error, currentUserName, onEdit, onCreateReview, onUpdateReview, onDeleteReview }) {
  const [displayServings, setDisplayServings] = useState(recipe.servings || '');
  const [completedSteps, setCompletedSteps] = useState({});
  const [reviewDraft, setReviewDraft] = useState({ rating: 0, comment: '' });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState('');
  const [editingReviewDraft, setEditingReviewDraft] = useState({ rating: 0, comment: '' });
  const baseServings = useMemo(() => parseServingsValue(recipe.servings), [recipe.servings]);
  const desiredServings = useMemo(() => parseServingsValue(displayServings), [displayServings]);
  const ingredientScale = !baseServings || !desiredServings ? 1 : desiredServings / baseServings;

  useEffect(() => {
    setDisplayServings(recipe.servings || '');
    setCompletedSteps({});
    setEditingReviewId('');
  }, [recipe.id, recipe.servings]);

  if (loading) return <div className="empty-inline">Loading recipe…</div>;

  const submitReview = async () => {
    if (!reviewDraft.rating || !reviewDraft.comment.trim()) return;
    setSubmittingReview(true);
    await onCreateReview(reviewDraft);
    setSubmittingReview(false);
    setReviewDraft({ rating: 0, comment: '' });
  };

  const saveEditedReview = async () => {
    if (!editingReviewId || !editingReviewDraft.rating || !editingReviewDraft.comment.trim()) return;
    await onUpdateReview(editingReviewId, editingReviewDraft);
    setEditingReviewId('');
    setEditingReviewDraft({ rating: 0, comment: '' });
  };

  return (
    <div className="recipe-view">
      {error && <div className="inline-alert inline-alert--error">{error}</div>}

      <div className="recipe-view__hero">
        {recipe.imageUrl ? (
          <img className="recipe-view__image" src={recipe.imageUrl} alt={recipe.title || 'Recipe'} />
        ) : (
          <div className="recipe-view__image recipe-view__image--empty">No image</div>
        )}

        <div className="recipe-view__summary">
          <div className="recipe-view__summary-top">
            <div>
              <div className="cookbook-owner mono subtle">Added by {recipe.ownerName || 'Unknown user'}</div>
              <h2 className="recipe-view__title">{recipe.title || 'Untitled recipe'}</h2>
              <p className="recipe-view__description">{recipe.description || 'No description yet.'}</p>
            </div>
            {recipe.canEdit && (
              <button className="btn btn--primary" onClick={onEdit}>
                <Icons.Settings size={14} /> Edit recipe
              </button>
            )}
          </div>

          <div className="recipe-view__meta-grid">
            <RecipeMeta label="Servings">
              <input
                className="input recipe-view__servings-input"
                value={displayServings}
                onChange={(e) => setDisplayServings(e.target.value)}
              />
            </RecipeMeta>
            <RecipeMeta label="Prep time" value={formatRecipeTime(recipe.prepTime) || 'Not listed'} />
            <RecipeMeta label="Cook time" value={formatRecipeTime(recipe.cookTime) || 'Not listed'} />
            <RecipeMeta label="Total time" value={formatRecipeTime(recipe.totalTime) || 'Not listed'} />
            <RecipeMeta label="Source">
              {recipe.sourceUrl ? <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">{recipe.sourceUrl}</a> : 'Not listed'}
            </RecipeMeta>
            <RecipeMeta label="Rating">
              {recipe.ratingCount ? `${recipe.ratingAverage} / 5 from ${recipe.ratingCount} review${recipe.ratingCount === 1 ? '' : 's'}` : 'No ratings yet'}
            </RecipeMeta>
          </div>

          {(recipe.tags || []).length > 0 && (
            <div className="pill-list">
              {(recipe.categories || []).map((category) => <span className="pill pill--info" key={category}>{category}</span>)}
              {recipe.tags.map((tag) => <span className="pill" key={tag}>{tag}</span>)}
            </div>
          )}
          {(!recipe.tags || recipe.tags.length === 0) && (recipe.categories || []).length > 0 && (
            <div className="pill-list">
              {(recipe.categories || []).map((category) => <span className="pill pill--info" key={category}>{category}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="recipe-view__columns">
        <div className="panel">
          <div className="panel__header">
            <div className="panel__title">Ingredients</div>
            <div className="panel__meta">
              {baseServings && desiredServings && Math.abs(ingredientScale - 1) > 0.001
                ? `scaled from ${formatNumber(baseServings)} servings`
                : ''}
            </div>
          </div>
          <div className="panel__body recipe-view__ingredients">
            {(recipe.ingredients || []).map((ingredient, index) => (
              <div className="cookbook-ingredient-display" key={`ingredient-${index}`}>
                <span className="cookbook-ingredient-display__amount">
                  {formatIngredientQuantity(ingredient, ingredientScale)}
                </span>
                <span className="cookbook-ingredient-display__name">{ingredient.ingredient || ''}</span>
              </div>
            ))}
            {(recipe.ingredients || []).length === 0 && <div className="empty-inline">No ingredients listed.</div>}
          </div>

          <div className="panel__header">
            <div className="panel__title">Nutrition facts</div>
          </div>
          <div className="panel__body recipe-view__nutrition">
            {(recipe.nutritionFacts || []).length === 0 ? (
              <div className="empty-inline">No nutrition facts listed.</div>
            ) : (
              (recipe.nutritionFacts || []).map((fact, index) => (
                <div className="recipe-view__nutrition-item" key={`nutrition-${index}`}>{fact}</div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div className="panel__title">Instructions</div>
            <div className="panel__meta">click a number to mark a step done</div>
          </div>
          <div className="panel__body cookbook-steps">
            {(recipe.steps || []).map((step, index) => {
              const done = !!completedSteps[index];
              return (
                <div className={`recipe-view__step ${done ? 'is-complete' : ''}`} key={`step-${index}`}>
                  <button
                    className={`recipe-view__step-marker ${done ? 'is-complete' : ''}`}
                    onClick={() => setCompletedSteps((prev) => ({ ...prev, [index]: !prev[index] }))}
                    aria-label={done ? `Mark step ${index + 1} incomplete` : `Mark step ${index + 1} complete`}
                  >
                    {done ? <Icons.Check size={16} /> : <span>{index + 1}</span>}
                  </button>
                  <div className="recipe-view__step-content">
                    <div
                      className="recipe-view__step-text rich-text"
                      dangerouslySetInnerHTML={{ __html: renderRecipeMarkdown(step.text || 'No instruction provided.') }}
                    />
                    {step.imageUrl && <img src={step.imageUrl} alt={`Step ${index + 1}`} className="cookbook-step__image" />}
                  </div>
                </div>
              );
            })}
            {(recipe.steps || []).length === 0 && <div className="empty-inline">No steps listed.</div>}
          </div>
        </div>
      </div>

      {recipe.notes && (
        <div className="panel">
          <div className="panel__header">
            <div className="panel__title">Notes</div>
          </div>
          <div className="panel__body">
            <div className="recipe-view__notes">{recipe.notes}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel__header">
          <div className="panel__title">Ratings and comments</div>
          <div className="panel__meta">{recipe.ratingCount || 0} total</div>
        </div>
        <div className="panel__body recipe-view__reviews">
          <div className="recipe-review-form">
            <div className="recipe-review-form__title">Leave a review as {currentUserName}</div>
            <StarRatingInput value={reviewDraft.rating} onChange={(rating) => setReviewDraft((prev) => ({ ...prev, rating }))} />
            <textarea
              className="textarea"
              rows="4"
              placeholder="Share what worked well, what you changed, or tips for the next person."
              value={reviewDraft.comment}
              onChange={(e) => setReviewDraft((prev) => ({ ...prev, comment: e.target.value }))}
            />
            <div>
              <button className="btn btn--primary" onClick={submitReview} disabled={submittingReview || !reviewDraft.rating || !reviewDraft.comment.trim()}>
                {submittingReview ? 'Posting…' : 'Post review'}
              </button>
            </div>
          </div>

          <div className="recipe-review-list">
            {(recipe.reviews || []).length === 0 && <div className="empty-inline">No comments yet. Be the first to rate this recipe.</div>}
            {(recipe.reviews || []).map((review) => {
              const isEditing = editingReviewId === review.id;
              return (
                <div className="recipe-review" key={review.id}>
                  <div className="recipe-review__header">
                    <div className="recipe-review__author-block">
                      {review.avatarUrl ? (
                        <img src={review.avatarUrl} alt={review.userName || 'User'} className="recipe-review__avatar" />
                      ) : (
                        <div className="avatar recipe-review__avatar">{getInitials(review.userName || 'U')}</div>
                      )}
                      <div>
                        <div className="recipe-review__author">{review.userName || 'Unknown user'}</div>
                        <div className="recipe-review__meta">{renderStars(review.rating)} · {formatDateTime(review.updatedAt || review.createdAt)}</div>
                      </div>
                    </div>
                    {review.canEdit && (
                      <div className="recipe-review__actions">
                        {!isEditing && (
                          <button
                            className="btn"
                            onClick={() => {
                              setEditingReviewId(review.id);
                              setEditingReviewDraft({ rating: review.rating, comment: review.comment || '' });
                            }}
                          >
                            Edit
                          </button>
                        )}
                        <button className="btn btn--danger" onClick={() => onDeleteReview(review.id)}>Delete</button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="recipe-review__editor">
                      <StarRatingInput value={editingReviewDraft.rating} onChange={(rating) => setEditingReviewDraft((prev) => ({ ...prev, rating }))} />
                      <textarea
                        className="textarea"
                        rows="4"
                        value={editingReviewDraft.comment}
                        onChange={(e) => setEditingReviewDraft((prev) => ({ ...prev, comment: e.target.value }))}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn btn--primary" onClick={saveEditedReview}>Save</button>
                        <button className="btn" onClick={() => setEditingReviewId('')}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="recipe-review__comment">{review.comment}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecipeMeta({ label, value, children }) {
  return (
    <div className="recipe-view__meta-card">
      <div className="recipe-view__meta-label">{label}</div>
      <div className="recipe-view__meta-value">{children || value}</div>
    </div>
  );
}

function StarRatingInput({ value, onChange }) {
  return (
    <div className="star-rating-input" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`star-rating-input__star ${star <= value ? 'is-active' : ''}`}
          onClick={() => onChange(star)}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function MarkdownToolbar({ onAction }) {
  const tools = [
    { id: 'bold', label: 'Bold', short: 'B' },
    { id: 'italic', label: 'Italic', short: 'I' },
    { id: 'bullet', label: 'Bullets', short: '• List' },
    { id: 'number', label: 'Numbered list', short: '1. List' },
    { id: 'quote', label: 'Quote', short: 'Quote' },
  ];

  return (
    <div className="rte__toolbar cookbook-markdown-toolbar">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className="btn rte__btn"
          onClick={() => onAction(tool.id)}
          title={tool.label}
        >
          {tool.short}
        </button>
      ))}
    </div>
  );
}

function normalizeRecipeForForm(recipe, isNew) {
  return {
    ...EMPTY_RECIPE,
    ...recipe,
    canEdit: recipe.canEdit ?? isNew,
    categories: Array.isArray(recipe.categories) ? recipe.categories : [],
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    nutritionFacts: Array.isArray(recipe.nutritionFacts) ? recipe.nutritionFacts : [],
    reviews: Array.isArray(recipe.reviews) ? recipe.reviews : [],
    ratingAverage: Number(recipe.ratingAverage || 0),
    ratingCount: Number(recipe.ratingCount || 0),
    ingredients: Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0
      ? recipe.ingredients.map(normalizeIngredientForForm)
      : [{ amount: '', measurement: '', ingredient: '' }],
    steps: Array.isArray(recipe.steps) && recipe.steps.length > 0
      ? recipe.steps.map((step) => ({
        text: step.text || '',
        imageUrl: step.imageUrl || '',
      }))
      : [{ text: '', imageUrl: '' }],
  };
}

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags.map((tag) => `${tag || ''}`.trim()).filter(Boolean) : [];
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => `${item || ''}`.trim()).filter(Boolean)
    : [];
}

function normalizeIngredients(ingredients) {
  return (Array.isArray(ingredients) ? ingredients : [])
    .map((ingredient) => {
      const providedMeasurement = `${ingredient?.measurement || ''}`.trim();
      const parsedAmount = providedMeasurement
        ? { amount: ingredient?.amount, measurement: '' }
        : parseAmountAndMeasurement(ingredient?.amount);
      const amount = parseIngredientAmount(parsedAmount.amount);
      return {
        amount,
        measurement: providedMeasurement || parsedAmount.measurement,
        ingredient: `${ingredient?.ingredient || ''}`.trim(),
      };
    })
    .filter((ingredient) => ingredient.amount !== null || ingredient.measurement || ingredient.ingredient);
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step) => ({
      text: `${step?.text || ''}`.trim(),
      imageUrl: `${step?.imageUrl || ''}`.trim(),
    }))
    .filter((step) => step.text || step.imageUrl);
}

function buildCategoryCards(recipes, categoryOptions = []) {
  const counts = new Map(categoryOptions.map((category) => [category, 0]));

  for (const recipe of recipes) {
    const categories = Array.isArray(recipe.categories) ? recipe.categories.filter(Boolean) : [];
    if (categories.length === 0) {
      counts.set('Uncategorized', (counts.get('Uncategorized') || 0) + 1);
      continue;
    }
    for (const category of categories) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((category) => category.name === 'Uncategorized' || category.count > 0 || categoryOptions.includes(category.name))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
}

function filterRecipes(recipes, { query, category }) {
  const queryValue = `${query || ''}`.trim().toLowerCase();
  const categoryValue = `${category || ''}`.trim().toLowerCase();

  return recipes.filter((recipe) => {
    const categories = Array.isArray(recipe.categories) ? recipe.categories : [];
    const matchesCategory = !categoryValue || (
      categoryValue === 'uncategorized'
        ? categories.length === 0
        : categories.some((item) => `${item || ''}`.toLowerCase() === categoryValue)
    );

    if (!matchesCategory) return false;
    if (!queryValue) return true;

    const haystack = [
      recipe.title,
      recipe.description,
      recipe.ownerName,
      ...(recipe.categories || []),
      ...(recipe.tags || []),
      ...((recipe.ingredients || []).flatMap((ingredient) => [ingredient?.amount, ingredient?.measurement, ingredient?.ingredient])),
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(queryValue);
  });
}

function getCookbookCategories(configuredCategories, recipes) {
  const defaults = ['Appetizers', 'Soups', 'Sauces', 'Vegetarian', 'Seafood', 'Meat', 'Desserts'];
  const configured = Array.isArray(configuredCategories) ? configuredCategories : [];
  const discovered = recipes.flatMap((recipe) => Array.isArray(recipe.categories) ? recipe.categories : []);
  const unique = new Map();

  [...defaults, ...configured, ...discovered].forEach((category) => {
    const value = `${category || ''}`.trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (!unique.has(key)) unique.set(key, value);
  });

  return [...unique.values()];
}

function parseServingsValue(value) {
  const match = `${value || ''}`.match(/(\d+(?:\.\d+)?)/);
  return match ? Number.parseFloat(match[1]) : null;
}

function scaleIngredientAmount(amount, scale) {
  const numericValue = parseIngredientAmount(amount);
  if (numericValue === null || !Number.isFinite(scale) || Math.abs(scale - 1) < 0.001) {
    return formatIngredientAmount(amount);
  }

  return formatIngredientAmount(numericValue * scale);
}

function formatIngredientQuantity(ingredient, scale = 1) {
  const amount = scaleIngredientAmount(ingredient?.amount, scale);
  const measurement = `${ingredient?.measurement || ''}`.trim();

  return [amount, measurement].filter(Boolean).join(' ');
}

function normalizeIngredientForForm(item) {
  const legacy = parseLegacyIngredient(item);
  const amount = parseIngredientAmount(legacy.amount);
  return {
    amount: amount === null ? '' : formatIngredientAmount(amount),
    measurement: legacy.measurement,
    ingredient: legacy.ingredient,
  };
}

function parseLegacyIngredient(item) {
  const measurement = `${item?.measurement || ''}`.trim();
  const ingredient = `${item?.ingredient || ''}`.trim();

  if (measurement) {
    return {
      amount: item?.amount ?? '',
      measurement,
      ingredient,
    };
  }

  const parsedAmount = parseAmountAndMeasurement(item?.amount);
  return {
    amount: parsedAmount.amount,
    measurement: parsedAmount.measurement,
    ingredient,
  };
}

function parseAmountAndMeasurement(value) {
  const raw = `${value || ''}`.trim();
  if (!raw) return { amount: '', measurement: '' };

  const textMeasurement = raw.match(/^(to taste|pinch|dash|few)$/i);
  if (textMeasurement) {
    const measurement = textMeasurement[1].toLowerCase();
    return {
      amount: measurement === 'to taste' ? '' : 1,
      measurement,
    };
  }

  const match = raw.match(/^(.+?)\s+([a-z][a-z.\s]*)$/i);
  if (!match) return { amount: raw, measurement: '' };

  const amount = parseIngredientAmount(match[1]);
  if (amount === null) return { amount: raw, measurement: '' };

  return { amount, measurement: match[2].trim() };
}

function parseIngredientAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? roundIngredientAmount(value) : null;
  }

  const raw = `${value || ''}`.trim();
  if (!raw) return null;

  const unicodeFraction = parseUnicodeFraction(raw);
  if (Number.isFinite(unicodeFraction)) return roundIngredientAmount(unicodeFraction);

  const mixedUnicode = raw.match(/^(\d+(?:\.\d+)?)\s*([¼½¾⅓⅔⅛⅜⅝⅞⅙⅚⅕⅖⅗⅘])$/);
  if (mixedUnicode) {
    const whole = Number.parseFloat(mixedUnicode[1]);
    const fraction = parseUnicodeFraction(mixedUnicode[2]);
    if (Number.isFinite(whole) && Number.isFinite(fraction)) return roundIngredientAmount(whole + fraction);
  }

  const mixed = raw.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number.parseFloat(mixed[1]);
    const fraction = parseSimpleFraction(`${mixed[2]}/${mixed[3]}`);
    if (Number.isFinite(whole) && Number.isFinite(fraction)) return roundIngredientAmount(whole + fraction);
  }

  const fractionValue = parseSimpleFraction(raw);
  if (Number.isFinite(fractionValue)) return roundIngredientAmount(fractionValue);

  if (!/^(\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return null;
  const decimalValue = Number.parseFloat(raw);
  return Number.isFinite(decimalValue) ? roundIngredientAmount(decimalValue) : null;
}

function parseUnicodeFraction(value) {
  const unicodeFractions = new Map([
    ['⅛', 1 / 8],
    ['¼', 1 / 4],
    ['⅓', 1 / 3],
    ['⅜', 3 / 8],
    ['½', 1 / 2],
    ['⅝', 5 / 8],
    ['⅔', 2 / 3],
    ['¾', 3 / 4],
    ['⅞', 7 / 8],
    ['⅙', 1 / 6],
    ['⅚', 5 / 6],
    ['⅕', 1 / 5],
    ['⅖', 2 / 5],
    ['⅗', 3 / 5],
    ['⅘', 4 / 5],
  ]);

  return unicodeFractions.get(`${value || ''}`.trim());
}

function parseSimpleFraction(value) {
  const match = `${value || ''}`.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const numerator = Number.parseFloat(match[1]);
  const denominator = Number.parseFloat(match[2]);
  if (!numerator || !denominator) return null;
  return numerator / denominator;
}

function formatIngredientAmount(value) {
  const amount = parseIngredientAmount(value);
  if (amount === null) return `${value || ''}`.trim();
  return formatFraction(amount);
}

function formatFraction(value) {
  if (!Number.isFinite(value)) return '';

  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  let whole = Math.trunc(absolute);
  const remainder = absolute - whole;

  if (remainder >= 0.98) {
    return `${sign}${whole + 1}`;
  }

  const fraction = [
    { value: 1 / 8, label: '⅛' },
    { value: 1 / 6, label: '⅙' },
    { value: 1 / 5, label: '⅕' },
    { value: 1 / 4, label: '¼' },
    { value: 1 / 3, label: '⅓' },
    { value: 3 / 8, label: '⅜' },
    { value: 2 / 5, label: '⅖' },
    { value: 1 / 2, label: '½' },
    { value: 3 / 5, label: '⅗' },
    { value: 5 / 8, label: '⅝' },
    { value: 2 / 3, label: '⅔' },
    { value: 3 / 4, label: '¾' },
    { value: 4 / 5, label: '⅘' },
    { value: 5 / 6, label: '⅚' },
    { value: 7 / 8, label: '⅞' },
  ].find((option) => Math.abs(remainder - option.value) <= 0.02);

  if (fraction) {
    return whole ? `${sign}${whole} ${fraction.label}` : `${sign}${fraction.label}`;
  }

  if (remainder <= 0.02) return `${sign}${whole}`;
  return `${sign}${formatNumber(roundIngredientAmount(absolute))}`;
}

function roundIngredientAmount(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRecipeTime(value) {
  const raw = `${value || ''}`.trim();
  if (!raw) return '';

  const isoMatch = raw.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i);
  if (!isoMatch) return raw;

  const days = Number.parseInt(isoMatch[1] || '0', 10);
  const hours = Number.parseInt(isoMatch[2] || '0', 10);
  const minutes = Number.parseInt(isoMatch[3] || '0', 10);
  const parts = [];

  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hr${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} min`);

  return parts.join(' ') || raw;
}

function applyMarkdownAction(textarea, action, onChange) {
  if (!textarea) return;

  const value = textarea.value || '';
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  let nextValue = value;
  let nextStart = start;
  let nextEnd = end;

  if (action === 'bold' || action === 'italic') {
    const marker = action === 'bold' ? '**' : '*';
    const inner = selected || (action === 'bold' ? 'bold text' : 'italic text');
    nextValue = `${value.slice(0, start)}${marker}${inner}${marker}${value.slice(end)}`;
    nextStart = start + marker.length;
    nextEnd = nextStart + inner.length;
  } else if (action === 'bullet' || action === 'number' || action === 'quote') {
    const selectedText = selected || 'List item';
    const lines = selectedText.split('\n');
    const transformed = lines.map((line, index) => {
      const clean = line.trim() || 'List item';
      if (action === 'bullet') return `- ${clean}`;
      if (action === 'number') return `${index + 1}. ${clean}`;
      return `> ${clean}`;
    }).join('\n');
    nextValue = `${value.slice(0, start)}${transformed}${value.slice(end)}`;
    nextStart = start;
    nextEnd = start + transformed.length;
  }

  onChange(nextValue);

  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(nextStart, nextEnd);
  });
}

function renderRecipeMarkdown(value) {
  const source = `${value || ''}`.trim();
  if (!source) return '<p>No instruction provided.</p>';

  const lines = source.split('\n');
  const blocks = [];
  let paragraph = [];
  let listBuffer = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listBuffer?.items?.length) return;
    const tag = listBuffer.type === 'ol' ? 'ol' : 'ul';
    blocks.push(`<${tag}>${listBuffer.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
    listBuffer = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const numberMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    const quoteMatch = trimmed.match(/^>\s+(.+)$/);

    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote><p>${renderInlineMarkdown(quoteMatch[1])}</p></blockquote>`);
      continue;
    }

    if (bulletMatch) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== 'ul') {
        flushList();
        listBuffer = { type: 'ul', items: [] };
      }
      listBuffer.items.push(bulletMatch[1]);
      continue;
    }

    if (numberMatch) {
      flushParagraph();
      if (!listBuffer || listBuffer.type !== 'ol') {
        flushList();
        listBuffer = { type: 'ol', items: [] };
      }
      listBuffer.items.push(numberMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.join('');
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function escapeHtml(value) {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return 'just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function renderStars(value) {
  const rating = Math.max(0, Math.min(5, Number(value) || 0));
  return `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`;
}

function getInitials(name) {
  const parts = `${name || ''}`.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function navigateToBrowse(navigate, { q, category }) {
  const params = new URLSearchParams();
  if (`${q || ''}`.trim()) params.set('q', `${q}`.trim());
  if (`${category || ''}`.trim()) params.set('category', `${category}`.trim());
  const suffix = params.toString();
  navigate(suffix ? `/cookbook?${suffix}` : '/cookbook');
}

function upsertCookbookRecipe(queryClient, viewerKey, recipe) {
  queryClient.setQueryData(queryKeys.cookbookRecipes(viewerKey), (prev = { recipes: EMPTY_RECIPES }) => {
    const items = Array.isArray(prev.recipes) ? prev.recipes : EMPTY_RECIPES;
    const existing = items.some((item) => item.id === recipe.id);
    return {
      ...prev,
      recipes: existing
        ? items.map((item) => (item.id === recipe.id ? { ...item, ...recipe } : item))
        : [recipe, ...items],
    };
  });
  queryClient.setQueryData(queryKeys.cookbookRecipe(viewerKey, recipe.id), { recipe });
}

function removeCookbookRecipe(queryClient, viewerKey, recipeId) {
  queryClient.setQueryData(queryKeys.cookbookRecipes(viewerKey), (prev = { recipes: EMPTY_RECIPES }) => ({
    ...prev,
    recipes: (prev.recipes || EMPTY_RECIPES).filter((item) => item.id !== recipeId),
  }));
  queryClient.removeQueries({ queryKey: queryKeys.cookbookRecipe(viewerKey, recipeId), exact: true });
}
