/**
 * Chat module index — assembles all chat sub-routes into a single Router.
 * Replaces the monolithic visitor-chat.routes.ts (6452 lines → 16 modules).
 */

import { Router } from 'express';
import telegramRoutes from './chat-telegram.routes.js';
import pushRoutes from './chat-push.routes.js';
import adminRoutes from './chat-admin.routes.js';
import adminUploadRoutes from './chat-admin-upload.routes.js';
import mediaRoutes from './chat-media.routes.js';
import sessionRoutes from './chat-session.routes.js';
import messagesRoutes from './chat-messages.routes.js';
import directUploadRoutes from './chat-direct-upload.routes.js';
import multipartUploadRoutes from '../shared/multipart-upload.routes.js';
import cartRoutes from './chat-cart.routes.js';
import cartWaterfallRoutes from './chat-cart-waterfall.routes.js';
import { authenticateToken } from '../../middleware/auth.js';
import { chatApiLimiter, uploadLimiter } from './chat-shared.js';

const router = Router();

// Auth-only: требуем JWT (cookie или Bearer) на всех /sessions/:sessionId/* routes.
// Каждый sub-router дополнительно проверяет ownership через getOwnedConversation.
router.use('/sessions/:sessionId', authenticateToken, chatApiLimiter);

router.use(sessionRoutes);
router.use(messagesRoutes);
router.use(cartRoutes);
router.use(directUploadRoutes);
router.use('/sessions/:sessionId/upload', uploadLimiter, multipartUploadRoutes);
router.use(mediaRoutes);
router.use(adminRoutes);
router.use(cartWaterfallRoutes);
router.use(adminUploadRoutes);
router.use('/admin/sessions/:sessionId/upload', authenticateToken, uploadLimiter, multipartUploadRoutes);
router.use(telegramRoutes);
router.use(pushRoutes);

// Phase 3D.5: chat-external.routes.ts removed — all channels use unified webhook pipeline

export default router;

// Re-export bot engine functions for backward compatibility
export { handleInteractiveResponse, handleContextualTextInput } from './chat-bot-engine.js';
