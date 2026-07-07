import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './queryKeys';

export const EMPTY_COOKBOOK_RECIPES = { recipes: [] };

export function getViewerKey(profile) {
  return profile?.sub || 'me';
}

export function useCookbookRecipesQuery({ viewerKey } = {}) {
  return useQuery({
    queryKey: queryKeys.cookbookRecipes(viewerKey),
    queryFn: () => api.get('/cookbook/recipes'),
    enabled: Boolean(viewerKey),
    placeholderData: EMPTY_COOKBOOK_RECIPES,
  });
}

export function useCookbookRecipeQuery({ viewerKey, recipeId, enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.cookbookRecipe(viewerKey, recipeId || ''),
    queryFn: () => api.get(`/cookbook/recipes/${encodeURIComponent(recipeId)}`),
    enabled: Boolean(enabled && viewerKey && recipeId),
  });
}
