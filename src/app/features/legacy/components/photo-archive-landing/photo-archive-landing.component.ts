import { Component, inject, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { BasePageComponent } from '../../../../core/models/base-page.component';
import { SeoService } from '../../../../core/services/seo.service';
import { CONTACTS } from '../../../../core/data/contacts.data';
import { STUDIO_PHONE_SCHEMA } from '../../../../core/data/address.data';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-photo-archive-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatSnackBarModule
  ],
  templateUrl: './photo-archive-landing.component.html',
  styleUrl: './photo-archive-landing.component.scss'
})
export class PhotoArchiveLandingComponent extends BasePageComponent implements OnInit {
  override get pageName(): string {
    return 'photo-archive-landing';
  }
  private route = inject(ActivatedRoute);
  private seoService = inject(SeoService);
  private log = inject(LoggerService);

  // Данные для страницы
  photoCode = '';
  contacts = CONTACTS;  override ngOnInit(): void {
    super.ngOnInit();
    
    // Получаем код фотографии из URL параметра
    this.photoCode = this.route.snapshot.paramMap.get('code') || '';
    
    // Если код не найден через paramMap, пробуем получить из URL
    if (!this.photoCode) {
      const url = this.route.snapshot.url.join('/');
      this.log.debug('URL segments:', this.route.snapshot.url);
      this.log.debug('Full URL:', url);
      
      // Проверяем, есть ли ~ в URL
      if (url.includes('~')) {
        this.photoCode = url.replace('~', '');
      }
    }
    
    this.log.debug('Photo code extracted:', this.photoCode);
    
    // Устанавливаем SEO данные
    this.setupSeoData();
  }
  private setupSeoData(): void {
    const title = `Фотография ${this.photoCode} - Архив Своё Фото`;
    const description = `Ваша фотография ${this.photoCode} находится в нашем архиве. Свяжитесь с нами для получения копий через Telegram или МАКС.`;
    
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    
    // Добавляем структурированные данные
    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      'name': title,
      'description': description,
      'provider': {
        '@type': 'Organization',
        'name': 'Своё Фото',
        'telephone': STUDIO_PHONE_SCHEMA,
        'url': 'https://svoe-foto.ru'
      }
    });
  }

  /**
   * Открыть МАКС с предзаполненным сообщением
   */
  openMax(event?: Event): void {
    event?.preventDefault();
    const message = encodeURIComponent(
      `Здравствуйте! Я ищу свои фотографии по коду ${this.photoCode}. Можете ли вы помочь найти их в архиве?`
    );
    const maxUrl = `https://max.ru/id262603741214_bot?text=${message}`;
    window.open(maxUrl, '_blank');
  }

  /**
   * Открыть Telegram с предзаполненным сообщением
   */
  openTelegram(event?: Event): void {
    event?.preventDefault();
    const message = encodeURIComponent(
      `Здравствуйте! Я ищу свои фотографии по коду ${this.photoCode}. Можете ли вы помочь найти их в архиве?`
    );
    const telegramUrl = `${this.contacts.links[1].href}?text=${message}`;
    window.open(telegramUrl, '_blank');
  }

  /**
   * Позвонить в студию
   */
  makeCall(event?: Event): void {
    event?.preventDefault();
    window.open(this.contacts.links[2].href, '_self');
  }

  /**
   * Перейти на главную страницу
   */
  goToHome(): void {
    this.router.navigate(['/']);
  }
}
