/**
 * Centralized config for OAuth login buttons.
 * Add new providers here, the button appears automatically
 * when the backend reports the provider as available (has credentials).
 */
export interface OAuthButtonConfig {
  /** Matches provider.id returned by GET /api/auth/providers */
  id: string;
  /** Button label on login page */
  label: string;
  /** Button label on register page */
  registerLabel: string;
  /** CSS class for provider-specific colour */
  cssClass: string;
  /** Inline SVG string */
  svgIcon: string;
}

export const OAUTH_BUTTONS: OAuthButtonConfig[] = [
  {
    id: 'yandex',
    label: 'Яндекс ID',
    registerLabel: 'Яндекс ID',
    cssClass: 'oauth-yandex',
    svgIcon: `<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="13" fill="#FC3F1D"/><text x="13" y="18" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="16" fill="#FFFFFF">Я</text></svg>`,
  },
  {
    id: 'google',
    label: 'Google',
    registerLabel: 'Google',
    cssClass: 'oauth-google',
    svgIcon: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.04 10.04 0 0 0 1.07 12c0 1.62.39 3.15 1.07 4.5l3.66-2.84.04.43z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
  },
  {
    id: 'vk',
    label: 'VK ID',
    registerLabel: 'VK ID',
    cssClass: 'oauth-vk',
    svgIcon: `<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><path fill="#FFFFFF" d="M13.72 18.5c-5.55 0-8.72-3.8-8.85-10.13h2.78c.09 4.65 2.14 6.62 3.77 7.03V8.37h2.62v4.01c1.6-.17 3.28-2 3.85-4.01h2.62c-.44 2.48-2.28 4.31-3.59 5.06 1.31.61 3.41 2.2 4.21 5.07h-2.88c-.62-1.93-2.16-3.43-4.21-3.63v3.63h-.32Z"/></svg>`,
  },
  {
    id: 'sber',
    label: 'Сбер ID',
    registerLabel: 'Сбер ID',
    cssClass: 'oauth-sber',
    svgIcon: `<svg width="20" height="20" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="sber-g" x1="4.47" y1="4.47" x2="28.75" y2="28.75" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#30C470"/><stop offset="100%" stop-color="#1F8B49"/></linearGradient></defs><path d="M16 2C8.27 2 2 8.27 2 16s6.27 14 14 14 14-6.27 14-14S23.73 2 16 2z" fill="url(#sber-g)"/><path d="M23.5 11.3l-1.9-1.1-5.5 9.5-3.1-1.8-1 1.7 4.1 2.4.9-1.6L23.5 11.3z" fill="white"/><path d="M8.5 16c0-1.8.6-3.5 1.7-4.9l-1.4-1.2A9.2 9.2 0 0 0 6.8 16c0 2.5 1 4.8 2.5 6.5l1.4-1.2C9.4 19.8 8.5 18 8.5 16z" fill="white"/></svg>`,
  },
  {
    id: 'mts',
    label: 'МТС ID',
    registerLabel: 'МТС ID',
    cssClass: 'oauth-mts',
    svgIcon: `<svg width="20" height="20" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="#E30611"/><text x="16" y="21" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="11" fill="white">МТС</text></svg>`,
  },
  {
    id: 'apple',
    label: 'Apple',
    registerLabel: 'Apple',
    cssClass: 'oauth-apple',
    svgIcon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
  },
];
