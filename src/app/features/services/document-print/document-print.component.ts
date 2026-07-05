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
  selector: 'app-document-print',
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
  templateUrl: './document-print.component.html',
  styleUrls: ['./document-print.component.scss']
})
export class DocumentPrintComponent implements OnInit {
  
  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  layout = inject(ResponsiveLayoutService);

  constructor() {
    this.seoService.updateCanonicalUrl('/document-print');
  }

  // Data
  contacts = CONTACTS;
  addresses = ADDRESSES;

  // Responsive signals (конвертированы из Observable)
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Basic properties for template
  price = 5; // цена за лист

  // Print services for template
  printServices = [
    {
      icon: 'description',
      title: 'Документы А4',
      description: 'Печать текстовых документов, справок, договоров',
      specifications: [
        { label: 'Формат', value: 'А4' },
        { label: 'Качество', value: '600 dpi' },
        { label: 'Цвет', value: 'Ч/Б или цветная' }
      ],
      priceBlackWhite: 5,
      priceColor: 15
    },
    {
      icon: 'photo',
      title: 'Фотографии',
      description: 'Печать фотографий любого размера',
      specifications: [
        { label: 'Размеры', value: '10×15, 13×18, А4' },
        { label: 'Бумага', value: 'Фотобумага' },
        { label: 'Качество', value: 'Premium' }
      ],
      priceBlackWhite: 20,
      priceColor: 30
    },
    {
      icon: 'picture_as_pdf',
      title: 'PDF файлы',
      description: 'Печать любых PDF документов',
      specifications: [
        { label: 'Формат', value: 'А4, А3' },
        { label: 'Качество', value: 'Высокое' },
        { label: 'Переплет', value: 'По желанию' }
      ],
      priceBlackWhite: 7,
      priceColor: 20
    },
    {
      icon: 'article',
      title: 'Презентации',
      description: 'Печать презентаций и буклетов',
      specifications: [
        { label: 'Формат', value: 'А4, А3' },
        { label: 'Бумага', value: 'Глянцевая/матовая' },
        { label: 'Переплет', value: 'Спираль, скоба' }
      ],
      priceBlackWhite: 10,
      priceColor: 25
    },
    {
      icon: 'book',
      title: 'Брошюровка',
      description: 'Сшивание и переплет документов',
      specifications: [
        { label: 'Типы', value: 'Спираль, термо' },
        { label: 'Обложка', value: 'Пластик, картон' },
        { label: 'Объем', value: 'До 300 страниц' }
      ],
      priceBlackWhite: 50,
      priceColor: 80
    },
    {
      icon: 'content_copy',
      title: 'Ксерокопия',
      description: 'Копирование документов любого формата',
      specifications: [
        { label: 'Формат', value: 'А4, А3, А5' },
        { label: 'Качество', value: 'Четкое' },
        { label: 'Количество', value: 'Любое' }
      ],
      priceBlackWhite: 3,
      priceColor: 12
    }
  ];

  // Process steps
  processSteps = [
    {
      title: 'Прием файлов',
      description: 'Принимаем файлы на флешке, по email или из облака',
      icon: 'upload_file'
    },
    {
      title: 'Проверка качества',
      description: 'Проверяем файлы на качество и готовность к печати',
      icon: 'check_circle'
    },
    {
      title: 'Настройка печати',
      description: 'Настраиваем параметры печати под ваши требования',
      icon: 'settings'
    },
    {
      title: 'Печать',
      description: 'Печатаем на профессиональном оборудовании',
      icon: 'print'
    },
    {
      title: 'Контроль качества',
      description: 'Проверяем каждый лист на качество печати',
      icon: 'verified'
    },
    {
      title: 'Выдача',
      description: 'Готовые документы через 10-15 минут',
      icon: 'done_all'
    }
  ];

