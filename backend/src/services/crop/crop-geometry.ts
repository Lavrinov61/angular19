/**
 * crop-geometry — чистая каноническая математика кадрирования фото под документ.
 *
 * ⚠️ ИСТОЧНИК ИСТИНЫ: 30-architecture.md, раздел «Финальная математика (КАНОНИЧЕСКАЯ)».
 * Этот модуль считает ТОЛЬКО числа плана (extract/extend/target/density/jpegQuality/warnings).
 * Двухпроходный image pipeline здесь НЕ исполняется — это делает Rust photo-retouch-tool.
 *
 * Фронт-зеркало: src/app/shared/utils/crop-geometry.ts — обязано совпадать табличными кейсами.
 */

export interface CropLines {
  /** Макушка головы, px по вертикали в координатах оригинала. */
  crownY: number;
  /** Подбородок, px по вертикали. */
  chinY: number;
  /** Центр лица, px по горизонтали. */
  centerX: number;
}

export interface CropPreset {
  photoWmm: number;
  photoHmm: number;
  topMarginMm: number;
  headHeightMm: number;
  dpi: number;
  jpegQuality: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Канонический enum предупреждений (30-architecture.md, фикс n1). */
export type CropWarningCode =
  | 'extend_top'
  | 'extend_bottom'
  | 'extend_left'
  | 'extend_right'
  | 'low_resolution';

export interface CropWarning {
  code: CropWarningCode;
  /** Величина в пикселях (для логов). Для extend_* — белое поле; для low_resolution — round(cropH). */
  valuePx: number;
  /**
   * Та же величина в мм, scale-invariant (показывается сотруднику). round(valuePx/pxPerMm, 1).
   * Задаётся ТОЛЬКО для extend_* (там мм осмысленны); для low_resolution НЕ задаётся.
   */
  valueMm?: number;
}

export interface CropPlan {
  extract: { left: number; top: number; width: number; height: number };
  extend: { top: number; bottom: number; left: number; right: number };
  target: { width: number; height: number };
  density: number;
  jpegQuality: number;
  warnings: CropWarning[];
}

const MM_PER_INCH = 25.4;

/**
 * Порог апскейла для предупреждения low_resolution (30-architecture.md, канонический блок).
 * Триггер: target.height > UPSCALE_WARN_FACTOR * round(cropH).
 * Считаем от round(cropH) (плотность пикселей источника = photoH_mm * pxPerMm), а НЕ от extract.height:
 * при обрезке краем extract.height < cropH из-за extend, и low_resolution ложно сработал бы от клиппинга,
 * продублировав extend_*. Низкое разрешение — про плотность источника, не про обрезку.
 * Эталон pxPerMm=10: factor 531/450=1.18 < 1.5 → НЕ триггерит (acceptance строка 178: warnings=[]).
 * Триггерит при pxPerMm < ~7.87 (реально мелкий исходник).
 */
const UPSCALE_WARN_FACTOR = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Округление до 1 знака после запятой (для valueMm). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * computeCropPlan — каноническое разложение плана кадрирования.
 *
 * @throws RangeError если pxPerMm <= 0 || !isFinite (страж; анти-тампер обязан отсечь раньше).
 */
export function computeCropPlan(
  lines: CropLines,
  preset: CropPreset,
  image: ImageSize
): CropPlan {
  const { crownY, chinY, centerX } = lines;
  const { photoWmm, photoHmm, topMarginMm, headHeightMm, dpi, jpegQuality } = preset;

  const pxPerMm = (chinY - crownY) / headHeightMm;
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) {
    throw new RangeError('invalid face height');
  }

  const cropW = photoWmm * pxPerMm;
  const cropH = photoHmm * pxPerMm;
  const roundCropH = Math.round(cropH);
  const idealTop = crownY - topMarginMm * pxPerMm;
  const idealLeft = centerX - cropW / 2;

  // Декларативное разложение «за краем» — extend белым ВОКРУГ extract.
  const extendTop = Math.round(Math.max(0, -idealTop));
  const extendLeft = Math.round(Math.max(0, -idealLeft));
  const extendBottom = Math.round(Math.max(0, idealTop + cropH - image.height));
  const extendRight = Math.round(Math.max(0, idealLeft + cropW - image.width));

  const extractLeft = clamp(Math.round(idealLeft), 0, image.width);
  const extractTop = clamp(Math.round(idealTop), 0, image.height);
  const extractWidth = clamp(
    Math.round(cropW) - extendLeft - extendRight,
    1,
    image.width - extractLeft
  );
  const extractHeight = clamp(
    roundCropH - extendTop - extendBottom,
    1,
    image.height - extractTop
  );

  const targetWidth = Math.round((photoWmm / MM_PER_INCH) * dpi);
  const targetHeight = Math.round((photoHmm / MM_PER_INCH) * dpi);

  const warnings: CropWarning[] = [];
  if (extendTop > 0) {
    warnings.push({ code: 'extend_top', valuePx: extendTop, valueMm: round1(extendTop / pxPerMm) });
  }
  if (extendBottom > 0) {
    warnings.push({ code: 'extend_bottom', valuePx: extendBottom, valueMm: round1(extendBottom / pxPerMm) });
  }
  if (extendLeft > 0) {
    warnings.push({ code: 'extend_left', valuePx: extendLeft, valueMm: round1(extendLeft / pxPerMm) });
  }
  if (extendRight > 0) {
    warnings.push({ code: 'extend_right', valuePx: extendRight, valueMm: round1(extendRight / pxPerMm) });
  }
  // low_resolution: ЗАМЕТНЫЙ апскейл по плотности источника (НЕ по обрезке краем).
  // Триггер: target.height > UPSCALE_WARN_FACTOR * round(cropH). valuePx = round(cropH) (px источника
  // на высоту документа). valueMm НЕ задаём (мм для low_resolution не осмысленны). См. канонический блок.
  if (targetHeight > UPSCALE_WARN_FACTOR * roundCropH) {
    warnings.push({ code: 'low_resolution', valuePx: roundCropH });
  }

  return {
    extract: { left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight },
    extend: { top: extendTop, bottom: extendBottom, left: extendLeft, right: extendRight },
    target: { width: targetWidth, height: targetHeight },
    density: dpi,
    jpegQuality,
    warnings,
  };
}
