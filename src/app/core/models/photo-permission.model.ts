/**
 * Модель разрешения на использование фотографий
 */
export interface PhotoPermission {
  id: string;
  userId: string;
  sessionId?: string;
  photoIds?: string[];
  type: PermissionType;
  purposes: PermissionPurpose[];
  createdAt: Date;
  expiresAt?: Date;
  status: PermissionStatus;
  comments?: string;
  signature?: {
    signedAt: Date;
    signatureImage?: string;
  };
}

/**
 * Тип разрешения на использование фотографий
 */
export enum PermissionType {
  ALL_PHOTOS = 'all_photos',      // Все фотографии пользователя
  SESSION = 'session',            // Фотографии из конкретной сессии
  SPECIFIC_PHOTOS = 'specific'    // Отдельные фотографии
}

/**
 * Цели использования фотографий
 */
export enum PermissionPurpose {
  ADVERTISING = 'advertising',          // Реклама студии
  PORTFOLIO = 'portfolio',              // Портфолио фотографа
  SOCIAL_MEDIA = 'social_media',        // Публикации в соцсетях
  PRINT_MEDIA = 'print_media',          // Печатные издания
  WEBSITE = 'website',                  // Веб-сайт студии
  COMPETITIONS = 'competitions',        // Конкурсы и выставки
  EDUCATIONAL = 'educational'           // Обучающие материалы
}

/**
 * Статус разрешения
 */
export enum PermissionStatus {
  PENDING = 'pending',           // Ожидает подтверждения клиентом
  APPROVED = 'approved',         // Подтверждено клиентом
  DECLINED = 'declined',         // Отклонено клиентом
  EXPIRED = 'expired',           // Срок действия истек
  REVOKED = 'revoked'            // Отозвано клиентом
}
