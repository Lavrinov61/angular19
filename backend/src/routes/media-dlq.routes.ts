/**
 * Media DLQ Admin API
 *
 * GET  /api/admin/media/dlq         — list dead-letter jobs (last 100)
 * POST /api/admin/media/dlq/:jobId/retry — retry a specific DLQ job
 */

import { Router } from 'express';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { listDlqJobs, retryDlqJob } from '../services/connectors/pipeline/dlq-worker.js';
import { mediaQueue } from '../services/connectors/pipeline/inbound-worker.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('media-dlq-routes');
const router = Router();

/**
 * GET / — list DLQ jobs
 */
router.get('/', async (_req: AuthRequest, res: Response) => {
  const jobs = await listDlqJobs(100);
  res.json({ ok: true, count: jobs.length, jobs });
});

/**
 * POST /:jobId/retry — retry a specific DLQ job
 */
router.post('/:jobId/retry', async (req: AuthRequest, res: Response) => {
  const { jobId } = req.params as { jobId: string };

  try {
    const newJobId = await retryDlqJob(jobId, mediaQueue);
    log.info('DLQ job retried via API', { dlqJobId: jobId, newJobId, userId: req.user?.id });
    res.json({ ok: true, newJobId });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      throw new AppError(404, `DLQ job not found: ${jobId}`);
    }
    throw err;
  }
});

export default router;
