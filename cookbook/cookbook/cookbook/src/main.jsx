import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { queryClient } from './lib/queryClient';
import './styles.css';
import './app.css';

// HashRouter keeps all routing in the URL fragment, which is invariant under
// Home Assistant's ingress path rewriting — no basename juggling required.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
