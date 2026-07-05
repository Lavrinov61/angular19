# SSR (Server-Side Rendering) в Magnus Photo

## Что такое SSR?

SSR (Server-Side Rendering) - это рендеринг страниц на сервере вместо в браузере пользователя. При каждом запросе сервер генерирует полный HTML и отправляет его клиенту.

## Отличие от статических страниц (CSR/Prerendering)

| Режим | Когда генерируется HTML | Как работает |
|-------|------------------------|--------------|
| **CSR** (Client-Side Rendering) | В браузере пользователя | Сервер отдает пустой HTML + JS, браузер рендерит |
| **SSR** (Server-Side Rendering) | На сервере при каждом запросе | Сервер генерирует полный HTML для каждого пользователя |
| **Prerender/SSG** (Static Site Generation) | Один раз при сборке | HTML генерируется заранее, все получают одинаковый |

## Почему мы используем SSR?

1. **Персонализация**: Каждый пользователь получает свой контент (авторизация, личный кабинет)
2. **SEO**: Поисковики видят готовый HTML с контентом
3. **Быстрая загрузка**: Пользователь видит контент сразу, не ждет загрузки JS
4. **Актуальность данных**: Данные всегда свежие (запрос к API на каждый рендер)

## Конфигурация проекта

### 1. Angular.json
```json
{
  "build": {
    "options": {
      "server": "src/main.server.ts",  // ← Entry point для SSR
      "ssr": {
        "entry": "src/server.ts"       // ← Express сервер
      }
    }
  }
}
```

### 2. app.config.ts
```typescript
provideClientHydration()  // ← Включает гидрацию (переиспользование серверного HTML)
provideHttpClient(
  withInterceptorsFromDi()  // ← Для поддержки DI-based interceptors (ServerHttpInterceptor)
)
```

**Важно:** `withInterceptorsFromDi()` **обязателен** для DI-based interceptors (классы, реализующие `HttpInterceptor`). Без него DI-based interceptors не будут работать. Functional interceptors (через `withInterceptors()`) работают без этого флага.

### 3. app.routes.server.ts
```typescript
{
  path: '**',
  renderMode: RenderMode.Server  // ← Все маршруты рендерятся на сервере
}
```

### 4. server.ts
```typescript
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();
const angularApp = new AngularNodeAppEngine();

// Serve static files from /browser
app.use(express.static(browserDistFolder, {
  maxAge: '1y',
  index: false,
  redirect: false,
}));

// Handle all other requests by rendering the Angular application
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

// Start the server if this module is the main entry point
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

// Request handler used by the Angular CLI (dev-server and during build)
export const reqHandler = createNodeRequestHandler(app);
```

**Критически важно:** `export const reqHandler = createNodeRequestHandler(app)` **обязателен** - Angular CLI использует его для dev-server (`ng serve`) и во время сборки. Без этого экспорта SSR не будет работать в development режиме.

### 5. app.config.server.ts
```typescript
import { ServerHttpInterceptor } from './core/interceptors/server-http.interceptor';
import { HTTP_INTERCEPTORS } from '@angular/common/http';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // DI-based interceptor для SSR - преобразует относительные URL в абсолютные
    { provide: HTTP_INTERCEPTORS, useClass: ServerHttpInterceptor, multi: true }
  ]
};
```

**Важно:** DI-based interceptors регистрируются через multi-provider `HTTP_INTERCEPTORS` и работают **только** если в `app.config.ts` добавлен `withInterceptorsFromDi()`. Порядок выполнения interceptors зависит от порядка регистрации провайдеров.

## Как запускать

### Development режим (SSR)

В Angular 20 с `outputMode: "server"` `ng serve` автоматически использует SSR через `reqHandler` из `src/server.ts`.

```bash
# Терминал 1: Backend API
cd backend
npm run dev

# Терминал 2: Frontend SSR (автоматически использует SSR)
npm run start
# или для сборки и запуска собранного сервера:
npm run dev:ssr
```

