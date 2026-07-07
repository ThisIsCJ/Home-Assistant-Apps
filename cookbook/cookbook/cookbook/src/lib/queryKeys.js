export const queryKeys = {
  cookbookRecipes: (viewerKey) => ['cookbook', 'recipes', viewerKey],
  cookbookRecipe: (viewerKey, recipeId) => ['cookbook', 'recipes', viewerKey, recipeId],
};
