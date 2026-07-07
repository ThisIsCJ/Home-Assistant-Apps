import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, apiUrl } from '../lib/api.js';
import { useApp, timeAgo } from '../lib/state.jsx';
import { Icons } from '../components/Icons.jsx';

// Compute the document-relative prefix for a site-root-relative asset path,
// e.g. editing "blog/post.html" → "../assets/x.png".
const rootPrefix = (filePath) => '../'.repeat(filePath.split('/').length - 1);

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

function ImageModal({ current, onApply, onClose, siteId, filePath }) {
  const { toast } = useApp();
  const [url, setUrl] = useState(current || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const uploadFile = async (file) => {
    setBusy(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const dest = `assets/uploads/${Date.now()}-${safeName}`;
      await api.upload(`/sites/${siteId}/asset?path=${encodeURIComponent(dest)}`, file);
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
          <span className="modal-title">Replace image</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="form-section">
          <div className="input-group">
            <label className="input-label">Image URL</label>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or a path inside the site" />
            <div className="input-hint">Use a full URL, or upload a file below — it is stored in the site under assets/uploads/.</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
          <button className="btn btn-sec" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Icons.Loader size={13} className="spin" /> : <Icons.Image size={13} />} Upload image…
          </button>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" disabled={!url.trim()} onClick={() => onApply(url.trim())}>Apply</button>
        </div>
      </div>
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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildLog, setBuildLog] = useState(null);
  const [textContent, setTextContent] = useState(null); // non-HTML text editing
  const [showPush, setShowPush] = useState(false);
  const [imageTarget, setImageTarget] = useState(null); // { imgId, src }
  const [frameNonce, setFrameNonce] = useState(0);
  const iframeRef = useRef(null);
  const htmlRequests = useRef(new Map());
  const reqSeq = useRef(0);

  const isHtml = current ? /\.html?$/i.test(current) : false;

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

  // Non-HTML files are edited in a plain text editor.
  useEffect(() => {
    setTextContent(null);
    setDirty(false);
    setBuildLog(null);
    if (!current || isHtml) return;
    api.get(`/sites/${siteId}/file?path=${encodeURIComponent(current)}`)
      .then((f) => setTextContent(f.content))
      .catch((err) => toast('error', err.message));
  }, [current, isHtml, siteId, frameNonce]);

  // Messages from the editor iframe runtime.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'se-dirty') setDirty(true);
      else if (d.type === 'se-image') setImageTarget({ imgId: d.imgId, src: d.src });
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
      const content = isHtml ? await getFrameHtml() : textContent;
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
    setFrameNonce((n) => n + 1);
  };

  const visibleFiles = useMemo(
    () => files.filter((f) => (f.html || f.text) && f.path.toLowerCase().includes(filter.toLowerCase())),
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

      {/* ── Formatting toolbar (HTML editing only) ── */}
      {mode === 'edit' && isHtml && (
        <div className="editor-format-bar">
          <button className="icon-btn" title="Bold" onClick={() => sendToFrame({ type: 'se-cmd', cmd: 'bold' })}><Icons.Bold size={13} /></button>
          <button className="icon-btn" title="Italic" onClick={() => sendToFrame({ type: 'se-cmd', cmd: 'italic' })}><Icons.Italic size={13} /></button>
          <button className="icon-btn" title="Underline" onClick={() => sendToFrame({ type: 'se-cmd', cmd: 'underline' })}><Icons.Underline size={13} /></button>
          <div className="divider" style={{ width: 1, height: 18 }} />
          <select className="input" style={{ width: 'auto', padding: '3px 6px' }} defaultValue=""
            onChange={(e) => { if (e.target.value) sendToFrame({ type: 'se-cmd', cmd: 'formatBlock', value: e.target.value }); e.target.value = ''; }}>
            <option value="" disabled>Block…</option>
            <option value="H1">Heading 1</option>
            <option value="H2">Heading 2</option>
            <option value="H3">Heading 3</option>
            <option value="P">Paragraph</option>
          </select>
          <button className="icon-btn" title="Insert link" onClick={() => {
            const url = window.prompt('Link URL:');
            if (url) sendToFrame({ type: 'se-cmd', cmd: 'createLink', value: url });
          }}><Icons.Link size={13} /></button>
          <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>
            Click any text to edit it · click an image to replace it
          </span>
        </div>
      )}

      {/* ── Main layout: file list + editing surface ── */}
      <div className="editor-layout">
        <div className="editor-files card">
          <div className="card-header">
            <span className="card-title">Pages &amp; Files</span>
          </div>
          <div className="editor-files-search">
            <input className="input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="editor-files-list">
            {visibleFiles.map((f) => (
              <button key={f.path}
                className={`editor-file-item${f.path === current ? ' active' : ''}`}
                onClick={() => switchFile(f.path)}>
                {f.html ? <Icons.FileText size={13} /> : <Icons.Code size={13} />}
                <span className="truncate" style={{ flex: 1, textAlign: 'left' }}>{f.path}</span>
                {f.draft && <span className="editor-file-draft-dot" title="Drafted" />}
              </button>
            ))}
            {visibleFiles.length === 0 && <div className="text-sm text-muted" style={{ padding: 10 }}>No editable files</div>}
          </div>
        </div>

        <div className="editor-stage card">
          {current && (isHtml || mode === 'preview') && (
            <iframe
              key={`${mode}-${current}-${frameNonce}`}
              ref={iframeRef}
              className="editor-frame"
              title={mode === 'preview' ? 'Site preview' : 'Site editor'}
              src={frameSrc}
            />
          )}
          {current && !isHtml && mode === 'edit' && (
            textContent === null
              ? <div className="empty-state"><Icons.Loader size={22} className="spin" /></div>
              : <textarea
                  className="editor-code"
                  value={textContent}
                  spellCheck={false}
                  onChange={(e) => { setTextContent(e.target.value); setDirty(true); }}
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
      {imageTarget && (
        <ImageModal current={imageTarget.src} siteId={siteId} filePath={current || 'index.html'}
          onClose={() => setImageTarget(null)}
          onApply={(src) => {
            sendToFrame({ type: 'se-set-image', imgId: imageTarget.imgId, src });
            setImageTarget(null);
            setDirty(true);
          }} />
      )}
    </>
  );
}
