import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from '../components/Icons';
import api from '../lib/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];

const LEVEL_STYLE = {
  DEBUG:   { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  INFO:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  WARNING: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  ERROR:   { color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtTs(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function LevelBadge({ level }) {
  const s = LEVEL_STYLE[level] ?? LEVEL_STYLE.INFO;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4,
      fontSize: '0.67rem', fontWeight: 700, letterSpacing: '0.05em',
      color: s.color, background: s.bg, minWidth: 60, textAlign: 'center',
    }}>
      {level}
    </span>
  );
}

// ── Tab shell ─────────────────────────────────────────────────────────────────

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 2, borderBottom: '1px solid var(--border)',
      marginBottom: 20, overflowX: 'auto',
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 16px', fontSize: '0.82rem', fontWeight: active === t.id ? 700 : 400,
            color: active === t.id ? 'var(--accent)' : 'var(--muted2)',
            borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1, whiteSpace: 'nowrap', transition: 'color 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Logs tab ──────────────────────────────────────────────────────────────────

function LogRow({ entry }) {
  const [open, setOpen] = useState(false);
  const hasDetails = entry.details && Object.keys(entry.details).length > 0;
  const s = LEVEL_STYLE[entry.level] ?? LEVEL_STYLE.INFO;

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
      <div
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: hasDetails ? 'pointer' : 'default' }}
        onClick={() => hasDetails && setOpen(o => !o)}
      >
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.7rem', color: 'var(--muted)', whiteSpace: 'nowrap', paddingTop: 1, minWidth: 130 }}>
          {fmtTs(entry.timestamp)}
        </span>
        <LevelBadge level={entry.level} />
        <span style={{ fontSize: '0.72rem', color: 'var(--muted2)', whiteSpace: 'nowrap', minWidth: 90 }}>
          {entry.source}
        </span>
        <span style={{ fontSize: '0.78rem', flex: 1, color: s.color, wordBreak: 'break-word' }}>
          {entry.message}
        </span>
        {hasDetails && (
          <Icons.ChevronDown size={12} style={{
            color: 'var(--muted)', flexShrink: 0, marginTop: 2,
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
          }} />
        )}
      </div>
      {open && hasDetails && (
        <pre style={{
          marginTop: 6, marginLeft: 210,
          fontSize: '0.7rem', color: 'var(--muted2)', background: 'var(--bg-3,var(--bg3))',
          borderRadius: 5, padding: '8px 10px', overflowX: 'auto', lineHeight: 1.5,
        }}>
          {JSON.stringify(entry.details, null, 2)}
        </pre>
      )}
    </div>
  );
}

