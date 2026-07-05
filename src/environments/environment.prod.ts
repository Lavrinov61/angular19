export const environment = {
  production: true,
  apiUrl: '/api', // Относительный путь, проксируется nginx
  wsUrl: 'https://ws.svoefoto.ru', // Socket.IO через MWS/MTS CDN с WebSocket Upgrade
  useEmulators: false,
  // Яндекс OAuth настройки (заполнить значения вручную или через build-time environment variables)
  yandex: {
    clientId: '', // Заполнить Yandex Client ID
    redirectUri: 'https://svoefoto.ru/auth/callback'
  },
  yandexMaps: {
    apiKey: 'dd7ad91b-827a-41d4-a065-296ca8ada8d3',
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
    taxationSystem: 1, // УСН доходы (0 = ОСН, 1 = УСН доходы, 2 = УСН доходы-расходы, 3 = ЕСХН, 4 = ЕНВД, 5 = Патент)
  }
};
