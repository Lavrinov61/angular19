import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { SeoService } from '../../../../core/services/seo.service';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';
import { TestimonialsComponent } from '../../../../shared/components/testimonials/testimonials.component';
import { TeamHeroComponent } from './components/team-hero/team-hero.component';
import { TeamStatsComponent } from './components/team-stats/team-stats.component';
import { OurApproachComponent } from './components/our-approach/our-approach.component';

interface FaqItem {
  question: string;
  answer: string;
}

interface StudioWorkItem {
  icon: string;
  title: string;
  text: string;
  points: readonly string[];
}

@Component({
  selector: 'app-photographer-list',
  imports: [
    RouterLink,
    MatIconModule,
    MatExpansionModule,
    ScrollRevealDirective,
    TestimonialsComponent,
    TeamHeroComponent,
    TeamStatsComponent,
    OurApproachComponent,
  ],
  templateUrl: './photographer-list.component.html',
  styleUrl: './photographer-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotographerListComponent implements OnInit {
  private seoService = inject(SeoService);

  protected readonly studioWorkItems: readonly StudioWorkItem[] = [
    {
      icon: 'badge',
      title: 'Фото на документы',
      text: 'Мастер проверяет требования, ставит свет, помогает выбрать кадр и готовит печать или файл.',
      points: ['требования', 'свет и поза', 'печать'],
    },
    {
      icon: 'assignment_ind',
      title: 'Студийный портрет',
      text: 'Помогаем спокойно собраться перед камерой: поза, выражение, отбор кадра и аккуратная подготовка результата.',
      points: ['кадр', 'отбор', 'ретушь по задаче'],
    },
    {
      icon: 'print',
      title: 'Печать и файл',
      text: 'Подготавливаем готовые отпечатки и цифровые файлы, проверяем размеры и формат перед выдачей.',
      points: ['печать', 'файл', 'выдача'],
    },
  ];

  readonly faqItems: FaqItem[] = [
    {
      question: 'Как записаться на фотосессию?',
      answer: 'Нажмите кнопку «Записаться на съёмку», выберите услугу и удобное время. Мы подтвердим вашу запись в течение часа. Также можно написать нам в Telegram или МАКС.',
    },
    {
      question: 'Кто будет снимать?',
      answer: 'С вами работает мастер студии на смене. Если хотите попасть к конкретному специалисту, напишите об этом в комментарии или в чате, подберём по графику.',
    },
    {
      question: 'Что включено в стоимость фотосессии?',
      answer: 'В стоимость входит съёмка в студии и подготовка результата по выбранной услуге. Печать, файл и ретушь зависят от конкретного заказа.',
    },
    {
      question: 'Сколько фотографий я получу?',
      answer: 'Зависит от услуги: для документов обычно выбирается один готовый кадр, для портретной съёмки количество согласуем заранее.',
    },
  ];

  ngOnInit(): void {
    this.setupSeo();
  }

  private setupSeo(): void {
    const title = 'Фотографы студии Своё Фото, съёмка в Ростове-на-Дону';
    const description = 'Сотрудники студии Своё Фото помогают с фото на документы, портретной съёмкой, печатью и передачей готового файла. Запишитесь онлайн.';
    const image = 'https://svoefoto.ru/assets/static/photographers/team-og.webp';

    this.seoService.setAllMetaData(title, description, image);
    this.seoService.setLocalSeoMeta();

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      'name': 'Фотографы студии Своё Фото',
      'description': 'Сотрудники студии Своё Фото, которые работают со съёмкой, печатью и подготовкой файлов',
      'numberOfItems': this.studioWorkItems.length,
      'itemListElement': this.studioWorkItems.map((item, index) => ({
        '@type': 'ListItem',
        'position': index + 1,
        'item': {
          '@type': 'Service',
          'name': item.title,
          'description': item.text,
          'provider': {
            '@type': 'LocalBusiness',
            'name': 'Своё Фото',
            'url': 'https://svoefoto.ru',
          },
        },
      })),
    });

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': this.faqItems.map(item => ({
        '@type': 'Question',
        'name': item.question,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': item.answer,
        },
      })),
    });

    this.seoService.setBreadcrumbJsonLd([
      { name: 'Главная', url: 'https://svoefoto.ru/' },
      { name: 'Фотографы', url: 'https://svoefoto.ru/photographers' },
    ]);
  }
}
