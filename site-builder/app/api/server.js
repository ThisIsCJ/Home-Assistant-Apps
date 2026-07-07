import express from 'express';
import { requireAuth } from './middleware/auth.js';
import sitesRouter from './routes/sites.js';
import gitopsRouter from './routes/gitops.js';
import contentRouter from './routes/content.js';
import serveRouter from './routes/serve.js';
import keysRouter from './routes/keys.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

// Liveness — no auth so orchestrator checks pass.
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', requireAuth);

app.get('/api/me', (req, res) => {
  res.json({
    username: req.user.username,
    name: req.user.name,
    isAdmin: req.user.isAdmin,
    appName: 'Site Editor',
  });
});

app.use('/api/keys', keysRouter);
app.use('/api/sites', sitesRouter);
app.use('/api/sites/:siteId', gitopsRouter);
app.use('/api/sites/:siteId', contentRouter);
app.use('/api/sites/:siteId', serveRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ message: err.message || 'Internal error' });
});

const port = Number(process.env.PORT || 4000);
const host = process.env.BIND_HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Site Editor API listening on ${host}:${port}`);
});
