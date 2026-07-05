import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Конфигурация SSR для оптимизации SEO
 * 
 * Стратегия:
 * - Публичные страницы: SSR для лучшего SEO (индексация поисковиками)
 * - Защищенные страницы: CSR для экономии ресурсов сервера (не индексируются)
 * 
 * Согласно документации Angular (llms-full.txt):
 * - SSR отлично подходит для SEO (строка 10979: "Server-side rendering generally has excellent search engine optimization (SEO)")
 * - CSR может негативно влиять на SEO (строка 10969: "client-side rendering may negatively affect search engine optimization (SEO)")
 * - CSR подходит для защищенных страниц, которые не индексируются (строка 10969)
 */
export const serverRoutes: ServerRoute[] = [
  // ========== ЗАЩИЩЕННЫЕ СТРАНИЦЫ (CSR) ==========
  // Эти страницы не индексируются поисковиками, поэтому используем CSR для экономии ресурсов сервера
  {
    path: 'user-profile',
    renderMode: RenderMode.Client
  },
  {
    path: 'user-profile/**',
    renderMode: RenderMode.Client
  },
  {
    path: 'photographer-dashboard',
    renderMode: RenderMode.Client
  },
  {
    path: 'photographer-dashboard/**',
    renderMode: RenderMode.Client
  },
  {
    path: 'admin',
    renderMode: RenderMode.Client
  },
  {
    path: 'admin/**',
    renderMode: RenderMode.Client
  },
  {
    path: 'auth',
    renderMode: RenderMode.Client
  },
  {
    path: 'auth/**',
    renderMode: RenderMode.Client
  },
  {
    path: 'employee',
    renderMode: RenderMode.Client
  },
  {
    path: 'employee/**',
    renderMode: RenderMode.Client
  },
  {
    path: 'partner-dashboard',
    renderMode: RenderMode.Client
  },
  {
    path: 'partner-dashboard/**',
    renderMode: RenderMode.Client
  },
  {
    path: 'chat',
    renderMode: RenderMode.Client
  },
  {
    path: 'chat/**',
    renderMode: RenderMode.Client
  },
  // Подтверждение очной студ-верификации — клиентская страница за authGuard.
  // ОБЯЗАТЕЛЬНО Client: при SSR (Server/катч-олл) гард выполняется на сервере, где
  // isAuthenticated()=false → 302 на /auth/login без returnUrl, и ссылка из чата
  // не открывает страницу (залогиненного отбивает на главную). Client рендерит
  // оболочку (200), а гард корректно отрабатывает в браузере, сохраняя returnUrl.
  { path: 'education/in-person', renderMode: RenderMode.Client },
  // Legacy redirects (CSR — just redirect, no SSR needed)
  { path: 'orders', renderMode: RenderMode.Client },
  { path: 'orders/**', renderMode: RenderMode.Client },
  { path: 'photos', renderMode: RenderMode.Client },
  { path: 'photos/**', renderMode: RenderMode.Client },
  { path: 'profile', renderMode: RenderMode.Client },
  { path: 'profile/**', renderMode: RenderMode.Client },

  // ========== ПУБЛИЧНЫЕ СТРАНИЦЫ ДЛЯ SEO (SSR) ==========
  // Эти страницы должны быть в SSR для лучшего SEO
  {
    path: '',
    renderMode: RenderMode.Prerender // Главная — статический HTML при билде, TTFB ~0ms
  },
  {
    path: 'about',
    renderMode: RenderMode.Prerender // О нас — статический контент
  },
  {
    path: 'services',
    renderMode: RenderMode.Prerender // Услуги — каталог, статический
  },
  {
    path: 'document-copy',
    renderMode: RenderMode.Prerender // Ксерокопия документов
  },
  {
    path: 'foto-na-document',
    renderMode: RenderMode.Prerender // Фото на документы — TOP трафик
  },
  {
    path: 'document-print',
    renderMode: RenderMode.Prerender // Печать документов
  },
  {
    path: 'premium-print',
    renderMode: RenderMode.Prerender // Премиум печать
  },
  {
    path: 'scanning',
    renderMode: RenderMode.Prerender // Сканирование
  },
  {
    path: 'immortal-polk-stander',
    renderMode: RenderMode.Prerender // Штендеры для Бессмертного полка
  },
  {
    path: 'document-plus',
    renderMode: RenderMode.Prerender // Документальный Комплект Плюс
  },
  {
    path: 'gallery',
    renderMode: RenderMode.Server // Галерея
  },
  {
    path: 'gallery/**',
    renderMode: RenderMode.Server // Галерея (все подмаршруты)
  },
  {
    path: 'booking',
    renderMode: RenderMode.Server // Бронирование (для SEO)
  },
  {
    path: 'booking/**',
    renderMode: RenderMode.Server // Бронирование (все подмаршруты)
  },
  {
    path: 'photographers',
    renderMode: RenderMode.Server // Фотографы
  },
  {
    path: 'photographers/**',
    renderMode: RenderMode.Server // Фотографы (все подмаршруты)
  },
  {
    path: 'photograph/:slug',
    renderMode: RenderMode.Server // Профиль фотографа (параметризованный маршрут)
  },
  {
    path: 'testimonials',
    renderMode: RenderMode.Prerender // Отзывы — статический контент
  },
  {
    path: 'testimonials/**',
    renderMode: RenderMode.Server // Отзывы подмаршруты
  },
  {
    path: 'contacts',
    renderMode: RenderMode.Prerender // Контакты — статический контент
  },
  {
    path: 'contacts/**',
    renderMode: RenderMode.Server // Контакты подмаршруты
  },
  
  // ========== ПОСАДОЧНЫЕ СТРАНИЦЫ С РЕКЛАМНЫМ ТРАФИКОМ (Prerender) ==========
  // Статические данные из .data.ts — отдаются мгновенно как pre-built HTML
  { path: 'pechat-foto', renderMode: RenderMode.Prerender },
  { path: 'pechat-foto-10x15', renderMode: RenderMode.Prerender },
  { path: 'pechat-foto-na-holste', renderMode: RenderMode.Prerender },
  { path: 'foto-na-pasport', renderMode: RenderMode.Prerender },
  { path: 'foto-na-zagran', renderMode: RenderMode.Prerender },
  { path: 'foto-na-vizu', renderMode: RenderMode.Prerender },
  { path: 'foto-na-green-card', renderMode: RenderMode.Prerender },
  { path: 'foto-na-studencheskiy', renderMode: RenderMode.Prerender },
  { path: 'foto-na-documenty-online', renderMode: RenderMode.Prerender },
  { path: 'voennaya-retush', renderMode: RenderMode.Prerender },
  { path: 'portretnaya-sjomka', renderMode: RenderMode.Prerender },
  { path: 'biznes-portret', renderMode: RenderMode.Prerender },
  { path: 'foto-na-resume', renderMode: RenderMode.Prerender },
  { path: 'vizitki', renderMode: RenderMode.Prerender },
  { path: 'pechat-dokumentov', renderMode: RenderMode.Prerender },
  { path: 'pereplet', renderMode: RenderMode.Prerender },
  { path: 'broshyurovka', renderMode: RenderMode.Prerender },
  { path: 'broshyurovka-dokumentov', renderMode: RenderMode.Prerender },
  { path: 'pereplet-kursovyh', renderMode: RenderMode.Prerender },
  { path: 'pereplet-na-plastikovuyu-pruzhinu', renderMode: RenderMode.Prerender },
  { path: 'kserokopiya', renderMode: RenderMode.Prerender },
  { path: 'laminirovanie', renderMode: RenderMode.Prerender },
  { path: 'skanirovanie', renderMode: RenderMode.Prerender },
  { path: 'pechat-na-kruzhkah', renderMode: RenderMode.Prerender },
  { path: 'pechat-na-futbolkah', renderMode: RenderMode.Prerender },
  { path: 'pechat-na-podarki', renderMode: RenderMode.Prerender },
  { path: 'retush', renderMode: RenderMode.Prerender },
  { path: 'restavratsiya-foto', renderMode: RenderMode.Prerender },
  { path: 'foto-na-pamyatnik', renderMode: RenderMode.Prerender },
  { path: 'start-client', renderMode: RenderMode.Prerender },
  { path: 'startclient', renderMode: RenderMode.Prerender },
  { path: 'stat-klientom', renderMode: RenderMode.Prerender },
  { path: 'students', renderMode: RenderMode.Prerender },

  // ========== УНИВЕРСАЛЬНОЕ ПРАВИЛО ==========
  // Все остальные маршруты рендерятся на сервере (SSR) для лучшего SEO
  {
    path: '**',
    renderMode: RenderMode.Server
  }
];
