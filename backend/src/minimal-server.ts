import express from 'express';

import { createLogger } from './utils/logger.js';

const logger = createLogger('minimal-server');

const app = express();
const PORT = 3002;

app.get('/test', (req, res) => {
  logger.info('Request received');
  res.json({ status: 'ok' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Minimal server running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  logger.error('Server error:', { error: err.message });
});
