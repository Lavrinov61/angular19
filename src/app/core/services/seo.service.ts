import { Injectable, inject, DOCUMENT, PLATFORM_ID, Renderer2, RendererFactory2 } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { STUDIO_PHONE, STUDIO_PHONE_SCHEMA } from '../data/address.data';

const GOOGLE_REVIEW_SNIPPET_PARENT_TYPES = new Set<string>([
  'Book',
  'Course',
  'CreativeWorkSeason',
  'CreativeWorkSeries',
  'Episode',
  'Event',
  'Game',
  'MediaObject',
  'Movie',
  'MusicPlaylist',
  'MusicRecording',
  'Product',
  'Recipe',
  'SoftwareApplication',
]);

const SELF_OWNED_REVIEW_PARENT_TYPES = new Set<string>([
  'LocalBusiness',
  'Organization',
]);

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private title = inject(Title);
  private meta = inject(Meta);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private document = inject(DOCUMENT);
  private renderer: Renderer2;
  private baseTitle = 'Своё Фото';
  private baseDescription = 'Профессиональная фотостудия в Ростове-на-Дону. Фото на документы, портретная и семейная съемка.';
  private baseUrl = 'https://svoefoto.ru';
  private jsonLdBlocks: Record<string, unknown>[] = [];

  constructor() {
    const rendererFactory = inject(RendererFactory2);
    this.renderer = rendererFactory.createRenderer(null, null);
  }

  /**
   * Обновляет заголовок страницы
   */
  updateTitle(title: string): void {
    this.title.setTitle(title);
  }

  /**
   * Обновляет мета-описание страницы
   */
  updateDescription(description: string): void {
    this.meta.updateTag({ name: 'description', content: description });
  }  /**
   * Устанавливает канонический URL
   */
  updateCanonicalUrl(path?: string): void {
    // Строим полный URL
    let url = this.baseUrl;
    if (path) {
      url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    }

    // Очищаем параметры запроса
    if (url.includes('?')) {
      url = url.split('?')[0];
    }

    // Проверяем доступность document
    if (!this.document) {
      return;
    }

    // Ищем существующий canonical link
    const link = this.document.querySelector('link[rel="canonical"]');
    if (link) {
      link.setAttribute('href', url);
    } else {
      const newLink = this.document.createElement('link');
      newLink.setAttribute('rel', 'canonical');
      newLink.setAttribute('href', url);
      this.document.head.appendChild(newLink);
    }
  }  /**
   * Очищает все JSON-LD блоки
   * Используется при инициализации каждой страницы для очистки предыдущих блоков
   */
  clearJsonLd(): void {
    this.jsonLdBlocks = [];
    if (this.document) {
      const existing = this.document.querySelector('script[type="application/ld+json"]');
      if (existing) {
        existing.remove();
      }
    }
  }

  /**
   * Добавляет структурированные данные JSON-LD для SEO
   * Работает как на сервере, так и в браузере для правильного SSR
   * Объединяет все блоки в один массив для поддержки нескольких JSON-LD блоков на странице
   */
  addJsonLd(data: Record<string, unknown> | Record<string, unknown>[]): void {
    if (this.document) {
      // Добавляем новые блоки в массив
      if (Array.isArray(data)) {
        // Если передан массив - добавляем все элементы
        this.jsonLdBlocks.push(...data.map(block => this.sanitizeJsonLdObject(block)));
      } else {
        // Если передан объект - добавляем его
        this.jsonLdBlocks.push(this.sanitizeJsonLdObject(data));
      }

      // Удаляем существующий JSON-LD script
      const existing = this.document.querySelector('script[type="application/ld+json"]');
      if (existing) {
        existing.remove();
      }

      // Создаем новый JSON-LD script с массивом всех блоков
      const script = this.document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      // Всегда создаем массив для консистентности (JSON-LD валидатор принимает и массив, и объект)
      const jsonContent = this.jsonLdBlocks.length > 1 
        ? this.jsonLdBlocks 
        : this.jsonLdBlocks[0];
      script.textContent = JSON.stringify(jsonContent, null, 2);
      this.document.head.appendChild(script);
    }
  }

  private sanitizeJsonLdValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeJsonLdValue(item));
    }

    if (this.isRecord(value)) {
      return this.sanitizeJsonLdObject(value);
    }

    return value;
  }

  private sanitizeJsonLdObject(value: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = this.sanitizeJsonLdValue(entry);
    }

    if (this.shouldDropReviewSnippetFields(sanitized)) {
      delete sanitized['aggregateRating'];
      delete sanitized['review'];
    }

    return sanitized;
  }

  private shouldDropReviewSnippetFields(value: Record<string, unknown>): boolean {
    if (!('aggregateRating' in value) && !('review' in value)) {
      return false;
    }

    const types = this.getJsonLdTypes(value['@type']);
    if (types.length === 0) {
      return false;
    }

    if (types.some(type => SELF_OWNED_REVIEW_PARENT_TYPES.has(type))) {
      return true;
    }

    return types.every(type => !GOOGLE_REVIEW_SNIPPET_PARENT_TYPES.has(type));
  }

  private getJsonLdTypes(value: unknown): string[] {
    if (typeof value === 'string') {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }

    return [];
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Добавляет метаданные для социальных сетей (Open Graph, Twitter)
   * Необходимо для красивых превью при шаринге контента
   * @param title Заголовок страницы для социальных сетей
   * @param description Описание страницы для социальных сетей
   * @param image URL изображения для превью (опционально)
   * @param type Тип контента (по умолчанию 'website')
   * @param url Канонический URL страницы (опционально)
   */  setOpenGraph(title: string, description: string, image?: string, type = 'website', url?: string): void {
    // Определяем URL для og:url
    const pageUrl = url || (this.baseUrl + (this.router ? this.router.url : ''));

    // Базовые Open Graph теги
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: pageUrl });
    this.meta.updateTag({ property: 'og:type', content: type });

    // Изображение для Open Graph
    if (image) {
      this.meta.updateTag({ property: 'og:image', content: image });
      this.meta.updateTag({ property: 'og:image:alt', content: title });
      // Указываем размеры для OG изображения (улучшает отображение в Facebook)
      this.meta.updateTag({ property: 'og:image:width', content: '1200' });
      this.meta.updateTag({ property: 'og:image:height', content: '630' });
    }

    // Добавляем информацию о сайте
    this.meta.updateTag({ property: 'og:site_name', content: 'Своё Фото' });
    this.meta.updateTag({ property: 'og:locale', content: 'ru_RU' });

    // Twitter Card - расширенная поддержка для Twitter
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:url', content: pageUrl });

    if (image) {
      this.meta.updateTag({ name: 'twitter:image', content: image });
      this.meta.updateTag({ name: 'twitter:image:alt', content: title });
    }
  }  /**
   * Устанавливает все метаданные для страницы
   * Комбинирует обычные мета-теги, Open Graph и canonical URL
   *
   * @param title Заголовок страницы
   * @param description Описание страницы
   * @param image URL изображения для превью
   * @param canonicalPath Путь для канонического URL (опционально)
   * @param keywords Ключевые слова через запятую (опционально)
   * @param ogType Тип контента для Open Graph (опционально)
   */
  setAllMetaData(
    title: string,
    description: string = this.baseDescription,
    image?: string,
    canonicalPath?: string,
    keywords?: string,
    ogType = 'website'
  ): void {
    // Основные мета-теги
    this.updateTitle(title);
    this.updateDescription(description);

    // Ключевые слова
    if (keywords) {
      this.meta.updateTag({ name: 'keywords', content: keywords });
    }

    // Канонический URL
    this.updateCanonicalUrl(canonicalPath);

    // Open Graph и Twitter Cards
    this.setOpenGraph(
      title,
      description,
      image,
      ogType,
      canonicalPath ? `${this.baseUrl}${canonicalPath}` : undefined
    );

    // Язык контента
    this.meta.updateTag({ 'http-equiv': 'content-language', content: 'ru-RU' });

    // Viewport для мобильных устройств
    this.meta.updateTag({ name: 'viewport', content: 'width=device-width, initial-scale=1' });
  }
  /**
   * Создает структурированные данные для фотостудии (LocalBusiness)
   */
  setPhotoStudioJsonLd(): void {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "@id": `${this.baseUrl}/#business`,
      "name": "Своё Фото",
      "alternateName": "Magnus Photo",
      "description": this.baseDescription,
      "url": this.baseUrl,
      "image": {
        "@type": "ImageObject",
        "url": `${this.baseUrl}/static/1-1088-l.webp`,
        "contentUrl": `${this.baseUrl}/static/1-1088-l.webp`,
        "name": "Интерьер Своё Фото",
        "caption": "Основное фото салона Своё Фото",
        "description": "Фотостудия Своё Фото в Ростове-на-Дону",
        "height": "1088",
        "width": "720"
      },
      "logo": {
        "@type": "ImageObject",
        "contentUrl": `${this.baseUrl}/static/svoe-foto-600x600.png`,
        "name": "Логотип Своё Фото",
        "height": "600",
        "width": "600"
      },
      "telephone": STUDIO_PHONE_SCHEMA,
      "email": "magnusphoto@list.ru",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Переулок Соборный 21",
        "addressLocality": "Ростов-на-Дону",
        "postalCode": "344002",
        "addressCountry": "RU"
      },      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "47.219706",
        "longitude": "39.7107641"
      },
      "openingHours": "Mo-Su 09:00-19:30",
      "priceRange": "Средний",
      "paymentAccepted": "Cash, Credit Card",
      "currenciesAccepted": "RUB",
      "serviceType": "Photography Services",
      "areaServed": "Ростов-на-Дону",
      "sameAs": [
        "https://yandex.ru/maps/org/magnusfoto/50414539463/reviews/",
        "https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews",
        "https://g.page/r/CdLAfLUuNAGrEBM/",
        "https://vk.com/im?sel=-68371131",
        "https://instagram.com/foto.magnus",
        "https://vk.com/studiomagnus",
        "https://t.me/magnus_photo",
        "https://ok.ru/photo.magnus/"
      ],
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "5.0",
        "reviewCount": "482"
      },
      "hasOfferCatalog": {
        "@type": "OfferCatalog",
        "name": "Фотоуслуги",
        "itemListElement": [
          {
            "@type": "Offer",
            "itemOffered": {
              "@type": "Service",
              "name": "Фото на документы",
              "description": "Профессиональные фото на документы любого формата"
            }
          },
          {
            "@type": "Offer",
            "itemOffered": {
              "@type": "Service",
              "name": "Портретная съемка",
              "description": "Художественная портретная фотосъемка в студии"
            }
          },
          {
            "@type": "Offer",
            "itemOffered": {
              "@type": "Service",
              "name": "Семейная фотосессия",
              "description": "Семейные фотосессии в уютной атмосфере студии"
            }
          }
        ]
      }
    };

    this.addJsonLd(jsonLd);
  }
  /**
   * Создает структурированные данные для фотографа (Person)
   */
  setPhotographerJsonLd(): void {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Person",
      "@id": `${this.baseUrl}/#photographer`,
      "name": "Магнус",
      "alternateName": "Magnus",
      "jobTitle": "Профессиональный фотограф",
      "description": "Опытный фотограф с более чем 10-летним стажем в портретной и документальной фотографии",
      "url": `${this.baseUrl}/about`,
      "image": `${this.baseUrl}/static/svoe-foto-600x600.png`,
      "telephone": STUDIO_PHONE_SCHEMA,
      "email": "magnusphoto@list.ru",
      "worksFor": {
        "@type": "LocalBusiness",
        "name": "Своё Фото",
        "url": this.baseUrl
      },
      "knowsAbout": [
        "Портретная фотография",
        "Документальная фотография",
        "Студийная съемка",
        "Фотография на документы",
        "Семейная фотография"
      ],
      "hasOccupation": {
        "@type": "Occupation",
        "name": "Фотограф",
        "occupationLocation": {
          "@type": "City",
          "name": "Ростов-на-Дону"
        }
      }
    };

    this.addJsonLd(jsonLd);
  }
  /**
   * Создает структурированные данные для услуги
   */
  setServiceJsonLd(serviceName: string, serviceDescription: string, price?: string): void {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": serviceName,
      "description": serviceDescription,
      "provider": {
        "@type": "LocalBusiness",
        "name": "Своё Фото",
        "url": this.baseUrl
      },
      "areaServed": "Ростов-на-Дону",
      "serviceType": "Photography",
      "category": "Photography Services",
      ...(price && {
        "offers": {
          "@type": "Offer",
          "price": price,
          "priceCurrency": "RUB",
          "availability": "https://schema.org/InStock"
        }
      })
    };

    this.addJsonLd(jsonLd);
  }
  /**
   * Создает breadcrumb структурированные данные
   */
  setBreadcrumbJsonLd(breadcrumbs: {name: string, url: string}[]): void {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": breadcrumbs.map((item, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": item.name,
        "item": item.url
      }))
    };

    this.addJsonLd(jsonLd);
  }

  /**
   * FAQPage schema для расширенных сниппетов в Google.
   * Принимает массив вопросов/ответов из faqItems лендинга.
   */
  setFAQPageJsonLd(items: { question: string; answer: string }[]): void {
    if (!items?.length) return;
    this.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': items.map(item => ({
        '@type': 'Question',
        'name': item.question,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': item.answer,
        }
      }))
    });
  }

  /**
   * Устанавливает полные структурированные данные для главной страницы
   */
  setHomePageJsonLd(): void {
    // Очищаем предыдущие JSON-LD блоки
    this.clearJsonLd();
    
    // Для главной страницы используем только LocalBusiness schema
    // BreadcrumbList не нужен на главной странице
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": "Своё Фото",
      "url": this.baseUrl,
      "image": {
        "@type": "ImageObject",
        "url": `${this.baseUrl}/static/1-1088-l.webp`,
        "contentUrl": `${this.baseUrl}/static/1-1088-l.webp`,
        "name": "Интерьер Своё Фото",
        "caption": "Основное фото салона Своё Фото",
        "description": "Фотостудия Своё Фото в Ростове-на-Дону",
        "height": "1088",
        "width": "720"
      },
      "logo": {
        "@type": "ImageObject",
        "contentUrl": `${this.baseUrl}/static/svoe-foto-600x600.png`,
        "name": "Логотип Своё Фото",
        "height": "600",
        "width": "600"
      },
      "telephone": STUDIO_PHONE_SCHEMA,
      "email": "magnusphoto@list.ru",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Переулок Соборный 21",
        "addressLocality": "Ростов-на-Дону",
        "postalCode": "344002",
        "addressCountry": "RU"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "47.219706",
        "longitude": "39.7107641"
      },
      "openingHours": "Mo-Su 09:00-19:30",
      "priceRange": "Средний",
      "sameAs": [
        "https://yandex.ru/maps/org/magnusfoto/50414539463/reviews/",
        "https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews",
        "https://g.page/r/CdLAfLUuNAGrEBM/",
        "https://vk.com/im?sel=-68371131",
        "https://instagram.com/foto.magnus",
        "https://vk.com/studiomagnus",
        "https://t.me/magnus_photo",
        "https://ok.ru/photo.magnus/"
      ],
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "5.0",
        "reviewCount": "482",
        "bestRating": "5",
        "worstRating": "1"
      }
    };

    this.addJsonLd(jsonLd);
  }

  /**
   * Генерирует SEO-оптимизированные заголовки
   */
  generateDynamicTitle(pageTitle: string, section?: string): string {
    const parts = [pageTitle];
    if (section) {
      parts.push(section);
    }
    parts.push(this.baseTitle);
    return parts.join(' - ');
  }

  /**
   * Генерирует и устанавливает полные SEO мета-теги для страницы  /**
   * Универсальный метод для установки всех SEO мета-тегов страницы
   * Включает все необходимые теги для поисковых систем и социальных сетей
   */
  setPageMetadata(options: {
    title: string;
    description: string;
    keywords?: string;
    ogImage?: string;
    canonicalUrl?: string;
    ogType?: string;
    structuredData?: Record<string, unknown> | Record<string, unknown>[];
    noIndex?: boolean;
    author?: string;
    publishedTime?: string;
    modifiedTime?: string;
    tags?: string[];
  }): void {
    // Формируем полный заголовок
    const fullTitle = `${options.title} | ${this.baseTitle}`;

    // Основные мета-теги
    this.updateTitle(fullTitle);
    this.updateDescription(options.description);

    if (options.keywords) {
      this.meta.updateTag({ name: 'keywords', content: options.keywords });
    }

    // Указываем автора, если есть
    if (options.author) {
      this.meta.updateTag({ name: 'author', content: options.author });
    }

    // Open Graph теги
    this.meta.updateTag({ property: 'og:title', content: options.title });
    this.meta.updateTag({ property: 'og:description', content: options.description });
    this.meta.updateTag({ property: 'og:type', content: options.ogType || 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: this.baseTitle });

    // Дата публикации и обновления для статей
    if (options.publishedTime) {
      this.meta.updateTag({ property: 'article:published_time', content: options.publishedTime });
    }

    if (options.modifiedTime) {
      this.meta.updateTag({ property: 'article:modified_time', content: options.modifiedTime });
    }

    // Теги для статей
    if (options.tags && options.tags.length > 0) {
      options.tags.forEach(tag => {
        this.meta.updateTag({ property: 'article:tag', content: tag });
      });
    }

    // Изображение для Open Graph
    const ogImage = options.ogImage || `${this.baseUrl}/assets/images/og-default.jpg`;
    this.meta.updateTag({ property: 'og:image', content: ogImage });
    this.meta.updateTag({ property: 'og:image:width', content: '1200' });
    this.meta.updateTag({ property: 'og:image:height', content: '630' });
    this.meta.updateTag({ property: 'og:image:alt', content: options.title });

    // Twitter Cards
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: options.title });
    this.meta.updateTag({ name: 'twitter:description', content: options.description });
    this.meta.updateTag({ name: 'twitter:image', content: ogImage });
    this.meta.updateTag({ name: 'twitter:site', content: '@SvoeFoto' });

    if (options.author) {
      this.meta.updateTag({ name: 'twitter:creator', content: `@${options.author.replace(/\s+/g, '')}` });
    }
      // URL и canonical
    const currentUrl = options.canonicalUrl ||
      (this.router ? `${this.baseUrl}${this.router.url}` : this.baseUrl);

    this.meta.updateTag({ property: 'og:url', content: currentUrl });
    this.updateCanonicalUrl(options.canonicalUrl);

    // Robots
    if (options.noIndex) {
      this.setRobotsMeta('noindex, nofollow');
    } else {
      this.setRobotsMeta('index, follow');
    }

    // Структурированные данные
    if (options.structuredData) {
      this.addJsonLd(options.structuredData);
    }

    // Web Application manifest link для PWA
    if (this.document && !this.document.querySelector('link[rel="manifest"]')) {
      const manifestLink = this.document.createElement('link');
      manifestLink.rel = 'manifest';
      manifestLink.href = '/manifest.webmanifest';
      this.document.head.appendChild(manifestLink);
    }

    // Favicons для разных устройств
    this.addFavicons();
  }

  /**
   * Добавляет иконки для различных устройств
   */
  private addFavicons(): void {
    if (!this.document) return;

    // Стандартный favicon
    this.ensureLinkExists('icon', '/favicon.ico');

    // Apple Touch Icon
    this.ensureLinkExists('apple-touch-icon', '/apple-touch-icon.png');

    // Для Android и других устройств
    this.ensureLinkExists('icon', '/web-app-manifest-192x192.png', 'image/png', '192x192');
    this.ensureLinkExists('icon', '/web-app-manifest-512x512.png', 'image/png', '512x512');
  }
    /**
   * Создает link элемент, если он еще не существует
   */
  private ensureLinkExists(rel: string, href: string, type?: string, sizes?: string): void {
    if (!this.document) return;

    let selector = `link[rel="${rel}"]`;
    if (href) selector += `[href="${href}"]`;

    if (!this.document.querySelector(selector)) {
      const link = this.document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (type) link.type = type;
      if (sizes) link.setAttribute('sizes', sizes);
      this.document.head.appendChild(link);
    }
  }

  /**
   * Генерирует мета-теги для страницы фотографа
   */
  setPhotographerPageMeta(photographer: {
    id: string;
    name: string;
    specialization: string;
    description: string;
    avatarUrl?: string;
    portfolioImages?: string[];
    rating?: number;
    experience?: number;
  }): void {
    const title = `${photographer.name} - ${photographer.specialization}`;
    const description = `${photographer.description} Профессиональный фотограф в Ростове-на-Дону.${photographer.rating ? ` Рейтинг: ${photographer.rating}/5.` : ''}${photographer.experience ? ` Опыт: ${photographer.experience} лет.` : ''} Запись по телефону ${STUDIO_PHONE}.`;

    // Генерируем динамическое изображение для социальных сетей
    const ogImage = this.generatePhotographerOgImage(photographer);

    this.setPageMetadata({
      title,
      description,
      keywords: `${photographer.name}, ${photographer.specialization}, фотограф, портфолио, съемка, Ростов-на-Дону`,
      ogImage,
      structuredData: this.generatePhotographerJsonLd(photographer)
    });

    // Дополнительные Open Graph теги для профилей
    this.meta.updateTag({ property: 'og:type', content: 'profile' });
    this.meta.updateTag({ property: 'profile:first_name', content: photographer.name.split(' ')[0] });
    if (photographer.name.split(' ')[1]) {
      this.meta.updateTag({ property: 'profile:last_name', content: photographer.name.split(' ')[1] });
    }
  }

  /**
   * Генерирует мета-теги для страницы галереи
   */
  setGalleryPageMeta(gallery: {
    title: string;
    description: string;
    images: {url: string; alt: string}[];
    photographer?: string;
    category?: string;
  }): void {
    const title = `${gallery.title} - Галерея`;
    const description = `${gallery.description} Профессиональная фотосъемка в студии Своё Фото.${gallery.photographer ? ` Фотограф: ${gallery.photographer}.` : ''}`;

    // Используем первое изображение галереи как Open Graph image
    const ogImage = gallery.images[0]?.url || this.generateDynamicOgImage('gallery', gallery.title);

    this.setPageMetadata({
      title,
      description,
      keywords: `галерея, фотосъемка, ${gallery.category || 'фотография'}, ${gallery.photographer || ''}, Своё Фото`,
      ogImage,
      structuredData: this.generateGalleryJsonLd(gallery)
    });

    // Дополнительные мета-теги для галереи
    this.meta.updateTag({ property: 'og:type', content: 'article' });
    this.meta.updateTag({ name: 'article:section', content: 'Галерея' });
    if (gallery.category) {
      this.meta.updateTag({ name: 'article:tag', content: gallery.category });
    }
  }
  /**
   * Генерирует JSON-LD для фотографа
   */
  private generatePhotographerJsonLd(photographer: {
    id: string;
    name: string;
    specialization: string;
    description: string;
    avatarUrl?: string;
    portfolioImages?: string[];
    rating?: number;
    experience?: number;
  }): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'Person',
      '@id': `${this.baseUrl}/photograph/${photographer.id}`,
      name: photographer.name,
      jobTitle: photographer.specialization,
      description: photographer.description,
      image: photographer.avatarUrl,
      url: `${this.baseUrl}/photograph/${photographer.id}`,
      worksFor: {
        '@type': 'LocalBusiness',
        name: 'Своё Фото',
        url: this.baseUrl
      },
      ...(photographer.rating && {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: photographer.rating,
          bestRating: 5,
          ratingCount: 1
        }
      }),
      ...(photographer.portfolioImages && {
        hasOccupation: {
          '@type': 'Occupation',
          name: 'Фотограф',
          occupationLocation: {
            '@type': 'City',
            name: 'Ростов-на-Дону'
          }
        }
      })
    };
  }

  /**
   * Генерирует JSON-LD для галереи
   */
  private generateGalleryJsonLd(gallery: {
    title: string;
    description: string;
    images: {url: string; alt: string}[];
    photographer?: string;
    category?: string;
  }): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'ImageGallery',
      name: gallery.title,
      description: gallery.description,
      url: `${this.baseUrl}${this.router.url}`,
      provider: {
        '@type': 'LocalBusiness',
        name: 'Своё Фото',
        url: this.baseUrl
      },
      ...(gallery.images && gallery.images.length > 0 && {
        associatedMedia: gallery.images.map((img: {url: string; alt: string}, index: number) => ({
          '@type': 'ImageObject',
          contentUrl: img.url,
          description: img.alt || `${gallery.title} - изображение ${index + 1}`,
          thumbnailUrl: img.url,
          creator: gallery.photographer ? {
            '@type': 'Person',
            name: gallery.photographer
          } : undefined
        }))
      })
    };
  }

  /**
   * Генерирует динамическое Open Graph изображение для фотографа
   */
  private generatePhotographerOgImage(photographer: {
    name: string;
    specialization: string;
    avatarUrl?: string;
  }): string {
    // В продакшене здесь будет вызов к сервису генерации изображений
    // Пример: Canvas API или сервис типа Bannerbear/HTMLcsstoimage
    const _params = new URLSearchParams({
      name: photographer.name,
      specialization: photographer.specialization,
      template: 'photographer'
    });

    // Временно возвращаем аватар фотографа или дефолтное изображение
    return photographer.avatarUrl || `${this.baseUrl}/assets/images/og-photographer-default.jpg`;
  }

  /**
   * Устанавливает мета-теги для страницы услуги с расширенной информацией
   */
  setServicePageMetaEnhanced(service: {
    name: string;
    description: string;
    price?: string;
    duration?: string;
    includes?: string[];
    category: string;
    imageUrl?: string;
  }): void {
    const title = `${service.name} - Услуги фотостудии`;
    const priceText = service.price ? ` Цена от ${service.price} руб.` : '';
    const durationText = service.duration ? ` Длительность: ${service.duration}.` : '';
    const description = `${service.description}${priceText}${durationText} Запись по телефону ${STUDIO_PHONE}.`;

    this.setPageMetadata({
      title,
      description,
      keywords: `${service.name}, ${service.category}, фотосъемка, цена, услуги, Ростов-на-Дону`,
      ogImage: service.imageUrl || this.generateDynamicOgImage('service', service.name),
      structuredData: this.generateServiceJsonLd(service)
    });
  }

  /**
   * Генерирует JSON-LD для услуги
   */
  private generateServiceJsonLd(service: {
    name: string;
    description: string;
    price?: string;
    duration?: string;
    includes?: string[];
    category: string;
    imageUrl?: string;
  }): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'Service',
      '@id': `${this.baseUrl}/services/${encodeURIComponent(service.name.toLowerCase())}`,
      name: service.name,
      description: service.description,
      category: service.category,
      provider: {
        '@type': 'LocalBusiness',
        name: 'Своё Фото',
        url: this.baseUrl,
        telephone: STUDIO_PHONE_SCHEMA,
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Переулок Соборный 21',
          addressLocality: 'Ростов-на-Дону',
          addressRegion: 'Ростовская область',
          postalCode: '344002',
          addressCountry: 'RU'
        }
      },
      ...(service.price && {
        offers: {
          '@type': 'Offer',
          price: service.price.replace(/[^\d]/g, ''),
          priceCurrency: 'RUB',
          availability: 'https://schema.org/InStock'
        }
      }),
      ...(service.duration && {
        duration: service.duration
      }),
      ...(service.includes && {
        additionalProperty: service.includes.map((item: string) => ({
          '@type': 'PropertyValue',
          name: 'Включено',
          value: item
        }))
      })
    };
  }

  /**
   * Генерирует и устанавливает JSON-LD для организации (LocalBusiness)
   */
  setLocalBusinessJsonLd(): void {
    const businessData = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      '@id': this.baseUrl,
      name: 'Своё Фото',
      description: this.baseDescription,
      url: this.baseUrl,
      telephone: STUDIO_PHONE_SCHEMA,
      email: 'magnusphoto@list.ru',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Переулок Соборный 21',
        addressLocality: 'Ростов-на-Дону',
        addressRegion: 'Ростовская область',
        postalCode: '344002',
        addressCountry: 'RU'
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 47.219706,
        longitude: 39.7107641
      },
      openingHours: 'Mo-Su 09:00-19:30',
      priceRange: 'Средний',
      category: 'Фотостудия',
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Услуги фотостудии',
        itemListElement: [
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Фото на документы',
              description: 'Профессиональная съемка фотографий на документы'
            }
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Портретная съемка',
              description: 'Художественная портретная фотосъемка в студии'
            }
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Семейная съемка',
              description: 'Семейные фотосессии и съемка мероприятий'
            }
          }
        ]
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 5.0,
        reviewCount: 482,
        bestRating: 5
      },
      review: [
        {
          '@type': 'Review',
          author: {
            '@type': 'Person',
            name: 'Анна Петрова'
          },
          reviewRating: {
            '@type': 'Rating',
            ratingValue: 5
          },
          reviewBody: 'Отличная фотостудия! Профессиональные фотографы и качественный сервис.'
        }
      ]
    };
    this.addJsonLd(businessData);
  }

  /**
   * Устанавливает SEO-метаданные для страниц с локальной информацией (контакты, о нас)
   * Оптимизировано для локального SEO и Google My Business
   */
  setLocalSeoMeta(): void {
    const title = 'Своё Фото - Профессиональная фотостудия в Ростове-на-Дону';
    const description = 'Качественные фотоуслуги в центре Ростова-на-Дону: фото на документы, художественная съемка, печать, сканирование и копирование документов.';
    const keywords = 'фотостудия, фото на документы, печать фотографий, Ростов-на-Дону, фотограф, фотоуслуги, срочное фото';

    this.setPageMetadata({
      title: title,
      description: description,
      keywords: keywords,
      ogImage: `${this.baseUrl}/assets/images/studio-local.jpg`,
      ogType: 'business.business',
      structuredData: this.generateLocalBusinessJsonLd()
    });
  }

  /**
   * Генерирует структурированные данные LocalBusiness для локального SEO
   */
  private generateLocalBusinessJsonLd(): Record<string, unknown> {
    return {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "@id": `${this.baseUrl}/#business`,
      "name": "Своё Фото",
      "alternateName": "Magnus Photo",
      "description": "Современная фотостудия с полным спектром услуг: от фото на документы до художественной съемки",
      "url": this.baseUrl,
      "logo": `${this.baseUrl}/assets/images/logo.png`,
      "image": `${this.baseUrl}/assets/images/studio-front.jpg`,
      "telephone": STUDIO_PHONE_SCHEMA,
      "email": "magnusphoto@list.ru",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Переулок Соборный 21",
        "addressLocality": "Ростов-на-Дону",
        "postalCode": "344002",
        "addressCountry": "RU"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "47.219706",
        "longitude": "39.7107641"
      },
      "openingHoursSpecification": [
        {
          "@type": "OpeningHoursSpecification",
          "dayOfWeek": [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday"
          ],
          "opens": "09:00",
          "closes": "19:30"
        }
      ],
      "priceRange": "$$",
      "currenciesAccepted": "RUB",
      "paymentAccepted": "Cash, Credit Card",
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "4.8",
        "bestRating": "5",
        "worstRating": "1",
        "ratingCount": "482"      }
    };
  }

  /**
   * Set robots meta tag
   */
  setRobotsMeta(content: string): void {
    if (this.document) {
      let robotsTag = this.document.querySelector('meta[name="robots"]') as HTMLMetaElement;
      if (!robotsTag) {
        robotsTag = this.document.createElement('meta');
        robotsTag.name = 'robots';
        this.document.head.appendChild(robotsTag);
      }
      robotsTag.content = content;
    }
  }

  /**
   * Generate dynamic Open Graph image URL
   * TODO: Implement actual dynamic image generation service
   */
  generateDynamicOgImage(type: string, title: string, options?: {
    subtitle?: string;
    authorName?: string;
    tags?: string[];
  }): string {
    // For now, return a placeholder URL
    const baseUrl = this.getBaseUrl();
    const encodedTitle = encodeURIComponent(title);
    const encodedType = encodeURIComponent(type);

    let imageUrl = `${baseUrl}/api/og-image?type=${encodedType}&title=${encodedTitle}`;

    if (options?.subtitle) {
      imageUrl += `&subtitle=${encodeURIComponent(options.subtitle)}`;
    }

    if (options?.authorName) {
      imageUrl += `&author=${encodeURIComponent(options.authorName)}`;
    }

    if (options?.tags && options.tags.length > 0) {
      imageUrl += `&tags=${encodeURIComponent(options.tags.join(','))}`;
    }

    return imageUrl;
  }

  /**
   * Get base URL for the application
   */
  private getBaseUrl(): string {
    return this.baseUrl;
  }
}
