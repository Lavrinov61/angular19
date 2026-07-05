import { generateThumbnail } from '../approval-thumbnail.service.js';
import { storageService } from '../storage.service.js';
import { canPublishWorkspaceVariant } from './photo-workspace-readiness.js';
import { PhotoWorkspaceNotificationService } from './photo-workspace-notification.service.js';
import { PhotoWorkspaceRepository } from './photo-workspace.repository.js';
import type { PhotoWorkspaceEnvelope, PhotoWorkspaceVariantRow } from '../../types/views/photo-workspace-views.js';

interface SocketServerLike {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
}

export interface CompletePhotoshopUploadInput {
  variantId: string;
  s3Key: string;
  actorUserId: string;
}

export interface SetWorkspaceVariantCheckedInput {
  variantId: string;
  checked: boolean;
  actorUserId: string;
}

export interface SendVerifiedWorkspaceItemInput {
  itemId: string;
  actorUserId: string;
  socketServer?: SocketServerLike;
}

export interface ReplaceWorkspaceApprovalFileInput {
  variantId: string;
  s3Key: string;
  actorUserId: string;
  socketServer?: SocketServerLike;
}

export interface DeleteWorkspaceApprovalFileInput {
  variantId: string;
  actorUserId: string;
  socketServer?: SocketServerLike;
}

interface UploadedPhotoshopFile {
  url: string;
  thumbnailUrl: string | null;
}

export class PhotoWorkspaceApprovalService {
  private readonly repository: PhotoWorkspaceRepository;
  private readonly notificationService: PhotoWorkspaceNotificationService;

  constructor(
    repository = new PhotoWorkspaceRepository(),
    notificationService = new PhotoWorkspaceNotificationService(),
  ) {
    this.repository = repository;
    this.notificationService = notificationService;
  }

  async completePhotoshopUpload(input: CompletePhotoshopUploadInput): Promise<PhotoWorkspaceVariantRow> {
    const upload = await readUploadedPhotoshopFile(input.s3Key);
    const variant = await this.repository.completePhotoshopUpload({
      variantId: input.variantId,
      actorUserId: input.actorUserId,
      photoshopUrl: upload.url,
      photoshopThumbnailUrl: upload.thumbnailUrl,
    });
    await this.repository.addJournal({
      itemId: variant.item_id,
      variantId: variant.id,
      actorUserId: input.actorUserId,
      eventType: 'photoshop_uploaded',
      payload: { sourceAssetUrl: upload.url },
    });
    return variant;
  }

  async setChecked(input: SetWorkspaceVariantCheckedInput): Promise<PhotoWorkspaceVariantRow> {
    const variant = await this.repository.setVariantChecked({
      variantId: input.variantId,
      checked: input.checked,
      actorUserId: input.actorUserId,
    });
    await this.repository.addJournal({
      itemId: variant.item_id,
      variantId: variant.id,
      actorUserId: input.actorUserId,
      eventType: input.checked ? 'variant_checked' : 'variant_unchecked',
    });
    return variant;
  }

  async sendVerified(input: SendVerifiedWorkspaceItemInput): Promise<void> {
    const envelope = await this.repository.getItemEnvelope(input.itemId);
    if (!envelope) {
      throw new Error('Photo workspace item not found');
    }
    if (!envelope.item.approval_session_id) {
      throw new Error('Approval session is required before sending verified variants');
    }
    if (!envelope.item.crop_result_url) {
      throw new Error('Crop result is required before sending verified variants');
    }

    const publishableVariants = envelope.variants.filter(variant => canPublishWorkspaceVariant({
      status: variant.status,
      photoshopUrl: variant.photoshop_url,
      checkedAt: variant.checked_at,
      aiOriginalUrl: variant.ai_original_url,
    }));

    const existingPrimaryVariant = envelope.variants.find(variant =>
      variant.approval_position_kind === 'primary' && variant.approval_photo_id,
    );
    let approvalPhotoId: string | null = existingPrimaryVariant?.approval_photo_id ?? null;
    let linkAlreadySent = true;
    let sentCount = 0;
    for (const variant of publishableVariants) {
      const photoshopUrl = requireString(variant.photoshop_url, 'Photoshop URL is required');
      if (!approvalPhotoId) {
        const primary = await this.repository.ensureApprovalPrimaryPhoto({
          approvalPhotoId: variant.approval_photo_id,
          approvalSessionId: envelope.item.approval_session_id,
          originalPhotoUrl: envelope.item.crop_result_url,
          retouchedPhotoUrl: photoshopUrl,
          thumbnailUrl: variant.photoshop_thumbnail_url,
        });
        approvalPhotoId = primary.approvalPhotoId;
        linkAlreadySent = primary.linkAlreadySent;
        await this.repository.markVariantSent({
          variantId: variant.id,
          actorUserId: input.actorUserId,
          approvalPhotoId,
          approvalVariantId: null,
          approvalPositionKind: 'primary',
        });
      } else {
        const approvalVariant = await this.repository.addApprovalVariant({
          approvalPhotoId,
          variantUrl: photoshopUrl,
          thumbnailUrl: variant.photoshop_thumbnail_url,
          label: variant.preset_label,
        });
        await this.repository.markVariantSent({
          variantId: variant.id,
          actorUserId: input.actorUserId,
          approvalPhotoId,
          approvalVariantId: approvalVariant.approvalVariantId,
          approvalPositionKind: 'variant',
        });
      }
      sentCount += 1;
    }

    if (sentCount > 0) {
      await this.repository.addJournal({
        orderId: envelope.item.order_id,
        itemId: envelope.item.id,
        actorUserId: input.actorUserId,
        eventType: 'verified_variants_sent',
        payload: { variantLimit: sentCount },
      });
      await this.notificationService.scheduleApprovalUpdate({
        orderId: envelope.item.order_id,
        approvalSessionId: envelope.item.approval_session_id,
        actorUserId: input.actorUserId,
        immediate: !linkAlreadySent,
        socketServer: input.socketServer,
      });
      emitApprovalUpdated(input.socketServer, envelope.item.order_id, envelope.item.id);
    }
  }

