import { ObjectId } from 'mongodb';
import { Router } from 'express';
import { ingressUser } from '../middleware/ingressAuth.js';
import { recordUser, requireAccess, requireAdmin } from '../middleware/access.js';
import { getDb, isConnected } from '../db.js';
import { buildExport } from '../lib/transfer.js';
import {
  requireSyncSecret,
  getSyncConfig,
  createInbound,
  deleteInbound,
  createOutbound,
  updateOutbound,
  deleteOutbound,
  runOutboundById,
} from '../lib/sync.js';

const router = Router();
const requireCookbookAccess = [ingressUser, recordUser, requireAccess];
const requireCookbookAdmin = [ingressUser, recordUser, requireAdmin];
const COLLECTION = 'cookbookRecipes';
const DEFAULT_CATEGORIES = ['Appetizers', 'Soups', 'Sauces', 'Vegetarian', 'Seafood', 'Meat', 'Desserts'];
const AMOUNT_TOKEN_PATTERN = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+\s*[¼½¾⅓⅔⅛⅜⅝⅞⅙⅚⅕⅖⅗⅘]|\d+(?:\.\d+)?|\.\d+|[¼½¾⅓⅔⅛⅜⅝⅞⅙⅚⅕⅖⅗⅘])`;
const MEASUREMENT_PATTERN = String.raw`(?:cups?|c|tablespoons?|tbsp\.?|tbs\.?|teaspoons?|tsp\.?|ounces?|oz\.?|pounds?|lbs?|grams?|g|kilograms?|kg|milliliters?|ml|liters?|l|cloves?|slices?|cans?|packages?|packets?|sticks?|pinches?|dashes?)`;

router.get('/recipes', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });

  try {
    const isAdmin = req.user.isAdmin;
    const recipes = await getDb().collection(COLLECTION)
      .find({ archived: { $ne: true } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .project({
        title: 1,
        description: 1,
        imageUrl: 1,
        categories: 1,
        tags: 1,
        ingredients: 1,
        sourceUrl: 1,
        servings: 1,
        totalTime: 1,
        ownerId: 1,
        ownerName: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .toArray();

    await migrateRecipeIngredients(recipes);

    res.json({
      recipes: recipes.map((recipe) => serializeRecipeSummary(recipe, req.user.id, isAdmin)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recipes/:id', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });

  try {
    const isAdmin = req.user.isAdmin;
    const recipe = await getDb().collection(COLLECTION).findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!recipe || (recipe.archived && !isAdmin)) return res.status(404).json({ error: 'Recipe not found' });
    await migrateRecipeIngredients([recipe]);
    res.json({ recipe: await serializeRecipe(recipe, req.user.id, isAdmin) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recipes', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });

  try {
    const isAdmin = req.user.isAdmin;
    const recipe = sanitizeRecipeInput(req.body, req.user);
    if (!recipe.title) return res.status(400).json({ error: 'title is required' });

    const result = await getDb().collection(COLLECTION).insertOne(recipe);
    const created = await getDb().collection(COLLECTION).findOne({ _id: result.insertedId });
    res.status(201).json({ ok: true, recipe: await serializeRecipe(created, req.user.id, isAdmin) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/recipes/:id', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });

  try {
    const isAdmin = req.user.isAdmin;
    const existing = await getDb().collection(COLLECTION).findOne({ _id: new ObjectId(req.params.id) });
    if (!existing || (existing.archived && !isAdmin)) return res.status(404).json({ error: 'Recipe not found' });
    if (!canEditRecipe(existing, req.user.id, isAdmin)) {
      return res.status(403).json({ error: 'You do not have permission to edit this recipe' });
    }

    const patch = sanitizeRecipePatch(req.body);
    if (!patch.title) return res.status(400).json({ error: 'title is required' });

    const result = await getDb().collection(COLLECTION).updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: patch }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'Recipe not found' });

    const updated = await getDb().collection(COLLECTION).findOne({
      _id: new ObjectId(req.params.id),
    });

    res.json({ ok: true, recipe: await serializeRecipe(updated, req.user.id, isAdmin) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/recipes/:id', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });

  try {
    const isAdmin = req.user.isAdmin;
    const existing = await getDb().collection(COLLECTION).findOne({ _id: new ObjectId(req.params.id) });
    if (!existing || (existing.archived && !isAdmin)) return res.status(404).json({ error: 'Recipe not found' });
    if (!canEditRecipe(existing, req.user.id, isAdmin)) {
      return res.status(403).json({ error: 'You do not have permission to edit this recipe' });
    }

    const patch = sanitizePartialRecipePatch(req.body);
    if (Object.keys(patch).length <= 1) return res.status(400).json({ error: 'No valid fields provided' });

    await getDb().collection(COLLECTION).updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: patch }
    );

    const updated = await getDb().collection(COLLECTION).findOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true, recipe: await serializeRecipe(updated, req.user.id, isAdmin) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/recipes/:id', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });

  try {
    const isAdmin = req.user.isAdmin;
    const existing = await getDb().collection(COLLECTION).findOne({ _id: new ObjectId(req.params.id) });
    if (!existing || existing.archived) return res.status(404).json({ error: 'Recipe not found' });
    if (!canEditRecipe(existing, req.user.id, isAdmin)) {
      return res.status(403).json({ error: 'You do not have permission to delete this recipe' });
    }

    // Soft delete: the recipe disappears from the app but stays in the archive,
    // where an admin can restore it or permanently delete it.
    await getDb().collection(COLLECTION).updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          archived: true,
          archivedAt: new Date(),
          archivedBy: req.user.id,
          archivedByName: req.user.name || '',
        },
      }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scrape', ...requireCookbookAccess, async (req, res) => {
  const url = `${req.body?.url || ''}`.trim();
  if (!url) return res.status(400).json({ error: 'url is required' });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only http and https URLs are supported' });
  }

  try {
    const response = await fetch(parsedUrl, {
      headers: {
        'User-Agent': 'AtlasCookBookBot/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Recipe page returned ${response.status}` });
    }

    const html = await response.text();
    const scraped = extractRecipeFromHtml(html, parsedUrl.toString());

    if (!scraped.title) {
      return res.status(422).json({ error: 'Could not find recipe data on that page' });
    }

    res.json({ recipe: scraped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recipes/:id/reviews', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });

  try {
    const recipeId = new ObjectId(req.params.id);
    const existing = await getDb().collection(COLLECTION).findOne({ _id: recipeId });
    if (!existing || (existing.archived && !req.user.isAdmin)) return res.status(404).json({ error: 'Recipe not found' });

    const review = await sanitizeReviewInput(req.body, req.user);
    if (!review.rating) return res.status(400).json({ error: 'rating is required' });
    if (!review.comment) return res.status(400).json({ error: 'comment is required' });

    await getDb().collection(COLLECTION).updateOne(
      { _id: recipeId },
      {
        $push: { reviews: review },
        $set: { updatedAt: new Date() },
      }
    );

    const updated = await getDb().collection(COLLECTION).findOne({ _id: recipeId });
    const isAdmin = req.user.isAdmin;
    res.status(201).json({ ok: true, recipe: await serializeRecipe(updated, req.user.id, isAdmin) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/recipes/:id/reviews/:reviewId', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });
  if (!ObjectId.isValid(req.params.reviewId)) return res.status(400).json({ error: 'Invalid review id' });

  try {
    const recipeId = new ObjectId(req.params.id);
    const reviewId = req.params.reviewId;
    const existing = await getDb().collection(COLLECTION).findOne({ _id: recipeId });
    if (!existing || (existing.archived && !req.user.isAdmin)) return res.status(404).json({ error: 'Recipe not found' });

    const isAdmin = req.user.isAdmin;
    const reviews = Array.isArray(existing.reviews) ? existing.reviews : [];
    const currentReview = reviews.find((review) => review?._id?.toString() === reviewId);
    if (!currentReview) return res.status(404).json({ error: 'Review not found' });
    if (!canEditReview(currentReview, req.user.id, isAdmin)) {
      return res.status(403).json({ error: 'You do not have permission to edit this review' });
    }

    const patch = sanitizeReviewPatch(req.body, currentReview);
    await getDb().collection(COLLECTION).updateOne(
      { _id: recipeId },
      {
        $set: {
          reviews: reviews.map((review) => review?._id?.toString() === reviewId ? patch : review),
          updatedAt: new Date(),
        },
      }
    );

    const updated = await getDb().collection(COLLECTION).findOne({ _id: recipeId });
    res.json({ ok: true, recipe: await serializeRecipe(updated, req.user.id, isAdmin) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/recipes/:id/reviews/:reviewId', ...requireCookbookAccess, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid recipe id' });
  if (!ObjectId.isValid(req.params.reviewId)) return res.status(400).json({ error: 'Invalid review id' });

  try {
    const recipeId = new ObjectId(req.params.id);
    const reviewId = req.params.reviewId;
    const existing = await getDb().collection(COLLECTION).findOne({ _id: recipeId });
    if (!existing || (existing.archived && !req.user.isAdmin)) return res.status(404).json({ error: 'Recipe not found' });

    const isAdmin = req.user.isAdmin;
    const reviews = Array.isArray(existing.reviews) ? existing.reviews : [];
    const currentReview = reviews.find((review) => review?._id?.toString() === reviewId);
    if (!currentReview) return res.status(404).json({ error: 'Review not found' });
    if (!canEditReview(currentReview, req.user.id, isAdmin)) {
      return res.status(403).json({ error: 'You do not have permission to delete this review' });
    }

    await getDb().collection(COLLECTION).updateOne(
      { _id: recipeId },
      {
        $set: {
          reviews: reviews.filter((review) => review?._id?.toString() !== reviewId),
          updatedAt: new Date(),
        },
      }
    );

    const updated = await getDb().collection(COLLECTION).findOne({ _id: recipeId });
    res.json({ ok: true, recipe: await serializeRecipe(updated, req.user.id, isAdmin) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeRecipeInput(body, ownerId) {
  const now = new Date();
  return {
    ownerId: ownerId.id,
    ownerName: ownerId.name || ownerId.email || 'Unknown user',
    ...baseRecipeFields(body),
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeRecipePatch(body) {
  return {
    ...baseRecipeFields(body),
    updatedAt: new Date(),
  };
}

function sanitizePartialRecipePatch(body) {
  const patch = { updatedAt: new Date() };
  const str = (key, max) => { if (key in body) patch[key] = `${body[key] || ''}`.trim().slice(0, max); };

  str('title', 160);
  str('description', 4000);
  str('sourceUrl', 800);
  str('imageUrl', 800);
  str('prepTime', 80);
  str('cookTime', 80);
  str('totalTime', 80);
  str('servings', 80);
  str('notes', 6000);

  if ('categories' in body) patch.categories = normalizeStringList(body.categories);
  if ('tags' in body) patch.tags = normalizeStringList(body.tags);
  if ('ingredients' in body) patch.ingredients = normalizeIngredients(body.ingredients);
  if ('nutritionFacts' in body) patch.nutritionFacts = normalizeNutritionFacts(body.nutritionFacts);
  if ('steps' in body) patch.steps = normalizeSteps(body.steps ?? body.instructions);

  return patch;
}

function baseRecipeFields(body = {}) {
  return {
    title: `${body.title || ''}`.trim().slice(0, 160),
    description: `${body.description || ''}`.trim().slice(0, 4000),
    sourceUrl: `${body.sourceUrl || ''}`.trim().slice(0, 800),
    imageUrl: `${body.imageUrl || ''}`.trim().slice(0, 800),
    prepTime: `${body.prepTime || ''}`.trim().slice(0, 80),
    cookTime: `${body.cookTime || ''}`.trim().slice(0, 80),
    totalTime: `${body.totalTime || ''}`.trim().slice(0, 80),
    servings: `${body.servings || ''}`.trim().slice(0, 80),
    categories: normalizeStringList(body.categories),
    tags: normalizeStringList(body.tags),
    ingredients: normalizeIngredients(body.ingredients),
    nutritionFacts: normalizeNutritionFacts(body.nutritionFacts),
    steps: normalizeSteps(body.steps ?? body.instructions),
    notes: `${body.notes || ''}`.trim().slice(0, 6000),
  };
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => `${item || ''}`.trim())
      .filter(Boolean)
      .slice(0, 200);
  }

  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 200);
  }

  return [];
}

function normalizeIngredients(value) {
  if (!Array.isArray(value)) {
    return normalizeStringList(value).map((line) => splitIngredientLine(line));
  }

  return value
    .map(normalizeIngredientItem)
    .filter((item) => item.amount !== null || item.measurement || item.ingredient)
    .slice(0, 300);
}

function normalizeIngredientItem(item) {
  if (typeof item === 'string') return splitIngredientLine(item);

  const providedMeasurement = cleanText(item?.measurement).slice(0, 80);
  const parsedAmount = providedMeasurement
    ? { amount: item?.amount, measurement: '' }
    : parseAmountAndMeasurement(item?.amount);

  return {
    amount: normalizeIngredientAmount(parsedAmount.amount),
    measurement: (providedMeasurement || parsedAmount.measurement).slice(0, 80),
    ingredient: cleanText(item?.ingredient).slice(0, 300),
  };
}

async function migrateRecipeIngredients(recipes) {
  const updates = [];

  for (const recipe of recipes) {
    if (!recipe?._id || !ingredientsNeedMigration(recipe.ingredients)) continue;
    const ingredients = normalizeIngredients(recipe.ingredients);
    recipe.ingredients = ingredients;
    updates.push({
      updateOne: {
        filter: { _id: recipe._id },
        update: { $set: { ingredients } },
      },
    });
  }

  if (updates.length > 0) {
    await getDb().collection(COLLECTION).bulkWrite(updates, { ordered: false });
  }
}

function ingredientsNeedMigration(ingredients) {
  if (!Array.isArray(ingredients)) return !!ingredients;

  return ingredients.some((item) => (
    typeof item === 'string'
    || item?.measurement === undefined
    || typeof item?.amount === 'string'
  ));
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) {
    return normalizeStringList(value).map((text) => ({
      text,
      imageUrl: '',
    }));
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { text: item.trim(), imageUrl: '' };
      }
      return {
        text: `${item?.text || ''}`.trim().slice(0, 4000),
        imageUrl: `${item?.imageUrl || ''}`.trim().slice(0, 800),
      };
    })
    .filter((item) => item.text || item.imageUrl)
    .slice(0, 300);
}

function normalizeNutritionFacts(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => `${item || ''}`.trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 50);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n+/)
      .map((item) => item.trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 50);
  }

  return [];
}

function serializeRecipeSummary(recipe, userId, isAdmin) {
  const categories = getRecipeCategories(recipe);
  return {
    id: recipe._id.toString(),
    title: recipe.title || 'Untitled recipe',
    description: recipe.description || '',
    imageUrl: recipe.imageUrl || '',
    categories,
    tags: getRecipeTags(recipe),
    ingredients: normalizeIngredients(recipe.ingredients),
    sourceUrl: recipe.sourceUrl || '',
    servings: recipe.servings || '',
    totalTime: recipe.totalTime || '',
    ownerId: recipe.ownerId || '',
    ownerName: recipe.ownerName || 'Unknown user',
    canEdit: canEditRecipe(recipe, userId, isAdmin),
    createdAt: recipe.createdAt || null,
    updatedAt: recipe.updatedAt || null,
  };
}

async function serializeRecipe(recipe, userId, isAdmin) {
  const reviews = Array.isArray(recipe.reviews) ? recipe.reviews : [];
  const ratingStats = summarizeRatings(reviews);
  const avatarMap = await getReviewAvatarMap(reviews);

  return {
    ...serializeRecipeSummary(recipe, userId, isAdmin),
    prepTime: recipe.prepTime || '',
    cookTime: recipe.cookTime || '',
    ingredients: normalizeIngredients(recipe.ingredients),
    nutritionFacts: Array.isArray(recipe.nutritionFacts) ? recipe.nutritionFacts : [],
    steps: Array.isArray(recipe.steps)
      ? recipe.steps
      : normalizeStringList(recipe.instructions).map((text) => ({ text, imageUrl: '' })),
    notes: recipe.notes || '',
    ratingAverage: ratingStats.average,
    ratingCount: ratingStats.count,
    reviews: reviews
      .map((review) => serializeReview(review, userId, isAdmin, avatarMap))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)),
  };
}

