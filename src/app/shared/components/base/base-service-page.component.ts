import { Component, OnInit, inject, PLATFORM_ID, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../contacts-section/contacts-section.component';
import { ServicesSectionComponent } from '../services-section/services-section.component';
import { TestimonialsComponent } from '../testimonials/testimonials.component';
import { AboutPreviewComponent } from '../about-preview/about-preview.component';

import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESSES } from '../../../core/data/address.data';
import { SERVICES } from '../../../core/data/services.data';
import { ABOUT_DATA } from '../../../core/data/about.data';

export interface ServiceBenefit {
  icon: string;
  title: string;
  description: string;
}

export interface ServiceOption {
  id: string;
  name: string;
  price: number;
  description?: string;
  popular?: boolean;
}

export interface ServiceConfig {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  keywords: string[];
  benefits: ServiceBenefit[];
  options: ServiceOption[];
  technicalSpecs?: string[];
  urgencyBadge?: string;
  priceFrom?: number;
}

export interface AttentionData {
  mainTitle: string;
  subtitle: string;
  promise: string;
  urgencyBadge?: string;
  priceHighlight?: string;
}

export interface InterestData {
  benefits: ServiceBenefit[];
  technicalSpecs?: string[];
}

@Component({
  selector: 'app-base-service-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatTabsModule,
    MatExpansionModule,
    ContactsSectionComponent,
    ServicesSectionComponent,
    TestimonialsComponent,
    AboutPreviewComponent
  ],
  template: `
    <div class="service-page">
      <!-- Hero Section -->
      <section class="hero-section" [class.mobile]="isMobile()">
        <div class="hero-content">
          <div class="hero-text">
            @if (attentionData?.urgencyBadge) {
              <span class="urgency-badge">
                {{ attentionData.urgencyBadge }}
              </span>
            }
            <h1 class="hero-title">{{ attentionData.mainTitle }}</h1>
            <p class="hero-subtitle">{{ attentionData.subtitle }}</p>
            @if (attentionData?.promise) {
              <p class="hero-promise">
                {{ attentionData.promise }}
              </p>
            }
            @if (attentionData?.priceHighlight) {
              <div class="hero-price">
                <span class="price-label">Цена:</span>
                <span class="price-value">{{ attentionData.priceHighlight }}</span>
              </div>
            }
            <div class="hero-actions">
              <button mat-raised-button color="primary" (click)="scrollToBooking()">
                Заказать услугу
              </button>
              <button mat-button (click)="scrollToDetails()">
                Подробнее
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Benefits Section -->
      @if (interestData?.benefits?.length) {
        <section class="benefits-section">
          <div class="section-container">
            <h2 class="section-title">Преимущества нашей услуги</h2>
            <div class="benefits-grid" [class.mobile-grid]="isMobile()">
              @for (benefit of interestData.benefits; track benefit.title || benefit.icon || $index) {
                <mat-card class="benefit-card">
                  <mat-card-content>
                    <div class="benefit-icon">
                      <mat-icon>{{ benefit.icon }}</mat-icon>
                    </div>
                    <h3 class="benefit-title">{{ benefit.title }}</h3>
                    <p class="benefit-description">{{ benefit.description }}</p>
                  </mat-card-content>
                </mat-card>
              }
            </div>
          </div>
        </section>
      }

      <!-- Service Options -->
      @if (serviceOptions().length) {
        <section class="options-section">
          <div class="section-container">
            <h2 class="section-title">Варианты услуг и цены</h2>
            <div class="options-grid">
              @for (option of serviceOptions(); track option.name || $index) {
                <mat-card 
                  class="option-card" 
                  [class.popular]="option.popular"
                  (click)="selectOption(option)">
                  <mat-card-header>
                    <mat-card-title>{{ option.name }}</mat-card-title>
                    @if (option.description) {
                      <mat-card-subtitle>
                        {{ option.description }}
                      </mat-card-subtitle>
                    }
                  </mat-card-header>
                  <mat-card-content>
                    <div class="option-price">
                      <span class="price-value">{{ option.price }} ₽</span>
                    </div>
                  </mat-card-content>
                  <mat-card-actions>
                    <button 
                      mat-button 
                      color="primary"
                      [disabled]="selectedOptions().includes(option)"
                      (click)="selectOption(option); $event.stopPropagation()">
                      {{ selectedOptions().includes(option) ? 'Выбрано' : 'Выбрать' }}
                    </button>
                  </mat-card-actions>
                </mat-card>
              }
            </div>
          </div>
        </section>
      }

      <!-- Technical Specifications -->
      @if (interestData?.technicalSpecs?.length) {
        <section class="specs-section">
          <div class="section-container">
            <h2 class="section-title">Технические характеристики</h2>
            <mat-card class="specs-card">
              <mat-card-content>
                <ul class="specs-list">
                  @for (spec of interestData.technicalSpecs; track spec || $index) {
                    <li>
                      <mat-icon class="spec-icon">check_circle</mat-icon>
                      {{ spec }}
                    </li>
                  }
                </ul>
              </mat-card-content>
            </mat-card>
          </div>
        </section>
      }

      <!-- Price Calculator -->
      @if (selectedOptions().length) {
        <section class="calculator-section">
          <div class="section-container">
            <h2 class="section-title">Расчет стоимости</h2>
            <mat-card class="calculator-card">
              <mat-card-content>
                <div class="selected-options">
                  <h3>Выбранные услуги:</h3>
                  @for (option of selectedOptions(); track option.name || $index) {
                    <div class="selected-option">
                      <span class="option-name">{{ option.name }}</span>
                      <span class="option-price">{{ option.price }} ₽</span>
                      <button mat-icon-button (click)="removeOption(option)">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                  }
                </div>
                <mat-divider></mat-divider>
                <div class="total-price">
                  <span class="total-label">Итого:</span>
                  <span class="total-value">{{ calculatedPrice() }} ₽</span>
                </div>
              <div class="calculator-actions">
                <button mat-raised-button color="primary" (click)="proceedToBooking()">
                  Заказать за {{ calculatedPrice() }} ₽
                </button>
              </div>
            </mat-card-content>
          </mat-card>
        </div>
      </section>
      }

      <!-- Shared Sections -->
      <app-services-section [services]="services"></app-services-section>
      <app-testimonials></app-testimonials>
      <app-about-preview [aboutData]="aboutData"></app-about-preview>
      <app-contacts-section [contacts]="contacts" [addresses]="addresses"></app-contacts-section>
    </div>
  `,
  styleUrls: ['./base-service-page.component.scss']
})
export abstract class BaseServicePageComponent implements OnInit {
  
