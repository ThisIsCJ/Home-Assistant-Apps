import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icons } from './Icons';
import { getEnv } from '../lib/env';
import api from '../lib/api';

const NAV_ITEMS = [
  { path: '/', icon: '/icons/ui_menu_grid@2x.png', label: 'Dashboard', exact: true },
  { path: '/calendar', icon: '/icons/calendar.png', label: 'Calendar' },
  { path: '/food', icon: Icons.Food, label: 'Food' },
  { path: '/medications', icon: '/icons/medicines@2x.png', label: 'Medications' },
  { path: '/health', icon: '/icons/heart_cardiogram@2x.png', label: 'Health Stats' },
  { path: '/workouts', icon: '/icons/exercise@2x.png', label: 'Workouts' },
  { path: '/reminders', icon: Icons.AlarmClock, label: 'Reminders' },
  { path: '/reports',       icon: Icons.Reports,  label: 'Reports' },
  { path: '/health-import', icon: Icons.Upload,   label: 'Import Data' },
];

const BOTTOM_ITEMS = [
  { path: '/settings', icon: Icons.Settings, label: 'Settings' },
];

export default function Shell({ children }) {
  const { profile, logout, isDevMode, accessToken } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ht_nav_collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const profileRef = useRef(null);
  const appName = getEnv('APP_NAME') || 'Health Tracker';

  const [dbAvatarUrl, setDbAvatarUrl] = useState(null);

  useEffect(() => {
    localStorage.setItem('ht_nav_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    if (!accessToken) return;
    api.get('/me', accessToken)
      .then(u => {
        setIsAdmin((u?.roles ?? []).includes('admin'));
        if (u?.avatarUrl) setDbAvatarUrl(u.avatarUrl);
      })
      .catch(() => {});
  }, [accessToken]);

  // Close profile menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close mobile nav on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const closeMobile = () => setMobileOpen(false);

  const navDataAttr = collapsed ? 'collapsed' : 'expanded';

  return (
    <div
      className="app-shell"
      data-nav={navDataAttr}
      data-mobile-nav={mobileOpen ? 'open' : 'closed'}
    >
      {/* Mobile backdrop */}
      <div className="nav-backdrop" onClick={closeMobile} />

      {/* Sidebar */}
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <img src="/icons/coronary_care_unit@2x.png" alt="logo" />
          </div>
          <span className="sidebar-brand-text">{appName}</span>
        </div>

        <nav className="nav-menu">
          {NAV_ITEMS.map(({ path, icon, label, exact }) => (
            <NavLink
              key={path}
              to={path}
              end={exact}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-ico">
                {typeof icon === 'string'
                  ? <img src={icon} alt="" />
                  : icon({ size: 15 })
                }
              </span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-ico"><Icons.ClipboardList size={15} /></span>
              <span className="nav-label">Admin</span>
            </NavLink>
          )}
          {BOTTOM_ITEMS.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-ico"><Icon size={15} /></span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="content-shell">
        {/* Topbar */}
        <header className="topbar">
          <button className="hamburger" onClick={() => setMobileOpen(o => !o)} aria-label="Open navigation">
            <Icons.Menu size={18} />
          </button>

          <button
            className="collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <Icons.ChevronRight size={15} /> : <Icons.ChevronLeft size={15} />}
          </button>

          <span className="topbar-title">{appName}</span>
          {isDevMode && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '2px 7px' }}>DEV</span>
          )}
          <div className="topbar-spacer" />

          <div className="topbar-actions">
            <button className="icon-btn" aria-label="Notifications">
              <Icons.Bell size={14} />
            </button>

            <div className="profile-menu-wrap" ref={profileRef}>
              <button
                className="avatar-btn"
                onClick={() => setProfileOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                {(dbAvatarUrl || profile?.avatarUrl)
                  ? <img className="avatar-img" src={dbAvatarUrl || profile.avatarUrl} alt="Avatar" />
                  : <div className="avatar-initials">{profile?.initials || 'U'}</div>
                }
              </button>

              {profileOpen && (
                <div className="profile-menu" role="menu">
                  <div className="profile-menu-user">
                    <div className="profile-menu-name">{profile?.name}</div>
                    <div className="profile-menu-email">{profile?.email}</div>
                  </div>
                  <button role="menuitem" onClick={() => { navigate('/profile'); setProfileOpen(false); }}>
                    <Icons.Profile size={13} /> Profile
                  </button>
                  <button role="menuitem" onClick={() => { navigate('/settings'); setProfileOpen(false); }}>
                    <Icons.Settings size={13} /> Settings
                  </button>
                  <button role="menuitem" className="danger" onClick={logout}>
                    <Icons.Logout size={13} /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="main-body">
          {children}
        </main>
      </div>
    </div>
  );
}
