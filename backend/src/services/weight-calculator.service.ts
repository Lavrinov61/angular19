/**
 * Калькулятор веса фотопродукции для расчёта стоимости доставки.
 *
 * Плотность фотобумаги: 260 г/м² (стандартная глянцевая/матовая).
 * Вес упаковки (конверт + картонная подложка): ~55г.
 */

/** Плотность фотобумаги в г/м² */
const PAPER_DENSITY_GSM = 260;

/** Вес упаковки: конверт (~15г) + картонная подложка (~40г) */
const PACKAGING_WEIGHT_GRAMS = 55;

/** Fallback вес для неизвестного формата (грамм) */
const FALLBACK_WEIGHT_GRAMS = 5;

/** Размеры фото в сантиметрах */
const PHOTO_SIZES: Record<string, { w: number; h: number }> = {
  '10x15':    { w: 10, h: 15 },   // 3.9 г/лист
  '15x20':    { w: 15, h: 20 },   // 7.8 г/лист
  '20x30':    { w: 20, h: 30 },   // 15.6 г/лист
  '30x40':    { w: 30, h: 40 },   // 31.2 г/лист
  '40x50':    { w: 40, h: 50 },   // 52.0 г/лист
  '50x70':    { w: 50, h: 70 },   // 91.0 г/лист
  '70x100':   { w: 70, h: 100 },  // 182.0 г/лист
  'document': { w: 10, h: 15 },   // фото на документы: печатается на листе 10×15
};

/**
 * Нормализация ключа формата: убрать суффиксы бумаги и холста.
 * Например: '10x15_supergloss' → '10x15', '30x40_canvas' → '30x40'
 */
function normalizeFormatKey(format: string): string {
  return format
    .replace(/_supergloss$/i, '')
    .replace(/_glossy$/i, '')
    .replace(/_matte$/i, '')
    .replace(/_satin$/i, '')
    .replace(/_super$/i, '')
    .replace(/_canvas$/i, '')
    .replace(/_premium$/i, '');
}

/**
 * Рассчитать вес одного листа фотобумаги по формату (грамм).
 * Формула: (ширина_м) × (высота_м) × плотность_г/м²
 */
export function calculatePhotoWeight(format: string): number {
  const key = normalizeFormatKey(format);
  const size = PHOTO_SIZES[key];
  if (!size) return FALLBACK_WEIGHT_GRAMS;

  const widthM = size.w / 100;
  const heightM = size.h / 100;
  return widthM * heightM * PAPER_DENSITY_GSM;
}

/**
 * Рассчитать общий вес отправления для заказа (грамм, округлено вверх).
 * Включает вес всех фото + упаковку.
 *
 * @param items Массив позиций: { format: '10x15', quantity: 2 }
 * @returns Общий вес в граммах (целое число)
 */
export function calculateOrderWeight(
  items: Array<{ format: string; quantity: number }>,
): number {
  let photosWeight = 0;

  for (const item of items) {
    photosWeight += calculatePhotoWeight(item.format) * item.quantity;
  }

  return Math.ceil(photosWeight + PACKAGING_WEIGHT_GRAMS);
}
