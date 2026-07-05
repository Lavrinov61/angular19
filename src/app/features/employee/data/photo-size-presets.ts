export type TemplateMode = 'none' | 'polaroid' | 'passport' | 'collage' | 'label' | 'business-card';

export interface PhotoSizePreset {
  id: string;
  label: string;
  width_mm: number;
  height_mm: number;
  icon?: string;
  group: 'photo' | 'document' | 'collage' | 'label';
  templateMode?: TemplateMode;
  bottomPaddingMm?: number;
}

export const POLAROID_600_TEMPLATE = {
  paperWidthMm: 100,
  paperHeightMm: 150,
  cardWidthMm: 88,
  cardHeightMm: 107,
  photoSizeMm: 79,
  borderTopMm: 5,
  borderSideMm: 4.5,
  borderBottomMm: 23,
} as const;

export const BUSINESS_CARD_A4_TEMPLATE = {
  paperSize: 'A4',
  paperWidthMm: 210,
  paperHeightMm: 297,
  rows: 5,
  cols: 2,
  cutMarginMm: 3,
  cutMarkLengthMm: 5,
  cutMarkOffsetMm: 1,
  requiredPrinterNeedle: 'c3226',
  requiredMediaTypeId: 'heavy6',
  requiredPaperSourceId: 'manual',
} as const;

export const BUSINESS_CARD_MEDIA_TYPE_LABEL = 'Плотная 6/7 (HEAVY6/HEAVY7)' as const;

export const ENVELOPE_C6_KRAFT_TEMPLATE = {
  paperSize: 'c6_envelope',
  paperWidthMm: 114,
  paperHeightMm: 162,
  templateHtmlUrl: '/assets/print-templates/envelope-c6-svoefoto-template.html',
  templateOrientation: 'landscape',
  templateWidthMm: 162,
  templateHeightMm: 114,
  requiredPrinterNeedle: 'c3226',
  requiredMediaTypeId: 'envelope',
  requiredPaperSourceId: 'manual',
  templateAssetUrl: '/assets/print-templates/envelope-c6-svoefoto-template.png',
} as const;

export const ENVELOPE_C6_KRAFT_MEDIA_TYPE_LABEL = 'Конверт / крафт' as const;

export const PHOTO_SIZE_PRESETS: PhotoSizePreset[] = [
  { id: 'full',  label: 'По размеру бумаги', width_mm: 0, height_mm: 0, group: 'photo' },
  { id: '10x15', label: '10×15', width_mm: 100, height_mm: 150, group: 'photo' },
  { id: '10x10', label: '10×10', width_mm: 100, height_mm: 100, group: 'photo' },
  { id: '9x13',  label: '9×13',  width_mm: 90,  height_mm: 130, group: 'photo' },
  { id: '13x18', label: '13×18', width_mm: 130, height_mm: 180, group: 'photo' },
  { id: '15x21', label: '15×21', width_mm: 150, height_mm: 210, group: 'photo' },
  { id: '3x4',   label: '3×4 паспорт', width_mm: 30, height_mm: 40, icon: 'badge', group: 'document' },
  { id: '35x45', label: '35×45 виза', width_mm: 35, height_mm: 45, icon: 'flight', group: 'document' },
  { id: '25x35', label: '25×35 пропуск', width_mm: 25, height_mm: 35, icon: 'badge', group: 'document' },
  {
    id: 'polaroid',
    label: 'Polaroid',
    width_mm: POLAROID_600_TEMPLATE.cardWidthMm,
    height_mm: POLAROID_600_TEMPLATE.photoSizeMm,
    icon: 'photo_camera',
    group: 'photo',
    templateMode: 'polaroid',
    bottomPaddingMm: POLAROID_600_TEMPLATE.cardHeightMm - POLAROID_600_TEMPLATE.photoSizeMm,
  },
  // Collage presets
  { id: '2-on-a4', label: '2 фото на A4', width_mm: 148, height_mm: 210, icon: 'grid_view', group: 'collage', templateMode: 'collage' },
  { id: '4-on-a4', label: '4 фото на A4', width_mm: 105, height_mm: 148, icon: 'grid_on', group: 'collage', templateMode: 'collage' },
  { id: '2-on-10x15', label: '2 фото на 10×15', width_mm: 75, height_mm: 100, icon: 'photo_library', group: 'collage', templateMode: 'collage' },
  // Label preset
  { id: 'order-label', label: 'Этикетка заказа', width_mm: 62, height_mm: 29, icon: 'label', group: 'label', templateMode: 'label' },
  // Business cards
  { id: 'business-card', label: 'Визитка 90×50', width_mm: 90, height_mm: 50, icon: 'contact_page', group: 'label', templateMode: 'business-card' },
  { id: 'business-card-eu', label: 'Визитка 85×55', width_mm: 85, height_mm: 55, icon: 'contact_page', group: 'label', templateMode: 'business-card' },
];

