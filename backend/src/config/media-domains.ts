/**
 * Централизованная конфигурация медиа-доменов.
 * Используется для SSRF whitelist, CSP headers и валидации URL.
 * CDN и внешний S3 отключены — все медиа через MinIO (localhost:9000) + nginx proxy /media/.
 */

const envDomains = process.env['MEDIA_ALLOWED_DOMAINS'];

export const MEDIA_ALLOWED_DOMAINS: readonly string[] = envDomains
  ? envDomains.split(',').map(s => s.trim()).filter(Boolean)
  : ['svoefoto.ru', 'www.svoefoto.ru', '127.0.0.1'];

export function isAllowedMediaDomain(hostname: string): boolean {
  return MEDIA_ALLOWED_DOMAINS.some(
    domain => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

export const CSP_MEDIA_SOURCES: readonly string[] = MEDIA_ALLOWED_DOMAINS
  .filter(d => d !== '127.0.0.1')
  .map(d => `https://${d}`);
