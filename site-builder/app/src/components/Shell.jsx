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
  const navigate = useNavigate();

  return (
    <div className="app-shell" data-mobile-nav={mobileOpen ? 'open' : 'closed'}
      onClick={(e) => { if (e.target.closest('.sidebar')) return; setMobileOpen(false); }}>

      <nav className="sidebar" onClick={(e) => { if (e.target.closest('.nav-item')) setMobileOpen(false); }}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-logo">
            <Icons.Edit size={16} style={{ color: '#fff' }} />
          </div>
          <div>
            <div className="sidebar-brand-text">Site Editor</div>
            <div className="sidebar-brand-sub">GitHub static sites</div>
          </div>
        </div>

        <div className="nav-section-label">Portal</div>
        <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Icons.Home size={15} />
          Home
        </NavLink>

        {sites.length > 0 && <div className="nav-section-label">Sites</div>}
        {sites.map((site) => (
          <NavLink key={site.id} to={`/sites/${site.id}`}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icons.Globe size={15} />
            <span className="truncate" style={{ flex: 1 }}>{site.name}</span>
            {site.status !== 'ready' && <StatusIcon status={site.status} size={12} />}
            {site.draft && <span className="badge badge-orange" title="You have a saved draft">draft</span>}
          </NavLink>
        ))}

        <div className="sidebar-footer">
          {me?.isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icons.Shield size={15} />
              Admin
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
          <span className="topbar-title">{title}</span>
          <div className="topbar-spacer" />
          <AvatarMenu me={me} navigate={navigate} />
        </header>

        <main className="main-body">
          {children}
        </main>
      </div>
    </div>
  );
}
