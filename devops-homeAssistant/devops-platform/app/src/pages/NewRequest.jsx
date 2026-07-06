import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Icons } from '../components/Icons.jsx';

function validate(form) {
  const errs = {};
  if (!form.host_id)    errs.host_id  = 'Select a host';
  if (!form.domain_id)  errs.domain_id = 'Select a domain';
  if (!form.host_port)  errs.host_port = 'Enter a port number';
  else if (form.host_port < 1 || form.host_port > 65535) errs.host_port = 'Port must be between 1 and 65535';
  if (form.subdomain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(form.subdomain))
    errs.subdomain = 'Subdomain must contain only lowercase letters, numbers, and hyphens';
  return errs;
}

export function NewRequest() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();

  const [options, setOptions] = useState({ hosts: [], domains: [] });
  const [form, setForm]       = useState({ host_id: '', domain_id: '', subdomain: '', host_port: '' });
  const [errs, setErrs]       = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/app/options', accessToken)
      .then(setOptions)
      .catch(e => setLoadErr(e.message));
  }, [accessToken]);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrs(e => { const n = { ...e }; delete n[k]; return n; });
  };

  const selectedDomain = options.domains.find(d => d._id === form.domain_id);
  const preview = form.subdomain
    ? `${form.subdomain}.${selectedDomain?.domain_name || '<domain>'}`
    : selectedDomain?.domain_name || '<domain>';

  const submit = async () => {
    const errors = validate({ ...form, host_port: Number(form.host_port) });
    if (Object.keys(errors).length) { setErrs(errors); return; }

    setSubmitting(true);
    try {
      const result = await api.post('/requests', {
        host_id:   form.host_id,
        domain_id: form.domain_id,
        subdomain: form.subdomain || null,
        host_port: Number(form.host_port),
      }, accessToken);
      navigate(`/app/requests/${result._id}`);
    } catch (e) {
      setErrs({ _: e.message });
      setSubmitting(false);
    }
  };

  if (loadErr) return (
    <div className="alert alert-err">
      <Icons.AlertTriangle size={14} style={{flexShrink:0}} />
      Failed to load options: {loadErr}. Check your connection and try again.
    </div>
  );

  return (
    <div style={{maxWidth:580, width:'100%'}}>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">New Site Request</h1>
          <span className="page-subtitle">Select a host and domain you are authorized to use, enter the target port, and optionally add a subdomain.</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Request details</span></div>
        <div className="card-body">
          <div className="form-section">
            {errs._ && (
              <div className="alert alert-err">
                <Icons.AlertTriangle size={14} style={{flexShrink:0}} />
                {errs._}
              </div>
            )}

            <div className="form-row">
              <div className="input-group">
                <label className="input-label">Host *</label>
                <select className="input" value={form.host_id} onChange={e => set('host_id', e.target.value)}>
                  <option value="">Select a host…</option>
                  {options.hosts.map(h => (
                    <option key={h._id} value={h._id}>{h.name} ({h.hostname})</option>
                  ))}
                </select>
                {errs.host_id && <span className="input-error">{errs.host_id}</span>}
                {options.hosts.length === 0 && !loadErr && (
                  <span className="input-hint">No hosts are assigned to your account or teams. Contact an admin.</span>
                )}
              </div>

              <div className="input-group">
                <label className="input-label">Domain *</label>
                <select className="input" value={form.domain_id} onChange={e => set('domain_id', e.target.value)}>
                  <option value="">Select a domain…</option>
                  {options.domains.map(d => (
                    <option key={d._id} value={d._id}>{d.domain_name}</option>
                  ))}
                </select>
                {errs.domain_id && <span className="input-error">{errs.domain_id}</span>}
                {options.domains.length === 0 && !loadErr && (
                  <span className="input-hint">No domains are assigned to your account or teams. Contact an admin.</span>
                )}
              </div>
            </div>

            <div className="form-row">
              <div className="input-group">
                <label className="input-label">Subdomain <span style={{color:'var(--muted)',fontWeight:400}}>(optional)</span></label>
                <input className="input" type="text" placeholder="e.g. app, api, internal"
                  value={form.subdomain} onChange={e => set('subdomain', e.target.value.toLowerCase())} />
                {errs.subdomain
                  ? <span className="input-error">{errs.subdomain}</span>
                  : <span className="input-hint">Leave blank to use the apex domain.</span>}
              </div>

              <div className="input-group">
                <label className="input-label">Host Port *</label>
                <input className="input" type="number" placeholder="e.g. 3000" min="1" max="65535"
                  value={form.host_port} onChange={e => set('host_port', e.target.value)} />
                {errs.host_port
                  ? <span className="input-error">{errs.host_port}</span>
                  : <span className="input-hint">TCP port where your service listens on the host.</span>}
              </div>
            </div>

            {(form.domain_id) && (
              <div className="alert alert-info">
                <Icons.Globe size={14} style={{flexShrink:0,marginTop:1}} />
                <div>
                  Requested hostname: <strong className="mono">{preview}</strong>
                  {form.host_port && <> → <span className="mono">{options.hosts.find(h => h._id === form.host_id)?.hostname || 'host'}:{form.host_port}</span></>}
                </div>
              </div>
            )}

            <div className="divider" />

            <div style={{fontSize:'0.72rem', color:'var(--muted)', lineHeight:1.6}}>
              The platform will run each workflow step independently. If one step fails, the remaining steps still execute and all results are recorded.
            </div>

            <div className="flex gap-2 justify-end">
              <button className="btn btn-sec" onClick={() => navigate(-1)} disabled={submitting}>Cancel</button>
              <button className="btn btn-pri" onClick={submit} disabled={submitting}>
                {submitting ? <><Icons.Loader size={13} className="spin" /> Submitting…</> : <><Icons.Play size={13} /> Submit Request</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