export const PHOTO_PRESETS = PHOTO_SIZE_PRESETS.filter(p => p.group === 'photo');
export const DOCUMENT_PRESETS = PHOTO_SIZE_PRESETS.filter(p => p.group === 'document');
export const COLLAGE_PRESETS = PHOTO_SIZE_PRESETS.filter(p => p.group === 'collage');
export const LABEL_PRESETS = PHOTO_SIZE_PRESETS.filter(p => p.group === 'label');

/** Fixed grid for collage templates: id -> { cols, rows } */
export const COLLAGE_GRID: Record<string, { cols: number; rows: number }> = {
  '2-on-a4': { cols: 1, rows: 2 },
  '4-on-a4': { cols: 2, rows: 2 },
  '2-on-10x15': { cols: 1, rows: 2 },
};

export const BUSINESS_CARD_GRID: Record<string, { cols: number; rows: number }> = {
  'business-card': { cols: BUSINESS_CARD_A4_TEMPLATE.cols, rows: BUSINESS_CARD_A4_TEMPLATE.rows },
  'business-card-eu': { cols: BUSINESS_CARD_A4_TEMPLATE.cols, rows: BUSINESS_CARD_A4_TEMPLATE.rows },
};

/** Branded footer config for document photo sets */
export const BRANDED_FOOTER = {
  heightMm: 15,
  logo: 'Своё Фото',
  lines: [
    'Соборный 21 | 2-я Баррикадная 4',
    'svoefoto.ru | +7 (863) 322-65-75',
  ],
};

/** Face requirements per document preset (from DB print_presets.face_requirements) */
export const DOCUMENT_FACE_REQUIREMENTS: Record<string, { min_mm: number; max_mm: number; standard?: string }> = {
  '3x4':   { min_mm: 30, max_mm: 34, standard: 'ГОСТ Р ИСО/МЭК 19794-5' },
  '35x45': { min_mm: 32, max_mm: 36, standard: 'ICAO 9303' },
  '25x35': { min_mm: 25, max_mm: 30 },
};

/** Document set: exact fixed grids on 10×15 with cut margin. */
export const DOCUMENT_SET_INFO: Record<string, { cols: number; rows: number; total: number; paperLabel: string }> = {
  '3x4': { cols: 2, rows: 3, total: 6, paperLabel: '10×15' },
  '35x45': { cols: 2, rows: 2, total: 4, paperLabel: '10×15' },
  '25x35': { cols: 3, rows: 3, total: 9, paperLabel: '10×15' },
};

export interface LayoutCalcResult {
  rows: number;
  cols: number;
  photosPerSheet: number;
  wastePercent: number;
  photoCellW: number;
  photoCellH: number;
  cutMarginMm: number;
  sheetsNeeded?: number;
  templateMode?: TemplateMode;
  photoAreaH?: number;
  bottomPaddingMm?: number;
  brandedFooter?: boolean;
}

