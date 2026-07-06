import express from 'express';
import { connect } from './db.js';
import requestsRouter  from './routes/requests.js';
import adminRouter     from './routes/admin.js';
import discoveryRouter from './routes/discovery.js';

const app  = express();
const PORT = process.env.PORT || 4200;
const HOST = process.env.BIND_HOST || '0.0.0.0';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true, module: 'provisioning' }));

app.use('/api/app',      requestsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/admin',    adminRouter);
app.use('/api/admin',    discoveryRouter);

app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

async function start() {
  await connect();
  app.listen(PORT, HOST, () => console.log(`[provisioning] listening on ${HOST}:${PORT}`));
}

start();
