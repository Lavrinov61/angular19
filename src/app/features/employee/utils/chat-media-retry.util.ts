const RETRY_PARAM = 'sf_img_retry';
const ABSOLUTE_OR_PROTOCOL_RELATIVE_URL = /^(?:[a-z][a-z\d+\-.]*:)?\/\//i;
const INLINE_URL_PREFIX = /^(?:data|blob):/i;

export function chatMediaRetryUrl(source: string, token: string | number, baseUrl: string): string {
  const raw = source.trim();
  if (!raw || INLINE_URL_PREFIX.test(raw)) return source;

  const url = new URL(raw, baseUrl);
  url.searchParams.set(RETRY_PARAM, String(token));

  if (ABSOLUTE_OR_PROTOCOL_RELATIVE_URL.test(raw)) {
    return url.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
