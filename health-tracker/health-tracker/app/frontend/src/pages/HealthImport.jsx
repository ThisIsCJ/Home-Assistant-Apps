import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';

const SUPPORTED = [
  { label: 'Samsung Health', items: ['Steps', 'Heart Rate', 'Blood Pressure', 'SpO2', 'Sleep stages'] },
  { label: 'Health Connect', items: ['Steps', 'Heart Rate', 'SpO2', 'Calories Burned'] },
  { label: 'Health Tracker Export', items: ['health_readings.csv from the Data export'] },
  { label: 'Unknown format', items: ['AI will map columns automatically if you have a provider configured in Settings'] },
];

function FileIcon({ name }) {
  const ext = name.split('.').pop().toLowerCase();
  const color = ext === 'zip' ? '#f97316' : '#60a5fa';
  return (
    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 700,
      background: color + '22', color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>
      .{ext}
    </span>
  );
}

function ReadingRow({ r }) {
  const dt = r.takenAt ? new Date(r.takenAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—';
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px', fontSize: '0.73rem', color: 'var(--muted2)', whiteSpace: 'nowrap' }}>{dt}</td>
      <td style={{ padding: '5px 10px', fontSize: '0.73rem', color: 'var(--accent2)', fontFamily: 'monospace' }}>{r.metricKey}</td>
      <td style={{ padding: '5px 10px', fontSize: '0.73rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{r.value}</td>
      <td style={{ padding: '5px 10px', fontSize: '0.7rem', color: 'var(--muted)' }}>{r.unit}</td>
    </tr>
  );
}

function FileCard({ result, onDiscard }) {
  const [expanded, setExpanded] = useState(false);
  const isError = !!result.error;
  const preview = result.preview || [];

  return (
    <div style={{
      border: `1px solid ${isError ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
      borderRadius: 10,
      background: 'var(--card)',
      overflow: 'clip',
    }}>
      {/* File header */}
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: isError || preview.length > 0 ? '1px solid var(--border)' : 'none' }}>
        <FileIcon name={result.filename} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {result.filename}
          </div>
          {!isError && (
            <div style={{ fontSize: '0.68rem', color: 'var(--muted2)', marginTop: 2 }}>
              {result.format_label}
              {result.ai_used && <span style={{ marginLeft: 6, color: '#a855f7', fontWeight: 600 }}>✦ AI mapped</span>}
            </div>
          )}
        </div>
        {!isError && (
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent2)', flexShrink: 0 }}>
            {result.count.toLocaleString()} readings
          </span>
        )}
      </div>

      {/* Error */}
      {isError && (
        <div style={{ padding: '10px 14px', fontSize: '0.73rem', color: 'var(--red)', lineHeight: 1.5 }}>
          {result.error}
          {result.columns && (
            <div style={{ marginTop: 6, color: 'var(--muted2)' }}>
              Columns found: <span style={{ fontFamily: 'monospace' }}>{result.columns.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Preview toggle */}
      {!isError && preview.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ width: '100%', padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--muted)',
              borderBottom: expanded ? '1px solid var(--border)' : 'none' }}
          >
            <Icons.ChevronRight size={12} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            {expanded ? 'Hide' : 'Show'} preview ({Math.min(preview.length, 10)} of {result.count})
          </button>

          {expanded && (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Date / Time', 'Metric', 'Value', 'Unit'].map(h => (
                      <th key={h} style={{ padding: '5px 10px', textAlign: 'left', fontSize: '0.6rem', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => <ReadingRow key={i} r={r} />)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HealthImport() {
  const { accessToken } = useAuth();
  const [dragOver, setDragOver]   = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [analysis, setAnalysis]   = useState(null);   // { session_id, files, total_count }
  const [result, setResult]       = useState(null);   // commit result
  const [error, setError]         = useState('');
  const fileRef = useRef(null);

  const reset = () => { setAnalysis(null); setResult(null); setError(''); };

  // Safe fetch wrapper — always returns parsed body or throws with a readable message
  const apiFetch = useCallback(async (url, options = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { detail: text.trim() || res.statusText }; }
    if (!res.ok) throw new Error(data?.detail || data?.message || `Server error ${res.status}`);
    return data;
  }, [accessToken]);

  const analyze = useCallback(async (file) => {
    if (!file || !accessToken) return;
    setAnalyzing(true);
    setAnalysis(null);
    setResult(null);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await apiFetch('/api/health-import/analyze', { method: 'POST', body: form });
      setAnalysis(data);
    } catch (e) {
      setError(e.message || 'Failed to analyze file');
    } finally {
      setAnalyzing(false);
    }
  }, [accessToken, apiFetch]);

  const commit = async () => {
    if (!analysis?.session_id) return;
    setCommitting(true);
    setError('');
    try {
      const data = await apiFetch(`/api/health-import/commit/${analysis.session_id}`, { method: 'POST' });
      setResult(data);
      setAnalysis(null);
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setCommitting(false);
    }
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) analyze(file);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) analyze(file);
  };

  const importableCount = analysis ? analysis.files.filter(f => !f.error && f.count > 0).length : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Health Data Import</div>
          <div className="text-muted text-sm mt-1">Import CSV files from Samsung Health, Health Connect, or any wearable</div>
        </div>
      </div>

      <div style={{ maxWidth: 740, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Supported formats info */}
        {!analysis && !result && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><Icons.Info size={13} /> Supported Formats</div>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {SUPPORTED.map(({ label, items }) => (
                  <div key={label} style={{ background: 'var(--bg-2,var(--card2))', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--fg,var(--text))', marginBottom: 6 }}>{label}</div>
                    <ul style={{ paddingLeft: 14, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {items.map(i => <li key={i} style={{ fontSize: '0.68rem', color: 'var(--muted2)' }}>{i}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                All existing readings are <strong style={{ color: 'var(--text)' }}>updated, never duplicated</strong> — re-importing the same file is safe.
                Deduplication key: <span style={{ fontFamily: 'monospace' }}>(userId, metricKey, timestamp)</span>.
                ZIP archives containing multiple CSVs are processed in one shot.
              </div>
            </div>
          </div>
        )}

        {/* Drop zone */}
        {!analysis && !result && (
          <div
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : analyzing ? 'var(--accent2)' : 'var(--border2)'}`,
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
              cursor: analyzing ? 'default' : 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
              background: dragOver ? 'rgba(20,184,166,0.05)' : 'transparent',
            }}
            onClick={() => !analyzing && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <input ref={fileRef} type="file" accept=".csv,.zip" style={{ display: 'none' }} onChange={onFileChange} />
            {analyzing ? (
              <>
                <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>⏳</div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)', marginBottom: 4 }}>Analyzing file…</div>
                <div style={{ fontSize: '0.73rem', color: 'var(--muted)' }}>Detecting format and parsing data</div>
              </>
            ) : (
              <>
                <Icons.Upload size={32} style={{ opacity: 0.35, display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)', marginBottom: 6 }}>
                  Drop a file here or click to browse
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                  Accepts <span style={{ fontFamily: 'monospace' }}>.csv</span> or <span style={{ fontFamily: 'monospace' }}>.zip</span> (multiple CSVs)
                </div>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--red)' }}>
            {error}
          </div>
        )}

        {/* Analysis results */}
        {analysis && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>
                  {analysis.total_count.toLocaleString()} readings ready to import
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>
                  {importableCount} file{importableCount !== 1 ? 's' : ''} • all data will be upserted (no duplicates)
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                if (analysis.session_id) {
                  apiFetch(`/api/health-import/session/${analysis.session_id}`, { method: 'DELETE' }).catch(() => {});
                }
                reset();
              }}>
                ← Back
              </button>
              <button
                className="btn btn-pri"
                onClick={commit}
                disabled={committing || analysis.total_count === 0}
                style={{ minWidth: 140 }}
              >
                {committing ? 'Importing…' : `Import ${analysis.total_count.toLocaleString()} Readings`}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {analysis.files.map((f, i) => <FileCard key={i} result={f} />)}
            </div>
          </>
        )}

        {/* Import result */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '20px 18px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--green2)', marginBottom: 12 }}>
                ✓ Import complete
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, textAlign: 'center' }}>
                {[
                  { label: 'New readings', value: result.inserted, color: 'var(--green2)' },
                  { label: 'Updated', value: result.updated, color: 'var(--accent2)' },
                  { label: 'Unchanged', value: result.skipped, color: 'var(--muted2)' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>
                      {value?.toLocaleString() ?? 0}
                    </div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginTop: 4 }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button className="btn btn-sec btn-sm" onClick={reset} style={{ alignSelf: 'flex-start' }}>
              Import another file
            </button>
          </div>
        )}
      </div>
    </>
  );
}
