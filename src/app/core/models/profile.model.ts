// Базовый интерфейс для профиля пользователя
export interface BaseProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  phoneNumber?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  role: 'client' | 'admin' | 'employee' | 'photographer';
  pendingApprovals?: number; // Количество требующих подтверждения элементов
  createdAt: string | Date;
}

// Расширенный интерфейс для Firebase профиля пользователя
export interface UserProfile extends BaseProfile {
  lastLoginAt: string | Date;
  deleted?: boolean; // Поле для мягкого удаления
  personalData?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    preferences?: Record<string, unknown>;
  };
  // Поля для социальных аккаунтов
  authMethods?: string[];
  linkedAccounts?: {
    google?: boolean;
    apple?: boolean;
    microsoft?: boolean;
    facebook?: boolean;
    twitter?: boolean;
  };
}

// Интерфейс для локального мок-профиля пользователя
export interface MockProfile extends BaseProfile {
  firstName: string;
  lastName: string;
  updatedAt: Date;
}
