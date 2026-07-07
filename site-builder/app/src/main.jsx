import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from './lib/state.jsx';
import './styles.css';

// Apply the stored theme before the first render so there is no flash of
// the wrong theme. The Shell's toggle keeps this attribute in sync.
document.documentElement.dataset.theme = localStorage.getItem('se_theme') || 'dark';

// Hash routing: the document URL never changes, which is what keeps the SPA
// working under the Home Assistant ingress sub-path.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </React.StrictMode>
);
