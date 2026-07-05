import { Router, Request, Response } from 'express';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('address.routes');
// POST /api/address/suggest — подсказки адресов через DaData
router.post('/suggest', async (req: Request, res: Response): Promise<void> => {
  const { query, count } = req.body;
  if (!query || typeof query !== 'string') throw new AppError(400, 'query is required');
  if (!config.dadata.apiKey) throw new AppError(503, 'DaData not configured');

  const response = await fetchWithCB(SERVICE_BREAKERS.dadata, 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Token ${config.dadata.apiKey}`,
    },
    body: JSON.stringify({
      query: query.trim(),
      count: Math.min(count || 7, 20),
      language: 'ru',
      locations: [{ country: 'Россия' }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('DaData error:', { detail1: response.status, detail2: body });
    throw new AppError(502, 'DaData request failed');
  }

  const data = await response.json() as { suggestions: Array<{ value: string; unrestricted_value: string; data: Record<string, unknown> }> };

  res.json({
    success: true,
    data: data.suggestions.map(s => {
      const d = s.data;
      return {
        value: s.value,
        fullAddress: s.unrestricted_value,
        postalCode: d['postal_code'],
        city: d['city'],
        region: d['region'],
        street: d['street'],
        house: d['house'],
        flat: d['flat'],
        geo_lat: d['geo_lat'],
        geo_lon: d['geo_lon'],
      };
    }),
  });
});

export default router;
