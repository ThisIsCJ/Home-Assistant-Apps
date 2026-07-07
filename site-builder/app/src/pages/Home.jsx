import { useNavigate } from 'react-router-dom';
import { useApp, timeAgo } from '../lib/state.jsx';
import { Icons, StatusIcon } from '../components/Icons.jsx';

export function Home() {
  const { me, sites, sitesLoading } = useApp();
  const navigate = useNavigate();

  const draftCount = sites.filter((s) => s.draft).length;
  const lastPush = sites.map((s) => s.last_pushed_at).filter(Boolean).sort().pop();

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Your Sites</h1>
        {me?.isAdmin && (
          <div className="page-actions">
            <button className="btn btn-pri" onClick={() => navigate('/admin')}>
              <Icons.Plus size={14} /> Add Site
            </button>
          </div>
        )}
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="lbl">Sites</div>
          <div className="val">{sites.length}</div>
          <div className="sub">assigned to you</div>
        </div>
        <div className="kpi">
          <div className="lbl">Open Drafts</div>
          <div className={`val ${draftCount ? 'orange' : 'green'}`}>{draftCount}</div>
          <div className="sub">unpushed work</div>
        </div>
        <div className="kpi">
          <div className="lbl">Last Push</div>
          <div className="val green" style={{ fontSize: '1rem', lineHeight: '1.9' }}>{lastPush ? timeAgo(lastPush) : '—'}</div>
          <div className="sub">across your sites</div>
        </div>
        <div className="kpi">
          <div className="lbl">Role</div>
          <div className="val purple" style={{ fontSize: '1rem', lineHeight: '1.9' }}>{me?.isAdmin ? 'Admin' : 'Editor'}</div>
          <div className="sub">{me?.name}</div>
        </div>
      </div>

      {sites.length === 0 && !sitesLoading && (
        <div className="card">
          <div className="empty-state">
            <Icons.Globe size={34} className="empty-state-icon" />
            <div className="empty-state-text">No sites yet</div>
            <div className="empty-state-sub">
              {me?.isAdmin
                ? 'Add a GitHub-backed site from the Admin panel to get started.'
                : 'An administrator needs to assign a site to you before you can edit.'}
            </div>
            {me?.isAdmin && (
              <button className="btn btn-pri btn-sm mt-2" onClick={() => navigate('/admin')}>
                <Icons.Plus size={13} /> Add your first site
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid-2">
        {sites.map((site) => (
          <div key={site.id} className="card">
            <div className="card-header">
              <span className={`card-title ${site.status === 'ready' ? 'green' : site.status === 'error' ? 'red' : 'orange'}`}>
                {site.name}
              </span>
              <div className="flex items-center gap-2">
                {site.draft && <span className="badge badge-orange">draft</span>}
                <StatusIcon status={site.status} />
              </div>
            </div>
            <div className="card-body">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Icons.Link size={12} />
                  <span className="mono truncate">{site.repo_url}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span className="flex items-center gap-1"><Icons.GitBranch size={12} /> {site.branch}</span>
                  <span className="flex items-center gap-1"><Icons.DownloadCloud size={12} /> synced {timeAgo(site.last_synced_at)}</span>
                  <span className="flex items-center gap-1"><Icons.UploadCloud size={12} /> pushed {timeAgo(site.last_pushed_at)}</span>
                </div>
                {site.status === 'error' && (
                  <div className="alert alert-err text-sm">{site.error}</div>
                )}
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-pri btn-sm" disabled={site.status !== 'ready'}
                    onClick={() => navigate(`/sites/${site.id}`)}>
                    <Icons.Edit size={13} /> Open Editor
                  </button>
                  <button className="btn btn-sec btn-sm" onClick={() => navigate(`/sites/${site.id}/history`)}>
                    <Icons.History size={13} /> History
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