function extractRecipeFromHtml(html, sourceUrl) {
  const candidates = extractJsonLdCandidates(html);
  const recipe = findRecipeJsonLd(candidates);

  const title = cleanText(
    recipe?.name
    || matchMeta(html, 'property', 'og:title')
    || matchTitle(html)
  );

  const description = cleanText(
    recipe?.description
    || matchMeta(html, 'name', 'description')
  );

  const imageUrl = extractBestImageUrl(html, recipe, sourceUrl);
  const ingredients = normalizeIngredients(recipe?.recipeIngredient);
  const steps = normalizeRecipeInstructions(recipe?.recipeInstructions).map((text) => ({ text, imageUrl: '' }));
  const tags = buildTagList(recipe);
  const categories = inferCategoriesFromTags(tags);

  return {
    title,
    description,
    sourceUrl,
    imageUrl,
    prepTime: cleanText(recipe?.prepTime),
    cookTime: cleanText(recipe?.cookTime),
    totalTime: cleanText(recipe?.totalTime),
    servings: cleanText(recipe?.recipeYield),
    categories,
    tags: tags.filter((tag) => !categories.some((category) => category.toLowerCase() === tag.toLowerCase())),
    ingredients,
    nutritionFacts: [],
    steps,
    notes: '',
  };
}

