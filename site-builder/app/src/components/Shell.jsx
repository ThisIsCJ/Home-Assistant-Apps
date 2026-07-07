import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/state.jsx';
import { Icons, StatusIcon } from './Icons.jsx';

function AvatarMenu({ me, navigate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initials = (me?.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="avatar-menu" ref={ref}>
      <div className="topbar-avatar" title={me?.name} onClick={() => setOpen((o) => !o)}
        aria-haspopup="true" aria-expanded={open}>
        {initials}
      </div>
      {open && (
        <div className="avatar-dropdown">
          <div className="avatar-dropdown-header">
            <div className="avatar-dropdown-name">{me?.name || '—'}</div>
            <div className="avatar-dropdown-email">
              {me?.isAdmin ? 'Administrator' : 'Editor'} · Home Assistant
            </div>
          </div>
          {me?.isAdmin && (
            <>
              <div className="avatar-dropdown-divider" />
              <button className="avatar-dropdown-item" onClick={() => { setOpen(false); navigate('/admin'); }}>
                <Icons.Shield size={13} /> Admin panel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Shell({ children, title }) {
  const { me, sites } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('se_sidebar_collapsed') === '1');
  const [theme, setTheme] = useState(() => localStorage.getItem('se_theme') || 'dark');
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('se_theme', theme);
  }, [theme]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('se_sidebar_collapsed', c ? '0' : '1');
      return !c;
    });
  };

  return (
    <div className="app-shell" data-mobile-nav={mobileOpen ? 'open' : 'closed'}
      data-collapsed={collapsed ? 'true' : 'false'}
      onClick={(e) => { if (e.target.closest('.sidebar')) return; setMobileOpen(false); }}>

      <nav className="sidebar" onClick={(e) => { if (e.target.closest('.nav-item')) setMobileOpen(false); }}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-logo">
            <Icons.Edit size={16} style={{ color: '#fff' }} />
          </div>
          <div className="sidebar-brand-meta">
            <div className="sidebar-brand-text">Site Editor</div>
            <div className="sidebar-brand-sub">GitHub static sites</div>
          </div>
        </div>

        <div className="nav-section-label">Portal</div>
        <NavLink to="/" end title="Home"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Icons.Home size={15} />
          <span className="nav-label">Home</span>
        </NavLink>

        {sites.length > 0 && <div className="nav-section-label">Sites</div>}
        {sites.map((site) => (
          <NavLink key={site.id} to={`/sites/${site.id}`} title={site.name}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icons.Globe size={15} />
            <span className="nav-label truncate" style={{ flex: 1 }}>{site.name}</span>
            {site.status !== 'ready' && <span className="nav-extra"><StatusIcon status={site.status} size={12} /></span>}
            {site.draft && <span className="nav-extra badge badge-orange" title="You have a saved draft">draft</span>}
          </NavLink>
        ))}

        <div className="sidebar-footer">
          {me?.isAdmin && (
            <NavLink to="/admin" title="Admin"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icons.Shield size={15} />
              <span className="nav-label">Admin</span>
            </NavLink>
          )}
        </div>
      </nav>

      <div className="content-shell">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Menu"
            onClick={(e) => { e.stopPropagation(); setMobileOpen((o) => !o); }}>
            <Icons.Menu size={15} />
          </button>
          <button className="icon-btn collapse-btn" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <Icons.ChevronRight size={15} /> : <Icons.ChevronLeft size={15} />}
          </button>
          <span className="topbar-title">{title}</span>
          <div className="topbar-spacer" />
          <button className="icon-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Icons.Sun size={15} /> : <Icons.Moon size={15} />}
          </button>
          <AvatarMenu me={me} navigate={navigate} />
        </header>

        <main className="main-body">
          {children}
        </main>
      </div>
    </div>
  );
}