function LogsTab({ accessToken }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [filterLevel, setFilterLevel] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef(null);

  const fetchLogs = useCallback(async (skip = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200, skip });
      if (filterLevel) params.set('level', filterLevel);
      if (filterSource) params.set('source', filterSource);
      const data = await api.get(`/admin/sparky/logs?${params}`, accessToken);
      setLogs(prev => skip > 0 ? [...prev, ...(data.logs ?? [])] : (data.logs ?? []));
      setTotal(data.total ?? 0);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [accessToken, filterLevel, filterSource]);

  useEffect(() => { fetchLogs(0); }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => fetchLogs(0), 5000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, fetchLogs]);

  const clearLogs = async () => {
    if (!confirm('Clear all Sparky Bridge logs?')) return;
    await api.delete('/admin/sparky/logs', accessToken);
    setLogs([]);
    setTotal(0);
  };

  const sources = [...new Set(logs.map(l => l.source))].sort();

  return (
    <div className="panel">
      <div className="panel__header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>
          Sparky Bridge Logs
          {total > 0 && (
            <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
              {logs.length} of {total}
            </span>
          )}
        </span>

        {sources.length > 1 && (
          <select
            className="input"
            style={{ fontSize: '0.75rem', padding: '3px 8px', height: 28, width: 130 }}
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
          >
            <option value="">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        <select
          className="input"
          style={{ fontSize: '0.75rem', padding: '3px 8px', height: 28, width: 110 }}
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
        >
          <option value="">All levels</option>
          {LEVELS.map(l => <option key={l} value={l}>{l}+</option>)}
        </select>

        <button
          className={`btn btn-sm${autoRefresh ? ' btn--primary' : ''}`}
          onClick={() => setAutoRefresh(v => !v)}
          title={autoRefresh ? 'Stop auto-refresh' : 'Auto-refresh every 5s'}
        >
          <Icons.Refresh size={13} />
          <span style={{ marginLeft: 4 }}>{autoRefresh ? 'Live' : 'Auto'}</span>
        </button>

        <button className="btn btn-sm" onClick={() => fetchLogs(0)} disabled={loading} title="Refresh">
          <Icons.Refresh size={13} style={{ opacity: loading ? 0.4 : 1 }} />
        </button>

        <button className="btn btn-sm" onClick={clearLogs} title="Clear all logs" style={{ color: 'var(--red)' }}>
          <Icons.Trash size={13} />
        </button>
      </div>

      <div className="panel__body" style={{ padding: '0 14px' }}>
        {loading && logs.length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: '20px 0' }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: '20px 0' }}>
            No log entries. Make sure the Sparky Bridge is running and has processed at least one request.
          </div>
        ) : (
          <>
            {logs.map(entry => <LogRow key={entry.id} entry={entry} />)}
            {logs.length < total && (
              <div style={{ padding: '12px 0', textAlign: 'center' }}>
                <button className="btn btn-sm" onClick={() => fetchLogs(logs.length)} disabled={loading}>
                  {loading ? 'Loading…' : `Load more (${total - logs.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Config tab ────────────────────────────────────────────────────────────────

function ConfigTab({ accessToken }) {
  const [logLevel, setLogLevel] = useState('INFO');
  const [savedLevel, setSavedLevel] = useState('INFO');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/admin/sparky/config', accessToken)
      .then(d => { setLogLevel(d.logLevel); setSavedLevel(d.logLevel); })
      .catch(() => {});
  }, [accessToken]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/sparky/config', { logLevel }, accessToken);
      setSavedLevel(logLevel);
      setMsg('Saved');
    } catch {
      setMsg('Error saving');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 2000);
    }
  };

  return (
    <div className="panel">
      <div className="panel__header">Sparky Bridge</div>
      <div className="panel__body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div className="setting-row">
          <div className="setting-row__meta">
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Log Level</div>
            <div className="text-xs text-muted" style={{ marginTop: 3 }}>
              Only entries at or above this level are stored. DEBUG is very verbose — use for troubleshooting only.
              Changes take effect within 30 seconds.
            </div>
          </div>
          <div className="setting-row__control" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="seg">
              {LEVELS.map(l => (
                <button
                  key={l}
                  className={`seg__btn${logLevel === l ? ' is-active' : ''}`}
                  onClick={() => setLogLevel(l)}
                  style={logLevel === l ? { color: LEVEL_STYLE[l].color } : {}}
                >
                  {l}
                </button>
              ))}
            </div>
            <button
              className="btn btn--primary btn-sm"
              onClick={save}
              disabled={saving || logLevel === savedLevel}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && (
              <span style={{ fontSize: '0.78rem', color: msg === 'Saved' ? 'var(--green2)' : 'var(--red)' }}>
                {msg}
              </span>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginBottom: 10 }}>
            Level Reference
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { level: 'DEBUG',   desc: 'Every request, each individual reading outcome. Very high volume.' },
              { level: 'INFO',    desc: 'Sync start/complete summaries, startup events. Recommended for normal operation.' },
              { level: 'WARNING', desc: 'Unknown metric keys, malformed timestamps, 4xx responses.' },
              { level: 'ERROR',   desc: 'Server-side failures and 5xx responses only.' },
            ].map(({ level, desc }) => (
              <div key={level} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <LevelBadge level={level} />
                <span style={{ fontSize: '0.78rem', color: 'var(--muted2)' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'logs',   label: 'Logs'   },
  { id: 'config', label: 'Config' },
];

export default function Admin() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState('logs');

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Admin Portal</div>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'logs'   && <LogsTab   accessToken={accessToken} />}
      {tab === 'config' && <ConfigTab accessToken={accessToken} />}
    </>
  );
}
