import express, { Router, type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerCustomerChatRoutes } from './customer-chat.mount.js';

type HttpMethod = 'get' | 'post';

function jsonRoute(hit: string): RequestHandler {
  return (_req, res) => {
    res.json({ hit });
  };
}

function createRouteMountApp(): Express {
  const app = express();
  app.use(express.json());

  const customerChatRoutes = Router();
  customerChatRoutes.get('/sessions/current', jsonRoute('customer-current'));
  customerChatRoutes.get('/sessions/:sessionId/messages', jsonRoute('customer-history'));
  customerChatRoutes.post('/sessions/:sessionId/messages', jsonRoute('customer-send'));
  customerChatRoutes.post('/sessions/:sessionId/upload/presign', jsonRoute('customer-presign'));
  customerChatRoutes.post('/sessions/:sessionId/upload/complete', jsonRoute('customer-complete'));

  const bookingChatRoutes = Router();
  bookingChatRoutes.get('/bookings/:bookingId/messages', jsonRoute('booking-history'));

  registerCustomerChatRoutes(app, '/api', {
    customerChatRoutes,
    bookingChatRoutes,
  });

  app.use((_req, res) => {
    res.status(404).json({ hit: 'not-found' });
  });

  return app;
}

async function dispatch(app: Express, method: HttpMethod, path: string) {
  if (method === 'get') {
    return request(app).get(path);
  }
  return request(app).post(path).send({});
}

describe('customer chat route mounts', () => {
  const canonicalCustomerRoutes: Array<[HttpMethod, string, string]> = [
    ['get', '/api/chat/sessions/current', 'customer-current'],
    ['get', '/api/chat/sessions/session-1/messages', 'customer-history'],
    ['post', '/api/chat/sessions/session-1/messages', 'customer-send'],
    ['post', '/api/chat/sessions/session-1/upload/presign', 'customer-presign'],
    ['post', '/api/chat/sessions/session-1/upload/complete', 'customer-complete'],
  ];

  it.each(canonicalCustomerRoutes)(
    '%s %s reaches the canonical customer-chat router',
    async (method, path, expectedHit) => {
      const app = createRouteMountApp();

      const res = await dispatch(app, method, path);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hit: expectedHit });
    },
  );

  it('keeps /api/visitor-chat as a compatibility alias', async () => {
    const app = createRouteMountApp();

    const res = await request(app).get('/api/visitor-chat/sessions/current');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hit: 'customer-current' });
  });

  it('keeps legacy booking chat under /api/chat/bookings', async () => {
    const app = createRouteMountApp();

    const res = await request(app).get('/api/chat/bookings/booking-1/messages');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hit: 'booking-history' });
  });
});
