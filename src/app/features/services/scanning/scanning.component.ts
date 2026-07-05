import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESSES } from '../../../core/data/address.data';

@Component({
  selector: 'app-scanning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatTabsModule,
    MatExpansionModule,
    ContactsSectionComponent,
    TestimonialsComponent
],
  templateUrl: './scanning.component.html',
  styleUrls: ['./scanning.component.scss']
})
export class ScanningComponent implements OnInit {
  
  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  layout = inject(ResponsiveLayoutService);

  constructor() {
    // Устанавливаем canonical URL в конструкторе для SSR
    this.seoService.updateCanonicalUrl('/scanning');
  }

  // Data
  contacts = CONTACTS;
  addresses = ADDRESSES;

  // Responsive signals (конвертированы из Observable)
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Basic properties
  price = 50;

  // Scanning services
  scanningServices = [
    {
      icon: 'article',
      title: 'Документы А4',
      description: 'Сканирование стандартных документов',
      specifications: [
        { label: 'Формат', value: 'A4 (210×297 мм)' },
        { label: 'Разрешение', value: 'до 600 dpi' },
        { label: 'Формат файла', value: 'PDF, JPG' }
      ],
      price: 15
    },
    {
      icon: 'credit_card',
      title: 'Документы А5/А6',
      description: 'Сканирование малых документов',
      specifications: [
        { label: 'Формат', value: 'A5, A6, карточки' },
        { label: 'Разрешение', value: 'до 600 dpi' },
        { label: 'Качество', value: 'Высокое' }
      ],
      price: 10
    },
    {
      icon: 'photo',
      title: 'Фотографии',
      description: 'Оцифровка старых фотографий',
      specifications: [
        { label: 'Размер', value: 'любой до A4' },
        { label: 'Разрешение', value: 'до 1200 dpi' },
        { label: 'Формат', value: 'JPG, TIFF' }
      ],
      price: 25
    },
    {
      icon: 'menu_book',
      title: 'Книги/журналы',
      description: 'Сканирование переплетенных изданий',
      specifications: [
        { label: 'Формат', value: 'до A3' },
        { label: 'Технология', value: 'Планетарный сканер' },
        { label: 'Качество', value: 'Без повреждений' }
      ],
      price: 20
    },
    {
      icon: 'palette',
      title: 'Цветные документы',
      description: 'Полноцветное сканирование',
      specifications: [
        { label: 'Цветность', value: 'True Color' },
        { label: 'Глубина цвета', value: '24 бит' },
        { label: 'Калибровка', value: 'Профессиональная' }
      ],
      price: 30
    },
    {
      icon: 'folder_zip',
      title: 'Пакетное сканирование',
      description: 'Большие объемы документов',
      specifications: [
        { label: 'Скорость', value: 'до 50 стр/мин' },
        { label: 'Объем', value: 'от 100 листов' },
        { label: 'Скидка', value: 'до 30%' }
      ],
      price: 8
    }
  ];

  // Process steps
  processSteps = [
    {
      title: 'Оценка материала',
      description: 'Определяем тип документов и оптимальные настройки сканирования',
      icon: 'visibility'
    },
    {
      title: 'Настройка оборудования',
      description: 'Выбираем подходящий сканер и настраиваем параметры качества',
      icon: 'tune'
    },
    {
      title: 'Сканирование',
      description: 'Аккуратно сканируем документы с максимальным качеством',
      icon: 'scanner'
    },
    {
      title: 'Обработка',
      description: 'Корректируем яркость, контраст и убираем дефекты',
      icon: 'auto_fix_high'
    },
    {
      title: 'Сохранение',
      description: 'Сохраняем в нужном формате и разрешении',
      icon: 'save'
    },
    {
      title: 'Передача файлов',
      description: 'Отправляем готовые файлы удобным способом',
      icon: 'cloud_upload'
    }
  ];

  // Advantages
  advantages = [
    {
      icon: 'high_quality',
      title: 'Высокое качество',
      description: 'Разрешение до 1200 dpi для идеальной детализации'
    },
    {
      icon: 'speed',
      title: 'Быстрое выполнение',
      description: 'Готовые файлы в течение часа'
    },
    {
      icon: 'settings',
      title: 'Профессиональное оборудование',
      description: 'Современные планетарные и протяжные сканеры'
    },
    {
      icon: 'palette',
      title: 'Цветокоррекция',
      description: 'Профессиональная калибровка цветов'
    },
    {
      icon: 'security',
      title: 'Конфиденциальность',
      description: 'Полная безопасность ваших документов'
    },
    {
      icon: 'cloud',
      title: 'Облачное хранение',
      description: 'Бесплатное хранение файлов 30 дней'
    }
  ];

