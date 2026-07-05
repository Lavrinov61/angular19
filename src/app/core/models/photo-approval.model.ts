/**
 * Модель для подтверждения ретуши фотографий
 */
export interface PhotoApproval {
  id: string;
  orderId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  status: ApprovalStatus;
  photos: PhotoForApproval[];
  requestDeadline?: Date;
  additionalInfo?: Record<string, unknown>;
}

/**
 * Фотография для подтверждения
 */
export interface PhotoForApproval {
  id: string;
  originalPhotoUrl: string;
  retouchedPhotoUrl: string;
  approved: boolean;
  annotations: PhotoAnnotation[];
  comments?: string;
  // Расширенные поля для группировки и отображения
  sessionId?: string;
  sessionName?: string;
  serviceName?: string;
  orderId?: string;
  publicToken?: string;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  createdAt?: Date;
}

/**
 * Аннотация к фотографии
 */
export interface PhotoAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  createdAt: Date;
  createdBy: 'client' | 'photographer';
}

/**
 * Статус подтверждения
 */
export enum ApprovalStatus {
  PENDING = 'pending',           // Ожидает подтверждения
  PARTIALLY_APPROVED = 'partial', // Частично подтверждено
  APPROVED = 'approved',         // Подтверждено
  REJECTED = 'rejected',         // Отклонено
  NEEDS_REVISION = 'revision'    // Требуется доработка
}