async function sanitizeReviewInput(body, user) {
  const now = new Date();
  const userDoc = await getUserDoc(user.id);
  return {
    _id: new ObjectId(),
    userId: user.id,
    userName: user.name || user.email || 'Unknown user',
    avatarUrl: userDoc?.avatarUrl || '',
    rating: normalizeRating(body?.rating),
    comment: `${body?.comment || ''}`.trim().slice(0, 2000),
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeReviewPatch(body, existing) {
  const rating = normalizeRating(body?.rating);
  const comment = `${body?.comment || ''}`.trim().slice(0, 2000);

  return {
    ...existing,
    rating: rating || existing.rating || 0,
    comment: comment || existing.comment || '',
    updatedAt: new Date(),
  };
}

function normalizeRating(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(1, Math.min(5, parsed));
}

function serializeReview(review, userId, isAdmin, avatarMap = new Map()) {
  return {
    id: review?._id?.toString?.() || '',
    userId: review?.userId || '',
    userName: review?.userName || 'Unknown user',
    avatarUrl: avatarMap.get(review?.userId || '') || review?.avatarUrl || '',
    rating: normalizeRating(review?.rating),
    comment: review?.comment || '',
    createdAt: review?.createdAt || null,
    updatedAt: review?.updatedAt || null,
    canEdit: canEditReview(review, userId, isAdmin),
  };
}

function summarizeRatings(reviews) {
  const normalized = reviews
    .map((review) => normalizeRating(review?.rating))
    .filter(Boolean);

  if (normalized.length === 0) return { average: 0, count: 0 };

  const total = normalized.reduce((sum, rating) => sum + rating, 0);
  return {
    average: Math.round((total / normalized.length) * 10) / 10,
    count: normalized.length,
  };
}

function extractJsonLdCandidates(html) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return scripts.flatMap((match) => {
    const raw = decodeHtmlEntities(match[1]).trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  });
}

function findRecipeJsonLd(items) {
  const queue = [...items];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;

    const type = item['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((entry) => `${entry || ''}`.toLowerCase() === 'recipe')) return item;

    if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
    if (Array.isArray(item.itemListElement)) queue.push(...item.itemListElement);
    if (Array.isArray(item.mainEntity)) queue.push(...item.mainEntity);
    if (item.mainEntity && !Array.isArray(item.mainEntity)) queue.push(item.mainEntity);
  }

  return null;
}

function normalizeRecipeInstructions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [cleanText(item)];
      if (item?.text) return [cleanText(item.text)];
      if (Array.isArray(item?.itemListElement)) return normalizeRecipeInstructions(item.itemListElement);
      return [];
    }).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n+/).map(cleanText).filter(Boolean);
  }
  if (value?.text) return [cleanText(value.text)].filter(Boolean);
  return [];
}

