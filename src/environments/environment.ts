export const environment = {
  production: false,
  apiUrl: '', // Relative URL — API на том же сервере что и SSR (порт 4000)
  wsUrl: '', // Dev: относительный URL (тот же сервер)
  useEmulators: false,
  // Яндекс OAuth настройки (заполнить значения вручную или через build-time environment variables)
  yandex: {
    clientId: '', // Заполнить Yandex Client ID
    redirectUri: 'http://localhost:4200/auth/callback'
  },
  yandexMaps: {
    apiKey: '', // Заполнить Yandex Maps JavaScript API Key
  },
  vk: {
    appId: 'YOUR_VK_APP_ID' // Placeholder
  },
  telegram: {
    botUsername: 'YOUR_TELEGRAM_BOT_USERNAME' // Placeholder
  },
  cloudPayments: {
    publicTerminalId: 'pk_505d4c69874099b3fccce1872d136',
    currency: 'RUB',
    skin: 'modern' as const,
    taxationSystem: 1, // УСН доходы
  }
};