**Примечание:** `ng serve` автоматически использует SSR при `outputMode: "server"`. Для сборки и запуска собранного сервера используйте `npm run dev:ssr`.

### Production режим
```bash
# Сборка
npm run build:ssr:prod

# Запуск
npm run serve:ssr:magnus-photo
# или с переменной окружения для порта:
PORT=4000 npm run serve:ssr:magnus-photo
```

## Важные моменты для разработки

### 1. Platform checks
В SSR коде **нельзя** использовать browser API напрямую:
```typescript
// ❌ НЕПРАВИЛЬНО - упадет на сервере
localStorage.getItem('token')
window.location.href

// ✅ ПРАВИЛЬНО - проверка платформы
if (isPlatformBrowser(this.platformId)) {
  localStorage.getItem('token')
}
```

### 2. Computed signals с SSR
```typescript
// ✅ Правильный подход - signal с проверкой
public readonly token = computed(() => {
  if (!this.isBrowser()) {
    return null;  // На сервере всегда null
  }
  return this.getAccessToken();  // В браузере - из localStorage
});
```

### 3. HTTP запросы и кеширование

Angular автоматически кеширует HTTP запросы между сервером и клиентом:
```typescript
// Запрос сделается 1 раз на сервере, результат передастся в браузер
this.http.get('/api/users/me').subscribe(...)
```

**Как работает кеширование:**
- `HttpClient` кеширует все `HEAD` и `GET` запросы без заголовков `Authorization` или `Proxy-Authorization`
- Кеш сериализуется и передается в браузер как часть начального HTML
- В браузере `HttpClient` проверяет кеш и переиспользует данные вместо нового HTTP запроса
- Кеш перестает использоваться после того, как приложение становится стабильным в браузере

**Важно:** `ServerHttpInterceptor` автоматически преобразует относительные URL (`/api/...`) в абсолютные (`http://localhost:3001/api/...`) во время SSR, чтобы SSR сервер мог делать запросы напрямую к API серверу. Без этого преобразования SSR сервер попытается сделать запрос к самому себе (`http://localhost:4000/api/...`), что приведет к ошибкам.

**Настройка кеширования (опционально):**
```typescript
// В app.config.ts можно настроить кеширование
provideClientHydration(
  withHttpTransferCacheOptions({
    includeHeaders: ['ETag', 'Cache-Control'],
    filter: (req) => !req.url.includes('/api/profile'),
    includePostRequests: false,
    includeRequestsWithAuthHeaders: false,
  })
)
```

### 4. WebSocket в SSR
WebSocket подключается только в браузере:
```typescript
constructor() {
  effect(() => {
    const token = this.authService.token();  // computed signal
    if (token) {
      this.connect();  // Подключится только в браузере
    }
  });
}
```

## Отладка SSR

### Проверка что SSR работает
```bash
# 1. Запросить страницу через curl
curl http://localhost:4200

# Вы должны увидеть полный HTML с контентом, а не пустой:
# ✅ <app-root>...content here...</app-root>
# ❌ <app-root></app-root>
```

### Логи сервера
```bash
# Server выводит логи в консоль
[SSR HTTP] Transformed relative URL /api/users/me to absolute URL http://localhost:3001/api/users/me
Node Express server listening on http://localhost:4200
```

### Проверка hydration
Откройте DevTools Console - не должно быть ошибок гидрации:
- ❌ `NG0500: During hydration Angular expected...`
- ✅ Никаких ошибок

## Структура проекта

### Исходные файлы (для разработки)
```
src/
├── main.ts                 # Browser entry point
├── main.server.ts          # Server entry point (bootstraps Angular)
├── server.ts               # Express server (serves SSR)
├── app/
│   ├── app.config.ts       # App config (browser)
│   ├── app.config.server.ts # Server config (merges with browser)
│   └── app.routes.server.ts # Server routes (SSR/CSR/Prerender)
```

### Сборочные файлы (генерируются автоматически)
```
dist/magnus-photo/
├── browser/                # Статические файлы (CSS, JS, images)
└── server/
    ├── server.mjs         # Express сервер
    └── main.server.mjs    # Angular SSR bundle
```

