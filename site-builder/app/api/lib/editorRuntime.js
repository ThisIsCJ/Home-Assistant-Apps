// The script injected into pages served at /api/sites/:id/edit/*. It runs
// inside the editor iframe (same origin as the SPA) and talks to the parent
// window over postMessage:
//
//   runtime → parent:  se-ready · se-dirty · se-html {html} · se-image {imgId, src}
//   parent → runtime:  se-cmd {cmd, value} · se-get-html · se-set-image {imgId, src}
//
// Editing model: any element that directly contains visible text becomes
// contenteditable (outermost wins), so the site's structure is untouched —
// we never wrap, move or re-create nodes. Serialization restores the
// data-se-orig-* attributes written by the server-side URL rewrite and strips
// every editor artifact, so the saved file differs from the original only
// where the user actually edited.
//
// Kept dependency-free and ES5-ish so it runs in whatever the site ships.
export const EDITOR_RUNTIME = String.raw`
(function () {
  'use strict';
  if (window.__seActive) return;
  window.__seActive = true;

  var parentWin = window.parent;
  function send(msg) { try { parentWin.postMessage(msg, '*'); } catch (e) {} }

  // ── Editing styles (removed on serialize) ────────────────────────────────
  var style = document.createElement('style');
  style.id = '__se_style';
  style.textContent =
    '[data-se-editable]{outline:1px dashed rgba(59,130,246,.35);outline-offset:2px;cursor:text;min-height:1em;}' +
    '[data-se-editable]:hover{outline-color:rgba(59,130,246,.75);}' +
    '[data-se-editable]:focus{outline:2px solid rgba(59,130,246,.9);background:rgba(59,130,246,.05);}' +
    'img[data-se-img]{cursor:pointer;}' +
    'img[data-se-img]:hover{outline:2px solid rgba(168,85,247,.8);outline-offset:2px;}';
  document.head.appendChild(style);

  // ── Mark editable elements ───────────────────────────────────────────────
  function hasDirectText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.nodeValue.replace(/\s+/g, '')) return true;
    }
    return false;
  }
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1 };
  var all = document.body ? document.body.getElementsByTagName('*') : [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (SKIP[el.tagName]) continue;
    if (!hasDirectText(el)) continue;
    if (el.closest && el.closest('[data-se-editable]')) continue; // outermost wins
    el.setAttribute('data-se-editable', '');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
  }

  // Links must stay clickable-to-edit, not navigate away.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) { e.preventDefault(); }
  }, true);

  // ── Images: click to swap ────────────────────────────────────────────────
  var imgSeq = 0;
  var imgs = document.getElementsByTagName('img');
  for (var j = 0; j < imgs.length; j++) {
    imgs[j].setAttribute('data-se-img', String(++imgSeq));
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.getAttribute('data-se-img')) {
      e.preventDefault();
      e.stopPropagation();
      send({ type: 'se-image', imgId: t.getAttribute('data-se-img'),
             src: t.getAttribute('data-se-orig-src') || t.getAttribute('src') || '' });
    }
  }, true);

  // ── Dirty tracking ───────────────────────────────────────────────────────
  var dirty = false;
  function markDirty() {
    if (!dirty) { dirty = true; }
    send({ type: 'se-dirty' });
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.closest && e.target.closest('[data-se-editable]')) markDirty();
  }, true);

  // ── Serialization ────────────────────────────────────────────────────────
  function serialize() {
    var root = document.documentElement.cloneNode(true);

    var kill = root.querySelectorAll('#__se_runtime, #__se_style');
    for (var k = 0; k < kill.length; k++) kill[k].parentNode.removeChild(kill[k]);

    var marked = root.querySelectorAll('[data-se-editable], [data-se-img], [data-se-orig-href], [data-se-orig-src], [data-se-orig-action], [data-se-orig-poster]');
    for (var m = 0; m < marked.length; m++) {
      var n = marked[m];
      var attrs = ['href', 'src', 'action', 'poster'];
      for (var a = 0; a < attrs.length; a++) {
        var orig = n.getAttribute('data-se-orig-' + attrs[a]);
        if (orig !== null) {
          // Restore unless the user replaced the value (image swap): a swap
          // clears the data attribute, so anything still present is original.
          n.setAttribute(attrs[a], orig);
          n.removeAttribute('data-se-orig-' + attrs[a]);
        }
      }
      n.removeAttribute('data-se-editable');
      n.removeAttribute('data-se-img');
      if (n.getAttribute('contenteditable') === 'true') n.removeAttribute('contenteditable');
      if (n.getAttribute('spellcheck') === 'false') n.removeAttribute('spellcheck');
    }

    var doctype = '';
    if (document.doctype) {
      doctype = '<!DOCTYPE ' + document.doctype.name + '>\n';
    }
    return doctype + root.outerHTML + '\n';
  }

  // ── Parent commands ──────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'se-get-html') {
      send({ type: 'se-html', html: serialize(), requestId: d.requestId });
      dirty = false;
    } else if (d.type === 'se-cmd') {
      try { document.execCommand(d.cmd, false, d.value || null); markDirty(); } catch (err) {}
    } else if (d.type === 'se-set-image') {
      var img = document.querySelector('img[data-se-img="' + d.imgId + '"]');
      if (img) {
        img.setAttribute('src', d.src);
        // The new value is exactly what should be saved — drop the original.
        img.removeAttribute('data-se-orig-src');
        markDirty();
      }
    }
  });

  send({ type: 'se-ready' });
})();
`;
