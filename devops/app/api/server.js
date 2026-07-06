import express from 'express';
import { connect } from './db.js';
import configRouter   from './routes/config.js';
import settingsRouter from './routes/settings.js';
import uploadsRouter  from './routes/uploads.js';

const app  = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.BIND_HOST || '0.0.0.0';

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/config',   configRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/uploads',  uploadsRouter);

app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));

app.use((err, req, res, _next) => {
  console.error(err);
  // Surface intentional 4xx messages; never leak internal 5xx detail.
  const status = err.status || 500;
  res.status(status).json({ message: status < 500 ? (err.message || 'Request failed') : 'Internal server error' });
});

async function start() {
  await connect();
  app.listen(PORT, HOST, () => console.log(`[api] listening on ${HOST}:${PORT}`));
}

start();
