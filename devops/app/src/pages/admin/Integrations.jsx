import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons, StatusIcon } from '../../components/Icons.jsx';

function IntCard({ provider, title, icon: Icon, color, fields, current, onSave, accessToken, extraActions }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (!current) return;
    setForm({
      auth_mode: current.auth_mode || (current.api_key ? 'global_key' : 'token'),
      ...current,
    });
  }, [current]);

  const visibleFields = useMemo(
    () => fields.filter((field) => !field.showWhen || field.showWhen(form)),
    [fields, form]
  );

  const set = (key, value) => setForm((currentForm) => ({ ...currentForm, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const { _id, ...payload } = form;
      await onSave(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post(`/admin/integrations/${provider}/test`, form, accessToken);
      setTestResult({ ok: result.ok, msg: result.message });
    } catch (error) {
      setTestResult({ ok: false, msg: error.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className={`card-title ${color}`} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon size={13} /> {title}
        </span>
        {current?.active && <span className="badge badge-green">Connected</span>}
      </div>
      <div className="card-body">
        <div className="form-section">
          {visibleFields.map((field) => (
            <div className="input-group" key={field.key}>
              <label className="input-label">{field.label}</label>
              {field.type === 'select' ? (
                <select className="input" value={form[field.key] || field.defaultValue || ''} onChange={(event) => set(field.key, event.target.value)}>
                  {(field.options || []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  type={field.secret ? 'password' : field.type || 'text'}
                  placeholder={field.placeholder || ''}
                  value={form[field.key] || ''}
                  onChange={(event) => set(field.key, event.target.value)}
                  autoComplete="off"
                />
              )}
              {field.hint && <span className="input-hint">{field.hint}</span>}
            </div>
          ))}

          {testResult && (
            <div className={`alert ${testResult.ok ? 'alert-ok' : 'alert-err'}`}>
              <StatusIcon status={testResult.ok ? 'success' : 'failed'} size={13} />
              {testResult.msg}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                {extraActions}
              </div>
              <div className="flex gap-2 justify-end" style={{ marginLeft: 'auto' }}>
                <button className="btn btn-sec btn-sm" onClick={testConn} disabled={testing}>
                  {testing ? <Icons.Loader size={13} className="spin" /> : <Icons.Wifi size={13} />}
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                <button className="btn btn-pri btn-sm" onClick={save} disabled={saving}>
                  {saved ? <><Icons.Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneSyncModal({ provider, accessToken, onClose }) {
  const [zones, setZones] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const buildSelection = (nextZones, previousSelection = null) => {
    const nextSelection = {};
    nextZones.forEach((zone) => {
      if (zone.already_added) return;
      nextSelection[zone.id] = previousSelection?.[zone.id] ?? true;
    });
    return nextSelection;
  };

  const loadZones = async ({ preserveSelection = false } = {}) => {
    if (loading) setLoading(true);
    else setRefreshing(true);
    setResult(null);

    try {
      const data = await api.get(`/admin/integrations/${provider}/zones`, accessToken);
      const nextZones = data.zones || [];
      setZones(nextZones);
      setSelected((current) => buildSelection(nextZones, preserveSelection ? current : null));
    } catch (error) {
      setZones([]);
      setSelected({});
      setResult({ ok: false, msg: error.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadZones();
  }, []);

  const selectableZones = zones.filter((zone) => !zone.already_added);
  const selectedZoneIds = selectableZones.filter((zone) => selected[zone.id]).map((zone) => zone.id);
  const allSelected = selectableZones.length > 0 && selectedZoneIds.length === selectableZones.length;

  const toggleAll = () => {
    const nextChecked = !allSelected;
    setSelected(
      Object.fromEntries(
        selectableZones.map((zone) => [zone.id, nextChecked])
      )
    );
  };

  const toggleOne = (zoneId) => {
    setSelected((current) => ({ ...current, [zoneId]: !current[zoneId] }));
  };

  const importSelected = async () => {
    if (!selectedZoneIds.length) return;
    setImporting(true);
    setResult(null);
    try {
      const response = await api.post(`/admin/integrations/${provider}/import`, { zone_ids: selectedZoneIds }, accessToken);
      const count = response.imported_count || 0;
      await loadZones({ preserveSelection: true });
      setResult({ ok: true, msg: `Imported ${count} domain${count === 1 ? '' : 's'} into Domains.` });
    } catch (error) {
      setResult({ ok: false, msg: error.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal sync-modal">
        <div className="modal-header">
          <span className="modal-title">Sync {provider === 'n8n' ? 'n8n' : 'Cloudflare'} Domains</span>
          <button className="icon-btn" onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="sync-toolbar">
            <div className="flex-col gap-1">
              <span className="text-sm text-muted">
                Pick which Cloudflare zones should become managed domains in this app.
              </span>
              {!loading && (
                <span className="text-xs text-muted">
                  {zones.length} zone{zones.length === 1 ? '' : 's'} visible, {selectableZones.length} available to import.
                </span>
              )}
            </div>
            <button className="btn btn-sec btn-sm" onClick={() => loadZones({ preserveSelection: true })} disabled={refreshing || importing}>
              {refreshing ? <Icons.Loader size={13} className="spin" /> : <Icons.RefreshCw size={13} />}
              {refreshing ? 'Refreshing…' : 'Refresh list'}
            </button>
          </div>

          {result && (
            <div className={`alert ${result.ok ? 'alert-ok' : 'alert-err'}`}>
              <StatusIcon status={result.ok ? 'success' : 'failed'} size={13} />
              {result.msg}
            </div>
          )}

          {loading ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} />
            </div>
          ) : zones.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-state-icon"><Icons.CloudOff size={24} /></div>
              <div className="empty-state-text">No Cloudflare zones available</div>
              <div className="empty-state-sub">Test the Cloudflare connection first, then refresh this list.</div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-muted" style={{ cursor: selectableZones.length ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={allSelected} disabled={!selectableZones.length} onChange={toggleAll} />
                  Select all available domains
                </label>
                <span className="text-xs text-muted">{selectedZoneIds.length} selected</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}></th>
                      <th>Domain</th>
                      <th>Account</th>
                      <th>Zone ID</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((zone) => (
                      <tr key={zone.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[zone.id])}
                            disabled={zone.already_added}
                            onChange={() => toggleOne(zone.id)}
                          />
                        </td>
                        <td>
                          <div className="sync-zone-name mono">{zone.name}</div>
                          <div className="sync-zone-meta">
                            {(zone.name_servers || []).length ? `NS: ${(zone.name_servers || []).join(', ')}` : 'No nameservers reported'}
                          </div>
                        </td>
                        <td>{zone.account_name || '—'}</td>
                        <td className="td-mono">{zone.id}</td>
                        <td>
                          <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                            <span className={`badge ${zone.already_added ? 'badge-green' : 'badge-blue'}`}>
                              {zone.already_added ? 'Added' : 'Available'}
                            </span>
                            {zone.paused && <span className="badge badge-orange">Paused</span>}
                            {zone.status && !zone.paused && <span className="badge badge-muted">{zone.status}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-sec" onClick={onClose}>Close</button>
          <button className="btn btn-pri" onClick={importSelected} disabled={importing || !selectedZoneIds.length}>
            {importing ? 'Importing…' : `Import Selected${selectedZoneIds.length ? ` (${selectedZoneIds.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}


export function Integrations() {
  const { accessToken } = useAuth();
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncProvider, setSyncProvider] = useState(null);

  const load = async () => {
    const data = await api.get('/admin/integrations', accessToken);
    setConfigs(data.configs || {});
  };

  useEffect(() => {
    if (!accessToken) return;
    load().finally(() => setLoading(false));
  }, [accessToken]);

  const save = (provider) => async (form) => {
    const response = await api.post(`/admin/integrations/${provider}`, { ...form, provider }, accessToken);
    setConfigs((current) => ({ ...current, [provider]: response.config || { ...form, active: true } }));
  };

  if (loading) return <div className="empty-state"><Icons.Loader size={22} className="spin" style={{ color: 'var(--muted)' }} /></div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Integrations</h1>
          <span className="page-subtitle">Configure Cloudflare, NGINX Proxy Manager, and n8n webhook integrations.</span>
        </div>
      </div>

      <div className="flex-col gap-3" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <IntCard
          provider="cloudflare"
          title="Cloudflare"
          icon={Icons.Globe}
          color="blue"
          current={configs.cloudflare}
          onSave={save('cloudflare')}
          accessToken={accessToken}
          extraActions={(
            <button className="btn btn-sec btn-sm" onClick={() => setSyncProvider('cloudflare')} disabled={!configs.cloudflare?.active}>
              <Icons.RefreshCw size={13} />
              Sync domains
            </button>
          )}
          fields={[
            {
              key: 'auth_mode',
              label: 'Credential type',
              type: 'select',
              defaultValue: 'token',
              options: [
                { value: 'token', label: 'API Token' },
                { value: 'global_key', label: 'Global API Key' },
              ],
            },
            {
              key: 'api_token',
              label: 'API Token',
              secret: true,
              placeholder: 'Cloudflare API token',
              hint: 'Use a token with Zone:Read and DNS:Edit for the zones you manage.',
              showWhen: (form) => (form.auth_mode || 'token') === 'token',
            },
            {
              key: 'account_id',
              label: 'Cloudflare Account ID',
              placeholder: '2936c64acfbc3a0c8a2af58a64cabc2c',
              hint: 'Recommended for account-scoped token verification. The app also uses it to narrow zone sync.',
            },
            {
              key: 'email',
              label: 'Cloudflare account email',
              placeholder: 'me@example.com',
              showWhen: (form) => form.auth_mode === 'global_key',
            },
            {
              key: 'api_key',
              label: 'Global API Key',
              secret: true,
              placeholder: 'Global API key',
              hint: 'Use this only if you are intentionally authenticating with the Global API key flow.',
              showWhen: (form) => form.auth_mode === 'global_key',
            },
            {
              key: 'default_zone_id',
              label: 'Fallback Zone ID',
              placeholder: 'abc123ef…',
              hint: 'Optional fallback when a synced domain has not stored its own zone ID yet.',
            },
          ]}
        />

        <IntCard
          provider="nginx"
          title="NGINX"
          icon={Icons.Server}
          color="orange"
          current={configs.nginx}
          onSave={save('nginx')}
          accessToken={accessToken}
          fields={[
            { key: 'base_url', label: 'NGINX Proxy Manager URL', placeholder: 'http://waldorf.home:81', hint: 'Base URL for the NGINX Proxy Manager web/API service.' },
            { key: 'username', label: 'Account email or username', placeholder: 'admin@example.com' },
            { key: 'password', label: 'Password', secret: true, placeholder: '••••••••' },
          ]}
        />

        <IntCard
          provider="n8n"
          title="n8n Webhooks"
          icon={Icons.Zap}
          color="green"
          current={configs.n8n}
          onSave={save('n8n')}
          accessToken={accessToken}
          extraActions={(
            <button className="btn btn-sec btn-sm" onClick={() => setSyncProvider('n8n')} disabled={!configs.n8n?.active}>
              <Icons.RefreshCw size={13} />
              Sync domains
            </button>
          )}
          fields={[
            {
              key: 'webhook_base_url',
              label: 'n8n Base URL',
              placeholder: 'https://n8n.example.com',
              hint: 'Root URL of your n8n server, e.g. https://n8n.example.com — do not include /webhook/… paths.',
            },
            {
              key: 'api_key',
              label: 'API Key',
              secret: true,
              placeholder: 'x-api-key value',
              hint: 'Sent as the x-api-key header on every webhook request.',
            },
          ]}
        />

      </div>

      {syncProvider && <ZoneSyncModal provider={syncProvider} accessToken={accessToken} onClose={() => setSyncProvider(null)} />}
    </div>
  );
}
