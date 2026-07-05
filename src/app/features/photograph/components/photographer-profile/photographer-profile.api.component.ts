import { Component, ChangeDetectionStrategy, OnInit, inject } from '@angular/core';

import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { Title } from '@angular/platform-browser';

import { PhotographerService } from '../../../../core/services/photographer.service';
import { Photographer } from '../../models/photographer.model';
import { AttentionSectionComponent } from '../attention-section/attention-section.component';
import { PortfolioGalleryComponent } from '../portfolio-gallery/portfolio-gallery.component';
import { DesireSectionComponent } from '../desire-section/desire-section.component';
import { ActionSectionComponent } from '../action-section/action-section.component';
import { SeoService } from '../../../../core/services/seo.service';
import { QuickActionsComponent } from '../../../../shared/components/quick-actions/quick-actions.component';

@Component({
  selector: 'app-photographer-profile-api',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    AttentionSectionComponent,
    PortfolioGalleryComponent,
    DesireSectionComponent,
    ActionSectionComponent,
    QuickActionsComponent
],
  templateUrl: './photographer-profile.component.html',
  styleUrl: './photographer-profile.component.scss'
})
export class PhotographerProfileApiComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private titleService = inject(Title);
  private seoService = inject(SeoService);
  private photographerService = inject(PhotographerService);

  photographer: Photographer | null = null;
  isLoading = true;
  error: string | null = null;

  ngOnInit(): void {
    this.loadPhotographer();
  }

  private loadPhotographer(): void {
    this.isLoading = true;
    const slug = this.route.snapshot.paramMap.get('slug');

    if (!slug) {
      this.handleError('Некорректный адрес страницы');
      return;
    }

    this.photographerService.getBySlug(slug).subscribe(photographer => {
      if (photographer) {
        this.photographer = photographer;
        this.updateSeoMetadata(photographer);
      } else {
        this.handleError('Фотограф не найден');
      }
      this.isLoading = false;
    });
  }

  private updateSeoMetadata(photographer: Photographer): void {
    this.seoService.setPhotographerPageMeta({
      id: photographer.id || '',
      name: photographer.name,
      specialization: photographer.specialization.map(s => s.name).join(', '),
      description: photographer.uniqueApproach || photographer.metaDescription,
      avatarUrl: photographer.profileImage,
      rating: photographer.rating,
      experience: photographer.experience ? parseInt(photographer.experience, 10) : undefined
    });

    const photographerJsonLd = {
      "@context": "https://schema.org",
      "@type": "Person",
      "name": photographer.name,
      "jobTitle": photographer.title,
      "description": photographer.uniqueApproach || photographer.metaDescription,
      "image": photographer.profileImage,
      "url": `https://svoefoto.ru/photograph/${photographer.slug}`,
      "worksFor": {
        "@type": "LocalBusiness",
        "name": "Своё Фото",
        "url": "https://svoefoto.ru"
      },
      "knowsAbout": photographer.keywords,
      "hasOccupation": {
        "@type": "Occupation",
        "name": "Фотограф",
        "occupationLocation": {
          "@type": "City",
          "name": "Ростов-на-Дону"
        }
      },
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": photographer.rating?.toString(),
        "reviewCount": photographer.reviewsCount?.toString()
      }
    };
    
    this.seoService.addJsonLd(photographerJsonLd);
    
    this.seoService.setBreadcrumbJsonLd([
      { name: 'Главная', url: 'https://svoefoto.ru/' },
      { name: 'Фотографы', url: 'https://svoefoto.ru/photographers' },
      { name: photographer.name, url: `https://svoefoto.ru/photograph/${photographer.slug}` }
    ]);
  }

  private handleError(message: string): void {
    this.error = message;
    this.isLoading = false;
    this.titleService.setTitle('Ошибка загрузки - Своё Фото');
  }

  retry(): void {
    this.loadPhotographer();
  }
}