  // Advantages
  advantages = [
    {
      icon: 'flash_on',
      title: 'Быстро',
      description: 'Печать за 10-15 минут'
    },
    {
      icon: 'high_quality',
      title: 'Высокое качество',
      description: 'Профессиональные принтеры'
    },
    {
      icon: 'attach_money',
      title: 'Низкие цены',
      description: 'От 3 рублей за лист'
    },
    {
      icon: 'palette',
      title: 'Цветная печать',
      description: 'Яркие насыщенные цвета'
    },
    {
      icon: 'book',
      title: 'Переплет',
      description: 'Любые виды переплета'
    },
    {
      icon: 'schedule',
      title: 'Без очередей',
      description: 'Запись на удобное время'
    }
  ];

  // File formats
  supportedFormats = [
    'PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 
    'JPG', 'PNG', 'TIFF', 'BMP', 'TXT', 'RTF'
  ];

  // Testimonials
  testimonials = [
    {
      name: 'Анна Петрова',
      text: 'Срочно нужно было распечатать документы для сделки. Все сделали за 10 минут, качество отличное!',
      rating: 5,
      date: '2024-12-15',
      avatar: '/assets/images/testimonials/anna-p.jpg'
    },
    {
      name: 'Михаил Сидоров',
      text: 'Печатаю здесь презентации для работы. Цены приятные, качество на высоте.',
      rating: 5,
      date: '2024-12-10',
      avatar: '/assets/images/testimonials/mikhail-s.jpg'
    },
    {
      name: 'Елена Васильева',
      text: 'Нужно было срочно сделать переплет диплома. Сделали быстро и аккуратно, спасибо!',
      rating: 5,
      date: '2024-12-05',
      avatar: '/assets/images/testimonials/elena-v.jpg'
    }
  ];

  // FAQ
  faqItems = [
    {
      question: 'Какие форматы файлов вы принимаете?',
      answer: 'Мы принимаем все популярные форматы: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, PNG и многие другие. Если у вас нестандартный формат - обратитесь к нам, найдем решение.'
    },
    {
      question: 'Как быстро выполняется печать?',
      answer: 'Обычная печать документов выполняется за 10-15 минут. Большие объемы или сложные работы с переплетом могут занять от 30 минут до нескольких часов.'
    },
    {
      question: 'Можно ли получить скидку при больших объемах?',
      answer: 'Да, при печати от 100 листов действует скидка 10%, от 500 листов - 15%, от 1000 листов - 20%. Также действуют корпоративные скидки.'
    },
    {
      question: 'Какие способы оплаты доступны?',
      answer: 'Принимаем наличные, банковские карты, переводы по QR-коду. Для юридических лиц возможна оплата по счету с НДС.'
    },
    {
      question: 'Делаете ли переплет документов?',
      answer: 'Да, выполняем все виды переплета: пластиковая пружина, металлическая спираль, термопереплет, прошивка нитками. Также есть различные обложки.'
    },
    {
      question: 'Можно ли отправить файлы по email?',
      answer: 'Конечно! Отправляйте файлы на наш email, указывайте требования к печати и свои контакты. Мы свяжемся с вами для уточнения деталей.'
    }
  ];

  ngOnInit(): void {
    this.setupSEO();
  }
  private setupSEO(): void {
    const title = 'Печать документов в Ростове-на-Дону | Быстро и качественно - Своё Фото';
    const description = 'Печать документов в Ростове-на-Дону. Быстро и качественно распечатаем ваши файлы. Записаться онлайн, удобно!';
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    this.seoService.setOpenGraph(title, description);

    // Add structured data
    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Печать документов',
      description: 'Профессиональная печать документов, фотографий, презентаций с переплетом',
      provider: {
        '@type': 'Organization',
        name: 'Своё Фото',
        url: 'https://svoefoto.ru'
      },
      areaServed: 'Ростов-на-Дону',
      offers: {
        '@type': 'Offer',
        price: '5',
        priceCurrency: 'RUB',
        description: 'Черно-белая печать А4'
      },      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '5.0',
        reviewCount: '127'
      },
      serviceType: 'Печать документов',
      hoursAvailable: {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '09:00',
        closes: '18:00'
      }
    });
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
