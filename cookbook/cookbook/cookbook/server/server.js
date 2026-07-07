import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { connect, isConnected, getConnectionError } from './db.js';
import { getMongoUri, getConfigSummary } from './config.js';
import { ingressUser } from './middleware/ingressAuth.js';
import cookbookRouter from './routes/cookbook.js';
import cookbookAdminRouter from './routes/cookbookAdmin.js';
import uploadsRouter from './routes/uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const INDEX_PATH = path.join(DIST_DIR, 'index.html');
const PORT = Number(process.env.PORT || 4100);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// --- API -------------------------------------------------------------------
app.use('/api/cookbook/admin', cookbookAdminRouter);
app.use('/api/cookbook', cookbookRouter);
app.use('/api/uploads', uploadsRouter);

app.get('/api/whoami', ingressUser, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, isAdmin: req.user.isAdmin });
});

app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    connected: isConnected(),
    connectionError: getConnectionError() || null,
    db: getConfigSummary(),
  })
);

// --- Static frontend (with Home Assistant ingress base-path injection) -----
// HA strips the "/api/hassio_ingress/<token>" prefix before forwarding, and
// tells us what it was via the X-Ingress-Path header. We inject that into the
// served HTML so the SPA can build correct API URLs from the browser side.
let indexTemplate = null;
function getIndexTemplate() {
  if (indexTemplate === null) {
    indexTemplate = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';
  }
  return indexTemplate;
}

function sendIndex(req, res) {
  const template = getIndexTemplate();
  if (!template) {
    return res.status(500).send('Frontend build not found. Did the image build run "vite build"?');
  }
  const ingressPath = (req.get('X-Ingress-Path') || '').replace(/\/+$/, '');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(template.replaceAll('%%INGRESS_PATH%%', ingressPath));
}

app.use(express.static(DIST_DIR, { index: false }));

// SPA fallback — anything not matched above returns the app shell.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  sendIndex(req, res);
});

// --- Startup ---------------------------------------------------------------
async function start() {
  const uri = getMongoUri();
  if (uri) {
    try {
      await connect();
      console.log(`Cookbook connected to MongoDB (${getConfigSummary().database})`);
    } catch (err) {
      console.error('Cookbook MongoDB connection failed:', err.message);
      console.error('The UI will load but recipe endpoints return 503 until MongoDB is reachable.');
    }
  } else {
    console.warn('No mongo_uri configured — set it in the add-on options. Recipe endpoints will return 503.');
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Cookbook add-on listening on :${PORT}`));
}

start();