export function calculateLayout(
  photoW: number, photoH: number,
  paperW: number, paperH: number,
  cutMargin = 2,
  totalPhotos?: number,
  templateMode?: TemplateMode,
  bottomPaddingMm?: number,
  presetId?: string,
): LayoutCalcResult {
  if (photoW <= 0 || photoH <= 0) {
    return { rows: 1, cols: 1, photosPerSheet: 1, wastePercent: 0, photoCellW: paperW, photoCellH: paperH, cutMarginMm: 0 };
  }

  // Collage mode: use fixed grid from COLLAGE_GRID
  if (templateMode === 'collage' && presetId && COLLAGE_GRID[presetId]) {
    const grid = COLLAGE_GRID[presetId];
    const cellW = photoW;
    const cellH = photoH;
    const count = grid.cols * grid.rows;
    const usedArea = count * cellW * cellH;
    const totalArea = paperW * paperH;
    const result: LayoutCalcResult = {
      rows: grid.rows,
      cols: grid.cols,
      photosPerSheet: count,
      wastePercent: Math.round((1 - usedArea / totalArea) * 100),
      photoCellW: cellW,
      photoCellH: cellH,
      cutMarginMm: 1,
      templateMode: 'collage',
    };
    if (totalPhotos) {
      result.sheetsNeeded = Math.ceil(totalPhotos / count);
    }
    return result;
  }

  if (templateMode === 'business-card' && presetId) {
    const businessLayout = calculateBusinessCardLayout(presetId, totalPhotos);
    if (businessLayout) return businessLayout;
  }

  const effectiveH = templateMode === 'polaroid' && bottomPaddingMm ? photoH + bottomPaddingMm : photoH;

  const portrait = tryLayout(photoW, effectiveH, paperW, paperH, cutMargin);
  const landscape = tryLayout(effectiveH, photoW, paperW, paperH, cutMargin);
  const best = portrait.photosPerSheet >= landscape.photosPerSheet ? portrait : landscape;

  if (templateMode === 'polaroid' && bottomPaddingMm) {
    best.templateMode = 'polaroid';
    best.photoAreaH = photoH;
    best.bottomPaddingMm = bottomPaddingMm;
  }

  if (totalPhotos) {
    best.sheetsNeeded = Math.ceil(totalPhotos / best.photosPerSheet);
  }
  return best;
}

function tryLayout(pw: number, ph: number, paperW: number, paperH: number, margin: number): LayoutCalcResult {
  const cols = Math.max(1, Math.floor((paperW + margin) / (pw + margin)));
  const rows = Math.max(1, Math.floor((paperH + margin) / (ph + margin)));
  const count = rows * cols;
  const usedArea = count * pw * ph;
  const totalArea = paperW * paperH;
  return {
    rows, cols, photosPerSheet: count,
    wastePercent: Math.round((1 - usedArea / totalArea) * 100),
    photoCellW: pw, photoCellH: ph,
    cutMarginMm: margin,
  };
}

export function detectBestPaperSize(
  imgWidth: number,
  imgHeight: number,
  presets: PhotoSizePreset[] = PHOTO_SIZE_PRESETS,
): { presetId: string; orientation: 'portrait' | 'landscape' } {
  const imgRatio = imgWidth / imgHeight;
  let bestId = '10x15';
  let bestOrientation: 'portrait' | 'landscape' = 'portrait';
  let bestDiff = Infinity;

  for (const preset of presets) {
    if (preset.width_mm <= 0 || preset.height_mm <= 0) continue;

    const portraitRatio = preset.width_mm / preset.height_mm;
    const landscapeRatio = preset.height_mm / preset.width_mm;

    const diffPortrait = Math.abs(imgRatio - portraitRatio);
    const diffLandscape = Math.abs(imgRatio - landscapeRatio);

    if (diffPortrait < bestDiff) {
      bestDiff = diffPortrait;
      bestId = preset.id;
      bestOrientation = 'portrait';
    }
    if (diffLandscape < bestDiff) {
      bestDiff = diffLandscape;
      bestId = preset.id;
      bestOrientation = 'landscape';
    }
  }

  return { presetId: bestId, orientation: bestOrientation };
}

