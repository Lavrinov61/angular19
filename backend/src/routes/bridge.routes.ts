/**
 * Bridge Routes — замена Python bridge_api.py (:5052).
 *
 * HTTP-обёртка над attribution.service.ts.
 * Внутренние вызовы Express → attribution.service используют прямые imports,
 * но эти роуты нужны для nginx маршрутизации и обратной совместимости.
 */

import { Router, Request, Response } from 'express';
import {
  savePayment,
  trackOrderEvent,
  registerConversion,
  checkPhone,
  linkFingerprint,
  savePhoneFromMessenger,
  getAttributionStats,
  getDashboardMetrics,
  getRoiReport,
} from '../services/attribution.service.js';

const router = Router();

// ────── Critical endpoints (called internally by Express routes) ──────

router.post('/save-payment', async (req: Request, res: Response) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    res.status(400).json({ success: false, error: 'amount is required and must be > 0' });
    return;
  }
  const result = await savePayment(req.body);
  res.json({ success: true, ...result });
});

router.post('/track-order-event', async (req: Request, res: Response) => {
  const { event_type } = req.body;
  if (!event_type) {
    res.status(400).json({ success: false, error: 'event_type is required' });
    return;
  }
  const result = await trackOrderEvent(req.body);
  res.json({ success: true, ...result });
});

router.post('/register-conversion', async (req: Request, res: Response) => {
  const result = await registerConversion(req.body);
  res.json({ success: true, ...result });
});

// ────── Messenger integration ──────

router.post('/get-tracking-data', async (req: Request, res: Response) => {
  const { phone, email, fingerprint_visitor_id, posthog_distinct_id } = req.body;
  if (!phone && !email && !fingerprint_visitor_id && !posthog_distinct_id) {
    res.status(400).json({ success: false, error: 'At least one identifier required' });
    return;
  }
  // Simplified: register conversion returns attribution data
  const result = await registerConversion({
    ...req.body,
    conversion_type: 'tracking_data_request',
  });
  res.json({
    success: true,
    attribution: result.attribution,
    utm_for_bitrix24: result.utm_for_bitrix24,
  });
});

router.get('/check-phone', async (req: Request, res: Response) => {
  const telegramUserId = req.query['telegram_user_id'] as string;
  if (!telegramUserId) {
    res.status(400).json({ success: false, error: 'telegram_user_id required' });
    return;
  }
  const result = await checkPhone(telegramUserId);
  res.json({ success: true, ...result });
});

router.post('/link-fingerprint', async (req: Request, res: Response) => {
  const { fingerprint_visitor_id, telegram_user_id } = req.body;
  if (!fingerprint_visitor_id || !telegram_user_id) {
    res.status(400).json({ success: false, error: 'fingerprint_visitor_id and telegram_user_id required' });
    return;
  }
  const result = await linkFingerprint(fingerprint_visitor_id, telegram_user_id);
  res.json({ success: true, ...result });
});

router.post('/save-phone-from-telegram', async (req: Request, res: Response) => {
  const { telegram_user_id, phone, bitrix24_contact_id } = req.body;
  if (!telegram_user_id || !phone) {
    res.status(400).json({ success: false, error: 'telegram_user_id and phone required' });
    return;
  }
  const result = await savePhoneFromMessenger(telegram_user_id, 'telegram_user_id', phone, bitrix24_contact_id);
  res.json({ success: true, ...result });
});

router.post('/save-phone-from-max', async (req: Request, res: Response) => {
  const { max_user_id, phone, bitrix24_contact_id } = req.body;
  if (!max_user_id || !phone) {
    res.status(400).json({ success: false, error: 'max_user_id and phone required' });
    return;
  }
  const result = await savePhoneFromMessenger(max_user_id, 'max_user_id', phone, bitrix24_contact_id);
  res.json({ success: true, ...result });
});

// ────── Analytics ──────

router.get('/attribution-stats', async (req: Request, res: Response) => {
  const days = parseInt(req.query['days'] as string) || 30;
  const result = await getAttributionStats(days);
  res.json({ success: true, ...result });
});

router.get('/dashboard-metrics', async (req: Request, res: Response) => {
  const days = parseInt(req.query['days'] as string) || 7;
  const result = await getDashboardMetrics(days);
  res.json({ success: true, ...result });
});

router.get('/roi-report', async (req: Request, res: Response) => {
  const days = parseInt(req.query['days'] as string) || 30;
  const groupBy = (req.query['group_by'] as string) || 'platform';
  const result = await getRoiReport(days, groupBy);
  res.json({ success: true, data: result });
});

router.get('/attribution-models', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    models: [
      { id: 'last_touch', name: 'Last Touch', description: 'Вся конверсия приписывается последнему клику' },
      { id: 'first_touch', name: 'First Touch', description: 'Вся конверсия приписывается первому клику' },
      { id: 'linear', name: 'Linear', description: 'Конверсия делится поровну между всеми кликами' },
      { id: 'time_decay', name: 'Time Decay', description: 'Больший вес более поздним кликам' },
      { id: 'position_based', name: 'Position Based', description: '40% первому, 40% последнему, 20% остальным' },
    ],
  });
});

router.get('/health', async (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'bridge-api-node', timestamp: new Date().toISOString() });
});

export default router;
