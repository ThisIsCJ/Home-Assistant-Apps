import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useApp } from './lib/state.jsx';
import { Shell } from './components/Shell.jsx';
import { Home } from './pages/Home.jsx';
import { SiteEditor } from './pages/SiteEditor.jsx';
import { SiteHistory } from './pages/SiteHistory.jsx';
import { Admin } from './pages/Admin.jsx';

function useTitle() {
  const { pathname } = useLocation();
  const { sites } = useApp();
  if (pathname === '/') return 'Home';
  if (pathname === '/admin') return 'Admin';
  const m = pathname.match(/^\/sites\/([^/]+)/);
  if (m) {
    const site = sites.find((s) => s.id === m[1]);
    const name = site?.name || 'Site';
    return pathname.endsWith('/history') ? `${name} — History` : name;
  }
  return 'Site Editor';
}

function AdminOnly({ children }) {
  const { me } = useApp();
  if (!me) return null;
  if (!me.isAdmin) return <Navigate to="/" replace />;
  return children;
}

function Page({ children }) {
  const title = useTitle();
  const { meError } = useApp();
  return (
    <Shell title={title}>
      {meError
        ? <div className="alert alert-err">Could not reach the Site Editor API: {meError}</div>
        : children}
    </Shell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Page><Home /></Page>} />
      <Route path="/sites/:siteId" element={<Page><SiteEditor /></Page>} />
      <Route path="/sites/:siteId/history" element={<Page><SiteHistory /></Page>} />
      <Route path="/admin" element={<Page><AdminOnly><Admin /></AdminOnly></Page>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
