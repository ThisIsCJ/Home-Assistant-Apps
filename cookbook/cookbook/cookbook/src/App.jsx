import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Cookbook } from './pages/Cookbook';
import { Icons } from './components/Icons';
import { api } from './lib/api';

const THEME_KEY = 'cookbook-theme';

function initialTheme() {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  if (saved === 'light' || saved === 'dark') return saved;
  const prefersDark = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [me, setMe] = useState({ id: 'me', name: 'You' });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    api.get('/whoami').then((res) => {
      if (res?.id) setMe({ id: res.id, name: res.name || 'You' });
    }).catch(() => { /* fall back to the default local identity */ });
  }, []);

  const user = { sub: me.id, name: me.name };
  const dbUser = { name: me.name };
  const page = (
    <Cookbook accessToken={null} user={user} dbUser={dbUser} siteConfig={{ siteName: 'Cookbook' }} />
  );

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <div className="cb-topbar__brand">
          <Icons.FileText size={18} />
          <span>Cookbook</span>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title="Toggle theme"
          aria-label="Toggle color theme"
        >
          {theme === 'dark' ? <Icons.Sun size={15} /> : <Icons.Moon size={15} />}
        </button>
      </header>
      <main className="cb-main">
        <Routes>
          <Route path="/cookbook" element={page} />
          <Route path="/cookbook/new" element={page} />
          <Route path="/cookbook/import" element={page} />
          <Route path="/cookbook/:recipeId" element={page} />
          <Route path="*" element={<Navigate to="/cookbook" replace />} />
        </Routes>
      </main>
    </div>
  );
}
