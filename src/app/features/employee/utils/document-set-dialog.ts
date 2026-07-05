import type { PrintDialogData } from '../components/print-dialog/print-dialog.component';
import type { FaceValidationResult } from '../services/face-validation-api.service';

/** Источник для «Комплекта на документы»: уже обрезанное фотографом фото. */
export interface DocumentSetSource {
  readonly fileUrl: string;
  readonly fileName: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly faceValidation?: FaceValidationResult;
}

/**
 * Строит данные диалога печати для «Комплекта на документы»:
 * авто-детект пресета по пропорции фото (3×4 → 6 шт, 3,5×4,5 → 4 шт, 2,5×3,5 → 9 шт),
 * раскладка на 10×15 с брендовым подвалом, матовая бумага, высокое качество, L8050.
 * Фото считается отпечатанным в 800 DPI (его уже кадрировал фотограф).
 */
export async function buildDocumentSetDialogData(src: DocumentSetSource): Promise<PrintDialogData> {
  const {
    calculateLayout,
    calculateDocumentSet,
    BRANDED_FOOTER,
    DOCUMENT_PRESETS,
    DOCUMENT_FACE_REQUIREMENTS,
  } = await import('../data/photo-size-presets');

  const dpi = 800;
  const sourceWpx = Math.max(1, Math.round(src.naturalWidth));
  const sourceHpx = Math.max(1, Math.round(src.naturalHeight));
  const measuredWmm = (sourceWpx / dpi) * 25.4;
  const measuredHmm = (sourceHpx / dpi) * 25.4;
  const ratio = sourceWpx / sourceHpx;

  const bestPreset = DOCUMENT_PRESETS
    .map(preset => {
      const directAspectDiff = Math.abs(ratio - preset.width_mm / preset.height_mm);
      const swappedAspectDiff = Math.abs(ratio - preset.height_mm / preset.width_mm);
      const directMmDiff = Math.abs(measuredWmm - preset.width_mm) + Math.abs(measuredHmm - preset.height_mm);
      const swappedMmDiff = Math.abs(measuredWmm - preset.height_mm) + Math.abs(measuredHmm - preset.width_mm);
      const swapped = swappedAspectDiff < directAspectDiff;
      return {
        preset,
        aspectDiff: Math.min(directAspectDiff, swappedAspectDiff),
        mmDiff: Math.min(directMmDiff, swappedMmDiff),
        swapped,
      };
    })
    .sort((a, b) => a.aspectDiff - b.aspectDiff || a.mmDiff - b.mmDiff)[0];

  const usePreset = !!bestPreset && (bestPreset.aspectDiff <= 0.045 || bestPreset.mmDiff <= 8);
  const detectedPreset = usePreset ? bestPreset.preset : null;
  const photoWmm = detectedPreset
    ? (bestPreset.swapped ? detectedPreset.height_mm : detectedPreset.width_mm)
    : Math.max(1, Math.round(measuredWmm));
  const photoHmm = detectedPreset
    ? (bestPreset.swapped ? detectedPreset.width_mm : detectedPreset.height_mm)
    : Math.max(1, Math.round(measuredHmm));

  const paperW = 100; // 10×15
  const paperH = 150;
  const usableH = paperH - BRANDED_FOOTER.heightMm;
  const layout = detectedPreset
    ? (calculateDocumentSet(detectedPreset.id) ?? calculateLayout(photoWmm, photoHmm, paperW, usableH, 1))
    : calculateLayout(photoWmm, photoHmm, paperW, usableH, 1);
  layout.brandedFooter = true;
  layout.templateMode = 'passport';

  return {
    file_url: src.fileUrl,
    file_name: src.fileName,
    preferred_printer_type: 'photo',
    ...(src.faceValidation ? { face_validation: src.faceValidation } : {}),
    document_set: {
      photoWmm,
      photoHmm,
      copies: layout.photosPerSheet,
      layout,
      paper_size: '10x15',
      quality: 'high',
      printer_name: 'L8050',
      media_type: 'matte',
      borderless: false,
      detected_preset_id: detectedPreset?.id,
      detected_label: detectedPreset?.label ?? 'Пользовательский размер',
      detected_dpi: dpi,
      source_width_px: sourceWpx,
      source_height_px: sourceHpx,
      face_requirements: detectedPreset ? DOCUMENT_FACE_REQUIREMENTS[detectedPreset.id] : undefined,
    },
  };
}

/** Builds print dialog data for the branded kraft C6 envelope used with document-photo sets. */
export async function buildEnvelopeC6DialogData(): Promise<PrintDialogData> {
  const { ENVELOPE_C6_KRAFT_TEMPLATE } = await import('../data/photo-size-presets');

  return {
    file_url: ENVELOPE_C6_KRAFT_TEMPLATE.templateAssetUrl,
    file_name: 'envelope-c6-svoefoto-template.png',
    preferred_printer_type: 'mfp',
    envelope_c6: {
      template: 'svoefoto-kraft',
      paper_size: ENVELOPE_C6_KRAFT_TEMPLATE.paperSize,
      media_type: ENVELOPE_C6_KRAFT_TEMPLATE.requiredMediaTypeId,
      paper_source: ENVELOPE_C6_KRAFT_TEMPLATE.requiredPaperSourceId,
      quality: 'normal',
      printer_name: 'C3226i',
    },
  };
}

/**
 * Загружает изображение, чтобы получить его натуральные размеры (без `crossOrigin` —
 * для чтения naturalWidth/Height CORS не нужен, а `anonymous` ломает загрузку с /uploads).
 * Возвращает 0×0, если картинка не загрузилась (тогда раскладка уходит в «пользовательский размер»).
 */
export function measureImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    if (typeof Image === 'undefined') {
      resolve({ width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}
