/**
 * Выбор студии-отправителя для курьерской доставки.
 *
 * Берём ближайшую к точке доставки студию по гаверсину среди студий с ВАЛИДНЫМИ
 * координатами. Координаты — из `studios.coordinates` (jsonb {lat,lng}).
 *
 * P0-1 (фикс из адверсари-ревью): в БД есть фантомные строки `studios` со
 * `status='open'`, но `coordinates={}` («Онлайн смена» location_code='online' и
 * нулевой-uuid Test-Laptop с location_code=NULL). Фильтровать ТОЛЬКО по `status`
 * нельзя — гаверсин на отсутствующих координатах даст NaN. Поэтому фильтруем по
 * НАЛИЧИЮ валидных координат (`coordinates ? 'lat' AND coordinates ? 'lng'`) И
 * allowlist открытых публичных точек (`location_code IN ('soborny')`).
 */

import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('source-studio.service');

/** Реальные открытые точки отправления. Фантомы (online / Test Laptop) отсечены. */
const SOURCE_STUDIO_ALLOWLIST: readonly string[] = ['soborny'];

/** Радиус Земли в метрах (для гаверсина). */
const EARTH_RADIUS_M = 6_371_000;

/** Строка студии-кандидата (после фильтра валидных координат). */
interface StudioCandidateRow {
  id: string;
  location_code: string;
  lat: number;
  lng: number;
}

/** Выбранная студия-отправитель. */
export interface SourceStudio {
  studioId: string;
  locationCode: string;
  lon: number;
  lat: number;
  distanceMeters: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Гаверсин-дистанция между двумя точками (метры).
 */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Выбрать ближайшую к точке доставки студию-отправитель.
 *
 * @param lon Долгота точки доставки (число; нормализовать строки на стороне вызова).
 * @param lat Широта точки доставки.
 * @returns Ближайшая студия с дистанцией до клиента.
 * @throws Error конфигурации, если ни одна валидная студия не найдена (НЕ возвращаем NaN-студию).
 */
export async function selectNearestStudio(lon: number, lat: number): Promise<SourceStudio> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`selectNearestStudio: невалидные координаты точки доставки (lon=${lon}, lat=${lat})`);
  }

  // Фильтр: только реальные точки с валидными координатами в jsonb.
  // `coordinates ? 'lat'` — оператор существования ключа jsonb (отсекает фантомов с {}).
  const queryParams: unknown[] = [SOURCE_STUDIO_ALLOWLIST];
  const candidates = await db.query<StudioCandidateRow>(
    `SELECT id,
            location_code,
            (coordinates->>'lat')::double precision AS lat,
            (coordinates->>'lng')::double precision AS lng
     FROM studios
     WHERE location_code = ANY($1)
       AND coordinates ? 'lat'
       AND coordinates ? 'lng'`,
    queryParams,
  );

  // Defence-in-depth: даже после SQL-фильтра отбрасываем строки, где координаты не парсятся в число.
  const valid = candidates.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng),
  );

  if (valid.length === 0) {
    logger.error('[selectNearestStudio] нет студий-отправителей с валидными координатами', {
      allowlist: SOURCE_STUDIO_ALLOWLIST,
    });
    throw new Error(
      'Ошибка конфигурации: не найдено ни одной студии-отправителя с валидными координатами',
    );
  }

  let nearest: SourceStudio | null = null;
  for (const studio of valid) {
    const distanceMeters = haversineMeters(lat, lon, studio.lat, studio.lng);
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = {
        studioId: studio.id,
        locationCode: studio.location_code,
        lon: studio.lng,
        lat: studio.lat,
        distanceMeters,
      };
    }
  }

  // nearest гарантированно не null (valid.length > 0), но TS этого не выводит.
  if (!nearest) {
    throw new Error('Ошибка конфигурации: не удалось выбрать студию-отправитель');
  }

  return nearest;
}
