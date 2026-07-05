import { Routes } from '@angular/router';
import { adminGuard, authGuard, employeeGuard, photographerGuard } from './core/guards/auth.guard';
import { HomeComponent } from './features/home/home/home.component';

export const routes: Routes = [
  // ========== ОСНОВНЫЕ СТРАНИЦЫ ==========
  {
    path: '',
    component: HomeComponent,
    title: 'Реставрация фотографий любой сложности онлайн | Своё Фото'
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about/about.component').then(c => c.AboutComponent),
    title: 'О нас - Своё Фото'
  },
  {
    path: 'services',
    loadComponent: () => import('./features/services/uslugi-services/uslugi-services.component').then(c => c.UslugiServicesComponent),
    title: 'Услуги - Своё Фото'
  },
  // Страница о ребрендинге (для SEO)
  {
    path: 'rebranding',
    loadComponent: () => import('./features/rebranding/rebranding.component').then(c => c.RebrandingComponent),
    title: 'МагнусФото теперь Своё Фото — ребрендинг фотостудии'
  },
  // Редирект со старого названия
  {
    path: 'magnusfoto',
    redirectTo: '/rebranding',
    pathMatch: 'full'
  },

  // ========== СЕРВИСЫ И УСЛУГИ ==========

  // Редиректы со старых URL (с подчеркиванием) на новые (с дефисами)
  {
    path: 'document_copy',
    redirectTo: '/kserokopiya',
    pathMatch: 'full'
  },
  {
    path: 'document-copy',
    redirectTo: '/kserokopiya',
    pathMatch: 'full'
  },

  // Редиректы для страницы фото на документы
  {
    path: 'passport-foto',
    redirectTo: '/foto-na-pasport',
    pathMatch: 'full'
  },
  {
    path: 'foto-passport',
    redirectTo: '/foto-na-document',
    pathMatch: 'full'
  },
  {
    path: 'foto_na_document',
    redirectTo: '/foto-na-document',
    pathMatch: 'full'
  },
  {
    path: 'foto-na-document',
    loadComponent: () => import('./features/services/foto-na-document/foto-na-document.component').then(c => c.FotoNaDocumentComponent),
    title: 'Фото на документы в Своё Фото | Быстро и качественно',
    data: { canonicalUrl: '/foto-na-document' }
  },

  // Группа 1: Фото на документы (посадочные страницы)
  {
    path: 'foto-na-pasport',
    loadComponent: () => import('./features/services/passport-foto/passport-foto.component').then(c => c.PassportFotoComponent),
    title: 'Фото на паспорт в Ростове-на-Дону | Своё Фото — без записи, за 15 минут',
    data: { canonicalUrl: '/foto-na-pasport' }
  },
  {
    path: 'foto-na-zagran',
    loadComponent: () => import('./features/services/landing-pages/foto-na-zagran/foto-na-zagran.component').then(c => c.FotoNaZagranComponent),
    title: 'Фото на загранпаспорт в Ростове-на-Дону | Онлайн от 700₽, в студии 700₽ | Своё Фото',
    data: { canonicalUrl: '/foto-na-zagran' }
  },
  {
    path: 'foto-na-vizu',
    loadComponent: () => import('./features/services/landing-pages/foto-na-vizu/foto-na-vizu.component').then(c => c.FotoNaVizuComponent),
    title: 'Фото на визу США, Шенген, Китай в Ростове | Онлайн от 700₽, в студии 700₽ | Своё Фото',
    data: { canonicalUrl: '/foto-na-vizu' }
  },
  {
    path: 'foto-na-green-card',
    loadComponent: () => import('./features/services/landing-pages/foto-na-green-card/foto-na-green-card.component').then(c => c.FotoNaGreenCardComponent),
    title: 'Фото на Грин-Карту в Ростове-на-Дону | 950₽ онлайн, 700₽ в студии | Своё Фото',
    data: { canonicalUrl: '/foto-na-green-card' }
  },
  {
    path: 'foto-na-studencheskiy',
    loadComponent: () => import('./features/services/landing-pages/foto-na-studencheskiy/foto-na-studencheskiy.component').then(c => c.FotoNaStudencheskiyComponent),
    title: 'Фото на студенческий билет в Ростове | Онлайн от 700₽, в студии 700₽ | Своё Фото',
    data: { canonicalUrl: '/foto-na-studencheskiy' }
  },
  {
    path: 'foto-na-documenty-online',
    loadComponent: () => import('./features/services/foto-na-documenty-online/foto-na-documenty-online.component').then(c => c.FotoNaDocumentyOnlineComponent),
    title: 'Фото на документы онлайн по всей России | от 700₽ | Своё Фото',
    data: { canonicalUrl: '/foto-na-documenty-online' }
  },
  {
    path: 'voennaya-retush',
    loadComponent: () => import('./features/services/voennaya-retush/voennaya-retush.component').then(c => c.VoennayaRetushComponent),
    title: 'Военная ретушь: фото в военной форме из обычного снимка | Своё Фото',
    data: { canonicalUrl: '/voennaya-retush' }
  },

  // Группа 2: Печать фотографий
  {
    path: 'pechat-foto',
    loadComponent: () => import('./features/services/landing-pages/pechat-foto/pechat-foto-page.component').then(c => c.PechatFotoPageComponent),
    title: 'Печать фотографий в Ростове | от 19₽ | Своё Фото',
    data: { canonicalUrl: '/pechat-foto' }
  },
  {
    path: 'pechat-foto-10x15',
    redirectTo: '/pechat-foto'
  },
  {
    path: 'pechat-foto-na-holste',
    loadComponent: () => import('./features/services/landing-pages/pechat-foto-na-holste/pechat-foto-na-holste.component').then(c => c.PechatFotoNaHolsteComponent),
    title: 'Печать на холсте в Ростове | от 2200₽ | Своё Фото',
    data: { canonicalUrl: '/pechat-foto-na-holste' }
  },
  {
    path: 'foto-na-pamyatnik',
    loadComponent: () => import('./features/services/landing-pages/foto-na-pamyatnik/foto-na-pamyatnik.component').then(c => c.FotoNaPamyatnikComponent),
    title: 'Фото на памятник в Ростове | от 1000₽ | Своё Фото',
    data: { canonicalUrl: '/foto-na-pamyatnik' }
  },

  // Группа 3: Портретная съёмка
  {
    path: 'portretnaya-sjomka',
    loadComponent: () => import('./features/services/landing-pages/portretnaya-sjomka/portretnaya-sjomka.component').then(c => c.PortretnayaSjomkaComponent),
    title: 'Портретная съёмка в Ростове | от 900₽ | Своё Фото',
    data: { canonicalUrl: '/portretnaya-sjomka' }
  },
  {
    path: 'biznes-portret',
    redirectTo: '/portretnaya-sjomka',
    pathMatch: 'full'
  },
  {
    path: 'foto-na-resume',
    redirectTo: '/portretnaya-sjomka',
    pathMatch: 'full'
  },

  // Группа 4: Печать и полиграфия
  {
    path: 'vizitki',
    loadComponent: () => import('./features/services/landing-pages/vizitki/vizitki.component').then(c => c.VisitkiComponent),
    title: 'Визитки в Ростове-на-Дону | от 600₽ за 100 шт | Своё Фото',
    data: { canonicalUrl: '/vizitki' }
  },
  {
    path: 'pechat-dokumentov',
    loadComponent: () => import('./features/services/landing-pages/pechat-dokumentov/pechat-dokumentov.component').then(c => c.PechatDokumentovComponent),
    title: 'Печать документов в Ростове | от 10₽ | Своё Фото',
    data: { canonicalUrl: '/pechat-dokumentov' }
  },
  {
    path: 'pereplet',
    redirectTo: '/pereplet-na-plastikovuyu-pruzhinu',
    pathMatch: 'full'
  },
  {
    path: 'broshyurovka',
    redirectTo: '/pereplet-na-plastikovuyu-pruzhinu',
    pathMatch: 'full'
  },
  {
    path: 'broshyurovka-dokumentov',
    redirectTo: '/pereplet-na-plastikovuyu-pruzhinu',
    pathMatch: 'full'
  },
  {
    path: 'pereplet-kursovyh',
    redirectTo: '/pereplet-na-plastikovuyu-pruzhinu',
    pathMatch: 'full'
  },
  {
    path: 'pereplet-na-plastikovuyu-pruzhinu',
    loadComponent: () => import('./features/services/landing-pages/pereplet-na-plastikovuyu-pruzhinu/pereplet-na-plastikovuyu-pruzhinu.component').then(c => c.PerepletNaPlastikovuyuPruzhinuComponent),
    title: 'Переплёт на пластиковую пружину А4 в Ростове | от 100₽, для учёбы 10₽ | Своё Фото',
    data: { canonicalUrl: '/pereplet-na-plastikovuyu-pruzhinu' }
  },
  {
    path: 'kserokopiya',
    loadComponent: () => import('./features/services/landing-pages/kserokopiya/kserokopiya.component').then(c => c.KserokopiyaComponent),
    title: 'Ксерокопия документов в Ростове | от 10₽ | Своё Фото',
    data: { canonicalUrl: '/kserokopiya' }
  },
  {
    path: 'laminirovanie',
    loadComponent: () => import('./features/services/landing-pages/laminirovanie/laminirovanie.component').then(c => c.LaminirovanieComponent),
    title: 'Ламинирование документов в Ростове | 100₽ | Своё Фото',
    data: { canonicalUrl: '/laminirovanie' }
  },
  {
    path: 'skanirovanie',
    loadComponent: () => import('./features/services/landing-pages/skanirovanie/skanirovanie.component').then(c => c.SkanirovanieComponent),
    title: 'Сканирование документов в Ростове | 50₽ | Своё Фото',
    data: { canonicalUrl: '/skanirovanie' }
  },

  // Группа 5: Сувенирная продукция
  {
    path: 'pechat-na-kruzhkah',
    loadComponent: () => import('./features/services/landing-pages/pechat-na-kruzhkah/pechat-na-kruzhkah.component').then(c => c.PechatNaKruzhkahComponent),
    title: 'Печать на кружках в Ростове | 390₽ | Своё Фото',
    data: { canonicalUrl: '/pechat-na-kruzhkah' }
  },
  {
    path: 'pechat-na-futbolkah',
    loadComponent: () => import('./features/services/landing-pages/pechat-na-futbolkah/pechat-na-futbolkah.component').then(c => c.PechatNaFutbolkahComponent),
    title: 'Печать на футболках в Ростове | 590₽ | Своё Фото',
    data: { canonicalUrl: '/pechat-na-futbolkah' }
  },
  {
    path: 'pechat-na-podarki',
    loadComponent: () => import('./features/services/landing-pages/pechat-na-podarki/pechat-na-podarki.component').then(c => c.PechatNaPodarkiComponent),
    title: 'Печать на подарках в Ростове | от 300₽ | Своё Фото',
    data: { canonicalUrl: '/pechat-na-podarki' }
  },

  // Группа 6: Ретушь и обработка
  {
    path: 'retush',
    loadComponent: () => import('./features/services/landing-pages/retush/retush.component').then(c => c.RetushComponent),
    title: 'Ретушь фотографий в Ростове | 700₽ | Своё Фото',
    data: { canonicalUrl: '/retush' }
  },
  {
    path: 'restavratsiya-foto',
    loadComponent: () => import('./features/services/landing-pages/restavratsiya-foto/restavratsiya-foto.component').then(c => c.RestavratsiyaFotoComponent),
    title: 'Реставрация фото любой сложности в Ростове и онлайн | Своё Фото',
    data: { canonicalUrl: '/restavratsiya-foto' }
  },

  {
    path: 'document_print',
    redirectTo: '/pechat-dokumentov',
    pathMatch: 'full'
  },
  {
    path: 'document-print',
    redirectTo: '/pechat-dokumentov',
    pathMatch: 'full'
  },

  {
    path: 'premium_print',
    redirectTo: '/pechat-foto-na-holste',
    pathMatch: 'full'
  },
  {
    path: 'premium-print',
    redirectTo: '/pechat-foto-na-holste',
    pathMatch: 'full'
  },

  {
    path: 'scanning',
    redirectTo: '/skanirovanie',
    pathMatch: 'full'
  },
  {
    path: 'immortal-polk-stander',
    loadComponent: () => import('./features/services/immortal-polk-stander/immortal-polk-stander.component').then(c => c.ImmortalPolkStanderComponent),
    title: 'Штендеры для Бессмертного полка в Ростове-на-Дону | Своё Фото'
  },

  {
    path: 'document_plus',
    redirectTo: '/document-plus',
    pathMatch: 'full'
  },
  {
    path: 'document-plus',
    loadComponent: () => import('./features/services/document-plus/document-plus.component').then(c => c.DocumentPlusComponent),
    title: 'Документальный Комплект Плюс - Фото на документы + портрет | Своё Фото'
  },

  // ========== ДОЧЕРНИЕ МАРШРУТЫ (loadChildren) ==========
  {
    path: 'gallery',
    loadChildren: () => import('./features/gallery-new/gallery.routes').then(r => r.GALLERY_ROUTES),
    title: 'Галерея - Своё Фото'
  },
  {
    path: 'booking',
    loadChildren: () => import('./features/booking/booking.routes').then(r => r.BOOKING_ROUTES),
    title: 'Бронирование - Своё Фото'
  },
  {
    path: 'user-profile',
    loadChildren: () => import('./features/user-profile/user-profile.routes').then(r => r.USER_PROFILE_ROUTES),
    canActivate: [authGuard],
    title: 'Личный кабинет - Своё Фото'
  },  {
    path: 'photographer-dashboard',
    loadChildren: () => import('./features/photographer-dashboard/photographer-dashboard.routes').then(r => r.photographerDashboardRoutes),
    canActivate: [photographerGuard],
    title: 'Личный кабинет фотографа - Своё Фото'
  },
  {
    path: 'photographer-dashboard/:slug',
    loadChildren: () => import('./features/photographer-dashboard/photographer-dashboard.routes').then(r => r.photographerDashboardRoutes),
    canActivate: [photographerGuard],
    title: 'Личный кабинет фотографа - Своё Фото'
  },
  {
    path: 'employee',
    loadChildren: () => import('./features/employee/employee.routes').then(m => m.EMPLOYEE_ROUTES),
    canActivate: [employeeGuard],
    title: 'Рабочая доска — Своё Фото'
  },
  {
    path: 'admin',
    loadChildren: () => import('./features/admin/admin.routes').then(r => r.ADMIN_ROUTES),
    canActivate: [adminGuard],
    title: 'Админ-панель - Своё Фото'
  },

  // ========== ПАРАМЕТРИЗОВАННЫЕ МАРШРУТЫ ==========
  {
    path: 'photograph/:slug',
    loadComponent: () => import('./features/photographer-personal/components/photographer-personal-page/photographer-personal-page.component').then(c => c.PhotographerPersonalPageComponent),
    title: 'Профиль фотографа - Своё Фото'
  },
  {
    path: 'photographers',
    loadChildren: () => import('./features/photograph/photograph.routes').then(r => r.PHOTOGRAPHER_ROUTES),
    title: 'Фотографы - Своё Фото'
  },
  // ========== ДОПОЛНИТЕЛЬНЫЕ МАРШРУТЫ ==========
  {
    path: 'testimonials',
    loadChildren: () => import('./features/testimonials/testimonials.routes').then(r => r.TESTIMONIALS_ROUTES),
    title: 'Отзывы - Своё Фото'
  },
  {
    path: 'contacts',
    loadChildren: () => import('./features/contacts/contacts.routes').then(r => r.CONTACTS_ROUTES),
    title: 'Контакты - Своё Фото'
  },
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then(r => r.AUTH_ROUTES),
    title: 'Авторизация - Своё Фото'
  },

  // ========== АНАЛИТИКА (защищённый раздел) ==========
  {
    path: 'analytics',
    loadChildren: () => import('./features/analytics/analytics.routes').then(r => r.ANALYTICS_ROUTES),
    title: 'Аналитика - Своё Фото'
  },

  // ========== ОНЛАЙН-УСЛУГИ ==========
  {
    path: 'chat',
    loadComponent: () => import('./features/chat-page/chat-page.component').then(m => m.ChatPageComponent),
    canActivate: [authGuard],
    title: 'Онлайн-кабинет — Своё Фото'
  },
  {
    path: 'online-services',
    redirectTo: '/online-uslugi',
    pathMatch: 'full'
  },
  {
    path: 'online-uslugi',
    loadComponent: () => import('./features/services/landing-pages/online-services-hub/online-services-hub.component').then(c => c.OnlineServicesHubComponent),
    title: 'Онлайн-услуги Своё Фото — работаем по всей России',
    data: { canonicalUrl: '/online-uslugi' }
  },
  // Группа: Маркетплейс-услуги (B2B)
  {
    path: 'tovarnaya-sjomka',
    loadComponent: () => import('./features/services/landing-pages/tovarnaya-sjomka/tovarnaya-sjomka.component').then(c => c.TovarnayaSjomkaComponent),
    title: 'Товарная съёмка для маркетплейсов в Ростове | от 400₽ | Своё Фото',
    data: { canonicalUrl: '/tovarnaya-sjomka' },
  },
  {
    path: 'infografika-kartochek',
    loadComponent: () => import('./features/services/landing-pages/infografika-kartochek/infografika-kartochek.component').then(c => c.InfografikaKartochekComponent),
    title: 'Инфографика карточек WB и Ozon в Ростове | от 600₽ | Своё Фото',
    data: { canonicalUrl: '/infografika-kartochek' },
  },
  {
    path: 'smm-content',
    loadComponent: () => import('./features/services/landing-pages/smm-content/smm-content.component').then(c => c.SmmContentComponent),
    title: 'SMM-контент для бизнеса в Ростове: Reels, сторис | от 2500₽ | Своё Фото',
    data: { canonicalUrl: '/smm-content' },
  },
  {
    path: 'super-paket-prodayushiy',
    loadComponent: () => import('./features/services/landing-pages/super-paket/super-paket.component').then(c => c.SuperPaketComponent),
    title: 'Супер-пакет "Продающий": фото+инфографика+SMM | Ростов | Своё Фото',
    data: { canonicalUrl: '/super-paket-prodayushiy' },
  },
  {
    path: 'neyrofotosessiya',
    loadComponent: () => import('./features/services/landing-pages/neyrofotosessiya/neyrofotosessiya.component').then(c => c.NeyrofotosessiyaComponent),
    title: 'Нейрофотосессия онлайн | AI-фото из вашего селфи | от 450₽ | Своё Фото',
    data: { canonicalUrl: '/neyrofotosessiya' }
  },
  {
    path: 'restavratsiya-online',
    loadComponent: () => import('./features/services/landing-pages/restavratsiya-online/restavratsiya-online.component').then(c => c.RestavratsiyaOnlineComponent),
    title: 'Реставрация фото онлайн по всей России | от 450₽ | Своё Фото',
    data: { canonicalUrl: '/restavratsiya-online' }
  },
  {
    path: 'retush-online',
    loadComponent: () => import('./features/services/landing-pages/retush-online/retush-online.component').then(c => c.RetushOnlineComponent),
    title: 'Ретушь фото онлайн по всей России | от 350₽ | Своё Фото',
    data: { canonicalUrl: '/retush-online' }
  },

  // ========== ПОДПИСКА НА ФОТОУСЛУГИ ==========
  {
    path: 'subscriptions',
    loadChildren: () => import('./features/subscriptions/subscriptions.routes').then(r => r.SUBSCRIPTION_ROUTES),
    title: 'Подписка — Своё Фото'
  },
  {
    path: 'subscribe/:token',
    loadComponent: () => import('./features/subscriptions/subscribe-offer/subscribe-offer.component')
      .then(m => m.SubscribeOfferComponent),
    title: 'Персональное предложение — Своё Фото',
  },

  // ========== ПРОМО-СТРАНИЦЫ ==========
  {
    path: 'promo',
    children: [
      {
        path: 'studvesna',
        loadComponent: () => import('./features/promo/studvesna/studvesna.component')
          .then(c => c.StudvesnaComponent),
        title: 'Студвесна 2026 — 1 месяц бесплатной печати | Своё Фото',
        data: { canonicalUrl: '/promo/studvesna' }
      }
    ]
  },

  // ========== КЛИЕНТСКИЕ ПОСАДОЧНЫЕ СТРАНИЦЫ ==========
  {
    path: 'start-client',
    loadComponent: () => import('./features/start-client/start-client.component').then(c => c.StartClientComponent),
    title: 'Стать клиентом Своё Фото | Тарифы для себя, учёбы и бизнеса',
    data: { canonicalUrl: '/start-client' }
  },
  {
    path: 'startclient',
    redirectTo: '/start-client',
    pathMatch: 'full'
  },
  {
    path: 'stat-klientom',
    redirectTo: '/start-client',
    pathMatch: 'full'
  },
  {
    path: 'personal',
    loadComponent: () => import('./features/personal-account/personal-account.component').then(c => c.PersonalAccountComponent),
    title: 'Личный аккаунт для фото, документов и печати | Своё Фото',
    data: { canonicalUrl: '/personal' }
  },
  {
    path: 'for-me',
    redirectTo: '/personal',
    pathMatch: 'full'
  },
  {
    path: 'dlya-sebya',
    redirectTo: '/personal',
    pathMatch: 'full'
  },
  {
    path: 'business',
    loadComponent: () => import('./features/business-account/business-account.component').then(c => c.BusinessAccountComponent),
    title: 'Бизнес-аккаунт для печати, счетов и ЭДО | Своё Фото',
    data: { canonicalUrl: '/business' }
  },
  {
    path: 'b2b',
    redirectTo: '/business',
    pathMatch: 'full'
  },
  {
    path: 'biznes',
    redirectTo: '/business',
    pathMatch: 'full'
  },
  {
    path: 'education/in-person',
    canActivate: [authGuard],
    loadComponent: () => import('./features/students/in-person-student-confirm.component').then(c => c.InPersonStudentConfirmComponent),
    title: 'Подтверждение студенческой программы | Своё Фото'
  },
  {
    path: 'education',
    loadComponent: () => import('./features/students/students.component').then(c => c.StudentsComponent),
    title: 'Печать А4 за 3 ₽ | Образовательный доступ Своё Фото',
    data: { canonicalUrl: '/education' }
  },
  {
    path: 'students',
    redirectTo: '/education',
    pathMatch: 'full'
  },
  {
    path: 'studentam',
    redirectTo: '/education',
    pathMatch: 'full'
  },

  // ========== ТРЕКИНГ ЗАКАЗА ==========
  {
    path: 'track/:orderId',
    loadComponent: () => import('./features/order-tracking/order-tracking.component').then(c => c.OrderTrackingComponent),
    title: 'Отслеживание заказа — Своё Фото'
  },

  // ========== ЮРИДИЧЕСКИЕ СТРАНИЦЫ ==========
  {
    path: 'rekvizity',
    loadComponent: () => import('./features/legal/requisites.component').then(c => c.RequisitesComponent),
    title: 'Реквизиты — Своё Фото'
  },
  {
    path: 'oferta',
    loadComponent: () => import('./features/legal/oferta.component').then(c => c.OfertaComponent),
    title: 'Публичная оферта — Своё Фото'
  },
  {
    path: 'privacy',
    loadComponent: () => import('./features/legal/privacy.component').then(c => c.PrivacyComponent),
    title: 'Политика конфиденциальности — Своё Фото'
  },
  // Совместимость: /terms → /oferta
  {
    path: 'terms',
    redirectTo: '/oferta',
    pathMatch: 'full'
  },

  // ========== ФОТО-СОГЛАСОВАНИЕ (публичный) ==========
  {
    path: 'photo-review/:token',
    loadComponent: () => import('./features/photo-review/photo-review.component').then(c => c.PhotoReviewComponent),
    title: 'Просмотр фотографий — Своё Фото'
  },
  // Публичная страница обработки фото (без authGuard, без сайдбара профиля)
  {
    path: 'photo-processing',
    loadComponent: () => import('./features/user-profile/components/photo-selections/photo-selections.component')
      .then(c => c.PhotoSelectionsComponent),
    title: 'Обработка фотографий — Своё Фото',
  },

  // ========== ОТЗЫВЫ (публичный) ==========
  {
    path: 'review',
    loadComponent: () => import('./features/review/review-page.component').then(c => c.ReviewPageComponent),
    title: 'Оставить отзыв — Своё Фото'
  },

  // ========== ВАКАНСИЯ ПРОМОУТЕРА ==========
  {
    path: 'promo-job',
    loadComponent: () => import('./features/promo-job/promo-job.component').then(c => c.PromoJobComponent),
    title: 'Работа промоутером — до 2 400 ₽/день | Своё Фото',
    data: { canonicalUrl: '/promo-job' }
  },

  // ========== РЕКОМЕНДАЦИИ КЛИЕНТОВ ==========
  {
    path: 'priglasi-druga',
    loadComponent: () => import('./features/referral/referral-landing/referral-landing.component').then(c => c.ReferralLandingComponent),
    title: 'Пригласить друга — Своё Фото',
    data: { canonicalUrl: '/priglasi-druga' }
  },

  // ========== ПАРТНЁРСКАЯ ПРОГРАММА ==========
  {
    path: 'partners',
    loadComponent: () => import('./features/partners/partner-landing/partner-landing.component').then(c => c.PartnerLandingComponent),
    title: 'Партнёрская программа — Своё Фото'
  },
  {
    path: 'partner-dashboard',
    loadChildren: () => import('./features/partners/partner-dashboard.routes').then(r => r.PARTNER_DASHBOARD_ROUTES),
    canActivate: [authGuard],
    title: 'Кабинет партнёра — Своё Фото'
  },

  // ========== LEGACY REDIRECTS → /user-profile/* ==========
  { path: 'orders', redirectTo: '/user-profile/orders', pathMatch: 'full' },
  { path: 'orders/bookings', redirectTo: '/user-profile/bookings', pathMatch: 'full' },
  { path: 'orders/approvals', redirectTo: '/user-profile/approvals', pathMatch: 'full' },
  { path: 'photos', redirectTo: '/user-profile/my-photos', pathMatch: 'full' },
  { path: 'profile', redirectTo: '/user-profile', pathMatch: 'full' },
  { path: 'profile/dashboard', redirectTo: '/user-profile', pathMatch: 'full' },
  { path: 'profile/bonuses', redirectTo: '/user-profile/loyalty', pathMatch: 'full' },
  { path: 'profile/subscription', redirectTo: '/user-profile/subscription', pathMatch: 'full' },
  { path: 'profile/settings', redirectTo: '/user-profile/account', pathMatch: 'full' },
  { path: 'profile/notifications', redirectTo: '/user-profile/account', pathMatch: 'full' },
  { path: 'profile/channels', redirectTo: '/user-profile/account', pathMatch: 'full' },

  // ========== ПЛАТЁЖ (ONLINE PAYMENT) ==========
  {
    path: 'pay/:orderId',
    loadComponent: () => import('./features/payment-checkout/payment-checkout.component').then(c => c.PaymentCheckoutComponent),
    title: 'Оплата — Своё Фото',
  },

  // ========== WILDCARD МАРШРУТ ==========
  {
    path: '**',
    redirectTo: ''
  }
];
