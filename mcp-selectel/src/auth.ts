let cachedKeystoneToken: string | null = null;
let cachedTokenExpiry: number = 0;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export async function getKeystoneToken(): Promise<string> {
  if (cachedKeystoneToken && Date.now() < cachedTokenExpiry) {
    return cachedKeystoneToken;
  }

  const serviceUserId = requiredEnv('SELECTEL_SERVICE_USER_ID');
  const serviceUserPassword = requiredEnv('SELECTEL_SERVICE_USER_PASSWORD');
  const projectId = requiredEnv('SELECTEL_PROJECT_ID');

  const body = {
    auth: {
      identity: {
        methods: ['password'],
        password: {
          user: {
            id: serviceUserId,
            password: serviceUserPassword,
          },
        },
      },
      scope: {
        project: {
          id: projectId,
        },
      },
    },
  };

  const res = await fetch('https://api.selvpc.ru/identity/v3/auth/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keystone auth failed (${res.status}): ${text}`);
  }

  const token = res.headers.get('x-subject-token');
  if (!token) {
    throw new Error('Keystone auth: no x-subject-token in response headers');
  }

  const data = await res.json();
  const expiresAt = data.token?.expires_at;

  if (expiresAt) {
    // Cache for the token lifetime minus 5 minutes buffer, max 12 hours
    const expiryMs = new Date(expiresAt).getTime() - 5 * 60 * 1000;
    const maxCacheMs = Date.now() + 12 * 60 * 60 * 1000;
    cachedTokenExpiry = Math.min(expiryMs, maxCacheMs);
  } else {
    // Fallback: cache for 12 hours
    cachedTokenExpiry = Date.now() + 12 * 60 * 60 * 1000;
  }

  cachedKeystoneToken = token;
  return token;
}

export async function fetchSelectel(
  url: string,
  options: RequestInit & { authType?: 'keystone' | 'xtoken' } = {},
): Promise<Response> {
  const { authType = 'xtoken', headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string>),
  };

  if (authType === 'keystone') {
    headers['X-Auth-Token'] = await getKeystoneToken();
  } else {
    headers['X-Token'] = requiredEnv('SELECTEL_X_TOKEN');
  }

  return fetch(url, { ...rest, headers });
}
