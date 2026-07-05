import express from 'express';

import { createLogger } from './utils/logger.js';

const logger = createLogger('test-server');

const app = express();
const PORT = 3001;

app.get('/test', (req, res) => {
  logger.info('Request received');
  res.json({ status: 'ok', message: 'Test server works!' });
});

app.listen(PORT, () => {
  logger.info(`Test server running on port ${PORT}`);
});
