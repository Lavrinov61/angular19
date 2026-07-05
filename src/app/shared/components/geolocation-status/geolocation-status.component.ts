import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-geolocation-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, MatButtonModule],
  template: `
    <div class="geolocation-status" [class]="statusClass()">
      @switch (status()) {
        @case ('loading') {
          <div class="status-loading">
            <mat-spinner diameter="20"></mat-spinner>
            <span class="status-text">Получение местоположения...</span>
          </div>
        }
        
        @case ('success') {
          <div class="status-success">
            <mat-icon>location_on</mat-icon>
            <span class="status-text">Местоположение получено</span>
          </div>
        }
        
        @case ('error') {
          <div class="status-error">
            <mat-icon>location_off</mat-icon>
            <span class="status-text">{{ errorMessage() }}</span>
          </div>
        }
        
        @case ('permission-denied') {
          <div class="status-warning">
            <mat-icon>block</mat-icon>
            <span class="status-text">Доступ к местоположению запрещен</span>
          </div>
        }
        
        @case ('not-supported') {
          <div class="status-warning">
            <mat-icon>location_disabled</mat-icon>
            <span class="status-text">Геолокация не поддерживается</span>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .geolocation-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.875rem;
      transition: all 0.3s ease;
    }
    
    .status-loading,
    .status-success,
    .status-error,
    .status-warning {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status-loading {
      color: var(--ed-on-surface-variant, #a0a0a0);
      background: var(--ed-surface-container, #1a1a1a);
    }
    
    .status-success {
      color: var(--ed-on-accent-container, #fef3c7);
      background: var(--ed-accent-container, #451a03);
    }
    
    .status-error,
    .status-warning {
      color: var(--ed-error, #ef4444);
      background: rgba(239, 68, 68, 0.15);
    }
    
    .status-text {
      font-weight: 500;
    }
    
    mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    
    mat-spinner {
      margin: 0;
    }
  `]
})
export class GeolocationStatusComponent {
  status = input<'loading' | 'success' | 'error' | 'permission-denied' | 'not-supported'>('loading');
  errorMessage = input<string>('Ошибка получения местоположения');
  
  protected statusClass = computed(() => `status-${this.status()}`);
}
