import { useEffect, useRef, useState } from 'react';
import { getApiBase } from '../../lib/env.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { Icons, StatusIcon } from '../../components/Icons.jsx';

const DB_TYPES = [
  { value: 'mongodb',    label: 'MongoDB',              hint: 'Standard MongoDB or MongoDB Atlas.' },
  { value: 'documentdb', label: 'Amazon DocumentDB',    hint: 'AWS DocumentDB (MongoDB-compatible). TLS required.' },
  { value: 'cosmosdb',   label: 'Azure Cosmos DB',      hint: 'Azure Cosmos DB for MongoDB API.' },
];

function ConfirmModal({ title, body, confirmLabel, onConfirm, onClose, danger }) {
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '0.78rem', color: 'var(--muted2)', margin: 0 }}>{body}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-pri'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Database() {
  const { accessToken } = useAuth();
  const [dbType, setDbType]       = useState('mongodb');
  const [importing, setImporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const fileRef = useRef(null);

  // Connection config (managed in-app, applied via add-on restart)
  const [dbConfig, setDbConfig] = useState(null);
  const [uriInput, setUriInput] = useState('');
  const [testing, setTesting]   = useState(false);
  const [testMsg, setTestMsg]   = useState(null);
  const [savingDb, setSavingDb] = useState(false);
  const [dbMsg, setDbMsg]       = useState(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);

  const loadDbConfig = async () => {
    try {
      const cfg = await api.get('/admin/db/config', accessToken);
      setDbConfig(cfg);
    } catch { /* leave null */ }
  };

  useEffect(() => {
    if (accessToken) loadDbConfig();
  }, [accessToken]);

  const handleTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await api.post('/admin/db/config/test', { uri: uriInput.trim() }, accessToken);
      setTestMsg({ ok: r.ok, msg: r.ok ? (r.message || 'Connected successfully.') : r.message });
    } catch (err) {
      setTestMsg({ ok: false, msg: err.message });
    } finally {
      setTesting(false);
    }
  };

  const doSaveDb = async () => {
    setShowSaveConfirm(false);
    setSavingDb(true);
    setDbMsg(null);
    try {
      const r = await api.post('/admin/db/config', { uri: uriInput.trim() }, accessToken);
      setDbMsg({ ok: true, msg: r.message || 'Saved. Restarting…' });
    } catch (err) {
      setDbMsg({ ok: false, msg: err.message });
    } finally {
      setSavingDb(false);
    }
  };

  const doRevertDb = async () => {
    setShowRevertConfirm(false);
    setSavingDb(true);
    setDbMsg(null);
    try {
      const r = await api.del('/admin/db/config', accessToken);
      setDbMsg({ ok: true, msg: r.message || 'Reverted. Restarting…' });
    } catch (err) {
      setDbMsg({ ok: false, msg: err.message });
    } finally {
      setSavingDb(false);
    }
  };

  const handleExport = async () => {
    setExportMsg(null);
    try {
      const res = await fetch(`${getApiBase()}/admin/db/export`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `backup-${Date.now()}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setExportMsg({ ok: true, msg: 'Backup downloaded.' });
    } catch (err) {
      setExportMsg({ ok: false, msg: err.message });
    }
  };

  const triggerImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setPendingFile(file);
    setShowImportConfirm(true);
  };

  const doImport = async () => {
    if (!pendingFile) return;
    setShowImportConfirm(false);
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('backup', pendingFile);
      const res = await fetch(`${getApiBase()}/admin/db/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Import failed');
      const total = Object.values(data.collections || {}).reduce((s, n) => s + n, 0);
      setImportResult({ ok: true, msg: `Restored ${total} documents across ${Object.keys(data.collections || {}).length} collections.` });
    } catch (err) {
      setImportResult({ ok: false, msg: err.message });
    } finally {
      setImporting(false);
      setPendingFile(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Database</h1>
          <span className="page-subtitle">Connection info, backup, and restore.</span>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        {/* Connection card */}
        <div className="card">
          <div className="card-header">
            <span className="card-title green" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icons.Database size={13} /> Connection
            </span>
            {dbConfig && (
              dbConfig.connected
                ? <span className="badge badge-green"><StatusIcon status="success" size={11} />Connected</span>
                : <span className="badge badge-red"><StatusIcon status="failed" size={11} />Disconnected</span>
            )}
          </div>
          <div className="card-body">
            <div className="alert alert-info" style={{ marginBottom: 14 }}>
              <Icons.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {dbConfig?.source === 'external'
                ? <>Using an external database: <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{dbConfig.uri}</code></>
                : <>Using the bundled MongoDB. Enter an external connection string below to migrate. Saving restarts the add-on to apply the change.</>
              }
            </div>

            <div className="input-group">
              <label className="input-label">Database type</label>
              <select className="input" value={dbType} onChange={e => setDbType(e.target.value)}>
                {DB_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <span className="input-hint">{DB_TYPES.find(t => t.value === dbType)?.hint}</span>
            </div>

            <div className="input-group">
              <label className="input-label">Connection string</label>
              <input
                className="input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
                placeholder="mongodb+srv://user:password@cluster.example.com/devops-platform"
                value={uriInput}
                onChange={e => { setUriInput(e.target.value); setTestMsg(null); }}
              />
              <span className="input-hint">Standard <code>mongodb://</code> or <code>mongodb+srv://</code> URI, including credentials and database name.</span>
            </div>

            {testMsg && (
              <div className={`alert ${testMsg.ok ? 'alert-ok' : 'alert-err'}`} style={{ marginBottom: 10 }}>
                <StatusIcon status={testMsg.ok ? 'success' : 'failed'} size={13} />
                {testMsg.msg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sec btn-sm" onClick={handleTest} disabled={testing || savingDb || !uriInput.trim()}>
                {testing ? <Icons.Loader size={13} className="spin" /> : <Icons.Activity size={13} />}
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button className="btn btn-pri btn-sm" onClick={() => setShowSaveConfirm(true)} disabled={savingDb || !uriInput.trim()}>
                {savingDb ? <Icons.Loader size={13} className="spin" /> : <Icons.Check size={13} />}
                Save &amp; restart
              </button>
              {dbConfig?.source === 'external' && (
                <button className="btn btn-sec btn-sm" style={{ color: 'var(--red)', borderColor: 'rgba(239,68,68,0.3)' }} onClick={() => setShowRevertConfirm(true)} disabled={savingDb}>
                  <Icons.XCircle size={13} /> Revert to bundled
                </button>
              )}
            </div>

            {dbMsg && (
              <div className={`alert ${dbMsg.ok ? 'alert-ok' : 'alert-err'}`} style={{ marginTop: 10 }}>
                <StatusIcon status={dbMsg.ok ? 'success' : 'failed'} size={13} />
                {dbMsg.msg}
              </div>
            )}
          </div>
        </div>

        {/* Backup / restore card */}
        <div className="card">
          <div className="card-header">
            <span className="card-title blue" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icons.Download size={13} /> Backup &amp; Restore
            </span>
          </div>
          <div className="card-body">
            <div className="form-section">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <p style={{ fontSize: '0.74rem', color: 'var(--muted2)', marginBottom: 10 }}>
                    Export a full snapshot of all collections to a JSON file. Use this to migrate between database providers or create a point-in-time backup.
                  </p>
                  <button className="btn btn-sec btn-sm" onClick={handleExport}>
                    <Icons.Download size={13} />
                    Export all data as JSON
                  </button>
                  {exportMsg && (
                    <div className={`alert ${exportMsg.ok ? 'alert-ok' : 'alert-err'}`} style={{ marginTop: 8 }}>
                      <StatusIcon status={exportMsg.ok ? 'success' : 'failed'} size={13} />
                      {exportMsg.msg}
                    </div>
                  )}
                </div>

                <div className="divider" />

                <div>
                  <p style={{ fontSize: '0.74rem', color: 'var(--muted2)', marginBottom: 10 }}>
                    Import a previously exported JSON backup. <strong style={{ color: 'var(--red)' }}>This will overwrite all existing data.</strong>
                  </p>
                  <button
                    className="btn btn-sec btn-sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={importing}
                  >
                    {importing ? <Icons.Loader size={13} className="spin" /> : <Icons.Download size={13} style={{ transform: 'rotate(180deg)' }} />}
                    {importing ? 'Importing…' : 'Import JSON backup'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={triggerImport}
                  />
                  {importResult && (
                    <div className={`alert ${importResult.ok ? 'alert-ok' : 'alert-err'}`} style={{ marginTop: 8 }}>
                      <StatusIcon status={importResult.ok ? 'success' : 'failed'} size={13} />
                      {importResult.msg}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showImportConfirm && (
        <ConfirmModal
          title="Overwrite all data?"
          body={`Importing "${pendingFile?.name}" will delete all existing data and replace it with the backup contents. This cannot be undone.`}
          confirmLabel="Yes, import"
          danger
          onConfirm={doImport}
          onClose={() => { setShowImportConfirm(false); setPendingFile(null); }}
        />
      )}

      {showSaveConfirm && (
        <ConfirmModal
          title="Change database & restart?"
          body="The connection will be verified, then the add-on will restart to reconnect all services to the new database. The platform is briefly unavailable during the restart. Existing data is not migrated — use Export/Import for that."
          confirmLabel="Save & restart"
          danger
          onConfirm={doSaveDb}
          onClose={() => setShowSaveConfirm(false)}
        />
      )}

      {showRevertConfirm && (
        <ConfirmModal
          title="Revert to bundled database?"
          body="The add-on will restart and reconnect to the bundled MongoDB stored in /data/mongodb. Data in the external database is not copied back."
          confirmLabel="Revert & restart"
          danger
          onConfirm={doRevertDb}
          onClose={() => setShowRevertConfirm(false)}
        />
      )}
    </div>
  );
}
