/**
 * Чистая математика плана кадрирования фото под документ (`crop_document`).
 *
 * ⚓ ЯКОРЬ: ИДЕНТИЧНАЯ КОПИЯ «Финальной математики (КАНОНИЧЕСКОЙ)» из
 *   /tmp/team-cropping-doc-photos/30-architecture.md (раздел «Финальная математика»,
 *   блок строк 11-38). Бэк-копия — `backend/src/services/crop/crop-geometry.ts`.
 *   Обе реализации ОБЯЗАНЫ давать идентичные числа; дрейф ловится зеркальными
 *   табличными тестами (`crop-geometry.spec.ts` ↔ бэк `crop-geometry.test.ts`).
 *   Любая правка математики здесь требует синхронной правки бэка и обоих тестов.
 *
 * Только числа плана (extract/extend/target/density/jpegQuality/warnings).
 * БЕЗ sharp, БЕЗ зависимостей — чистый TS. Двухпроходный sharp живёт на бэке.
 */

import type {
  CropImageSize,
  CropLines,
  CropPlan,
  CropWarning,
  DocumentCropPreset,
} from '../../core/models/ai-retouch.models';

/**
 * Порог апскейла для warning `low_resolution`: предупреждаем, когда финальная
 * высота результата (target.height) превышает планируемую высоту кадра в px оригинала
 * (round(cropH)) более чем в этот раз. Эталон pasport pxPerMm=10: 531/450=1.18 < 1.5 → нет warning.
 * (Канон 30-architecture.md; идентичен бэку `crop-geometry.ts`.)
 */
export const UPSCALE_WARN_FACTOR = 1.5;

/**
 * Строит план кадрирования по положению трёх линий, пресету документа и размеру изображения.
 *
 * @throws RangeError если высота лица невалидна (`pxPerMm <= 0` или `!isFinite`).
 *         Это страж; анти-тампер обязан отсечь такой вход раньше (см. архитектуру).
 */
export function computeCropPlan(
  lines: CropLines,
  preset: DocumentCropPreset,
  image: CropImageSize,
): CropPlan {
  const { crownY, chinY, centerX } = lines;
  const { photoWmm, photoHmm, topMarginMm, headHeightMm, dpi, jpegQuality } = preset;

  const pxPerMm = (chinY - crownY) / headHeightMm;
  if (!isFinite(pxPerMm) || pxPerMm <= 0) {
    throw new RangeError('invalid face height');
  }

  const cropW = photoWmm * pxPerMm;
  const cropH = photoHmm * pxPerMm;
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
    image.width - extractLeft,
  );
  const extractHeight = clamp(
    Math.round(cropH) - extendTop - extendBottom,
    1,
    image.height - extractTop,
  );

  const targetWidth = Math.round((photoWmm / 25.4) * dpi);
  const targetHeight = Math.round((photoHmm / 25.4) * dpi);

  const warnings: CropWarning[] = [];
  if (extendTop > 0) warnings.push(makeExtendWarning('extend_top', extendTop, pxPerMm));
  if (extendBottom > 0) warnings.push(makeExtendWarning('extend_bottom', extendBottom, pxPerMm));
  if (extendLeft > 0) warnings.push(makeExtendWarning('extend_left', extendLeft, pxPerMm));
  if (extendRight > 0) warnings.push(makeExtendWarning('extend_right', extendRight, pxPerMm));
  // low_resolution: источник слишком мелкий — финальный результат апскейлится более чем
  // в UPSCALE_WARN_FACTOR раз относительно планируемой высоты кадра в px оригинала (round(cropH)).
  // Считаем ОТ round(cropH) (планируемая рамка), НЕ от extract.height (канон, идентично бэку).
  // valuePx = round(cropH); valueMm для low_resolution не применима.
  const cropHPx = Math.round(cropH);
  if (targetHeight > UPSCALE_WARN_FACTOR * cropHPx) {
    // valueMm НЕ задаётся (мм-величина не применима к low_resolution) — форма идентична бэку.
    warnings.push({ code: 'low_resolution', valuePx: cropHPx });
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

function makeExtendWarning(
  code: 'extend_top' | 'extend_bottom' | 'extend_left' | 'extend_right',
  valuePx: number,
  pxPerMm: number,
): CropWarning {
  // Warnings выражаем в ММ (scale-invariant): величина белого поля в px зависит от
  // масштаба, а мм — нет. Сотруднику показываем «добавлю N мм белого».
  return { code, valuePx, valueMm: round1(valuePx / pxPerMm) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
