import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { SeoService } from '../../../../core/services/seo.service';
import {
  ADDRESSES,
  ADDRESS_INFO,
  STUDIO_PHONE,
  STUDIO_PHONE_HREF,
} from '../../../../core/data/address.data';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';
import { TrackClickDirective } from '../../../../shared/directives/track-click.directive';
import { DocumentPrintOrderWidgetComponent } from '../pechat-dokumentov/components/document-print-order-widget/document-print-order-widget.component';
import { PEREPLET_NA_PLASTIKOVUYU_PRUZHINU } from '../data/print-polygraphy.data';

interface BindingTile {
  readonly icon: string;
  readonly label: string;
  readonly value: string;
  readonly note: string;
}

interface BindingUseCase {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

@Component({
  selector: 'app-pereplet-na-plastikovuyu-pruzhinu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    RouterLink,
    ScrollRevealDirective,
    TrackClickDirective,
    DocumentPrintOrderWidgetComponent,
  ],
  templateUrl: './pereplet-na-plastikovuyu-pruzhinu.component.html',
  styleUrl: './pereplet-na-plastikovuyu-pruzhinu.component.scss',
})
export class PerepletNaPlastikovuyuPruzhinuComponent implements OnInit {
  private readonly seo = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  protected readonly page = PEREPLET_NA_PLASTIKOVUYU_PRUZHINU;
  protected readonly studioPhone = STUDIO_PHONE;
  protected readonly studioPhoneHref = STUDIO_PHONE_HREF;

  protected readonly priceTiles: readonly BindingTile[] = [
    {
      icon: 'print',
      label: 'Учебная печать',
      value: '3 ₽',
      note: 'страница А4 ч/б после подтверждения статуса',
    },
    {
      icon: 'school',
      label: 'Переплёт',
      value: '10 ₽',
      note: 'один переплёт на пластиковую пружину',
    },
    {
      icon: 'payments',
      label: 'Обычная цена',
      value: 'от 100 ₽',
      note: 'без образовательного доступа',
    },
    {
      icon: 'schedule',
      label: 'Срок',
      value: 'около 10 минут',
      note: 'если документ готов к печати',
    },
  ];

  protected readonly useCases: readonly BindingUseCase[] = [
    {
      icon: 'assignment',
      title: 'Курсовые и рефераты',
      description: 'Распечатаем комплект А4 и соберём его на пластиковую пружину.',
    },
    {
      icon: 'work_history',
      title: 'Отчёты по практике',
      description: 'Удобно, когда нужно быстро сдать аккуратно оформленный отчёт.',
    },
    {
      icon: 'menu_book',
      title: 'Методички и материалы',
      description: 'Подходит для конспектов, инструкций, рабочих тетрадей и учебных подборок.',
    },
    {
      icon: 'school',
      title: 'ВКР и дипломные работы',
      description: 'Делаем пластиковую пружину, если такой вид оформления принимает ваш вуз.',
    },
  ];

  protected readonly educationPrices: readonly BindingTile[] = [
    {
      icon: 'format_align_left',
      label: 'Ч/б А4',
      value: '3 ₽',
      note: 'текстовые листы с заливкой до 15%',
    },
    {
      icon: 'looks_one',
      label: 'Переплёт',
      value: '10 ₽',
      note: 'один переплёт на пластиковую пружину за период доступа',
    },
    {
      icon: 'palette',
      label: 'Цветной А4',
      value: '4 ₽',
      note: 'цветной текст, таблицы и схемы до 15% заливки',
    },
    {
      icon: 'image',
      label: 'Плотная заливка',
      value: '8/12/18 ₽',
      note: 'для страниц с большим количеством графики',
    },
  ];

  ngOnInit(): void {
    this.setupSeo();
  }

  protected scrollToContacts(event: Event): void {
    this.scrollToPageSection(event, 'binding-order');
  }

  protected scrollToEducation(event: Event): void {
    this.scrollToPageSection(event, 'education-binding');
  }

  private scrollToPageSection(event: Event, targetId: string): void {
    event.preventDefault();
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const windowRef = this.document.defaultView;
    const target = this.document.getElementById(targetId);
    const scrollHost = this.document.querySelector('mat-sidenav-content');

    if (!windowRef || !target) {
      return;
    }

    if (scrollHost instanceof windowRef.HTMLElement) {
      const hostRect = scrollHost.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offset = windowRef.innerWidth <= 720 ? 116 : 132;
      const top = scrollHost.scrollTop + targetRect.top - hostRect.top - offset;

      scrollHost.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const nextUrl = `${windowRef.location.pathname}${windowRef.location.search}#${targetId}`;
    windowRef.history.replaceState(null, '', nextUrl);
  }

  private setupSeo(): void {
    const absoluteUrl = `https://svoefoto.ru${this.page.canonicalUrl}`;
    const imageUrl = `https://svoefoto.ru${this.page.heroImage ?? '/assets/static/education-smart/card-binding.webp'}`;

    this.seo.clearJsonLd();
    this.seo.updateCanonicalUrl(this.page.canonicalUrl);
    this.seo.updateTitle(this.page.metaTitle);
    this.seo.updateDescription(this.page.metaDescription);
    this.seo.setOpenGraph(
      this.page.metaTitle,
      this.page.metaDescription,
      imageUrl,
      'website',
      absoluteUrl,
    );

    this.seo.addJsonLd([
      {
        '@context': 'https://schema.org',
        '@type': 'Service',
        '@id': `${absoluteUrl}#service`,
        name: this.page.title,
        serviceType: this.page.serviceType,
        description: this.page.metaDescription,
        image: imageUrl,
        areaServed: {
          '@type': 'City',
          name: 'Ростов-на-Дону',
        },
        provider: {
          '@type': 'LocalBusiness',
          name: 'Своё Фото',
          telephone: ADDRESS_INFO.phone,
          address: {
            '@type': 'PostalAddress',
            addressLocality: 'Ростов-на-Дону',
            streetAddress: ADDRESSES[0].address,
          },
        },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'RUB',
          price: this.page.price,
          availability: 'https://schema.org/InStock',
          url: absoluteUrl,
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://svoefoto.ru/' },
          { '@type': 'ListItem', position: 2, name: 'Услуги', item: 'https://svoefoto.ru/services' },
          { '@type': 'ListItem', position: 3, name: this.page.title, item: absoluteUrl },
        ],
      },
    ]);
    this.seo.setFAQPageJsonLd(this.page.faqItems);
  }
}
