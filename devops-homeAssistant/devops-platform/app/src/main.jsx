import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.jsx';
import App from './App.jsx';
import './styles.css';
import { applyAppearance, loadAppearance } from './lib/appearance.js';

// Apply saved appearance immediately to avoid flash of wrong theme
applyAppearance(loadAppearance());

// HashRouter (not BrowserRouter): Home Assistant ingress serves the app under
// a dynamic sub-path, so route state must live in the URL hash where it is
// independent of the path the SPA is mounted at.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>
);
