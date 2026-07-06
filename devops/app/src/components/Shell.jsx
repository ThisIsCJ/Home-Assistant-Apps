import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { resolveAssetUrl } from '../lib/env.js';
import { Icons } from './Icons.jsx';

const USER_NAV = [
  { path: '/app',              icon: Icons.Dashboard,  label: 'Dashboard',       exact: true },
  { path: '/app/requests/new', icon: Icons.Plus,       label: 'New Site Request' },
  { path: '/app/requests',     icon: Icons.List,       label: 'Request History',  tourId: 'nav-requests' },
  { path: '/app/status',       icon: Icons.Activity,   label: 'Site Status',      tourId: 'nav-status'   },
  { path: '/app/team',         icon: Icons.Users,      label: 'Team Access'      },
];

function NavItem({ path, icon: Icon, label, exact, tourId }) {
  return (
    <NavLink
      to={path}
      end={exact}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
      {...(tourId ? { 'data-tour': tourId } : {})}
    >
      <Icon size={15} />
      {label}
    </NavLink>
  );
}

function AvatarMenu({ profile, isAdmin, navigate, logout, haMode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="avatar-menu" ref={ref}>
      <div className="topbar-avatar" title={profile?.name} onClick={() => setOpen(o => !o)}
        aria-haspopup="true" aria-expanded={open}>
        {profile?.initials || '?'}
      </div>
      {open && (
        <div className="avatar-dropdown">
          <div className="avatar-dropdown-header">
            <div className="avatar-dropdown-name">{profile?.name || '—'}</div>
            <div className="avatar-dropdown-email">{profile?.email || ''}</div>
          </div>
          <div className="avatar-dropdown-divider" />
          <button className="avatar-dropdown-item" onClick={() => { setOpen(false); navigate('/app/profile'); }}>
            <Icons.User size={13} /> Profile
          </button>
          {isAdmin && (
            <button className="avatar-dropdown-item" onClick={() => { setOpen(false); navigate('/admin'); }}>
              <Icons.Shield size={13} /> Admin panel
            </button>
          )}
          {!haMode && (
            <>
              <div className="avatar-dropdown-divider" />
              <button className="avatar-dropdown-item avatar-dropdown-item--danger" onClick={() => { setOpen(false); logout(); }}>
                <Icons.LogOut size={13} /> Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Shell({ children, title }) {
  const { profile, logout, appConfig } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const adminGroup = appConfig?.adminGroup || '';
  const isAdmin = profile?.isAdmin ?? Boolean(adminGroup && profile?.groups?.includes(adminGroup));
  // Under Home Assistant ingress the session belongs to HA — signing out here
  // is meaningless, so the sign-out controls are hidden.
  const haMode = Boolean(appConfig?.haIngress);
  const appName = appConfig?.appName || 'DevOps Platform';
  const logoUrl = resolveAssetUrl(appConfig?.logoUrl);

  return (
    <div className="app-shell" data-mobile-nav={mobileOpen ? 'open' : 'closed'}
      onClick={e => { if (e.target.closest('.sidebar')) return; setMobileOpen(false); }}>

      <nav className="sidebar" onClick={e => { if (e.target.closest('.nav-item')) setMobileOpen(false); }}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-logo" style={logoUrl ? { background: 'none', boxShadow: 'none' } : {}}>
            {logoUrl
              ? <img src={logoUrl} alt={appName} style={{ width: 36, height: 36, objectFit: 'contain' }} />
              : <Icons.Server size={16} style={{ color: '#fff' }} />
            }
          </div>
          <div>
            <div className="sidebar-brand-text">{appName}</div>
            <div className="sidebar-brand-sub">Self-service provisioning</div>
          </div>
        </div>

        <div className="nav-section-label">Portal</div>
        {(appConfig?.navOrder?.length
          ? [...USER_NAV].sort((a, b) => {
              const ai = appConfig.navOrder.indexOf(a.path);
              const bi = appConfig.navOrder.indexOf(b.path);
              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            })
          : USER_NAV
        ).map(item => <NavItem key={item.path} {...item} />)}

        <div className="sidebar-footer">
          <NavLink to="/app/profile" data-tour="nav-profile" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icons.User size={15} />
            Profile
          </NavLink>
          {!haMode && (
            <button className="nav-item" onClick={logout}>
              <Icons.LogOut size={15} />
              Sign out
            </button>
          )}
        </div>
      </nav>

      <div className="content-shell">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Menu"
            onClick={e => { e.stopPropagation(); setMobileOpen(o => !o); }}>
            <Icons.Menu size={15} />
          </button>
          <span className="topbar-title">{title}</span>
          <div className="topbar-spacer" />
          <AvatarMenu profile={profile} isAdmin={isAdmin} navigate={navigate} logout={logout} haMode={haMode} />
        </header>

        <main className="main-body">
          {children}
        </main>
      </div>
    </div>
  );
}
