import { Component, OnInit, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TestimonialService } from '../../shared/components/testimonials/testimonial.service';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-testimonials-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    RouterLink,
  ],
  templateUrl: './testimonials-page.component.html',
  styleUrl: './testimonials-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestimonialsPageComponent implements OnInit {
  private seoService = inject(SeoService);
  private testimonialService = inject(TestimonialService);

  protected readonly data = computed(() => this.testimonialService.testimonialSection() ?? this.testimonialService.getTestimonialsSync());
  protected readonly testimonials = computed(() => this.data().testimonials);
  protected readonly platforms = computed(() => this.data().reviewPlatforms.map(p => ({
    name: p.name,
    url: p.url,
    icon: p.icon || 'open_in_new',
  })));

  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly proofCards = [
    {
      icon: 'verified_user',
      value: '100%',
      label: 'живые отзывы',
      description: 'Показываем ссылки на карты, где можно проверить источник.',
    },
    {
      icon: 'block',
      value: '0',
      label: 'заказных отзывов',
      description: 'Не покупаем оценки и не предлагаем скидки за публикацию.',
    },
    {
      icon: 'photo_camera',
      value: `${new Date().getFullYear() - 1999}+`,
      label: 'лет в фотоуслугах',
      description: 'Отзывы приходят после реальных визитов в студию.',
    },
  ];

  ngOnInit(): void {
    this.setupSeo();
  }

  getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }

  private setupSeo(): void {
    const data = this.data();
    const title = 'Отзывы клиентов, Своё Фото, фотостудия в Ростове-на-Дону';
    const description = `Рейтинг ${data.overallRating}/5. Читайте реальные отзывы клиентов фотостудии Своё Фото.`;
    const image = 'https://svoefoto.ru/static/reviews-svoe-foto.jpg';

    this.seoService.setAllMetaData(title, description, image);
    this.seoService.setLocalSeoMeta();

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      'name': 'Своё Фото',
      'url': 'https://svoefoto.ru',
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': String(data.overallRating),
        'reviewCount': String(data.reviewCount),
        'bestRating': '5',
        'worstRating': '1',
      },
      'review': data.testimonials.slice(0, 6).map(t => ({
        '@type': 'Review',
        'author': { '@type': 'Person', 'name': t.author },
        'reviewRating': {
          '@type': 'Rating',
          'ratingValue': String(t.rating),
          'bestRating': '5',
        },
        'reviewBody': t.content,
        ...(t.date ? { 'datePublished': t.date } : {}),
      })),
    });

    this.seoService.setBreadcrumbJsonLd([
      { name: 'Главная', url: 'https://svoefoto.ru/' },
      { name: 'Отзывы', url: 'https://svoefoto.ru/testimonials' },
    ]);
  }
}
