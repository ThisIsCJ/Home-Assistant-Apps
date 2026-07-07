import { EDITOR_RUNTIME } from './editorRuntime.js';

// The add-on is served under the HA ingress sub-path, so a site's
// root-absolute URLs (href="/css/x.css") would escape the ingress prefix and
// 404. We rewrite them to document-relative form at serve time and stash the
// original value in a data-se-orig-* attribute; the editor runtime restores
// the originals when it serializes the page, so saved HTML is untouched.
//
// Known v1 limits: srcset and url(/…) inside CSS are not rewritten.
const URL_ATTR_RE = /(\s)(href|src|action|poster)(\s*=\s*)(["'])(\/[^"'/][^"']*)\4/gi;

export function rewriteAbsoluteUrls(html, relPath) {
  const dirs = relPath.split('/').length - 1;
  const prefix = '../'.repeat(dirs);
  return html.replace(URL_ATTR_RE, (m, ws, attr, eq, q, url) =>
    `${ws}data-se-orig-${attr.toLowerCase()}${eq}${q}${url}${q} ${attr}${eq}${q}${prefix}${url.slice(1)}${q}`);
}

// Serve a page into the editor iframe: rewritten URLs + injected runtime.
export function editorHtml(html, relPath) {
  const out = rewriteAbsoluteUrls(html, relPath);
  const tag = `<script id="__se_runtime">${EDITOR_RUNTIME}</script>`;
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${tag}</body>`);
  return out + tag;
}

// Serve a page into the preview iframe: rewritten URLs only.
export const previewHtml = rewriteAbsoluteUrls;
