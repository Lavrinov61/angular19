import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT } from './photo-workspace.constants.js';
import { PhotoWorkspaceNotificationService } from './photo-workspace-notification.service.js';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../database/db.js', () => ({
  default: dbMock,
  pool: { query: vi.fn() },
}));

vi.mock('../photo-approval.service.js', () => ({
  sendGalleryToChat: vi.fn(),
}));

describe('PhotoWorkspaceNotificationService', () => {
  const repository = {
    upsertScheduledNotification: vi.fn(),
    getDueNotifications: vi.fn(),
    markNotificationSent: vi.fn(),
    addJournal: vi.fn(),
  };
  const sendGallery = vi.fn();

  beforeEach(() => vi.resetAllMocks());

  it('extends the scheduled notification to 5 minutes after the latest change', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z');
    await new PhotoWorkspaceNotificationService(repository as never, sendGallery, () => now).scheduleApprovalUpdate({
      orderId: 'order-1',
      approvalSessionId: 'session-1',
      actorUserId: 'user-1',
      immediate: false,
    });

    expect(repository.upsertScheduledNotification).toHaveBeenCalledWith({
      orderId: 'order-1',
      approvalSessionId: 'session-1',
      actorUserId: 'user-1',
      messageText: PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT,
      scheduledFor: '2026-06-22T10:05:00.000Z',
    });
  });

  it('sends due notifications through the existing gallery sender', async () => {
    repository.getDueNotifications.mockResolvedValue([{ id: 'batch-1', order_id: 'order-1', approval_session_id: 'session-1' }]);
    sendGallery.mockResolvedValue({ messageId: 'msg-1', reviewUrl: '/photo-review/token' });

    await new PhotoWorkspaceNotificationService(repository as never, sendGallery).sendDueNotifications();

    expect(sendGallery).toHaveBeenCalledWith({ sessionId: 'session-1', overrideText: PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT });
    expect(repository.markNotificationSent).toHaveBeenCalledWith('batch-1');
  });
});
