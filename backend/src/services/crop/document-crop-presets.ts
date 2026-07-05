/**
 * document-crop-presets — загрузка геометрических пресетов кадрирования под документ.
 *
 * Источник: таблица document_crop_presets (миграция zz_20260606_document_crop_presets.sql).
 * Fallback на встроенные константы, если строки в БД нет или БД недоступна на старте.
 * Семантика «нет строки» = вернуть fallback только для известных built-in слагов.
 *
 * ⚠️ Встроенные числа: passport_rf 35×45мм, отступ 5мм, голова 32мм, 800dpi;
 * visa_schengen 35×45мм, отступ 3мм, голова 32мм, 800dpi;
 * photo_3x4 30×40мм, отступ 3мм, голова 26мм, 800dpi;
 * photo_9x12 90×120мм, отступ 10мм, голова 65мм, 800dpi;
 * photo_4x6 40×60мм, отступ 5мм, голова 34мм, 800dpi.
 */
import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';
import type { CropPreset } from './crop-geometry.js';

const logger = createLogger('document-crop-presets');

export interface DocumentCropPreset extends CropPreset {
  slug: string;
  label: string;
}

/** Встроенный пресет паспорта РФ — fallback и источник истины для тестов. */
export const PASSPORT_RF_PRESET: DocumentCropPreset = {
  slug: 'passport_rf',
  label: 'Паспорт РФ 35×45',
  photoWmm: 35,
  photoHmm: 45,
  topMarginMm: 5,
  headHeightMm: 32,
  dpi: 800,
  jpegQuality: 92,
};

/** Виза Шенген 35×45 — fallback для визового формата. */
export const VISA_SCHENGEN_PRESET: DocumentCropPreset = {
  slug: 'visa_schengen',
  label: 'Виза Шенген 35×45',
  photoWmm: 35,
  photoHmm: 45,
  topMarginMm: 3,
  headHeightMm: 32,
  dpi: 800,
  jpegQuality: 92,
};

/** Фото 3×4 — fallback для стандартного формата 30×40мм. */
export const PHOTO_3X4_PRESET: DocumentCropPreset = {
  slug: 'photo_3x4',
  label: 'Фото 3×4',
  photoWmm: 30,
  photoHmm: 40,
  topMarginMm: 3,
  headHeightMm: 26,
  dpi: 800,
  jpegQuality: 92,
};

/** Фото 9×12 — fallback для крупного рабочего формата 90×120мм. */
export const PHOTO_9X12_PRESET: DocumentCropPreset = {
  slug: 'photo_9x12',
  label: 'Фото 9×12',
  photoWmm: 90,
  photoHmm: 120,
  topMarginMm: 10,
  headHeightMm: 65,
  dpi: 800,
  jpegQuality: 92,
};

/** Фото 4×6 — fallback для формата 40×60мм. */
export const PHOTO_4X6_PRESET: DocumentCropPreset = {
  slug: 'photo_4x6',
  label: 'Фото 4×6',
  photoWmm: 40,
  photoHmm: 60,
  topMarginMm: 5,
  headHeightMm: 34,
  dpi: 800,
  jpegQuality: 92,
};

/** Карта встроенных пресетов (fallback). */
const BUILTIN_PRESETS: Record<string, DocumentCropPreset> = {
  [PASSPORT_RF_PRESET.slug]: PASSPORT_RF_PRESET,
  [VISA_SCHENGEN_PRESET.slug]: VISA_SCHENGEN_PRESET,
  [PHOTO_3X4_PRESET.slug]: PHOTO_3X4_PRESET,
  [PHOTO_9X12_PRESET.slug]: PHOTO_9X12_PRESET,
  [PHOTO_4X6_PRESET.slug]: PHOTO_4X6_PRESET,
};

interface PresetRow {
  slug: string;
  label: string;
  photo_w_mm: string | number;
  photo_h_mm: string | number;
  top_margin_mm: string | number;
  head_height_mm: string | number;
  dpi: string | number;
  jpeg_quality: string | number;
}

interface PresetSlugRow {
  slug: string;
}

function rowToPreset(row: PresetRow): DocumentCropPreset {
  return {
    slug: row.slug,
    label: row.label,
    photoWmm: Number(row.photo_w_mm),
    photoHmm: Number(row.photo_h_mm),
    topMarginMm: Number(row.top_margin_mm),
    headHeightMm: Number(row.head_height_mm),
    dpi: Number(row.dpi),
    jpegQuality: Number(row.jpeg_quality),
  };
}

/**
 * loadCropPreset — загрузить пресет по слагу из БД; fallback на встроенную константу.
 * Возвращает null для неизвестного слага (нет ни в БД, ни в fallback).
 */
export async function loadCropPreset(slug: string): Promise<DocumentCropPreset | null> {
  try {
    const row = await db.queryOne<PresetRow>(
      `SELECT slug, label, photo_w_mm, photo_h_mm, top_margin_mm, head_height_mm, dpi, jpeg_quality
       FROM document_crop_presets
       WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (row) {
      return rowToPreset(row);
    }
  } catch (error) {
    logger.warn('loadCropPreset: БД недоступна, fallback на встроенный пресет', {
      slug,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return BUILTIN_PRESETS[slug] ?? null;
}

/**
 * loadKnownDocumentTypes — множество известных слагов (БД ∪ встроенные).
 * Для анти-тампера уровня 1. Всегда содержит как минимум встроенные слаги.
 */
export async function loadKnownDocumentTypes(): Promise<Set<string>> {
  const known = new Set<string>(Object.keys(BUILTIN_PRESETS));
  try {
    const rows = await db.query<PresetSlugRow>(
      `SELECT slug FROM document_crop_presets WHERE is_active = true`
    );
    for (const row of rows) {
      known.add(row.slug);
    }
  } catch (error) {
    logger.warn('loadKnownDocumentTypes: БД недоступна, только встроенные слаги', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return known;
}
