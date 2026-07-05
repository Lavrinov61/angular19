export type PhotoWorkspaceTariffLevel = 'basic' | 'extended' | 'maximum' | 'super';

export const PHOTO_WORKSPACE_VARIANT_LIMITS = {
  basic: 2,
  extended: 3,
  maximum: 5,
  super: 10,
} as const satisfies Record<PhotoWorkspaceTariffLevel, number>;

export const PHOTO_WORKSPACE_REFERENCE_ROLES = [
  { slug: 'glasses', label: 'Очки' },
  { slug: 'hair', label: 'Причёска / волосы' },
  { slug: 'clothing', label: 'Форма / одежда' },
  { slug: 'background', label: 'Фон' },
  { slug: 'makeup', label: 'Макияж' },
  { slug: 'pose', label: 'Поза / выражение' },
  { slug: 'style', label: 'Стиль обработки' },
  { slug: 'other', label: 'Другое' },
] as const;

export type PhotoWorkspaceReferenceRoleSlug = typeof PHOTO_WORKSPACE_REFERENCE_ROLES[number]['slug'];

export const PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT =
  'Мы обновили варианты обработки, пожалуйста, посмотрите согласование ещё раз.';

export const PHOTO_WORKSPACE_AI_ORIGINAL_RETENTION_DAYS = 90;
export const PHOTO_WORKSPACE_JOURNAL_RETENTION_DAYS = 90;
export const PHOTO_WORKSPACE_NOTIFICATION_DELAY_MS = 5 * 60 * 1000;

export const PHOTO_WORKSPACE_PROMPT_PRESETS = [
  {
    slug: 'skin_background_clean',
    label: 'Кожа и фон',
    basePrompt: 'почистить кожу, почистить фон',
  },
  {
    slug: 'wrinkles_under_eyes',
    label: 'Морщины и синяки',
    basePrompt: 'убрать морщины, убрать синяки под глазами',
  },
  {
    slug: 'face_hair_lips',
    label: 'Подбородок, волосы, губы',
    basePrompt: 'убрать второй подбородок, поправить волосы и объём, поправить губы если это девушка',
  },
] as const;
