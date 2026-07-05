/**
 * DTO и типы для операции AI-ретуши «Кадрирование под документ» (`crop_document`).
 *
 * Контракты ровно по `30-architecture.md` (раздел «Финальная модель данных / контракты»):
 * detect-эндпоинт, параметры job, статус job, опция пресета документа,
 * а также фронт-зеркало плана кадрирования (`CropPlan`/`CropWarning`),
 * которое строит чистый модуль `src/app/shared/utils/crop-geometry.ts`
 * (идентичная копия канонической математики бэка) для живого превью рамки.
 */

/**
 * Ответ `POST /api/photo-retouch/detect-crop-lines` (data-часть `{ success, data }`).
 * Координаты — в пикселях исходного изображения. Поля линий null, если лицо не найдено.
 */
export interface DetectCropLinesResponse {
  imageWidth: number;
  imageHeight: number;
  /** Макушка (эвристика воркера), px по вертикали. null если лицо не найдено. */
  crownY: number | null;
  /** Подбородок (lm152), px по вертикали. null если лицо не найдено. */
  chinY: number | null;
  /** Центр лица (между глаз), px по горизонтали. null если лицо не найдено. */
  centerX: number | null;
  /** Наклон в градусах со знаком; только информативный (авто-поворот — non-goal). */
  tilt: number | null;
  faceDetected: boolean;
  /** Вердикт воркера: 'ok' | 'no_face' | ... */
  verdict: string;
}

/**
 * Параметры job операции `crop_document`.
 * Клиент шлёт ТОЛЬКО эти поля — геометрию (мм/dpi) бэк грузит из пресета по `documentType`
 * (граница доверия, см. анти-тампер в архитектуре).
 */
export interface CropDocumentParams {
  documentType: string;
  crownY: number;
  chinY: number;
  centerX: number;
  rotationDeg?: number;
}

/**
 * Статус ретуш-job (`GET /api/photo-retouch/jobs/:id`, data-часть).
 * Используется при поллинге результата кадрирования.
 */
export interface RetouchJobStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | string;
  result_url: string | null;
  result_thumbnail_url?: string | null;
  result_photo_id: string | null;
  error: string | null;
}

/**
 * Опция типа документа для селектора в редакторе.
 */
export interface DocumentPresetOption {
  slug: string;
  label: string;
  /** Соотношение сторон рамки превью (photo_w_mm / photo_h_mm), напр. 35/45. */
  aspectRatio: number;
}

/**
 * Канонический enum предупреждений кадрирования.
 * Имя `low_face_height` из proposal-2 НЕ используется (см. n1 в архитектуре).
 */
export type CropWarningCode =
  | 'extend_top'
  | 'extend_bottom'
  | 'extend_left'
  | 'extend_right'
  | 'low_resolution';

/**
 * Предупреждение плана кадрирования.
 * `valueMm` — scale-invariant величина белого поля (показывается сотруднику),
 * `valuePx` — та же величина в пикселях оригинала (для логов).
 * Для `low_resolution` мм-величина не применима → `valueMm` НЕ задаётся (undefined,
 * как у бэка), а `valuePx` несёт планируемую высоту кадра `round(cropH)`.
 */
export interface CropWarning {
  code: CropWarningCode;
  valuePx: number;
  valueMm?: number;
}

/**
 * Геометрия пресета документа (фронт-зеркало; на бэке грузится из `document_crop_presets`).
 */
export interface DocumentCropPreset {
  photoWmm: number;
  photoHmm: number;
  topMarginMm: number;
  headHeightMm: number;
  dpi: number;
  jpegQuality: number;
}

/** Положения трёх перетаскиваемых линий (px оригинала). tilt сюда НЕ входит. */
export interface CropLines {
  crownY: number;
  chinY: number;
  centerX: number;
}

/** Размеры исходного изображения (px). */
export interface CropImageSize {
  width: number;
  height: number;
}

/**
 * План кадрирования — фронт-зеркало канонического `CropPlan` бэка.
 * extract+extend выражены в масштабе оригинала; target — финальные пиксели результата.
 */
export interface CropPlan {
  extract: { left: number; top: number; width: number; height: number };
  extend: { top: number; bottom: number; left: number; right: number };
  target: { width: number; height: number };
  density: number;
  jpegQuality: number;
  warnings: CropWarning[];
}
