/**
 * crop-detect.service — авто-определение линий кадрирования (макушка/подбородок/центр).
 *
 * Тонкая обёртка поверх Rust photo-retouch-tool: проецирует результат автолиний в DTO
 * для редактора. НЕ сохраняет в face_validations (это разведочный запрос редактора).
 * Доступ к файлу идёт только через наш storage key.
 *
 * ⚠️ Координаты — в px ОРИГИНАЛА. crown_y/center_x/tilt добавлены в воркер (S2, аддитивно).
 */
import { detectCropLinesRust } from './photo-retouch-tool.service.js';

export interface DetectCropLinesDto {
  imageWidth: number;
  imageHeight: number;
  /** Макушка головы, px по вертикали (эвристика воркера). null если лицо не найдено. */
  crownY: number | null;
  /** Подбородок, px по вертикали. null если лицо не найдено. */
  chinY: number | null;
  /** Центр лица (между глаз), px по горизонтали. null если лицо не найдено. */
  centerX: number | null;
  /** Наклон головы в градусах [-90,90] со знаком (для UI-warning). null если лицо не найдено. */
  tilt: number | null;
  faceDetected: boolean;
  verdict: string;
}

/**
 * detectCropLines — определить линии кадрирования по фото.
 *
 * @param photoUrl публичный URL фото (whitelist доменов проверяет validateFace).
 * @returns DTO с координатами линий; при faceDetected=false координаты null.
 */
export async function detectCropLines(photoUrl: string): Promise<DetectCropLinesDto> {
  const result = await detectCropLinesRust(photoUrl);

  if (!result.faceDetected) {
    return {
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      crownY: null,
      chinY: null,
      centerX: null,
      tilt: null,
      faceDetected: result.faceDetected,
      verdict: result.verdict,
    };
  }

  return {
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    crownY: result.crownY,
    chinY: result.chinY,
    centerX: result.centerX,
    tilt: result.tilt,
    faceDetected: result.faceDetected,
    verdict: result.verdict,
  };
}
