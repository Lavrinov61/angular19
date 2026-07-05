import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = config.actions.apiKey;
  if (!configuredKey) {
    res.status(503).json({ success: false, error: 'API key not configured' });
    return;
  }

  const provided = req.get('x-api-key') || req.get('authorization')?.replace(/^bearer\s+/i, '');
  if (!provided || provided !== configuredKey) {
    res.status(401).json({ success: false, error: 'Invalid API key' });
    return;
  }

  next();
}