function buildTagList(recipe) {
  const tags = [
    ...(normalizeRecipeInstructions(recipe?.recipeCategory)),
    ...(normalizeRecipeInstructions(recipe?.keywords?.split ? recipe.keywords.split(',') : recipe?.keywords)),
    ...(normalizeRecipeInstructions(recipe?.recipeCuisine)),
  ];
  return [...new Set(tags.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 20);
}

function getRecipeCategories(recipe) {
  const explicit = normalizeStringList(recipe?.categories);
  if (explicit.length > 0) return explicit;

  const legacy = normalizeStringList(recipe?.tags);
  return inferCategoriesFromTags(legacy);
}

function getRecipeTags(recipe) {
  const categories = getRecipeCategories(recipe);
  const categorySet = new Set(categories.map((category) => category.toLowerCase()));
  return normalizeStringList(recipe?.tags).filter((tag) => !categorySet.has(tag.toLowerCase()));
}

function inferCategoriesFromTags(tags) {
  const allowed = new Map(DEFAULT_CATEGORIES.map((category) => [category.toLowerCase(), category]));
  return normalizeStringList(tags)
    .map((tag) => allowed.get(tag.toLowerCase()) || null)
    .filter(Boolean);
}

function extractImageUrl(image) {
  if (!image) return '';
  if (typeof image === 'string') return image.trim();
  if (Array.isArray(image)) {
    const first = image.find((entry) => typeof entry === 'string' || entry?.url);
    return extractImageUrl(first);
  }
  return `${image.url || ''}`.trim();
}

function extractBestImageUrl(html, recipe, sourceUrl) {
  const candidates = [
    resolveUrl(extractImageUrl(recipe?.image), sourceUrl),
    resolveUrl(matchMeta(html, 'property', 'og:image'), sourceUrl),
    resolveUrl(matchMeta(html, 'name', 'twitter:image'), sourceUrl),
    resolveUrl(matchMeta(html, 'itemprop', 'image'), sourceUrl),
  ].filter(Boolean);

  return candidates[0] || '';
}

function matchMeta(html, attr, value) {
  const regex = new RegExp(`<meta[^>]*${attr}=["']${escapeRegex(value)}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  return cleanText(html.match(regex)?.[1] || '');
}

function matchTitle(html) {
  return cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
}

function cleanText(value) {
  return decodeHtmlEntities(`${value || ''}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return `${value || ''}`
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegex(value) {
  return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveUrl(value, baseUrl) {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function splitIngredientLine(line) {
  const trimmed = `${line || ''}`.trim();
  if (!trimmed) return { amount: null, measurement: '', ingredient: '' };

  const textMeasurement = trimmed.match(/^(to taste|pinch|dash|few)\s+(.+)$/i);
  if (textMeasurement) {
    const measurement = textMeasurement[1].toLowerCase();
    return {
      amount: measurement === 'to taste' ? null : 1,
      measurement,
      ingredient: cleanText(textMeasurement[2]).slice(0, 300),
    };
  }

  const match = trimmed.match(new RegExp(`^(${AMOUNT_TOKEN_PATTERN})(?:\\s+(${MEASUREMENT_PATTERN}))?\\s+(.+)$`, 'i'));
  if (!match) return { amount: null, measurement: '', ingredient: cleanText(trimmed).slice(0, 300) };

  return {
    amount: normalizeIngredientAmount(match[1]),
    measurement: cleanText(match[2]).slice(0, 80),
    ingredient: cleanText(match[3]).slice(0, 300),
  };
}

function parseAmountAndMeasurement(value) {
  const raw = cleanText(value);
  if (!raw) return { amount: null, measurement: '' };

  const textMeasurement = raw.match(/^(to taste|pinch|dash|few)$/i);
  if (textMeasurement) {
    const measurement = textMeasurement[1].toLowerCase();
    return {
      amount: measurement === 'to taste' ? null : 1,
      measurement,
    };
  }

  const match = raw.match(new RegExp(`^(${AMOUNT_TOKEN_PATTERN})(?:\\s+(${MEASUREMENT_PATTERN}))?$`, 'i'));
  if (!match) return { amount: raw, measurement: '' };

  return {
    amount: match[1],
    measurement: cleanText(match[2]).slice(0, 80),
  };
}

function normalizeIngredientAmount(value) {
  const amount = parseIngredientAmount(value);
  return amount === null ? null : roundIngredientAmount(amount);
}

function parseIngredientAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = `${value || ''}`.trim();
  if (!raw) return null;

  const unicodeFraction = parseUnicodeFraction(raw);
  if (Number.isFinite(unicodeFraction)) return unicodeFraction;

  const mixedUnicode = raw.match(/^(\d+(?:\.\d+)?)\s*([¼½¾⅓⅔⅛⅜⅝⅞⅙⅚⅕⅖⅗⅘])$/);
  if (mixedUnicode) {
    const whole = Number.parseFloat(mixedUnicode[1]);
    const fraction = parseUnicodeFraction(mixedUnicode[2]);
    if (Number.isFinite(whole) && Number.isFinite(fraction)) return whole + fraction;
  }

  const mixed = raw.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number.parseFloat(mixed[1]);
    const fraction = parseSimpleFraction(`${mixed[2]}/${mixed[3]}`);
    if (Number.isFinite(whole) && Number.isFinite(fraction)) return whole + fraction;
  }

  const fractionValue = parseSimpleFraction(raw);
  if (Number.isFinite(fractionValue)) return fractionValue;

  if (!/^(\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return null;
  const decimalValue = Number.parseFloat(raw);
  return Number.isFinite(decimalValue) ? decimalValue : null;
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

function roundIngredientAmount(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canEditRecipe(recipe, userId, isAdmin) {
  return isAdmin || recipe.ownerId === userId;
}

function canEditReview(review, userId, isAdmin) {
  return isAdmin || review?.userId === userId;
}

async function getUserDoc(userId) {
  return getDb().collection('users').findOne(
    { _id: userId },
    { projection: { avatarUrl: 1 } }
  );
}

async function getReviewAvatarMap(reviews) {
  const userIds = [...new Set(
    (Array.isArray(reviews) ? reviews : [])
      .map((review) => `${review?.userId || ''}`.trim())
      .filter(Boolean)
  )];

  if (userIds.length === 0) return new Map();

  const users = await getDb().collection('users')
    .find(
      { _id: { $in: userIds } },
      { projection: { avatarUrl: 1 } }
    )
    .toArray();

  return new Map(users.map((user) => [user._id, user.avatarUrl || '']));
}

function escapeHtml(value) {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Recipe Sync -----------------------------------------------------------
// See ../../RECIPE_SYNC.md. The pull route is gated by a shared sync secret
// (not ingress) so remote peers can reach it; every management route is
// admin-only and returns plaintext secrets, so it must never be public.

// Public pull endpoint: a remote instance fetches the whole cookbook as the
// same zip that GET /export produces, authenticated by X-Sync-Secret.
router.get('/sync/pull', requireSyncSecret, async (_req, res) => {
  try {
    const archive = await buildExport();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="cookbook-sync-${date}.zip"`);
    res.send(archive);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full sync config — inbound links (URL + secret) and outbound sources (status).
router.get('/sync', ...requireCookbookAdmin, async (_req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  try {
    res.json(await getSyncConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync/inbound', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  try {
    const token = await createInbound(req.body?.label);
    res.status(201).json({ token: { ...token, url: buildPullUrl(req) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sync/inbound/:id', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  try {
    const removed = await deleteInbound(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Sync link not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync/outbound', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  if (!`${req.body?.url || ''}`.trim()) return res.status(400).json({ error: 'A pull URL is required' });
  try {
    res.status(201).json({ source: await createOutbound(req.body || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/sync/outbound/:id', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  try {
    const source = await updateOutbound(req.params.id, req.body || {});
    if (!source) return res.status(404).json({ error: 'Sync source not found' });
    res.json({ source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sync/outbound/:id', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  try {
    const removed = await deleteOutbound(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Sync source not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// "Sync now": pull + merge immediately. 502 when the pull/import itself failed.
router.post('/sync/outbound/:id/run', ...requireCookbookAdmin, async (req, res) => {
  if (!isConnected()) return res.status(503).json({ error: 'Database not connected' });
  try {
    const result = await runOutboundById(req.params.id, { manual: true });
    if (result.status === 'error') return res.status(502).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build the externally-reachable pull URL for a freshly-created inbound link.
// Honors the proxy's forwarded host/proto (nginx or HA ingress in front).
function buildPullUrl(req) {
  const proto = (req.get('X-Forwarded-Proto') || req.protocol || 'https').split(',')[0].trim();
  const host = req.get('X-Forwarded-Host') || req.get('Host') || '';
  const ingress = (req.get('X-Ingress-Path') || '').replace(/\/+$/, '');
  return `${proto}://${host}${ingress}/api/cookbook/sync/pull`;
}

export default router;