  async replaceApprovalFile(input: ReplaceWorkspaceApprovalFileInput): Promise<void> {
    const variant = await this.requireSentVariant(input.variantId);
    const upload = await readUploadedPhotoshopFile(input.s3Key);

    await this.repository.completePhotoshopUpload({
      variantId: input.variantId,
      actorUserId: input.actorUserId,
      photoshopUrl: upload.url,
      photoshopThumbnailUrl: upload.thumbnailUrl,
    });

    if (variant.approval_position_kind === 'primary') {
      await this.repository.updateApprovalPrimaryPhoto({
        approvalPhotoId: requireString(variant.approval_photo_id, 'Approval photo id is required'),
        retouchedPhotoUrl: upload.url,
        thumbnailUrl: upload.thumbnailUrl,
      });
    } else {
      await this.repository.updateApprovalVariantFile({
        approvalVariantId: requireString(variant.approval_variant_id, 'Approval variant id is required'),
        variantUrl: upload.url,
        thumbnailUrl: upload.thumbnailUrl,
      });
    }

    await this.repository.markVariantSent({
      variantId: variant.id,
      actorUserId: input.actorUserId,
      approvalPhotoId: requireString(variant.approval_photo_id, 'Approval photo id is required'),
      approvalVariantId: variant.approval_variant_id,
      approvalPositionKind: requireApprovalPositionKind(variant.approval_position_kind),
    });
    await this.repository.addJournal({
      itemId: variant.item_id,
      variantId: variant.id,
      actorUserId: input.actorUserId,
      eventType: 'approval_file_replaced',
      payload: { sourceAssetUrl: upload.url },
    });
    const envelope = await this.scheduleDelayedUpdateForVariant(variant, input.actorUserId, input.socketServer);
    emitApprovalUpdated(input.socketServer, envelope.item.order_id, envelope.item.id);
  }

  async deleteApprovalFile(input: DeleteWorkspaceApprovalFileInput): Promise<void> {
    const variant = await this.requireSentVariant(input.variantId);

    if (variant.approval_position_kind === 'primary') {
      await this.repository.deleteApprovalPrimaryPhoto({
        approvalPhotoId: requireString(variant.approval_photo_id, 'Approval photo id is required'),
      });
    } else {
      await this.repository.deleteApprovalVariant({
        approvalVariantId: requireString(variant.approval_variant_id, 'Approval variant id is required'),
      });
    }

    await this.repository.clearVariantApprovalLink({
      variantId: variant.id,
      actorUserId: input.actorUserId,
    });
    await this.repository.addJournal({
      itemId: variant.item_id,
      variantId: variant.id,
      actorUserId: input.actorUserId,
      eventType: 'approval_file_deleted',
    });
    const envelope = await this.scheduleDelayedUpdateForVariant(variant, input.actorUserId, input.socketServer);
    emitApprovalUpdated(input.socketServer, envelope.item.order_id, envelope.item.id);
  }

  private async requireSentVariant(variantId: string): Promise<PhotoWorkspaceVariantRow> {
    const variant = await this.repository.getVariant(variantId);
    if (!variant) {
      throw new Error('Photo workspace variant not found');
    }
    if (!variant.approval_photo_id || !variant.approval_position_kind || !variant.sent_at) {
      throw new Error('Photo workspace variant has not been sent to approval');
    }
    return variant;
  }

  private async scheduleDelayedUpdateForVariant(
    variant: PhotoWorkspaceVariantRow,
    actorUserId: string,
    socketServer?: SocketServerLike,
  ): Promise<PhotoWorkspaceEnvelope> {
    const envelope = await this.repository.getItemEnvelope(variant.item_id);
    if (!envelope?.item.approval_session_id) {
      throw new Error('Approval session is required before scheduling approval update');
    }
    await this.notificationService.scheduleApprovalUpdate({
      orderId: envelope.item.order_id,
      approvalSessionId: envelope.item.approval_session_id,
      actorUserId,
      immediate: false,
      socketServer,
    });
    return envelope;
  }
}

function emitApprovalUpdated(socketServer: SocketServerLike | undefined, orderId: string, itemId: string): void {
  socketServer?.to('admin:visitor-chats').emit('photo-workspace:approval-updated', {
    orderId,
    itemId,
  });
}

function requireString(value: string | null, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function requireApprovalPositionKind(value: PhotoWorkspaceVariantRow['approval_position_kind']): 'primary' | 'variant' {
  if (!value) {
    throw new Error('Approval position kind is required');
  }
  return value;
}

async function readUploadedPhotoshopFile(s3Key: string): Promise<UploadedPhotoshopFile> {
  const head = await storageService.headObject(s3Key);
  if (!head) {
    throw new Error('Photoshop upload object not found');
  }

  const { buffer } = await storageService.downloadToBuffer(s3Key);
  const { thumbnailUrl } = await generateThumbnail(buffer);
  return {
    url: storageService.getPublicUrl(s3Key),
    thumbnailUrl,
  };
}
