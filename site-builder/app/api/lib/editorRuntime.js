// The script injected into pages served at /api/sites/:id/edit/*. It runs
// inside the editor iframe (same origin as the SPA) and talks to the parent
// window over postMessage:
//
//   runtime → parent:  se-ready · se-dirty · se-html {html} · se-image {imgId, src}
//                      · se-picked {desc}
//   parent → runtime:  se-cmd {cmd, value} · se-get-html · se-set-image {imgId, src}
//                      · se-insert-image {src} · se-pick-element · se-cancel-pick
//                      · se-set-bg {target, css}
//
// Editing model: any element that directly contains visible text becomes
// contenteditable (outermost wins), so the site's structure is untouched —
// we never wrap, move or re-create nodes. Serialization restores the
// data-se-orig-* attributes written by the server-side URL rewrite and strips
// every editor artifact, so the saved file differs from the original only
// where the user actually edited.
//
// The selection is snapshotted on every selectionchange inside an editable
// region and restored before running a command — clicking a toolbar button
// in the parent frame would otherwise have dropped it.
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
    'img[data-se-img]:hover{outline:2px solid rgba(168,85,247,.8);outline-offset:2px;}' +
    '.__se-pick-hover{outline:2px solid rgba(245,158,11,.95)!important;outline-offset:2px;}' +
    'body.__se-picking, body.__se-picking *{cursor:crosshair!important;}';
  document.head.appendChild(style);

  // Formatting commands should emit inline CSS spans, not <font> tags.
  try { document.execCommand('styleWithCSS', false, true); } catch (e) {}

  // ── Element picking (for background editing) ─────────────────────────────
  // Registered FIRST so its capture-phase click handler can shut out the
  // link/image handlers below via stopImmediatePropagation.
  var pickMode = false, pickHover = null, pickedEl = null;
  function setHover(el) {
    if (pickHover) pickHover.classList.remove('__se-pick-hover');
    pickHover = el;
    if (el) el.classList.add('__se-pick-hover');
  }
  function describe(el) {
    if (el === document.body) return 'body';
    var d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    else if (el.classList.length) d += '.' + el.classList[0];
    return d;
  }
  function exitPick() {
    pickMode = false;
    setHover(null);
    document.body.classList.remove('__se-picking');
  }
  document.addEventListener('mousemove', function (e) {
    if (!pickMode) return;
    setHover(e.target && e.target.nodeType === 1 ? e.target : null);
  }, true);
  document.addEventListener('click', function (e) {
    if (!pickMode) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pickedEl = e.target && e.target.nodeType === 1 ? e.target : document.body;
    exitPick();
    send({ type: 'se-picked', desc: describe(pickedEl) });
  }, true);

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
  function tagImages() {
    var imgs = document.getElementsByTagName('img');
    for (var j = 0; j < imgs.length; j++) {
      if (!imgs[j].getAttribute('data-se-img')) imgs[j].setAttribute('data-se-img', String(++imgSeq));
    }
  }
  tagImages();
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.getAttribute('data-se-img')) {
      e.preventDefault();
      e.stopPropagation();
      send({ type: 'se-image', imgId: t.getAttribute('data-se-img'),
             src: t.getAttribute('data-se-orig-src') || t.getAttribute('src') || '' });
    }
  }, true);

  // ── Selection persistence ────────────────────────────────────────────────
  // Toolbar clicks live in the parent document, which steals focus — restore
  // the last in-page selection before every command.
  var savedRange = null;
  document.addEventListener('selectionchange', function () {
    if (pickMode) return;
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var n = sel.anchorNode;
    var el = n && (n.nodeType === 1 ? n : n.parentElement);
    if (el && el.closest && el.closest('[data-se-editable]')) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  });
  function restoreSel() {
    if (!savedRange) return;
    var sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

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

    var hovered = root.querySelectorAll('.__se-pick-hover');
    for (var h = 0; h < hovered.length; h++) {
      hovered[h].classList.remove('__se-pick-hover');
      if (!hovered[h].getAttribute('class')) hovered[h].removeAttribute('class');
    }
    var body = root.querySelector('body');
    if (body) {
      body.classList.remove('__se-picking');
      if (!body.getAttribute('class')) body.removeAttribute('class');
    }

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
      restoreSel();
      try { document.execCommand(d.cmd, false, d.value || null); markDirty(); } catch (err) {}
    } else if (d.type === 'se-set-image') {
      var img = document.querySelector('img[data-se-img="' + d.imgId + '"]');
      if (img) {
        img.setAttribute('src', d.src);
        // The new value is exactly what should be saved — drop the original.
        img.removeAttribute('data-se-orig-src');
        markDirty();
      }
    } else if (d.type === 'se-insert-image') {
      restoreSel();
      try {
        document.execCommand('insertImage', false, d.src);
        tagImages();
        markDirty();
      } catch (err) {}
    } else if (d.type === 'se-pick-element') {
      pickMode = true;
      document.body.classList.add('__se-picking');
    } else if (d.type === 'se-cancel-pick') {
      exitPick();
    } else if (d.type === 'se-set-bg') {
      var target = d.target === 'element' && pickedEl ? pickedEl : document.body;
      var css = d.css || {};
      for (var p in css) {
        if (Object.prototype.hasOwnProperty.call(css, p)) target.style[p] = css[p];
      }
      markDirty();
    }
  });

  send({ type: 'se-ready' });
})();
`;