  // File formats
  supportedFormats = [
    'PDF (многостраничный)',
    'JPG (максимальное качество)',
    'PNG (с прозрачностью)',
    'TIFF (архивное качество)',
    'BMP (без сжатия)',
    'Пользовательский формат'
  ];

  // FAQ items
  faqItems = [
    {
      question: 'Какое максимальное разрешение сканирования?',
      answer: 'Мы можем сканировать с разрешением до 1200 dpi для фотографий и до 600 dpi для документов. Этого достаточно для получения архивного качества.'
    },
    {
      question: 'Можно ли сканировать старые и хрупкие документы?',
      answer: 'Да, у нас есть планетарный сканер, который позволяет сканировать хрупкие документы без их повреждения. Документы не прижимаются к стеклу.'
    },
    {
      question: 'В каких форматах вы сохраняете файлы?',
      answer: 'Мы сохраняем в любых популярных форматах: PDF, JPG, PNG, TIFF, BMP. Можем создать многостраничные PDF с возможностью поиска по тексту.'
    },
    {
      question: 'Сколько времени занимает сканирование?',
      answer: 'Обычные документы сканируем за 15-30 минут. Большие объемы или специальные материалы могут потребовать до 2-3 часов.'
    },
    {
      question: 'Можете ли вы улучшить качество старых документов?',
      answer: 'Да, мы применяем цифровую обработку: убираем пятна, корректируем контраст и яркость, выравниваем наклон страниц.'
    },
    {
      question: 'Как получить готовые файлы?',
      answer: 'Файлы можно получить на флешке, записать на диск, отправить по email или загрузить из облачного хранилища. Выбирайте удобный способ!'
    }
  ];

  // Testimonials data
  testimonials = [
    {
      id: 1,
      name: 'Мария Козлова',
      text: 'Отсканировали семейный архив фотографий. Качество потрясающее! Старые снимки как будто ожили.',
      rating: 5,
      date: '2024-11-15',
      avatar: '/assets/images/testimonials/maria-k.jpg'
    },
    {
      id: 2,
      name: 'Сергей Волков',
      text: 'Нужно было срочно отсканировать документы для суда. Сделали за полчаса, все четко и в нужном формате.',
      rating: 5,
      date: '2024-11-10',
      avatar: '/assets/images/testimonials/sergey-v.jpg'
    },
    {
      id: 3,
      name: 'Анна Белова',
      text: 'Сканировали диплом и аттестат для работы. Очень высокое качество, все печати видны отлично.',
      rating: 5,
      date: '2024-11-05',
      avatar: '/assets/images/testimonials/anna-b.jpg'
    }
  ];

  // Structured data for SEO
  structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Сканирование документов',
    description: 'Профессиональное сканирование документов и фотографий в Ростове-на-Дону',
    provider: {
      '@type': 'LocalBusiness',
      name: 'Своё Фото',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Ростов-на-Дону',
        addressCountry: 'RU'
      }
    },
    areaServed: 'Ростов-на-Дону',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Услуги сканирования',
      itemListElement: [
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Сканирование документов А4'
          }
        }
      ]
    }
  };

  ngOnInit(): void {
    this.setupSEO();
  }  private setupSEO(): void {
    const title = 'Сканирование документов в Ростове-на-Дону | Цифровая копия высокого качества - Своё Фото';
    const description = 'Сканирование документов в Ростове-на-Дону. Цифровая копия с высоким разрешением за считанные минуты. Записаться онлайн, легко!';
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    this.seoService.setOpenGraph(title, description);
  }

  // Navigation methods
  scrollToServices() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('services');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  scrollToContacts() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('contacts');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  callPhone() {
    if (isPlatformBrowser(this.platformId)) {
      const phoneLink = this.contacts.links.find(link => link.icon === 'call');
      if (phoneLink) {
        window.location.href = phoneLink.href;
      }
    }
  }
}
