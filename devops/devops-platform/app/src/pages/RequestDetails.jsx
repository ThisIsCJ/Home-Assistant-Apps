import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Icons, StatusIcon } from '../components/Icons.jsx';

function fmtDate(d) { return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }) : '—'; }
function fmtMs(s, e) {
  if (!s || !e) return null;
  const ms = new Date(e) - new Date(s);
  return ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`;
}

const STEP_LABELS = {
  permission_validation:   'Access Validation',
  port_verification:       'Host Port Check',
  firewall_check:          'Firewall Rule Check',
  site_reachability:       'Site Reachability',
  nginx_route:             'NGINX Route Creation',
  cloudflare_dns:          'DNS Creation',
  teardown_dns:            'DNS Record Removal',
  teardown_nginx:          'NGINX Route Removal',
  teardown_firewall:       'Firewall Port Closure',
};

const STATUS_BADGE = {
  success:         { cls: 'badge-green',  label: 'Success'   },
  partial_success: { cls: 'badge-orange', label: 'Partial'   },
  failed:          { cls: 'badge-red',    label: 'Failed'    },
  running:         { cls: 'badge-blue',   label: 'Running'   },
  pending:         { cls: 'badge-muted',  label: 'Pending'   },
  removed:         { cls: 'badge-muted',  label: 'Removed'   },
  teardown_failed: { cls: 'badge-red',    label: 'Teardown Failed' },
};

function StepRow({ step, index }) {
  const [open, setOpen] = useState(step.status === 'failed' || step.status === 'warning');
  const duration = fmtMs(step.started_at, step.ended_at);

  return (
    <div className={`step-row step-${step.status}`}>
      <div className="step-icon-col">
        <div className={`step-dot ${step.status}`}>
          {step.status === 'running'
            ? <Icons.Loader size={12} className="spin" />
            : step.status === 'success' ? <Icons.Check size={12} />
            : step.status === 'failed'  ? <Icons.X size={12} />
            : step.status === 'warning' ? <Icons.AlertTriangle size={12} />
            : step.status === 'skipped' ? <Icons.ChevronRight size={12} />
            : <span>{index + 1}</span>}
        </div>
      </div>
      <div className="step-content">
        <div className="step-header" onClick={() => setOpen(o => !o)} role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}>
          <div>
            <div className="step-name">{STEP_LABELS[step.step_name] || step.step_name}</div>
            <div className="step-meta">
              <StatusIcon status={step.status} size={11} />
              <span style={{color: step.status === 'failed' ? 'var(--red)' : step.status === 'warning' ? 'var(--orange)' : 'var(--muted2)'}}>
                {step.summary || step.status}
              </span>
              {duration && <span>· {duration}</span>}
            </div>
          </div>
          <Icons.ChevronDown size={14} style={{color:'var(--muted)', transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.2s', flexShrink:0}} />
        </div>

        {open && (
          <div className="step-detail">
            <div className="meta-grid" style={{marginBottom: step.detail || step.detail_json ? 10 : 0}}>
              {step.started_at && <div className="meta-item">
                <span className="meta-key">Started</span>
                <span className="meta-val">{fmtDate(step.started_at)}</span>
              </div>}
              {step.ended_at && <div className="meta-item">
                <span className="meta-key">Ended</span>
                <span className="meta-val">{fmtDate(step.ended_at)}</span>
              </div>}
              {duration && <div className="meta-item">
                <span className="meta-key">Duration</span>
                <span className="meta-val mono">{duration}</span>
              </div>}
              <div className="meta-item">
                <span className="meta-key">Status</span>
                <span className={`badge ${STATUS_BADGE[step.status]?.cls || 'badge-muted'}`}>{step.status}</span>
              </div>
            </div>
            {(step.detail || step.detail_json) && (
              <pre>{typeof step.detail_json === 'object'
                ? JSON.stringify(step.detail_json, null, 2)
                : step.detail || JSON.stringify(step.detail_json, null, 2)}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RequestDetails() {
  const { id } = useParams();
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning]   = useState(false);
  const [removing, setRemoving]     = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);
  const pollRef = useRef(null);

  const load = () =>
    api.get(`/requests/${id}`, accessToken)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    if (!accessToken) return;
    load();
  }, [accessToken, id]);

  useEffect(() => {
    if (!data) return;
    const running = data.run?.final_status === 'running' || data.run?.final_status === 'pending' || !data.run?.ended_at;
    if (running) {
      pollRef.current = setInterval(load, 2000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [data]);

  const rerun = async () => {
    setRerunning(true);
    try {
      await api.post(`/requests/${id}/rerun`, {}, accessToken);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setRerunning(false);
    }
  };

  const teardown = async () => {
    setRemoving(true);
    setRemoveArmed(false);
    try {
      await api.post(`/requests/${id}/teardown`, {}, accessToken);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <div className="empty-state"><Icons.Loader size={22} className="spin" style={{color:'var(--muted)'}} /></div>;
  if (!data)   return <div className="alert alert-err"><Icons.AlertTriangle size={14} /> Request not found.</div>;

  const req  = data.request;
  const run  = data.run;
  const steps = data.steps || [];

  const successCount = steps.filter(s => s.status === 'success').length;
  const failCount    = steps.filter(s => s.status === 'failed').length;
  const warnCount    = steps.filter(s => s.status === 'warning').length;
  const finalStatus  = run?.final_status || 'pending';
  const sb = STATUS_BADGE[finalStatus] || STATUS_BADGE.pending;
  const bannerCls = finalStatus === 'success' ? 'success' : finalStatus === 'failed' || finalStatus === 'teardown_failed' ? 'failed' : finalStatus.includes('partial') ? 'partial' : finalStatus === 'running' ? 'running' : finalStatus === 'removed' ? 'success' : 'pending';
  const isTeardown = run?.run_type === 'teardown';

  return (
    <div>
      <div className="breadcrumb">
        <span style={{cursor:'pointer'}} onClick={() => navigate('/app/requests')}>Requests</span>
        <Icons.ChevronRight size={11} />
        <span className="mono" style={{color:'var(--text)'}}>{req.fqdn}</span>
      </div>

      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title mono" style={{fontSize:'0.95rem'}}>{req.fqdn}</h1>
          <span className="page-subtitle">
            <span className={`badge ${sb.cls}`}>{sb.label}</span>
            {' '} · Requested {fmtDate(req.created_at)}
          </span>
        </div>
        <div className="page-actions" style={{gap:8}}>
          {run?.final_status !== 'running' && req.status !== 'removed' && !removing && (
            <button className="btn btn-sec btn-sm" onClick={rerun} disabled={rerunning}>
              {rerunning ? <Icons.Loader size={13} className="spin" /> : <Icons.RefreshCw size={13} />}
              {rerunning ? 'Re-running…' : 'Re-run'}
            </button>
          )}
          {run?.final_status !== 'running' && req.status !== 'removed' && (
            removing
              ? <span style={{display:'flex',alignItems:'center',gap:6,fontSize:'0.72rem',color:'var(--muted2)'}}>
                  <Icons.Loader size={12} className="spin" /> Removing…
                </span>
              : removeArmed
                ? <span style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:'0.72rem',color:'var(--red)'}}>Remove {req.fqdn}?</span>
                    <button className="btn btn-danger btn-sm" onClick={teardown}>Confirm</button>
                    <button className="btn btn-sec btn-sm" onClick={() => setRemoveArmed(false)}>Cancel</button>
                  </span>
                : <button className="btn btn-danger btn-sm" onClick={() => setRemoveArmed(true)}>
                    <Icons.Trash size={13} /> Remove Site
                  </button>
          )}
        </div>
      </div>

      <div className={`status-banner ${bannerCls}`}>
        <StatusIcon status={finalStatus} size={22} />
        <div className="status-banner-stat">
          <div className="n" style={{color:'var(--green2)'}}>{successCount}</div>
          <div className="l">Succeeded</div>
        </div>
        <div className="status-banner-divider" />
        <div className="status-banner-stat">
          <div className="n" style={{color:'var(--red)'}}>{failCount}</div>
          <div className="l">Failed</div>
        </div>
        {warnCount > 0 && <>
          <div className="status-banner-divider" />
          <div className="status-banner-stat">
            <div className="n" style={{color:'var(--orange)'}}>{warnCount}</div>
            <div className="l">Warnings</div>
          </div>
        </>}
        <div className="status-banner-divider" />
        <div className="status-banner-stat" style={{textAlign:'left'}}>
          <div className="l">Last updated</div>
          <div style={{fontSize:'0.72rem',color:'var(--muted2)',marginTop:2}}>{fmtDate(run?.ended_at || run?.started_at)}</div>
        </div>
      </div>

      <div className="grid-2" style={{gap:12, marginBottom:16}}>
        <div className="card">
          <div className="card-header"><span className="card-title">Request details</span></div>
          <div className="card-body">
            <div className="meta-grid">
              <div className="meta-item"><span className="meta-key">FQDN</span><span className="meta-val mono">{req.fqdn}</span></div>
              <div className="meta-item"><span className="meta-key">Host</span><span className="meta-val">{req.host_name || req.host_id}</span></div>
              <div className="meta-item"><span className="meta-key">Port</span><span className="meta-val mono">{req.host_port}</span></div>
              <div className="meta-item"><span className="meta-key">Domain</span><span className="meta-val mono">{req.domain_name || req.domain_id}</span></div>
              {req.subdomain && <div className="meta-item"><span className="meta-key">Subdomain</span><span className="meta-val mono">{req.subdomain}</span></div>}
              <div className="meta-item"><span className="meta-key">Requested</span><span className="meta-val">{fmtDate(req.created_at)}</span></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Run info</span></div>
          <div className="card-body">
            <div className="meta-grid">
              <div className="meta-item"><span className="meta-key">Run ID</span><span className="meta-val mono" style={{fontSize:'0.65rem'}}>{run?._id || '—'}</span></div>
              <div className="meta-item"><span className="meta-key">Started</span><span className="meta-val">{fmtDate(run?.started_at)}</span></div>
              <div className="meta-item"><span className="meta-key">Ended</span><span className="meta-val">{fmtDate(run?.ended_at)}</span></div>
              <div className="meta-item"><span className="meta-key">Status</span><span className={`badge ${sb.cls}`}>{sb.label}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title green">
            {isTeardown ? 'Teardown steps' : 'Workflow steps'}
          </span>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {isTeardown && <span className="badge badge-red"><Icons.Trash size={10} /> Teardown</span>}
            {finalStatus === 'running' && (
              <span className="badge badge-blue" style={{display:'flex',gap:4,alignItems:'center'}}>
                <Icons.Loader size={10} className="spin" /> Live
              </span>
            )}
          </div>
        </div>
        <div className="card-body">
          {steps.length === 0 ? (
            <div className="empty-state">
              <Icons.Loader size={20} className="spin" style={{color:'var(--muted)'}} />
              <div className="empty-state-sub">Waiting for automation to start…</div>
            </div>
          ) : (
            <div className="stepper">
              {steps.map((s, i) => <StepRow key={s._id || s.step_name} step={s} index={i} />)}
            </div>
          )}
        </div>
      </div>

      {finalStatus !== 'success' && run?.ended_at && (
        <div className="alert alert-info mt-3" style={{marginTop:12}}>
          <Icons.Info size={14} style={{flexShrink:0,marginTop:1}} />
          All steps ran independently. Expand each step to review the exact status and details. Use <strong>Re-run</strong> to retry the entire workflow.
        </div>
      )}
    </div>
  );
}
