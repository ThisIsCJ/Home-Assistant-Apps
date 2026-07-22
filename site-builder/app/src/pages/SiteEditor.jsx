import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, apiUrl } from '../lib/api.js';
import { useApp, timeAgo } from '../lib/state.jsx';
import { Icons } from '../components/Icons.jsx';

// Compute the document-relative prefix for a site-root-relative asset path,
// e.g. editing "blog/post.html" → "../assets/x.png".
const rootPrefix = (filePath) => '../'.repeat(filePath.split('/').length - 1);

const FONTS = [
  'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman',
  'Garamond', 'Courier New', 'Impact', 'system-ui',
];
// execCommand fontSize levels 1–7.
const SIZES = [
  { v: '1', label: 'Tiny' }, { v: '2', label: 'Small' }, { v: '3', label: 'Normal' },
  { v: '4', label: 'Medium' }, { v: '5', label: 'Large' }, { v: '6', label: 'X-Large' },
  { v: '7', label: 'Huge' },
];
const BLOCKS = [
  { v: 'P', label: 'Paragraph' }, { v: 'H1', label: 'Heading 1' }, { v: 'H2', label: 'Heading 2' },
  { v: 'H3', label: 'Heading 3' }, { v: 'H4', label: 'Heading 4' }, { v: 'BLOCKQUOTE', label: 'Quote' },
  { v: 'PRE', label: 'Code block' },
];

