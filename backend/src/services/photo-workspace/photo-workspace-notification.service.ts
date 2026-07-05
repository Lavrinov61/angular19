import { sendGalleryToChat } from '../photo-approval.service.js';
import {
  PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT,
  PHOTO_WORKSPACE_NOTIFICATION_DELAY_MS,
} from './photo-workspace.constants.js';
import { PhotoWorkspaceRepository } from './photo-workspace.repository.js';

export type SendWorkspaceGallery = typeof sendGalleryToChat;
export type Clock = () => Date;

export interface ScheduleApprovalUpdateParams {
  orderId: string;
  approvalSessionId: string;
  actorUserId: string;
  immediate: boolean;
  socketServer?: SocketServerLike;
}

interface SocketServerLike {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
}

export class PhotoWorkspaceNotificationService {
  private readonly repository: PhotoWorkspaceRepository;
  private readonly sendGallery: SendWorkspaceGallery;
  private readonly clock: Clock;

  constructor(
    repository = new PhotoWorkspaceRepository(),
    sendGallery: SendWorkspaceGallery = sendGalleryToChat,
    clock: Clock = () => new Date(),
  ) {
    this.repository = repository;
    this.sendGallery = sendGallery;
    this.clock = clock;
  }

  async scheduleApprovalUpdate(params: ScheduleApprovalUpdateParams): Promise<void> {
    if (params.immediate) {
      await this.sendGallery({ sessionId: params.approvalSessionId });
      await this.repository.addJournal({
        orderId: params.orderId,
        itemId: null,
        actorUserId: params.actorUserId,
        eventType: 'client_notification_sent',
        payload: { message: PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT },
      });
      return;
    }

    const scheduledFor = new Date(this.clock().getTime() + PHOTO_WORKSPACE_NOTIFICATION_DELAY_MS).toISOString();
    await this.repository.upsertScheduledNotification({
      orderId: params.orderId,
      approvalSessionId: params.approvalSessionId,
      actorUserId: params.actorUserId,
      messageText: PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT,
      scheduledFor,
    });
    await this.repository.addJournal({
      orderId: params.orderId,
      itemId: null,
      actorUserId: params.actorUserId,
      eventType: 'client_notification_scheduled',
      payload: { message: PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT },
    });
    params.socketServer?.to('admin:visitor-chats').emit('photo-workspace:notification-scheduled', {
      orderId: params.orderId,
      scheduledFor,
    });
  }

  async sendDueNotifications(): Promise<void> {
    const nowIso = this.clock().toISOString();
    const dueNotifications = await this.repository.getDueNotifications(nowIso);

    for (const notification of dueNotifications) {
      await this.sendGallery({
        sessionId: notification.approval_session_id,
        overrideText: PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT,
      });
      await this.repository.markNotificationSent(notification.id);
      await this.repository.addJournal({
        orderId: notification.order_id,
        itemId: null,
        actorUserId: notification.created_by,
        eventType: 'client_notification_sent',
        payload: { message: PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT },
      });
    }
  }
}
