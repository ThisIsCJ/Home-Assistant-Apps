import express from 'express';
import { connect } from './db.js';
import monitorRouter from './routes/monitor.js';
import { startScheduler } from './lib/monitorScheduler.js';

const app = express();
const PORT = process.env.PORT || 4100;
const HOST = process.env.BIND_HOST || '0.0.0.0';

app.use(express.json());

app.get('/api/monitor/health', (_req, res) => res.json({ ok: true, module: 'monitor' }));

app.use('/api/monitor', monitorRouter);

app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

async function start() {
  await connect();
  startScheduler();
  app.listen(PORT, HOST, () => console.log(`[monitor] listening on ${HOST}:${PORT}`));
}

start();