function PushModal({ site, onClose, onPushed }) {
  const { toast } = useApp();
  const [message, setMessage] = useState('Update site content from Home Assistant editor');
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState(null);

  const push = async (force) => {
    setBusy(true);
    try {
      const res = await api.post(`/sites/${site.id}/push`, { message, force });
      toast('success', `Pushed ${res.files.length} file(s) — ${res.commit_hash.slice(0, 7)}`);
      onPushed();
    } catch (err) {
      if (err.status === 409 && err.conflicts) {
        setConflicts(err.conflicts);
      } else {
        toast('error', err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Push to GitHub</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="form-section">
          <div className="input-group">
            <label className="input-label">Commit message</label>
            <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="text-sm text-muted">
            Pushes your draft ({site.draft?.files?.length ?? 0} file{(site.draft?.files?.length ?? 0) === 1 ? '' : 's'}) to
            {' '}<span className="mono">{site.branch}</span> on <span className="mono">{site.repo_url}</span>.
          </div>
          {conflicts && (
            <div className="alert alert-warn">
              <div className="font-bold mb-2">These files also changed on GitHub since you started editing:</div>
              {conflicts.map((f) => <div key={f} className="mono text-sm">{f}</div>)}
              <div className="mt-2 text-sm">Force-pushing overwrites those upstream edits with your version.</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {conflicts
            ? <button className="btn btn-danger" disabled={busy} onClick={() => push(true)}>
                {busy ? <Icons.Loader size={13} className="spin" /> : <Icons.AlertTriangle size={13} />} Force Push
              </button>
            : <button className="btn btn-pri" disabled={busy || !message.trim()} onClick={() => push(false)}>
                {busy ? <Icons.Loader size={13} className="spin" /> : <Icons.UploadCloud size={13} />} Push
              </button>}
        </div>
      </div>
    </div>
  );
}

// Upload an image into the site (draft) and/or pick a URL. Used both for
// replacing an existing image and inserting a new one. Uploaded files go to
// a configurable folder inside the site, so they are committed on push.
function useImageFolder(siteId) {
  const key = `se_imgdir_${siteId}`;
  const [folder, setFolder] = useState(() => localStorage.getItem(key) || 'assets/uploads');
  const remember = (f) => { localStorage.setItem(key, f); setFolder(f); };
  return [folder, remember];
}

function ImageModal({ mode, current, onApply, onClose, siteId, filePath }) {
  const { toast } = useApp();
  const [url, setUrl] = useState(current || '');
  const [folder, setFolder] = useImageFolder(siteId);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const uploadFile = async (file) => {
    setBusy(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const dir = folder.replace(/^\/+|\/+$/g, '') || 'assets/uploads';
      const dest = `${dir}/${Date.now()}-${safeName}`;
      await api.upload(`/sites/${siteId}/asset?path=${encodeURIComponent(dest)}`, file);
      setFolder(dir);
      onApply(rootPrefix(filePath) + dest);
    } catch (err) {
      toast('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{mode === 'insert' ? 'Insert image' : 'Replace image'}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="form-section">
          <div className="input-group">
            <label className="input-label">Image URL</label>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or a path inside the site" />
          </div>
          <div className="input-group">
            <label className="input-label">Upload — destination folder in the site</label>
            <div className="flex gap-2">
              <input className="input mono" value={folder} onChange={(e) => setFolder(e.target.value)}
                placeholder="assets/uploads" style={{ flex: 1 }} />
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
              <button className="btn btn-sec" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? <Icons.Loader size={13} className="spin" /> : <Icons.Image size={13} />} Upload…
              </button>
            </div>
            <div className="input-hint">
              The file is saved into this folder of your draft and committed to GitHub when you push.
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" disabled={!url.trim()} onClick={() => onApply(url.trim())}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// Background editor: solid color, gradient, or image — applied to the page
// body or to an element picked in the iframe.
function BackgroundModal({ siteId, filePath, picked, onPickElement, onApply, onClose }) {
  const { toast } = useApp();
  const [target, setTarget] = useState(picked ? 'element' : 'page');
  const [kind, setKind] = useState('color');
  const [color, setColor] = useState('#1a2744');
  const [grad1, setGrad1] = useState('#3b82f6');
  const [grad2, setGrad2] = useState('#a855f7');
  const [gradDir, setGradDir] = useState('135deg');
  const [imgUrl, setImgUrl] = useState('');
  const [imgFit, setImgFit] = useState('cover');
  const [folder, setFolder] = useImageFolder(siteId);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const uploadFile = async (file) => {
    setBusy(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const dir = folder.replace(/^\/+|\/+$/g, '') || 'assets/uploads';
      const dest = `${dir}/${Date.now()}-${safeName}`;
      await api.upload(`/sites/${siteId}/asset?path=${encodeURIComponent(dest)}`, file);
      setFolder(dir);
      setImgUrl(rootPrefix(filePath) + dest);
    } catch (err) {
      toast('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const buildCss = () => {
    if (kind === 'color') return { background: color };
    if (kind === 'gradient') return { background: `linear-gradient(${gradDir}, ${grad1}, ${grad2})` };
    if (kind === 'image') {
      if (!imgUrl.trim()) return null;
      const url = `url("${imgUrl.trim()}")`;
      return imgFit === 'tile'
        ? { background: `${url} repeat` }
        : { background: `${url} center / ${imgFit} no-repeat` };
    }
    return { background: '' }; // clear
  };

  const css = buildCss();

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title">Background</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="form-section">
          <div className="input-group">
            <label className="input-label">Apply to</label>
            <div className="flex gap-2">
              <button className={`btn btn-sm ${target === 'page' ? 'btn-pri' : 'btn-sec'}`} onClick={() => setTarget('page')}>
                Whole page
              </button>
              <button className={`btn btn-sm ${target === 'element' ? 'btn-pri' : 'btn-sec'}`}
                onClick={() => picked ? setTarget('element') : onPickElement()}>
                {picked ? <>Element: <span className="mono">{picked}</span></> : 'Pick an element…'}
              </button>
              {picked && (
                <button className="btn btn-ghost btn-sm" onClick={onPickElement} title="Pick a different element">
                  <Icons.RefreshCw size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Type</label>
            <div className="flex gap-2">
              {[['color', 'Color'], ['gradient', 'Gradient'], ['image', 'Image'], ['clear', 'Clear']].map(([v, l]) => (
                <button key={v} className={`btn btn-sm ${kind === v ? 'btn-pri' : 'btn-sec'}`} onClick={() => setKind(v)}>{l}</button>
              ))}
            </div>
          </div>

          {kind === 'color' && (
            <div className="input-group">
              <label className="input-label">Color</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="se-swatch" />
                <input className="input mono" style={{ width: 110 }} value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
          )}

          {kind === 'gradient' && (
            <div className="input-group">
              <label className="input-label">Gradient</label>
              <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
                <input type="color" value={grad1} onChange={(e) => setGrad1(e.target.value)} className="se-swatch" />
                <input type="color" value={grad2} onChange={(e) => setGrad2(e.target.value)} className="se-swatch" />
                <select className="input" style={{ width: 'auto' }} value={gradDir} onChange={(e) => setGradDir(e.target.value)}>
                  <option value="135deg">Diagonal ↘</option>
                  <option value="45deg">Diagonal ↗</option>
                  <option value="to bottom">Top → bottom</option>
                  <option value="to right">Left → right</option>
                </select>
              </div>
            </div>
          )}

          {kind === 'image' && (
            <>
              <div className="input-group">
                <label className="input-label">Image URL</label>
                <input className="input" value={imgUrl} onChange={(e) => setImgUrl(e.target.value)}
                  placeholder="https://… or a path inside the site" />
              </div>
              <div className="input-group">
                <label className="input-label">Upload — destination folder in the site</label>
                <div className="flex gap-2">
                  <input className="input mono" value={folder} onChange={(e) => setFolder(e.target.value)} style={{ flex: 1 }} />
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
                  <button className="btn btn-sec" disabled={busy} onClick={() => fileRef.current?.click()}>
                    {busy ? <Icons.Loader size={13} className="spin" /> : <Icons.Image size={13} />} Upload…
                  </button>
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Fit</label>
                <div className="flex gap-2">
                  {[['cover', 'Cover'], ['contain', 'Contain'], ['tile', 'Tile']].map(([v, l]) => (
                    <button key={v} className={`btn btn-xs ${imgFit === v ? 'btn-pri' : 'btn-sec'}`} onClick={() => setImgFit(v)}>{l}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {kind === 'clear' && (
            <div className="text-sm text-muted">Removes the inline background from the target.</div>
          )}

          {css && kind !== 'clear' && (
            <div className="se-bg-preview" style={css} />
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" disabled={!css}
            onClick={() => onApply(target, css)}>
            <Icons.Check size={13} /> Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// Path-entry modal for the file-management actions (new file, new folder,
// rename, move). All four are a single text field for a site-relative path.
const OP_META = {
  'new-file':   { title: 'New file',   label: 'File path',   icon: 'FilePlus',   verb: 'Create', placeholder: 'about.html' },
  'new-folder': { title: 'New folder', label: 'Folder path', icon: 'FolderPlus', verb: 'Create', placeholder: 'blog/posts' },
  'rename':     { title: 'Rename',     label: 'New name',    icon: 'Edit',       verb: 'Rename', placeholder: '' },
  'move':       { title: 'Move',       label: 'New path',    icon: 'Move',       verb: 'Move',   placeholder: '' },
};

function FileOpModal({ op, onClose, onSubmit }) {
  const meta = OP_META[op.kind];
  const [value, setValue] = useState(op.initial || '');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const Icon = Icons[meta.icon];

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Rename → preselect the basename; move → preselect the folder portion.
    const v = el.value;
    const slash = v.lastIndexOf('/');
    if (op.kind === 'rename' && slash >= 0) el.setSelectionRange(slash + 1, v.length);
    else if (op.kind === 'move' && slash >= 0) el.setSelectionRange(0, slash + 1);
    else el.select();
  }, [op.kind]);

  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await onSubmit(v);
    if (!ok) setBusy(false);   // leave the modal open on failure
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <span className="modal-title">{meta.title}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="form-section">
          <div className="input-group">
            <label className="input-label">{meta.label}</label>
            <input ref={inputRef} className="input mono" value={value} placeholder={meta.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
            <div className="input-hint">
              {op.kind === 'new-folder'
                ? 'Empty folders live in your draft until they contain a file — Git can’t commit an empty folder.'
                : 'A path relative to the site root. Use “/” for subfolders.'}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" disabled={!value.trim() || busy} onClick={submit}>
            {busy ? <Icons.Loader size={13} className="spin" /> : <Icon size={13} />} {meta.verb}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hidden-input color button for the format bar (text / highlight color).
function ColorButton({ icon: Icon, title, onPick, underline }) {
  const ref = useRef(null);
  const [val, setVal] = useState(underline);
  return (
    <button className="icon-btn se-color-btn" title={title} onClick={() => ref.current?.click()}>
      <Icon size={13} />
      <span className="se-color-underline" style={{ background: val }} />
      <input ref={ref} type="color" value={val}
        onChange={(e) => { setVal(e.target.value); onPick(e.target.value); }} />
    </button>
  );
}

function FormatBar({ send, onInsertImage, onBackground }) {
  const cmd = (c, v) => send({ type: 'se-cmd', cmd: c, value: v });
  return (
    <div className="editor-format-bar">
      <select className="input se-fmt-select" defaultValue=""
        onChange={(e) => { if (e.target.value) cmd('formatBlock', e.target.value); e.target.value = ''; }}>
        <option value="" disabled>Block</option>
        {BLOCKS.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}
      </select>
      <select className="input se-fmt-select" defaultValue=""
        onChange={(e) => { if (e.target.value) cmd('fontName', e.target.value); e.target.value = ''; }}>
        <option value="" disabled>Font</option>
        {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
      </select>
      <select className="input se-fmt-select" defaultValue=""
        onChange={(e) => { if (e.target.value) cmd('fontSize', e.target.value); e.target.value = ''; }}>
        <option value="" disabled>Size</option>
        {SIZES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>

      <div className="se-fmt-sep" />

      <button className="icon-btn" title="Bold" onClick={() => cmd('bold')}><Icons.Bold size={13} /></button>
      <button className="icon-btn" title="Italic" onClick={() => cmd('italic')}><Icons.Italic size={13} /></button>
      <button className="icon-btn" title="Underline" onClick={() => cmd('underline')}><Icons.Underline size={13} /></button>
      <button className="icon-btn" title="Strikethrough" onClick={() => cmd('strikeThrough')}><Icons.Strikethrough size={13} /></button>
      <button className="icon-btn" title="Subscript" onClick={() => cmd('subscript')}><Icons.Subscript size={13} /></button>
      <button className="icon-btn" title="Superscript" onClick={() => cmd('superscript')}><Icons.Superscript size={13} /></button>

      <div className="se-fmt-sep" />

      <ColorButton icon={Icons.Type} title="Text color" underline="#e2e8f0" onPick={(v) => cmd('foreColor', v)} />
      <ColorButton icon={Icons.Droplet} title="Highlight color" underline="#f59e0b" onPick={(v) => cmd('hiliteColor', v)} />

      <div className="se-fmt-sep" />

      <button className="icon-btn" title="Align left" onClick={() => cmd('justifyLeft')}><Icons.AlignLeft size={13} /></button>
      <button className="icon-btn" title="Align center" onClick={() => cmd('justifyCenter')}><Icons.AlignCenter size={13} /></button>
      <button className="icon-btn" title="Align right" onClick={() => cmd('justifyRight')}><Icons.AlignRight size={13} /></button>
      <button className="icon-btn" title="Justify" onClick={() => cmd('justifyFull')}><Icons.AlignJustify size={13} /></button>

      <div className="se-fmt-sep" />

      <button className="icon-btn" title="Insert link" onClick={() => {
        const url = window.prompt('Link URL:');
        if (url) cmd('createLink', url);
      }}><Icons.Link size={13} /></button>
      <button className="icon-btn" title="Insert image" onClick={onInsertImage}><Icons.Image size={13} /></button>
      <button className="icon-btn" title="Background (page or element)" onClick={onBackground}><Icons.Palette size={13} /></button>
      <button className="icon-btn" title="Remove formatting" onClick={() => cmd('removeFormat')}><Icons.Eraser size={13} /></button>

      <span className="text-xs text-muted se-fmt-hint">
        Click text to edit · click an image to replace it
      </span>
    </div>
  );
}

export function SiteEditor() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { me, sites, refreshSites, toast } = useApp();
  const site = sites.find((s) => s.id === siteId);

  const [files, setFiles] = useState([]);
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState(null);       // selected file path
  const [mode, setMode] = useState('edit');           // edit | preview
  const [view, setView] = useState('visual');         // visual | code (HTML files)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildLog, setBuildLog] = useState(null);
  const [codeContent, setCodeContent] = useState(null); // code-view / text-file editing
  const [showPush, setShowPush] = useState(false);
  const [imageModal, setImageModal] = useState(null);   // { mode: 'replace'|'insert', imgId?, src? }
  const [bgModal, setBgModal] = useState(null);          // { picking: bool, picked: string|null }
  const [fileOp, setFileOp] = useState(null);            // { kind, initial, target } — file-management modal
  const [menuFor, setMenuFor] = useState(null);          // path whose row action menu is open
  const [dirContext, setDirContext] = useState('');      // folder to prefill in new-file/new-folder
  const [frameNonce, setFrameNonce] = useState(0);
  const iframeRef = useRef(null);
  const htmlRequests = useRef(new Map());
  const reqSeq = useRef(0);

  const isHtml = current ? /\.html?$/i.test(current) : false;
  const inCodeEditor = current && (!isHtml || view === 'code') && mode === 'edit';

  const loadFiles = useCallback(async () => {
    if (!site || site.status !== 'ready') return;
    try {
      const list = await api.get(`/sites/${siteId}/files`);
      setFiles(list);
      // Default selection: index.html, else the first HTML file.
      setCurrent((cur) => {
        if (cur && list.some((f) => f.path === cur)) return cur;
        const html = list.filter((f) => f.html);
        return (html.find((f) => f.path === 'index.html') || html[0] || list.find((f) => f.text))?.path ?? null;
      });
    } catch (err) {
      toast('error', err.message);
    }
  }, [site?.status, siteId, toast]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Load file content whenever the code editor is the active surface.
  useEffect(() => {
    setCodeContent(null);
    setBuildLog(null);
    if (!current || !(!isHtml || view === 'code')) return;
    api.get(`/sites/${siteId}/file?path=${encodeURIComponent(current)}`)
      .then((f) => setCodeContent(f.content))
      .catch((err) => toast('error', err.message));
  }, [current, isHtml, view, siteId, frameNonce]);

  // Messages from the editor iframe runtime.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'se-dirty') setDirty(true);
      else if (d.type === 'se-image') setImageModal({ mode: 'replace', imgId: d.imgId, src: d.src });
      else if (d.type === 'se-picked') setBgModal({ picking: false, picked: d.desc });
      else if (d.type === 'se-html') {
        const pending = htmlRequests.current.get(d.requestId);
        if (pending) { htmlRequests.current.delete(d.requestId); pending(d.html); }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const sendToFrame = (msg) => iframeRef.current?.contentWindow?.postMessage(msg, '*');

  const getFrameHtml = () => new Promise((resolve, reject) => {
    const requestId = ++reqSeq.current;
    htmlRequests.current.set(requestId, resolve);
    sendToFrame({ type: 'se-get-html', requestId });
    setTimeout(() => {
      if (htmlRequests.current.delete(requestId)) reject(new Error('Editor did not respond'));
    }, 5000);
  });

  const saveDraft = async () => {
    if (!current) return false;
    setSaving(true);
    try {
      const content = (isHtml && view === 'visual' && mode === 'edit')
        ? await getFrameHtml()
        : codeContent;
      if (content == null) throw new Error('Nothing to save');
      await api.put(`/sites/${siteId}/file`, { path: current, content });
      setDirty(false);
      await refreshSites();
      await loadFiles();
      toast('success', `Draft saved — ${current}`);
      return true;
    } catch (err) {
      toast('error', `Save failed: ${err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    if (site.draft && !window.confirm('You have a saved draft. Syncing keeps it, but the site underneath will update. Continue?')) return;
    setSyncing(true);
    try {
      const res = await api.post(`/sites/${siteId}/sync`);
      toast('success', `Synced: ${res.detail || 'up to date'}`);
      if (res.draftWarning) toast('warning', res.draftWarning);
      await refreshSites();
      await loadFiles();
      setFrameNonce((n) => n + 1);
    } catch (err) {
      toast('error', err.message);
    } finally {
      setSyncing(false);
    }
  };

  const openPreview = async () => {
    // Preview shows saved drafts — persist the current editor state first.
    if (dirty) { const ok = await saveDraft(); if (!ok) return; }
    setBuildLog(null);
    if (site.build_cmd) {
      setBuilding(true);
      try {
        await api.post(`/sites/${siteId}/preview`);
      } catch (err) {
        setBuildLog(err.log || err.message);
        setBuilding(false);
        toast('error', 'Build failed');
        return;
      }
      setBuilding(false);
    }
    setMode('preview');
    setFrameNonce((n) => n + 1);
  };

  const discardDraft = async () => {
    if (!window.confirm('Discard your entire draft for this site? This cannot be undone.')) return;
    try {
      await api.del(`/sites/${siteId}/draft`);
      setDirty(false);
      setFrameNonce((n) => n + 1);
      await refreshSites();
      await loadFiles();
      toast('success', 'Draft discarded');
    } catch (err) {
      toast('error', err.message);
    }
  };

  const switchFile = (path) => {
    if (dirty && !window.confirm('You have unsaved changes in this file. Discard them?')) return;
    setDirty(false);
    setCurrent(path);
    setMode('edit');
    setView('visual');
    setFrameNonce((n) => n + 1);
  };

  // Visual ⇄ code toggle for HTML files. The current state is saved as a
  // draft first so the other editor picks up exactly what was on screen.
  const switchView = async (v) => {
    if (v === view || !isHtml) return;
    if (dirty) { const ok = await saveDraft(); if (!ok) return; }
    setView(v);
    setFrameNonce((n) => n + 1);
  };

  const startElementPick = () => {
    setBgModal({ picking: true, picked: bgModal?.picked ?? null });
    sendToFrame({ type: 'se-pick-element' });
  };

  const cancelElementPick = () => {
    sendToFrame({ type: 'se-cancel-pick' });
    setBgModal({ picking: false, picked: bgModal?.picked ?? null });
  };

  // ── File-management operations (draft-level) ──────────────────────────────
  const NEW_HTML = '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>New page</title>\n</head>\n<body>\n  <h1>New page</h1>\n</body>\n</html>\n';

  const reloadFiles = async () => { await refreshSites(); await loadFiles(); setFrameNonce((n) => n + 1); };

  const openOp = (kind, f) => { setMenuFor(null); setFileOp({ kind, initial: f.path, target: f.path }); };
  const openNew = (kind) => setFileOp({ kind, initial: dirContext ? `${dirContext}/` : '' });

  const createFileFront = async (path) => {
    try {
      await api.post(`/sites/${siteId}/file`, { path, content: /\.html?$/i.test(path) ? NEW_HTML : '' });
      setFileOp(null);
      setDirty(false);
      await reloadFiles();
      setCurrent(path); setMode('edit'); setView(/\.html?$/i.test(path) ? 'visual' : 'code');
      toast('success', `Created ${path}`);
      return true;
    } catch (err) { toast('error', err.message); return false; }
  };

  const createFolderFront = async (path) => {
    try {
      await api.post(`/sites/${siteId}/folder`, { path });
      setFileOp(null);
      await reloadFiles();
      toast('success', `Created folder ${path}`);
      return true;
    } catch (err) { toast('error', err.message); return false; }
  };

  const moveEntryFront = async (from, to) => {
    try {
      // Preserve unsaved edits to the file being moved before it changes path.
      if (dirty && from === current) { const ok = await saveDraft(); if (!ok) return false; }
      await api.post(`/sites/${siteId}/move`, { from, to });
      setFileOp(null);
      setDirty(false);
      const next = current === from ? to
        : (current && current.startsWith(`${from}/`)) ? `${to}${current.slice(from.length)}` : current;
      await reloadFiles();
      if (next !== current) { setCurrent(next); setMode('edit'); setView('visual'); }
      toast('success', `Moved to ${to}`);
      return true;
    } catch (err) { toast('error', err.message); return false; }
  };

  const deleteEntryFront = async (path) => {
    setMenuFor(null);
    const affectsCurrent = path === current || (current && current.startsWith(`${path}/`));
    if (!window.confirm(`Delete ${path}?\n\nIt is removed from your draft and, when you push, from GitHub.`)) return;
    try {
      await api.del(`/sites/${siteId}/entry?path=${encodeURIComponent(path)}`);
      if (affectsCurrent) { setDirty(false); setMode('edit'); setView('visual'); }
      if (dirContext === path || (dirContext && dirContext.startsWith(`${path}/`))) setDirContext('');
      await reloadFiles();
      toast('success', `Deleted ${path}`);
    } catch (err) { toast('error', err.message); }
  };

  const visibleFiles = useMemo(
    () => files.filter((f) => (f.dir || f.html || f.text) && f.path.toLowerCase().includes(filter.toLowerCase())),
    [files, filter],
  );

  if (!site) {
    return <div className="empty-state"><div className="empty-state-text">Site not found</div></div>;
  }
  if (site.status !== 'ready') {
    return (
      <div className="card">
        <div className="empty-state">
          {site.status === 'cloning'
            ? <><Icons.Loader size={30} className="spin empty-state-icon" />
                <div className="empty-state-text">Cloning repository…</div>
                <div className="empty-state-sub mono">{site.repo_url}</div></>
            : <><Icons.XCircle size={30} className="empty-state-icon" style={{ color: 'var(--red)' }} />
                <div className="empty-state-text">Clone failed</div>
                <div className="empty-state-sub mono" style={{ whiteSpace: 'pre-wrap' }}>{site.error}</div>
                {me?.isAdmin && (
                  <button className="btn btn-sec btn-sm mt-2"
                    onClick={() => api.post(`/sites/${siteId}/reclone`).then(refreshSites)}>
                    <Icons.RefreshCw size={13} /> Retry clone
                  </button>
                )}</>}
        </div>
      </div>
    );
  }

  const canSync = me?.isAdmin || site.user_can_sync;
  const canPush = me?.isAdmin || site.user_can_push;
  // Built sites are previewed from their build output, whose paths don't map
  // 1:1 to source files — open those at the site root. Static sites preview
  // the page being edited.
  const previewPath = site.build_cmd || !isHtml ? '' : (current ?? '');
  const frameSrc = mode === 'preview'
    ? apiUrl(`/sites/${siteId}/preview/${previewPath}`)
    : apiUrl(`/sites/${siteId}/edit/${current ?? ''}`);
  const showFrame = current && mode === 'edit' ? (isHtml && view === 'visual') : Boolean(current);

  return (
    <>
      {/* ── Action toolbar ── */}
      <div className="editor-toolbar">
        <div className="flex items-center gap-2">
          <span className="badge badge-blue mono">{site.branch}</span>
          <span className="text-xs text-muted">synced {timeAgo(site.last_synced_at)} · pushed {timeAgo(site.last_pushed_at)}</span>
          {site.draft && <span className="badge badge-orange">{site.draft.files.length} drafted</span>}
          {dirty && <span className="badge badge-red">unsaved</span>}
        </div>
        <div className="flex items-center gap-2">
          {mode === 'edit' && isHtml && (
            <div className="se-seg">
              <button className={`se-seg-btn${view === 'visual' ? ' active' : ''}`} onClick={() => switchView('visual')}>
                <Icons.Eye size={12} /> Visual
              </button>
              <button className={`se-seg-btn${view === 'code' ? ' active' : ''}`} onClick={() => switchView('code')}>
                <Icons.Code size={12} /> Code
              </button>
            </div>
          )}
          {canSync && (
            <button className="btn btn-sec btn-sm" disabled={syncing} onClick={sync} title="Pull the latest from GitHub">
              {syncing ? <Icons.Loader size={13} className="spin" /> : <Icons.DownloadCloud size={13} />} Sync
            </button>
          )}
          <button className="btn btn-sec btn-sm" disabled={saving || !current} onClick={saveDraft}>
            {saving ? <Icons.Loader size={13} className="spin" /> : <Icons.Save size={13} />} Save Draft
          </button>
          {mode === 'edit'
            ? <button className="btn btn-sec btn-sm" disabled={building || !current} onClick={openPreview}>
                {building ? <Icons.Loader size={13} className="spin" /> : <Icons.Eye size={13} />}
                {building ? 'Building…' : 'Preview'}
              </button>
            : <button className="btn btn-sec btn-sm" onClick={() => { setMode('edit'); setFrameNonce((n) => n + 1); }}>
                <Icons.Edit size={13} /> Back to Editor
              </button>}
          {canPush && (
            <button className="btn btn-pri btn-sm" disabled={!site.draft} onClick={() => setShowPush(true)}
              title={site.draft ? 'Commit and push your draft' : 'Save a draft first'}>
              <Icons.UploadCloud size={13} /> Push to GitHub
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/sites/${siteId}/history`)}>
            <Icons.History size={13} /> History
          </button>
          {site.draft && (
            <button className="btn btn-danger btn-xs" onClick={discardDraft} title="Discard your draft">
              <Icons.Trash size={12} />
            </button>
          )}
        </div>
      </div>

      {buildLog && (
        <div className="alert alert-err mb-3">
          <div className="font-bold mb-2">Build failed</div>
          <pre className="editor-build-log">{buildLog}</pre>
        </div>
      )}

      {/* ── Formatting toolbar (visual HTML editing only) ── */}
      {mode === 'edit' && isHtml && view === 'visual' && (
        <FormatBar
          send={sendToFrame}
          onInsertImage={() => setImageModal({ mode: 'insert' })}
          onBackground={() => setBgModal({ picking: false, picked: null })}
        />
      )}

      {/* ── Element-pick hint bar ── */}
      {bgModal?.picking && (
        <div className="se-pick-banner">
          <Icons.Search size={13} />
          Click an element in the page to select it for the background…
          <button className="btn btn-ghost btn-xs" onClick={cancelElementPick}>Cancel</button>
        </div>
      )}

      {/* ── Main layout: file list + editing surface ── */}
      <div className="editor-layout">
        <div className="editor-files card">
          <div className="card-header">
            <span className="card-title">Pages &amp; Files</span>
            <div className="flex items-center gap-1">
              <button className="icon-btn" title="New file" onClick={() => openNew('new-file')}>
                <Icons.FilePlus size={14} />
              </button>
              <button className="icon-btn" title="New folder" onClick={() => openNew('new-folder')}>
                <Icons.FolderPlus size={14} />
              </button>
            </div>
          </div>
          <div className="editor-files-search">
            <input className="input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="editor-files-list">
            {visibleFiles.map((f) => (
              <div key={f.path} className={`editor-file-row${menuFor === f.path ? ' menu-open' : ''}`}>
                <button
                  className={`editor-file-item${f.path === current ? ' active' : ''}`}
                  onClick={() => f.dir ? setDirContext(dirContext === f.path ? '' : f.path) : switchFile(f.path)}
                  title={f.path}>
                  {f.dir ? <Icons.Folder size={13} /> : f.html ? <Icons.FileText size={13} /> : <Icons.Code size={13} />}
                  <span className="truncate" style={{ flex: 1, textAlign: 'left' }}>{f.path}</span>
                  {f.draft && !f.dir && <span className="editor-file-draft-dot" title="Drafted" />}
                </button>
                <button className="icon-btn editor-file-menu-btn" title="File actions"
                  onClick={() => setMenuFor(menuFor === f.path ? null : f.path)}>
                  <Icons.MoreVertical size={13} />
                </button>
                {menuFor === f.path && (
                  <div className="editor-file-menu">
                    <button onClick={() => openOp('rename', f)}><Icons.Edit size={12} /> Rename</button>
                    <button onClick={() => openOp('move', f)}><Icons.Move size={12} /> Move</button>
                    <button className="danger" onClick={() => deleteEntryFront(f.path)}><Icons.Trash size={12} /> Delete</button>
                  </div>
                )}
              </div>
            ))}
            {visibleFiles.length === 0 && <div className="text-sm text-muted" style={{ padding: 10 }}>No editable files</div>}
          </div>
        </div>

        <div className="editor-stage card">
          {showFrame && (
            <iframe
              key={`${mode}-${current}-${frameNonce}`}
              ref={iframeRef}
              className="editor-frame"
              title={mode === 'preview' ? 'Site preview' : 'Site editor'}
              src={frameSrc}
            />
          )}
          {inCodeEditor && (
            codeContent === null
              ? <div className="empty-state"><Icons.Loader size={22} className="spin" /></div>
              : <textarea
                  className="editor-code"
                  value={codeContent}
                  spellCheck={false}
                  onChange={(e) => { setCodeContent(e.target.value); setDirty(true); }}
                />
          )}
          {!current && (
            <div className="empty-state">
              <Icons.FileText size={30} className="empty-state-icon" />
              <div className="empty-state-text">Select a file to edit</div>
            </div>
          )}
        </div>
      </div>

      {menuFor && <div className="editor-menu-backdrop" onClick={() => setMenuFor(null)} />}

      {fileOp && (
        <FileOpModal op={fileOp} onClose={() => setFileOp(null)}
          onSubmit={(value) => {
            if (fileOp.kind === 'new-file') return createFileFront(value);
            if (fileOp.kind === 'new-folder') return createFolderFront(value);
            return moveEntryFront(fileOp.target, value); // rename & move
          }} />
      )}

      {showPush && (
        <PushModal site={site} onClose={() => setShowPush(false)}
          onPushed={async () => {
            setShowPush(false);
            setDirty(false);
            await refreshSites();
            await loadFiles();
            setFrameNonce((n) => n + 1);
          }} />
      )}
      {imageModal && (
        <ImageModal mode={imageModal.mode} current={imageModal.src} siteId={siteId}
          filePath={current || 'index.html'}
          onClose={() => setImageModal(null)}
          onApply={(src) => {
            if (imageModal.mode === 'replace') {
              sendToFrame({ type: 'se-set-image', imgId: imageModal.imgId, src });
            } else {
              sendToFrame({ type: 'se-insert-image', src });
            }
            setImageModal(null);
            setDirty(true);
          }} />
      )}
      {bgModal && !bgModal.picking && (
        <BackgroundModal siteId={siteId} filePath={current || 'index.html'}
          picked={bgModal.picked}
          onPickElement={startElementPick}
          onClose={() => setBgModal(null)}
          onApply={(target, css) => {
            sendToFrame({ type: 'se-set-bg', target, css });
            setBgModal(null);
            setDirty(true);
          }} />
      )}
    </>
  );
}
