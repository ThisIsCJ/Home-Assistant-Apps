import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { Icons, StatusIcon } from '../../components/Icons.jsx';

function TileCard({ icon: Icon, iconColor, label, description, badge, badgeColor, onClick }) {
  return (
    <button className="admin-tile" onClick={onClick}>
      <div className={`admin-tile-icon ${iconColor || ''}`}>
        <Icon size={20} />
      </div>
      <div className="admin-tile-body">
        <div className="admin-tile-label">{label}</div>
        {description && <div className="admin-tile-desc">{description}</div>}
      </div>
      {badge && (
        <span className={`badge ${badgeColor || 'badge-muted'}`}>{badge}</span>
      )}
    </button>
  );
}

export function AdminOverview() {
  const { accessToken, appConfig } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/admin/stats', accessToken)
      .then(setStats)
      .catch(() => setStats({}));
  }, [accessToken]);

  const providers = appConfig?.authProviders || [];
  const authBadge = providers.length > 0 ? `${providers.length} active` : 'Not configured';
  const authBadgeColor = providers.length > 0 ? 'badge-green' : 'badge-orange';

  const brandingConfigured = Boolean(appConfig?.appName && appConfig.appName !== 'DevOps Platform');

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Admin Overview</h1>
          <span className="page-subtitle">Manage your platform configuration and infrastructure.</span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="kpi-grid" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="lbl">Users</div>
          <div className="val">{stats ? (stats.users ?? 0) : '—'}</div>
          <div className="sub">registered</div>
        </div>
        <div className="kpi">
          <div className="lbl">Teams</div>
          <div className="val purple">{stats ? (stats.teams ?? 0) : '—'}</div>
          <div className="sub">configured</div>
        </div>
        <div className="kpi">
          <div className="lbl">Hosts</div>
          <div className="val green">{stats ? (stats.hosts ?? 0) : '—'}</div>
          <div className="sub">managed</div>
        </div>
        <div className="kpi">
          <div className="lbl">Domains</div>
          <div className="val">{stats ? (stats.domains ?? 0) : '—'}</div>
          <div className="sub">configured</div>
        </div>
      </div>

      {/* Platform section */}
      <div className="page-section-label">Platform</div>
      <div className="admin-tile-grid" style={{ marginBottom: 24 }}>
        <TileCard
          icon={Icons.Palette}
          iconColor="purple"
          label="Branding"
          description="Site name, logo, favicon, colors"
          badge={brandingConfigured ? 'Configured' : 'Default'}
          badgeColor={brandingConfigured ? 'badge-green' : 'badge-muted'}
          onClick={() => navigate('/admin/branding')}
        />
        {/* OIDC providers are irrelevant under HA ingress — HA signs users in */}
        {!appConfig?.haIngress && (
          <TileCard
            icon={Icons.Shield}
            iconColor="blue"
            label="Authentication"
            description="OIDC providers: Authentik, Microsoft, Google"
            badge={authBadge}
            badgeColor={authBadgeColor}
            onClick={() => navigate('/admin/authentication')}
          />
        )}
        <TileCard
          icon={Icons.Database}
          iconColor="green"
          label="Database"
          description="Connection, backup, and restore"
          badge={stats !== null ? 'Connected' : '—'}
          badgeColor="badge-green"
          onClick={() => navigate('/admin/database')}
        />
        <TileCard
          icon={Icons.Link}
          iconColor="orange"
          label="Integrations"
          description="Cloudflare, NGINX, n8n"
          badge={stats?.integrations?.cloudflare === 'success' ? 'Connected' : 'Configure'}
          badgeColor={stats?.integrations?.cloudflare === 'success' ? 'badge-green' : 'badge-muted'}
          onClick={() => navigate('/admin/integrations')}
        />
      </div>

      {/* Management section */}
      <div className="page-section-label">Management</div>
      <div className="admin-tile-grid" style={{ marginBottom: 24 }}>
        <TileCard
          icon={Icons.User}
          iconColor="blue"
          label="Users"
          description="Manage platform users"
          badge={stats ? `${stats.users ?? 0}` : undefined}
          onClick={() => navigate('/admin/users')}
        />
        <TileCard
          icon={Icons.Users}
          iconColor="purple"
          label="Teams"
          description="Configure team access"
          badge={stats ? `${stats.teams ?? 0}` : undefined}
          onClick={() => navigate('/admin/teams')}
        />
        <TileCard
          icon={Icons.Globe}
          iconColor="green"
          label="Domains"
          description="Managed DNS zones"
          badge={stats ? `${stats.domains ?? 0}` : undefined}
          onClick={() => navigate('/admin/domains')}
        />
        <TileCard
          icon={Icons.Server}
          iconColor="orange"
          label="Hosts"
          description="Managed servers"
          badge={stats ? `${stats.hosts ?? 0}` : undefined}
          onClick={() => navigate('/admin/hosts')}
        />
      </div>

      {/* Monitoring section */}
      <div className="page-section-label">Monitoring</div>
      <div className="admin-tile-grid">
        <TileCard
          icon={Icons.Terminal}
          iconColor="blue"
          label="Automation Runs"
          description="Provisioning run history"
          onClick={() => navigate('/admin/runs')}
        />
        <TileCard
          icon={Icons.Clock}
          iconColor="muted"
          label="Audit Log"
          description="Admin action history"
          onClick={() => navigate('/admin/audit')}
        />
        <TileCard
          icon={Icons.Scan}
          iconColor="green"
          label="Discovery"
          description="Scan NGINX & Cloudflare for unmanaged sites"
          onClick={() => navigate('/admin/discovery')}
        />
      </div>
    </div>
  );
}