/** Calculate layout for a document photo set on 10×15. */
export function calculateDocumentSet(presetId: string): LayoutCalcResult | null {
  const info = DOCUMENT_SET_INFO[presetId];
  const preset = PHOTO_SIZE_PRESETS.find(p => p.id === presetId);
  if (!info || !preset) return null;

  const paperW = 100; // 10×15
  const paperH = 150;

  return {
    rows: info.rows,
    cols: info.cols,
    photosPerSheet: info.total,
    wastePercent: Math.round((1 - (info.total * preset.width_mm * preset.height_mm) / (paperW * paperH)) * 100),
    photoCellW: preset.width_mm,
    photoCellH: preset.height_mm,
    cutMarginMm: 1,
    templateMode: 'passport',
  };
}

export function isBusinessCardPresetId(presetId: string | null | undefined): boolean {
  return !!presetId && Object.prototype.hasOwnProperty.call(BUSINESS_CARD_GRID, presetId);
}

function normalizePrintOptionId(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[\s_\-/]/g, '');
}

export function isBusinessCardMediaTypeId(value: string | null | undefined): boolean {
  const normalized = normalizePrintOptionId(value);
  return normalized === BUSINESS_CARD_A4_TEMPLATE.requiredMediaTypeId
    || normalized === 'heavy221256'
    || normalized === 'gsm250'
    || normalized === '250gsm'
    || normalized === 'cardstock250'
    || normalized === 'heavy7'
    || normalized === 'heavy257300'
    || normalized === 'gsm300'
    || normalized === '300gsm'
    || normalized === 'cardstock300'
    || normalized.includes('heavy6')
    || normalized.includes('heavy7')
    || normalized.includes('221256')
    || normalized.includes('257300')
    || normalized.includes('250')
    || normalized.includes('300')
    || normalized.includes('плотная6')
    || normalized.includes('плотная7')
    || normalized.includes('мелованная6')
    || normalized.includes('мелованная7');
}

export function calculateBusinessCardLayout(
  presetId: string,
  totalPhotos?: number,
): LayoutCalcResult | null {
  const grid = BUSINESS_CARD_GRID[presetId];
  const preset = PHOTO_SIZE_PRESETS.find(p => p.id === presetId);
  if (!grid || !preset) return null;

  const count = grid.cols * grid.rows;
  const usedArea = count * preset.width_mm * preset.height_mm;
  const totalArea = BUSINESS_CARD_A4_TEMPLATE.paperWidthMm * BUSINESS_CARD_A4_TEMPLATE.paperHeightMm;
  const result: LayoutCalcResult = {
    rows: grid.rows,
    cols: grid.cols,
    photosPerSheet: count,
    wastePercent: Math.round((1 - usedArea / totalArea) * 100),
    photoCellW: preset.width_mm,
    photoCellH: preset.height_mm,
    cutMarginMm: BUSINESS_CARD_A4_TEMPLATE.cutMarginMm,
    templateMode: 'business-card',
  };
  if (totalPhotos) {
    result.sheetsNeeded = Math.ceil(totalPhotos / count);
  }
  return result;
}

export function parsePageRange(input: string, totalPages: number): Set<number> {
  const result = new Set<number>();
  const hasPageLimit = Number.isFinite(totalPages) && totalPages > 0;
  const pageLimit = hasPageLimit ? Math.floor(totalPages) : 10_000;
  const parts = input.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeParts = trimmed.split('-');
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0], 10);
      const end = parseInt(rangeParts[1], 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(pageLimit, end); i++) {
          result.add(i);
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= pageLimit) {
        result.add(num);
      }
    }
  }
  return result;
}
