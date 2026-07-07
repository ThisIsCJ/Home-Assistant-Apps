import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// One provider for the app's shared state: the HA-authenticated user, the
// site list (sidebar + dashboard) and the toast stack.
export function AppProvider({ children }) {
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState(null);
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);

  const toast = useCallback((type, message) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const refreshSites = useCallback(async () => {
    try {
      setSites(await api.get('/sites'));
    } catch (err) {
      toast('error', `Failed to load sites: ${err.message}`);
    } finally {
      setSitesLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    api.get('/me').then(setMe).catch((e) => setMeError(e.message));
  }, []);
  useEffect(() => { refreshSites(); }, [refreshSites]);

  // While any site is still cloning, poll so status flips to ready/error
  // without a manual refresh.
  useEffect(() => {
    if (!sites.some((s) => s.status === 'cloning')) return;
    const t = setInterval(refreshSites, 3000);
    return () => clearInterval(t);
  }, [sites, refreshSites]);

  return (
    <AppContext.Provider value={{ me, meError, sites, sitesLoading, refreshSites, toast }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type === 'error' ? 'error' : t.type === 'warning' ? 'warning' : 'success'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
