/**
 * crop-document.executor — детерминированное кадрирование фото под документ через Rust.
 *
 * TS-слой отвечает за storage/job orchestration и загрузку доверенного пресета.
 * Image processing (decode/rotate/extract/extend/resize/JPEG density) выполняет
 * `photo-retouch-tool`, чтобы не держать паспортное кадрирование в Python/sharp.
 */
import { cropDocumentRust } from './photo-retouch-tool.service.js';
import { validateCropInput, type RawCropInput } from './crop-validation.js';
import { loadCropPreset, loadKnownDocumentTypes } from './document-crop-presets.js';
import type { CropPlan } from './crop-geometry.js';

/** Параметры job операции crop_document (клиент шлёт ТОЛЬКО эти поля; геометрию — нет). */
export interface CropDocumentParams {
  documentType: string;
  crownY: number;
  chinY: number;
  centerX: number;
  /** Поворот изображения в градусах перед кадрированием. Диапазон валидируется: [-10, 10]. */
  rotationDeg?: number;
}

export interface CropDocumentResult {
  buffer: Buffer;
  plan: CropPlan;
}

/**
 * executeCropDocument — выполнить локальное кадрирование под документ.
 *
 * @param sourceImageUrl публичный URL фото из НАШЕГО storage.
 * @param rawParams      сырые params job.
 * @throws Error при не-storage url, битом буфере, провале анти-тампера или неизвестном пресете.
 */
export async function executeCropDocument(
  sourceImageUrl: string,
  rawParams: RawCropInput,
): Promise<CropDocumentResult> {
  const knownTypes = await loadKnownDocumentTypes();
  const validated = validateCropInput(rawParams, knownTypes);
  if (!validated.valid || !validated.values) {
    const reason = validated.errors.map((e) => e.message).join('; ');
    throw new Error(`Crop validation failed: ${reason}`);
  }

  const preset = await loadCropPreset(validated.values.documentType);
  if (!preset) {
    throw new Error(`Unknown document preset: ${validated.values.documentType}`);
  }

  try {
    return await cropDocumentRust(sourceImageUrl, {
      documentType: validated.values.documentType,
      crownY: validated.values.crownY,
      chinY: validated.values.chinY,
      centerX: validated.values.centerX,
      rotationDeg: validated.values.rotationDeg,
      preset: {
        photoWmm: preset.photoWmm,
        photoHmm: preset.photoHmm,
        topMarginMm: preset.topMarginMm,
        headHeightMm: preset.headHeightMm,
        dpi: preset.dpi,
        jpegQuality: preset.jpegQuality,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/crop coordinates|face height|rotationDeg|invalid crop input/i.test(message)) {
      throw new Error(`Crop validation failed: ${message}`);
    }
    if (/decode|open image|image/i.test(message)) {
      throw new Error(`Invalid image for crop: ${message}`);
    }
    throw err;
  }
}
