import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';

function DomainModal({ domain, onClose, onSave }) {
  const [form, setForm] = useState(domain || { domain_name: '', cloudflare_zone_id: '', nginx_cert_profile: '', dns_target: '', active: true });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (error) {
      alert(error.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{domain ? 'Edit Domain' : 'Add Domain'}</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="input-group">
            <label className="input-label">Domain name *</label>
            <input className="input" placeholder="example.com" value={form.domain_name} onChange={(event) => set('domain_name', event.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">Cloudflare Zone ID</label>
            <input className="input" placeholder="abc123…" value={form.cloudflare_zone_id} onChange={(event) => set('cloudflare_zone_id', event.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">DNS target</label>
            <input className="input" placeholder="example.com or proxy target" value={form.dns_target || ''} onChange={(event) => set('dns_target', event.target.value)} />
            <span className="input-hint">Subdomain requests create proxied CNAME records pointing here.</span>
          </div>
          <div className="input-group">
            <label className="input-label">NGINX cert profile</label>
            <input className="input" placeholder="*.example.com" value={form.nginx_cert_profile} onChange={(event) => set('nginx_cert_profile', event.target.value)} />
          </div>
          <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.76rem' }}>
            <input type="checkbox" checked={form.active} onChange={(event) => set('active', event.target.checked)} />
            Active
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={save} disabled={saving || !form.domain_name}>
            {saving ? 'Saving…' : 'Save domain'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessModal({ resource, resourceType, onClose, accessToken }) {
  const [grants, setGrants] = useState([]);
  const [principals, setPrincipals] = useState({ users: [], teams: [] });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ principal_type: 'user', principal_id: '' });
  const [saving, setSaving] = useState(false);

  const pathBase = `/admin/${resourceType}/${resource._id}/access`;

  const load = async () => {
    const [grantData, principalData] = await Promise.all([
      api.get(pathBase, accessToken),
      api.get('/admin/principals', accessToken),
    ]);
    setGrants(grantData.grants || []);
    setPrincipals(principalData || { users: [], teams: [] });
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const options = useMemo(
    () => (form.principal_type === 'team' ? principals.teams || [] : principals.users || []),
    [form.principal_type, principals]
  );

  const add = async () => {
    if (!form.principal_id) return;
    setSaving(true);
    try {
      await api.post(pathBase, form, accessToken);
      await load();
      setForm((current) => ({ ...current, principal_id: '' }));
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (grantId) => {
    try {
      await api.del(`${pathBase}/${grantId}`, accessToken);
      await load();
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span className="modal-title">Access — <span className="mono">{resource.domain_name || resource.name}</span></span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="input-group">
              <label className="input-label">Principal type</label>
              <select className="input" value={form.principal_type} onChange={(event) => setForm((current) => ({ ...current, principal_type: event.target.value, principal_id: '' }))}>
                <option value="user">User</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div className="input-group" style={{ flex: 1 }}>
              <label className="input-label">Principal</label>
              <select className="input" value={form.principal_id} onChange={(event) => setForm((current) => ({ ...current, principal_id: event.target.value }))}>
                <option value="">Select…</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2 justify-end" style={{ marginBottom: 12 }}>
            <button className="btn btn-pri btn-sm" onClick={add} disabled={saving || !form.principal_id}>
              {saving ? 'Adding…' : 'Add access'}
            </button>
          </div>

          <div className="table-wrap">
            {loading ? <div className="empty-state" style={{ padding: 16 }}><Icons.Loader size={18} className="spin" style={{ color: 'var(--muted)' }} /></div>
            : grants.length === 0 ? <div className="empty-state" style={{ padding: 16 }}><div className="empty-state-sub">No access grants yet.</div></div>
            : (
              <table>
                <thead><tr><th>Type</th><th>Principal</th><th></th></tr></thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant._id}>
                      <td><span className={`badge ${grant.principal_type === 'team' ? 'badge-purple' : 'badge-blue'}`}>{grant.principal_type}</span></td>
                      <td>{grant.principal_label || grant.principal_id}</td>
                      <td><button className="btn btn-xs btn-danger" onClick={() => remove(grant._id)}><Icons.Trash size={11} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function Domains() {
  const { accessToken } = useAuth();
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal] = useState(null);
  const [accessModal, setAccessModal] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});
  const [recordsByDomain, setRecordsByDomain] = useState({});

  const load = () => api.get('/admin/domains', accessToken).then((data) => setDomains(data.domains || data));
  useEffect(() => { if (accessToken) load().finally(() => setLoading(false)); }, [accessToken]);

  const save = async (form) => {
    if (form._id) await api.patch(`/admin/domains/${form._id}`, form, accessToken);
    else await api.post('/admin/domains', form, accessToken);
    await load();
  };

  const toggle = async (domain) => {
    await api.patch(`/admin/domains/${domain._id}`, { active: !domain.active }, accessToken);
    await load();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await api.post('/admin/domains/refresh', {}, accessToken);
      await load();
    } catch (error) {
      alert(error.message);
    } finally {
      setSyncing(false);
    }
  };

  const loadRecords = async (domainId) => {
    setRecordsByDomain((current) => ({
      ...current,
      [domainId]: {
        ...(current[domainId] || {}),
        loading: true,
        error: '',
      },
    }));

    try {
      const data = await api.get(`/admin/domains/${domainId}/records`, accessToken);
      setRecordsByDomain((current) => ({
        ...current,
        [domainId]: {
          loading: false,
          loaded: true,
          error: '',
          items: data.records || [],
        },
      }));
    } catch (error) {
      setRecordsByDomain((current) => ({
        ...current,
        [domainId]: {
          loading: false,
          loaded: false,
          error: error.message,
          items: [],
        },
      }));
    }
  };

  const toggleExpanded = async (domainId) => {
    const willOpen = !expandedRows[domainId];
    setExpandedRows((current) => ({ ...current, [domainId]: willOpen }));
    if (!willOpen) return;

    const existing = recordsByDomain[domainId];
    if (!existing || (!existing.loaded && !existing.loading)) {
      await loadRecords(domainId);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Domains</h1>
          <span className="page-subtitle">Pull zones from Cloudflare, set DNS targets, and control who can request each domain.</span>
        </div>
        <div className="page-actions">
          <button className="btn btn-sec" onClick={sync} disabled={syncing}>
            {syncing ? <Icons.Loader size={14} className="spin" /> : <Icons.RefreshCw size={14} />}
            {syncing ? 'Importing…' : 'Import All'}
          </button>
          <button className="btn btn-pri" onClick={() => setModal({})}>
            <Icons.Plus size={14} /> Add Domain
          </button>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <div className="empty-state"><Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} /></div>
        : domains.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icons.Globe size={28} /></div>
            <div className="empty-state-text">No domains configured</div>
            <div className="empty-state-sub">Sync from Cloudflare or add a domain manually.</div>
          </div>
        ) : (
          <table>
            <thead><tr><th style={{ width: 44 }}></th><th>Domain</th><th>Zone ID</th><th>DNS target</th><th>Cert profile</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {domains.map((domain) => {
                const expanded = Boolean(expandedRows[domain._id]);
                const recordState = recordsByDomain[domain._id] || { loading: false, loaded: false, error: '', items: [] };

                return (
                  <Fragment key={domain._id}>
                    <tr>
                      <td>
                        <button className="icon-btn" onClick={() => toggleExpanded(domain._id)} title={expanded ? 'Hide DNS records' : 'Show DNS records'}>
                          {expanded ? <Icons.ChevronDown size={13} /> : <Icons.ChevronRight size={13} />}
                        </button>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        <span className="mono">{domain.domain_name}</span>
                      </td>
                      <td className="mono" style={{ color: 'var(--muted2)' }}>{domain.cloudflare_zone_id || '—'}</td>
                      <td className="mono" style={{ color: 'var(--muted2)' }}>{domain.dns_target || domain.domain_name || '—'}</td>
                      <td style={{ color: 'var(--muted2)' }}>{domain.nginx_cert_profile || '—'}</td>
                      <td><span className={`badge ${domain.active ? 'badge-green' : 'badge-muted'}`}>{domain.active ? 'Active' : 'Inactive'}</span></td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-xs btn-sec" onClick={() => setAccessModal(domain)}>Access</button>
                          <button className="btn btn-xs btn-sec" onClick={() => setModal(domain)}><Icons.Edit size={11} /></button>
                          <button className="btn btn-xs btn-sec" onClick={() => toggle(domain)}>{domain.active ? 'Disable' : 'Enable'}</button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="domain-detail-row">
                        <td colSpan={7} className="domain-detail-cell">
                          <div className="domain-records-panel">
                            <div className="domain-records-head">
                              <div className="flex-col gap-1">
                                <span className="font-bold">DNS Records</span>
                                <div className="domain-records-meta">
                                  <span>Zone ID: <span className="mono">{domain.cloudflare_zone_id || '—'}</span></span>
                                  {domain.cloudflare_account_name ? <span>Account: {domain.cloudflare_account_name}</span> : null}
                                  {(domain.cloudflare_name_servers || []).length ? <span>NS: {domain.cloudflare_name_servers.join(', ')}</span> : null}
                                </div>
                              </div>
                              <button className="btn btn-sec btn-xs" onClick={() => loadRecords(domain._id)} disabled={recordState.loading}>
                                {recordState.loading ? <Icons.Loader size={11} className="spin" /> : <Icons.RefreshCw size={11} />}
                                {recordState.loading ? 'Refreshing…' : 'Refresh'}
                              </button>
                            </div>

                            {recordState.loading && !recordState.loaded ? (
                              <div className="empty-state" style={{ padding: 18 }}>
                                <Icons.Loader size={18} className="spin" style={{ color: 'var(--muted)' }} />
                              </div>
                            ) : recordState.error ? (
                              <div className="alert alert-err">
                                <Icons.AlertTriangle size={14} style={{ flexShrink: 0 }} />
                                {recordState.error}
                              </div>
                            ) : recordState.items?.length ? (
                              <div className="table-wrap domain-records-table">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Type</th>
                                      <th>Name</th>
                                      <th>Content</th>
                                      <th>Proxied</th>
                                      <th>TTL</th>
                                      <th>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {recordState.items.map((record) => (
                                      <tr key={record.id}>
                                        <td><span className="badge badge-blue">{record.type}</span></td>
                                        <td className="td-mono">{record.name}</td>
                                        <td className="td-mono">{record.content || '—'}</td>
                                        <td>{record.proxied == null ? '—' : record.proxied ? 'Yes' : 'No'}</td>
                                        <td>{record.ttl === 1 ? 'Auto' : record.ttl || '—'}</td>
                                        <td>{record.proxiable === false ? <span className="badge badge-muted">DNS Only</span> : record.proxied ? <span className="badge badge-orange">Proxied</span> : <span className="badge badge-muted">Direct</span>}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="empty-state" style={{ padding: 18 }}>
                                <div className="empty-state-text">No DNS records found</div>
                                <div className="empty-state-sub">Cloudflare returned an empty record set for this zone.</div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && <DomainModal domain={modal._id ? modal : null} onClose={() => setModal(null)} onSave={save} />}
      {accessModal && <AccessModal resource={accessModal} resourceType="domains" onClose={() => setAccessModal(null)} accessToken={accessToken} />}
    </div>
  );
}
