import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';

import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatBadgeModule } from '@angular/material/badge';

import { Photographer } from '../../../../features/photograph/models/photographer.model';
import { PhotographerService } from '../../../../core/services/photographer.service';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-photographers-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatBadgeModule
],
  template: `
    <div class="photographers-container">
      <div class="header">
        <h2>
          <mat-icon>people</mat-icon>
          Фотографы Magnus Studio
        </h2>
        <div class="summary-stats">
          <div class="stat-item">
            <span class="stat-value">{{ photographers().length }}</span>
            <span class="stat-label">Всего фотографов</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ studioPhotographers().length }}</span>
            <span class="stat-label">Работают в студии</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ locationPhotographers().length }}</span>
            <span class="stat-label">Выездные съемки</span>
          </div>
        </div>
      </div>

      <div class="photographers-grid">
        @for (photographer of photographers(); track trackPhotographer($index, photographer)) {
          <div class="photographer-card">
          <mat-card>
            <mat-card-header>
              <div mat-card-avatar class="photographer-avatar">
                <img
                  [src]="photographer.profileImage"
                  [alt]="photographer.name"
                  (error)="handleImageError($event)"
                >
              </div>
              <mat-card-title>{{ photographer.name }}</mat-card-title>
              <mat-card-subtitle>{{ photographer.title }}</mat-card-subtitle>
              <div class="status-indicator" [class]="'status-' + (photographer.isActive ? 'active' : 'inactive')">
                <mat-icon>circle</mat-icon>
              </div>
            </mat-card-header>

            <mat-card-content>
              <div class="photographer-info">
                <div class="info-row">
                  <mat-icon>star</mat-icon>
                  <span>{{ photographer.rating }}/5.0 ({{ photographer.reviewsCount }} отзывов)</span>
                </div>

                <div class="info-row">
                  <mat-icon>schedule</mat-icon>
                  <span>{{ photographer.workingHours || 'Не указано' }}</span>
                </div>

                <div class="info-row">
                  <mat-icon>location_on</mat-icon>
                  <span>{{ photographer.location || 'Не указано' }}</span>
                </div>
              </div>              <div class="availability-chips">
                <div class="chip-container">
                  @if (photographer.studioAvailable) {
                    <mat-chip
                      color="primary">
                      <mat-icon>business</mat-icon>
                      Студия
                    </mat-chip>
                  }
                  @if (photographer.locationAvailable) {
                    <mat-chip
                      color="accent">
                      <mat-icon>location_on</mat-icon>
                      Выезд
                    </mat-chip>
                  }
                </div>
              </div>

              <div class="specializations">
                <h4>Специализации:</h4>
                <div class="specialization-chips">
                  @for (spec of photographer.specialization; track spec.name || spec.id || $index) {
                    <mat-chip>
                      {{ spec.name }}
                    </mat-chip>
                  }
                </div>
              </div>

              <div class="price-range">
                <strong>{{ photographer.rating }}/5 ({{ photographer.reviewsCount }} отзывов)</strong>
              </div>
            </mat-card-content>

            <mat-card-actions align="end">
              <button
                mat-button
                color="primary"
                [routerLink]="['/admin/photographers/schedule']"
                [queryParams]="{ photographer: photographer.id }"
              >
                <mat-icon>schedule</mat-icon>
                Расписание
              </button>

              <button
                mat-button
                [routerLink]="['/photographers', photographer.slug]"
                target="_blank"
              >
                <mat-icon>visibility</mat-icon>
                Просмотр
              </button>

              <button
                mat-raised-button
                color="primary"
                [routerLink]="['/admin/photographers', photographer.id, 'edit']"
              >
                <mat-icon>edit</mat-icon>
                Редактировать
              </button>
            </mat-card-actions>
          </mat-card>
          </div>
        }
      </div>

      @if (photographers().length === 0) {
        <div class="empty-state">
        <mat-icon class="empty-icon">people_outline</mat-icon>
        <h3>Нет активных фотографов</h3>
        <p>Добавьте первого фотографа в систему</p>
        <button mat-raised-button color="primary">
          <mat-icon>add</mat-icon>
          Добавить фотографа
        </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .photographers-container {
      padding: 16px;
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      margin-bottom: 32px;
      gap: 24px;
    }

    .header h2 {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      font-size: 24px;
      font-weight: 500;
    }

    .summary-stats {
      display: flex;
      justify-content: space-around;
      gap: 24px;
    }

    .stat-item {
      text-align: center;
      min-width: 80px;
    }

    .stat-value {
      display: block;
      font-size: 20px;
      font-weight: 600;
      color: var(--crm-accent);
      font-family: var(--crm-font-mono);
    }

    .stat-label {
      display: block;
      font-size: 12px;
      color: var(--crm-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .photographers-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }

    .photographer-card {
      height: 100%;
    }

    .photographer-card mat-card {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .photographer-avatar {
      position: relative;
      overflow: hidden;
    }

    .photographer-avatar img {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 50%;
    }

    .status-indicator {
      position: absolute;
      top: 16px;
      right: 16px;
    }

    .status-indicator mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .status-active mat-icon {
      color: var(--crm-status-success);
    }

    .status-busy mat-icon {
      color: var(--crm-status-warning);
    }

    .status-vacation mat-icon {
      color: var(--crm-status-info);
    }

    .status-inactive mat-icon {
      color: var(--crm-status-error);
    }

    mat-card-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .photographer-info {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .info-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--crm-text-secondary);
    }

    .info-row mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .availability-chips {
      margin: 8px 0;
    }    .availability-chips .chip-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .specializations h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .specialization-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .specialization-chips mat-chip {
      font-size: 11px;
    }

    .specialization-chips mat-chip.popular {
      background: var(--crm-status-info-container);
      color: var(--crm-status-info);
    }

    .price-range {
      margin-top: auto;
      padding-top: 16px;
      text-align: right;
      font-size: 18px;
      color: var(--crm-status-success);
      font-family: var(--crm-font-mono);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 64px;
      text-align: center;
      color: var(--crm-text-secondary);
    }

    .empty-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-state h3 {
      margin: 16px 0 8px 0;
    }

    .empty-state p {
      margin: 0 0 24px 0;
    }

    @media (min-width: 600px) {
      .photographers-container {
        padding: 24px;
      }

      .stat-item {
        min-width: 100px;
      }

      .stat-value {
        font-size: 24px;
      }
    }

    @media (min-width: 840px) {
      .header {
        flex-direction: row;
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .header h2 {
        font-size: 28px;
      }

      .photographers-grid {
        grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      }
    }
  `]
})
export class PhotographersOverviewComponent {
  private log = inject(LoggerService);
  private photographerService = inject(PhotographerService);

  // Signals для реактивных данных
  protected readonly photographers = signal<Photographer[]>([]);
  protected readonly studioPhotographers = signal<Photographer[]>([]);
  protected readonly locationPhotographers = signal<Photographer[]>([]);

  constructor() {
    this.photographerService.getAll(true).subscribe(all => {
      const active = all.filter(p => p.isActive);
      this.photographers.set(active);
      this.studioPhotographers.set(active.filter(p => p.studioAvailable));
      this.locationPhotographers.set(active.filter(p => p.locationAvailable));
      this.log.debug('PhotographersOverviewComponent: Загружено фотографов:', active.length);
    });
  }

  protected trackPhotographer(_index: number, photographer: Photographer): string {
    return photographer.id;
  }

  protected handleImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.src = '/assets/images/default-avatar.png'; // fallback изображение
  }
}
