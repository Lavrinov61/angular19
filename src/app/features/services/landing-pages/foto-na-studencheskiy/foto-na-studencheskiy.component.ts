import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import {
  DeliveryMethod,
  PricingApiService,
  PricingServiceOption,
} from '../../../../core/services/pricing-api.service';
import { SeoService } from '../../../../core/services/seo.service';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';

interface StudentPhotoFeature {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface StudentPhotoStep {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface StudentPhotoFaq {
  readonly question: string;
  readonly answer: string;
}

const FEATURES: readonly StudentPhotoFeature[] = [
  {
    icon: 'school',
    title: 'Под требования вуза',
    description:
      'Сделаем нужный размер, светлый фон и аккуратную компоновку для студенческого, зачётки или пропуска.',
  },
  {
    icon: 'photo_camera',
    title: 'Несколько кадров на выбор',
    description:
      'Не один случайный снимок. Фотограф помогает с позой, светом и выражением лица.',
  },
  {
    icon: 'brush',
    title: 'Естественная ретушь',
    description:
      'Выравниваем тон, убираем мелкие несовершенства и сохраняем живой, узнаваемый портрет.',
  },
] as const;

const STEPS: readonly StudentPhotoStep[] = [
  {
    icon: 'event_available',
    title: 'Запишитесь или приходите',
    description:
      'Можно выбрать время онлайн или прийти в студию в рабочее время.',
  },
  {
    icon: 'camera_alt',
    title: 'Выберите лучший кадр',
    description: 'Делаем серию дублей и показываем результат до печати.',
  },
  {
    icon: 'tune',
    title: 'Подготовим под документ',
    description:
      'Кадрируем, ставим фон и проверяем размер под требования учебного заведения.',
  },
  {
    icon: 'print',
    title: 'Печатаем комплект',
    description:
      'Вы получаете готовые фото на фотобумаге и при необходимости электронный файл.',
  },
] as const;

const DOCUMENT_TYPES: readonly string[] = [
  'Студенческий билет',
  'Зачётная книжка',
  'Пропуск',
  'Личное дело',
  'Общежитие',
  'Справка и анкета',
] as const;

const FAQS: readonly StudentPhotoFaq[] = [
  {
    question: 'Сколько стоит фото на студенческий?',
    answer:
      'Онлайн-подготовка фото на документы начинается от 700 ₽. Съёмка и печатный комплект в студии, 700 ₽.',
  },
  {
    question: 'Можно сделать без записи?',
    answer:
      'Да. В студию можно прийти без записи в рабочее время. Запись онлайн нужна, если хотите закрепить удобное время.',
  },
  {
    question: 'Подойдёт ли фото для любого вуза?',
    answer:
      'Да, для стандартных требований подойдёт. Если у вуза есть точный размер или особый фон, покажите требования фотографу перед съёмкой.',
  },
  {
    question: 'Делаете ли электронную версию?',
    answer:
      'Да, можем подготовить файл для отправки в деканат, личный кабинет или онлайн-анкету.',
  },
  {
    question: 'Чем это отличается от фото в автомате?',
    answer:
      'Вы выбираете кадр, фотограф настраивает свет, а ретушь делает портрет аккуратным без эффекта фильтра.',
  },
] as const;

@Component({
  selector: 'app-foto-na-studencheskiy',
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    RouterLink,
    ScrollRevealDirective,
  ],
  templateUrl: './foto-na-studencheskiy.component.html',
  styleUrl: './foto-na-studencheskiy.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FotoNaStudencheskiyComponent implements OnInit {
  private readonly pricing = inject(PricingApiService);
  private readonly seo = inject(SeoService);

  protected readonly onlinePrice = computed(() =>
    this.optionPrice('processing-basic', 'electronic', 700),
  );
  protected readonly studioPrice = computed(() =>
    this.optionPrice('photo-student', 'pickup', 700),
  );
  protected readonly features = FEATURES;
  protected readonly steps = STEPS;
  protected readonly documentTypes = DOCUMENT_TYPES;
  protected readonly faqs = FAQS;

  ngOnInit(): void {
    this.pricing.loadCategories();
    this.setupSeo();
  }

  private optionPrice(
    optionSlug: string,
    deliveryMethod: DeliveryMethod,
    fallback: number,
  ): number {
    const option = this.findPhotoDocsOption(optionSlug);
    return option
      ? this.pricing.resolveOptionPrice(option, deliveryMethod)
      : fallback;
  }

  private findPhotoDocsOption(optionSlug: string): PricingServiceOption | null {
    const category = this.pricing.getCategoryBySlug('photo-docs');
    if (!category) {
      return null;
    }

    for (const group of category.optionGroups) {
      const option = group.options.find((item) => item.slug === optionSlug);
      if (option) {
        return option;
      }
    }

    return null;
  }

  private setupSeo(): void {
    const title =
      'Фото на студенческий билет в Ростове-на-Дону | Онлайн от 700 ₽, в студии 700 ₽ | Своё Фото';
    const description =
      'Фото на студенческий билет, зачётку и пропуск: онлайн-подготовка от 700 ₽ или съёмка в студии за 700 ₽. Несколько кадров, светлый фон, естественная ретушь.';

    this.seo.clearJsonLd();
    this.seo.updateCanonicalUrl('/foto-na-studencheskiy');
    this.seo.updateTitle(title);
    this.seo.updateDescription(description);
    this.seo.setOpenGraph(
      title,
      description,
      'https://svoefoto.ru/assets/static/promo/foto-na-studencheskiy.webp',
    );
    this.seo.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Фото на студенческий билет',
      serviceType: 'Фото на документы',
      category: 'Фотоуслуги',
      areaServed: 'Ростов-на-Дону',
      provider: {
        '@type': 'LocalBusiness',
        name: 'Своё Фото',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Ростов-на-Дону',
          addressCountry: 'RU',
        },
      },
      offers: {
        '@type': 'Offer',
        price: 700,
        priceCurrency: 'RUB',
        availability: 'https://schema.org/InStock',
        url: 'https://svoefoto.ru/foto-na-studencheskiy',
      },
    });
    this.seo.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    });
  }
}