**⚠️ ВАЖНО: Правила работы со сборочными файлами**

**НЕ сканировать и НЕ анализировать сборочные файлы и директории:**
- `/dist` - директория со сборочными артефактами Angular
- `/dist/magnus-photo` - сборочные файлы приложения
- `/dist/magnus-photo/browser` - браузерные бандлы
- `/dist/magnus-photo/server` - серверные бандлы
- `/tmp` - временные файлы
- `/out-tsc` - вывод TypeScript компиляции
- `/.angular` - кеш Angular CLI
- `/backend/dist` - сборочные файлы backend
- `*.js.map` - source maps
- `*.d.ts.map` - TypeScript declaration maps
- `node_modules/` - зависимости проекта
- `/.angular/cache/` - кеш Angular CLI

**Правило:** Всегда используйте только исходные файлы из `src/` и `backend/src/`. Сборочные файлы генерируются автоматически и не должны редактироваться вручную.

## Производительность

### SSR дает:
- **FCP (First Contentful Paint)**: < 1s (вместо 2-3s в CSR)
- **TTI (Time To Interactive)**: ~ 2s (вместо 4-5s в CSR)
- **SEO Score**: 100 (Google видит полный контент)

### Но требует:
- Сервер для рендеринга (Express на Node.js)
- Больше CPU/RAM на сервере
- Правильное использование платформенных API

## FAQ

**Q: Использует ли `ng serve` SSR автоматически?**
A: Да! В Angular 20 с `outputMode: "server"` `ng serve` автоматически использует SSR через `reqHandler` из `src/server.ts`. Angular CLI использует `reqHandler` для dev-server и во время сборки. **Важно:** `reqHandler` должен быть экспортирован из `src/server.ts`, иначе SSR не будет работать.

**Q: В чем разница между DI-based и functional interceptors?**
A: 
- **Functional interceptors** (через `withInterceptors([...])`): простые функции, работают сразу
- **DI-based interceptors** (классы с `HttpInterceptor`): требуют `withInterceptorsFromDi()` в `app.config.ts` и регистрацию через `HTTP_INTERCEPTORS` multi-provider

Для SSR рекомендуется использовать DI-based interceptors, так как они могут использовать DI для получения зависимостей (например, `PLATFORM_ID` для проверки платформы).

**Q: Почему HTTP запросы не работают в SSR?**
A: Проверьте:
1. Добавлен ли `withInterceptorsFromDi()` в `app.config.ts`
2. Зарегистрирован ли `ServerHttpInterceptor` в `app.config.server.ts` через `HTTP_INTERCEPTORS`
3. Правильно ли `ServerHttpInterceptor` преобразует относительные URL в абсолютные
4. Доступен ли API сервер по указанному адресу

**Q: Можно ли часть страниц делать CSR, часть SSR?**
A: Да! В `app.routes.server.ts` можно настроить разные `renderMode` для разных маршрутов:
```typescript
{ path: 'admin', renderMode: RenderMode.ClientOnly },  // CSR
{ path: '**', renderMode: RenderMode.Server }          // SSR
```

**Q: Как отключить SSR?**
A: Удалить `provideClientHydration()` из `app.config.ts` и использовать обычный `ng build` без `--ssr`. Или изменить `outputMode` в `angular.json` с `"server"` на `"browser"`.

**Q: Нужен ли SSR для всех приложений?**
A: Нет. SSR нужен если важны:
- SEO (поисковая оптимизация)
- Быстрая первая загрузка
- Персонализированный контент

Для admin панелей, SPA за авторизацией - CSR может быть достаточно.

**Q: Почему сервер не запускается на порту 4000?**
A: Проверьте:
1. Правильно ли настроен `isMainModule(import.meta.url)` в `src/server.ts`
2. Установлена ли переменная окружения `PORT` (по умолчанию используется 4000)
3. Не занят ли порт другим процессом
4. Для PM2 добавлена проверка `process.env['pm_id']`
