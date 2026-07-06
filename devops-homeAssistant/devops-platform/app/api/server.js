import express from 'express';
import { connect } from './db.js';
import configRouter   from './routes/config.js';
import settingsRouter from './routes/settings.js';
import uploadsRouter  from './routes/uploads.js';

const app  = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.BIND_HOST || '0.0.0.0';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/config',   configRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/uploads',  uploadsRouter);

app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

async function start() {
  await connect();
  app.listen(PORT, HOST, () => console.log(`[api] listening on ${HOST}:${PORT}`));
}

start();
