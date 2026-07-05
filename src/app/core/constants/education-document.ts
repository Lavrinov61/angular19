import type { EducationRole } from '../services/student-verification.service';

/** Опция выбора роли при подтверждении образовательного статуса. */
export interface EducationRoleOption {
  readonly value: EducationRole;
  readonly label: string;
}

/** Роли образовательного статуса (значение + подпись для select). Источник правды для кабинета и /education. */
export const EDUCATION_ROLE_OPTIONS: readonly EducationRoleOption[] = [
  { value: 'student', label: 'Студент' },
  { value: 'applicant', label: 'Абитуриент' },
  { value: 'teacher', label: 'Учитель' },
  { value: 'lecturer', label: 'Преподаватель' },
  { value: 'staff', label: 'Сотрудник образовательной организации' },
] as const;

/** Подсказка по документу для подтверждения статуса, зависит от выбранной роли. */
export const EDUCATION_DOCUMENT_HINTS: Readonly<Record<EducationRole, string>> = {
  student: 'Студенческий билет или справка об обучении: видно ФИО, учебное заведение и срок действия.',
  applicant:
    'Подойдёт любой документ абитуриента: справка или приказ о зачислении, расписка приёмной комиссии, '
    + 'скриншот заявления «Поступление в вуз онлайн» на Госуслугах, аттестат или справка из школы. Главное, чтобы было видно ФИО.',
  teacher: 'Удостоверение педагога или справка с места работы: видно ФИО и учебное заведение.',
  lecturer: 'Удостоверение преподавателя или справка с места работы: видно ФИО и учебное заведение.',
  staff: 'Справка с места работы или служебное удостоверение: видно ФИО и образовательную организацию.',
};

/** Максимальный размер файла документа: 12 МБ. */
export const MAX_DOCUMENT_FILE_SIZE = 12 * 1024 * 1024;

/** Поддерживаемые MIME-типы фото документа. */
export const SUPPORTED_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** Значение `accept` для file-input документа. */
export const DOCUMENT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

/** Результат валидации файла документа: дискриминированный union по полю `ok`. */
export type DocumentValidationResult =
  | { ok: true; file: File }
  | { ok: false; message: string };

/**
 * Проверяет файл документа: сначала MIME-тип, затем размер. Чистая функция, без window/DOM.
 * Тексты ошибок совпадают с кабинетом (student-account.component.ts).
 * Вызывать только при наличии File; отсутствие файла обрабатывает вызывающий код.
 */
export function validateEducationDocumentFile(file: File): DocumentValidationResult {
  if (!SUPPORTED_DOCUMENT_TYPES.has(file.type)) {
    return { ok: false, message: 'Загрузите фото в формате JPEG, PNG, WEBP или HEIC.' };
  }

  if (file.size > MAX_DOCUMENT_FILE_SIZE) {
    return { ok: false, message: 'Файл должен быть не больше 12 МБ.' };
  }

  return { ok: true, file };
}
