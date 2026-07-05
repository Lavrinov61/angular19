/**
 * crop-validation — анти-тампер валидация параметров job кадрирования под документ.
 *
 * ⚠️ ИСТОЧНИК ИСТИНЫ: 30-architecture.md, раздел «Анти-тампер — ДВА УРОВНЯ».
 *
 * Уровень 1 (роут POST /jobs, без размеров изображения): 4 безразмерных инварианта → ранний 400.
 * Уровень 2 (executor/Rust tool, после decode): + bounds-проверка (coordinate_out_of_bounds).
 *
 * Ошибки возвращаются СПИСКОМ (не fail-fast).
 */

/** Минимальная высота лица в px (защита деления pxPerMm). */
export const MIN_FACE_HEIGHT_PX = 10;

export type CropValidationCode =
  | 'unknown_document_type'
  | 'non_finite_coordinate'
  | 'crown_not_above_chin'
  | 'face_height_too_small'
  | 'rotation_out_of_range'
  | 'coordinate_out_of_bounds';

export interface CropValidationError {
  code: CropValidationCode;
  message: string;
}

/** Сырой вход из тела запроса (JSON — поля могут быть любого типа). */
export interface RawCropInput {
  documentType?: unknown;
  crownY?: unknown;
  chinY?: unknown;
  centerX?: unknown;
  rotationDeg?: unknown;
}

export interface CropValidationImage {
  width: number;
  height: number;
}

export interface CropValidationResult {
  valid: boolean;
  errors: CropValidationError[];
  /** Нормализованные числовые координаты — заполнены только если все 3 finite. */
  values?: { crownY: number; chinY: number; centerX: number; rotationDeg: number; documentType: string };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * validateCropInput — валидация параметров кадрирования.
 *
 * @param raw         сырой вход из тела запроса.
 * @param knownTypes  множество известных слагов документов (из БД ∪ fallback).
 * @param image       размеры изображения; если НЕ передан — уровень 1 (bounds НЕ проверяются).
 */
export function validateCropInput(
  raw: RawCropInput,
  knownTypes: ReadonlySet<string> | readonly string[],
  image?: CropValidationImage
): CropValidationResult {
  const errors: CropValidationError[] = [];
  const known = knownTypes instanceof Set ? knownTypes : new Set(knownTypes);

  // 1. documentType ∈ knownTypes
  const documentType = raw.documentType;
  if (typeof documentType !== 'string' || !known.has(documentType)) {
    errors.push({
      code: 'unknown_document_type',
      message: `Неизвестный тип документа: ${String(documentType)}`,
    });
  }

  // 2. crownY, chinY, centerX — Number.isFinite (ловит NaN/Infinity/строки из JSON)
  const crownFinite = isFiniteNumber(raw.crownY);
  const chinFinite = isFiniteNumber(raw.chinY);
  const centerFinite = isFiniteNumber(raw.centerX);
  if (!crownFinite || !chinFinite || !centerFinite) {
    errors.push({
      code: 'non_finite_coordinate',
      message: 'Координаты crownY/chinY/centerX должны быть конечными числами',
    });
  }

  // Дальнейшие числовые инварианты — только если координаты финитны.
  if (crownFinite && chinFinite && centerFinite) {
    const crownY = raw.crownY as number;
    const chinY = raw.chinY as number;
    const centerX = raw.centerX as number;

    // 3. crownY < chinY строго
    if (!(crownY < chinY)) {
      errors.push({
        code: 'crown_not_above_chin',
        message: 'Макушка должна быть выше подбородка (crownY < chinY)',
      });
    } else if (chinY - crownY < MIN_FACE_HEIGHT_PX) {
      // 4. высота лица ≥ MIN_FACE_HEIGHT_PX (защита деления) — проверяем только при верном порядке
      errors.push({
        code: 'face_height_too_small',
        message: `Высота лица слишком мала (< ${MIN_FACE_HEIGHT_PX}px)`,
      });
    }

    // 5. Уровень 2 — bounds (только если переданы размеры изображения)
    if (image) {
      if (crownY < 0 || crownY > image.height || chinY < 0 || chinY > image.height) {
        errors.push({
          code: 'coordinate_out_of_bounds',
          message: 'crownY/chinY вне диапазона [0, image.height]',
        });
      }
      if (centerX < 0 || centerX > image.width) {
        errors.push({
          code: 'coordinate_out_of_bounds',
          message: 'centerX вне диапазона [0, image.width]',
        });
      }
    }
  }

  const rawRotation = raw.rotationDeg ?? 0;
  const rotationDeg = isFiniteNumber(rawRotation) ? rawRotation : Number.NaN;
  if (!Number.isFinite(rotationDeg) || rotationDeg < -10 || rotationDeg > 10) {
    errors.push({
      code: 'rotation_out_of_range',
      message: 'Наклон должен быть числом в диапазоне [-10, 10] градусов',
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    values: {
      crownY: raw.crownY as number,
      chinY: raw.chinY as number,
      centerX: raw.centerX as number,
      rotationDeg,
      documentType: raw.documentType as string,
    },
  };
}