  // Injected services
  protected seoService = inject(SeoService);
  protected platformId = inject(PLATFORM_ID);
  protected fb = inject(FormBuilder);
  protected snackBar = inject(MatSnackBar);
  
  // Public services for template
  layout = inject(ResponsiveLayoutService);
  
  // Конвертируем Observable в signals для использования в шаблонах
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Shared data
  contacts = CONTACTS;
  addresses = ADDRESSES;
  services = SERVICES;
  aboutData = ABOUT_DATA;

  // Signals for reactive state
  protected isLoading = signal(false);
  serviceOptions = signal<ServiceOption[]>([]);
  selectedOptions = signal<ServiceOption[]>([]);
  protected calculatedPrice = computed(() => 
    this.selectedOptions().reduce((sum, option) => sum + option.price, 0)
  );

  // Abstract properties for subclasses to implement
  abstract attentionData: AttentionData;
  abstract interestData: InterestData;

  // Abstract methods for subclasses to implement
  abstract getServiceConfig(): ServiceConfig;
  abstract loadServiceData(): void;

  ngOnInit(): void {
    this.initializeService();
    this.loadServiceData();
    this.setupSEO();
  }

  private initializeService(): void {
    const config = this.getServiceConfig();
    this.serviceOptions.set(config.options);
  }
  private setupSEO(): void {
    if (isPlatformBrowser(this.platformId)) {
      const config = this.getServiceConfig();      this.seoService.setAllMetaData(
        config.title,
        config.description,
        undefined, // image
        `/services/${config.slug}`, // canonicalPath
        config.keywords.join(', ') // join array to string
      );
    }
  }

  // Service option management
  selectOption(option: ServiceOption): void {
    const current = this.selectedOptions();
    if (!current.includes(option)) {
      this.selectedOptions.set([...current, option]);
      this.showSuccessMessage(`Добавлено: ${option.name}`);
    }
  }

  removeOption(option: ServiceOption): void {
    const current = this.selectedOptions();
    this.selectedOptions.set(current.filter(o => o.id !== option.id));
    this.showSuccessMessage(`Удалено: ${option.name}`);
  }
  // Navigation helpers
  scrollToBooking(): void {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.querySelector('.calculator-section');
      element?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  scrollToDetails(): void {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.querySelector('.benefits-section');
      element?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // Booking process
  proceedToBooking(): void {
    if (this.selectedOptions().length === 0) {
      this.showErrorMessage('Выберите хотя бы одну услугу');
      return;
    }

    this.processOrder();
  }

  protected processOrder(): void {
    this.isLoading.set(true);
    
    // Simulate order processing
    setTimeout(() => {
      this.isLoading.set(false);
      this.showSuccessMessage('Заказ принят! Мы свяжемся с вами в ближайшее время.');
      this.resetForm();
    }, 2000);
  }

  private resetForm(): void {
    this.selectedOptions.set([]);
  }

  // Utility methods
  protected showSuccessMessage(message: string): void {
    this.snackBar.open(message, 'Закрыть', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  protected showErrorMessage(message: string): void {
    this.snackBar.open(message, 'Закрыть', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }
}

