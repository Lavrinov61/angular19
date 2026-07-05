import express from 'express';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler.js';

/**
 * Creates a minimal Express app for integration testing with supertest.
 * Includes only the essential middleware: JSON body parser, error handler, 404 handler.
 * No rate limiting, no CORS, no Helmet — keeps tests fast and focused.
 */
export function createTestApp(router: express.Router, prefix = '/') {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
