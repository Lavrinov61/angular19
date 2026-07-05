/**
 * print-api-client.service.ts — внутренний клиент к Rust print-api (:3004).
 *
 * Используется edu-калькулятором печати: Node выпускает короткоживущий служебный JWT
 * (role=employee, чтобы пройти require_pos_use на /api/print/analyze-coverage),
 * передаёт presigned-GET URL файла и color_mode, получает постраничный анализ заливки.
 *
 * Rust analyze-coverage сам определяет тир/цену по заливке + color_mode override.
 * Это ЕДИНСТВЕННЫЙ потребитель Rust из Node — байты файла Rust качает сам по file_url.
 */

import { signJwt } from '../utils/jwt-keys.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('print-api-client');

/** Override авто-детекта цвета (совпадает с Rust CoverageRequest.color_mode). */
export type CoverageColorMode = 'auto' | 'color' | 'bw';

/** Постраничная запись анализа заливки (Rust coverage_page_json). */
export interface RustCoveragePage {
  page_number: number;
  coverage_percent: number;
  recommended_slug: string;
  recommended_price: number | string;
  recommended_name: string;
  tier: string;
}

/** Результат Rust analyze-coverage (поле result ответа). */
export interface RustCoverageResult {
  coverage_percent: number;
  recommended_slug: string;
  recommended_price: number | string;
  recommended_name: string;
  tier: string;
  page_count: number;
  pages: RustCoveragePage[];
  document_type: string;
}

interface RustCoverageEnvelope {
  success?: boolean;
  result?: RustCoverageResult;
  error?: string;
}

// ≥ Rust download-timeout (coverage.rs: reqwest timeout 120s) — иначе Node оборвёт
// раньше, чем Rust успеет скачать и отрендерить тяжёлый документ.
const ANALYZE_TIMEOUT_MS = 120_000;

/**
 * Запросить постраничный анализ заливки у Rust print-api.
 *
 * @param fileUrl presigned-GET URL файла (формирует вызывающий сервис; Rust качает сам).
 * @param colorMode override цвета для пересчёта тира/цены.
 * @throws AppError(502) при недоступности/ошибке Rust.
 */
export async function analyzeCoverageViaService(
  fileUrl: string,
  colorMode: CoverageColorMode,
): Promise<RustCoverageResult> {
  // Служебный JWT: role=employee имеет pos:use (require_pos_use на analyze-coverage).
  // userId — валидный UUID, чтобы Rust require_auth (uuid parse) не падал. exp 60s.
  const token = signJwt(
    { userId: config.printEstimate.serviceUserId, email: '', role: 'employee' },
    { expiresIn: '60s' },
  );

  const url = `${config.printApi.internalUrl}/api/print/analyze-coverage`;
  const body = JSON.stringify({
    file_url: fileUrl,
    paper_format: 'a4',
    color_mode: colorMode,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // НЕ логировать токен — короткоживущий, но всё равно секрет.
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    log.warn('Rust analyze-coverage request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(502, 'Сервис анализа печати недоступен', ErrorCode.PRINT_ANALYZE_UNAVAILABLE);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    log.warn('Rust analyze-coverage non-2xx', { status: response.status, body: text.slice(0, 500) });
    throw new AppError(502, 'Не удалось проанализировать файл для печати', ErrorCode.PRINT_ANALYZE_UNAVAILABLE);
  }

  let payload: RustCoverageEnvelope;
  try {
    payload = (await response.json()) as RustCoverageEnvelope;
  } catch {
    throw new AppError(502, 'Некорректный ответ сервиса анализа печати', ErrorCode.PRINT_ANALYZE_UNAVAILABLE);
  }

  if (!payload.success || !payload.result) {
    log.warn('Rust analyze-coverage success=false', { error: payload.error });
    throw new AppError(502, 'Сервис анализа печати вернул ошибку', ErrorCode.PRINT_ANALYZE_UNAVAILABLE);
  }

  return payload.result;
}
