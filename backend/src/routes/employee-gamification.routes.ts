/**
 * employee-gamification.routes.ts — REST API for employee gamification
 *
 * GET  /api/gamification/my-stats       — Current employee stats
 * GET  /api/gamification/my-profile     — Employee profile (shifts, XP, revenue)
 * GET  /api/gamification/my-xp-log      — XP activity log
 * GET  /api/gamification/leaderboard    — Top 10 by XP
 * GET  /api/gamification/achievements   — All achievements with unlock status
 */

import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getMyStats,
  getMyProfile,
  getMyXpLog,
  getLeaderboard,
  getAchievements,
} from '../services/employee-gamification.service.js';

const router = express.Router();

function isStaff(role: string): boolean {
  return ['admin', 'employee', 'photographer'].includes(role);
}

// GET /my-stats
router.get('/my-stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const stats = await getMyStats(req.user.id);
  res.json({ success: true, data: stats });
});

// GET /my-profile
router.get('/my-profile', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const profile = await getMyProfile(req.user.id);
  res.json({ success: true, data: profile });
});

// GET /my-xp-log?limit=30
router.get('/my-xp-log', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const limit = Math.min(parseInt(req.query['limit'] as string, 10) || 30, 100);
  const log = await getMyXpLog(req.user.id, limit);
  res.json({ success: true, data: log });
});

// GET /leaderboard?period=month
router.get('/leaderboard', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const period = (req.query['period'] as string) || 'month';
  const leaderboard = await getLeaderboard(period);
  res.json({ success: true, data: leaderboard });
});

// GET /achievements
router.get('/achievements', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Staff access required');
  }

  const achievements = await getAchievements(req.user.id);
  res.json({ success: true, data: achievements });
});

export default router;
