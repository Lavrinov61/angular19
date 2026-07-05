/**
 * fetch() wrapper with timeout support + distributed tracing.
 *
 * Automatically injects `X-Request-Id` header from AsyncLocalStorage
 * into every outgoing request for end-to-end correlation.
 *
 * Requests to messaging providers are routed through HTTP_PROXY (Privoxy → SOCKS5 Amsterdam)
 * because direct access to some provider IPs is blocked from Selectel network.
 *
 * When TELEGRAM_API_URL points to localhost (Local Bot API Server), proxy is bypassed automatically.
 *
 * Default timeout: 15 seconds.
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { getRequestId } from '../middleware/request-context.js';

const PROXY_URL = process.env.HTTP_PROXY
  || process.env.HTTPS_PROXY
  || process.env.http_proxy
  || process.env.https_proxy;

// Lazy-init proxy dispatcher only if env var exists
let proxyDispatcher: ProxyAgent | undefined;
function getProxyDispatcher(): ProxyAgent | undefined {
  if (!PROXY_URL) return undefined;
  if (!proxyDispatcher) {
    proxyDispatcher = new ProxyAgent(PROXY_URL);
  }
  return proxyDispatcher;
}

/** Hosts that must be reached through the proxy (blocked from Selectel network) */
const PROXIED_HOSTS = [
  'api.telegram.org',   // Telegram Bot API
  'graph.facebook.com', // WhatsApp Cloud API (Meta)
  'api.gupshup.io',     // WhatsApp BSP API (Gupshup)
];

function needsProxy(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return PROXIED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

export function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Merge signals if caller provided one
  if (fetchOptions.signal) {
    fetchOptions.signal.addEventListener('abort', () => controller.abort());
  }

  // Inject X-Request-Id for distributed tracing
  const requestId = getRequestId();
  if (requestId) {
    const existing = fetchOptions.headers;
    if (existing instanceof Headers) {
      if (!existing.has('X-Request-Id')) {
        existing.set('X-Request-Id', requestId);
      }
    } else if (Array.isArray(existing)) {
      const hasHeader = existing.some(([k]) => k.toLowerCase() === 'x-request-id');
      if (!hasHeader) {
        existing.push(['X-Request-Id', requestId]);
      }
    } else {
      // Record<string, string> or undefined
      const rec = (existing ?? {}) as Record<string, string>;
      if (!rec['X-Request-Id']) {
        fetchOptions.headers = { ...rec, 'X-Request-Id': requestId };
      }
    }
  }

  // Route Telegram/WhatsApp API through proxy (direct access blocked from Selectel)
  // Must use undici's own fetch() — Node.js 24's built-in fetch uses undici 7.x internally,
  // which is incompatible with ProxyAgent from undici 8.x (installed via npm).
  const dispatcher = needsProxy(url) ? getProxyDispatcher() : undefined;

  if (dispatcher) {
    return undiciFetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1]).finally(() => clearTimeout(timer)) as Promise<Response>;
  }

  return fetch(url, {
    ...fetchOptions,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}
