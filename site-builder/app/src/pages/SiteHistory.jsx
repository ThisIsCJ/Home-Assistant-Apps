import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../lib/state.jsx';
import { Icons, StatusIcon } from '../components/Icons.jsx';

export function SiteHistory() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.get(`/sites/${siteId}/history`)
      .then(setRows)
      .catch((err) => { toast('error', err.message); setRows([]); });
  }, [siteId]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Push History</h1>
        <div className="page-actions">
          <button className="btn btn-sec btn-sm" onClick={() => navigate(`/sites/${siteId}`)}>
            <Icons.ChevronLeft size={13} /> Back to Editor
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title purple">Pushed Changes</span>
        </div>
        {rows === null && <div className="empty-state"><Icons.Loader size={22} className="spin" /></div>}
        {rows?.length === 0 && (
          <div className="empty-state">
            <Icons.History size={30} className="empty-state-icon" />
            <div className="empty-state-text">No pushes yet</div>
            <div className="empty-state-sub">Changes pushed from the editor will appear here.</div>
          </div>
        )}
        {rows?.length > 0 && (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Commit</th>
                  <th>Message</th>
                  <th>Author</th>
                  <th>Files</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><StatusIcon status={r.status} /></td>
                    <td className="td-mono">{r.commit_hash ? r.commit_hash.slice(0, 7) : '—'}</td>
                    <td>{r.message}</td>
                    <td>{r.author}</td>
                    <td>
                      <div className="flex flex-col gap-1">
                        {r.files.map((f) => <span key={f} className="mono text-xs">{f}</span>)}
                      </div>
                    </td>
                    <td className="td-mono">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
