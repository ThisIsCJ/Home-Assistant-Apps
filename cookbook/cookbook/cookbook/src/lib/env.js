// The standalone add-on has no runtime env-injection layer; the original
// Cookbook page calls getEnv() for optional branding only, so an empty
// string is a safe default everywhere.
export function getEnv() {
  return '';
}
