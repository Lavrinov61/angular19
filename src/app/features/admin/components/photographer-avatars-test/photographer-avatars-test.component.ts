import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { PhotographerService } from '../../../../core/services/photographer.service';
import { Photographer } from '../../../photograph/models/photographer.model';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-photographer-avatars-test',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule],
  template: `
    <div class="avatars-test-container">
      <h2>Тест аватарок фотографов</h2>
      
      <div class="photographers-grid">
        @for (photographer of photographers(); track photographer.id) {
          <mat-card class="photographer-card">
            <mat-card-header>
              <div mat-card-avatar class="photographer-avatar">
                <img 
                  [src]="photographer.profileImage" 
                  [alt]="photographer.name"
                  (error)="handleImageError($event)"
                  (load)="handleImageLoad($event, photographer.name)">
              </div>
              <mat-card-title>{{ photographer.name }}</mat-card-title>
              <mat-card-subtitle>{{ photographer.title }}</mat-card-subtitle>
            </mat-card-header>
            
            <mat-card-content>
              <div class="image-info">
                <p><strong>ID:</strong> {{ photographer.id }}</p>
                <p><strong>Путь к аватарке:</strong></p>
                <code>{{ photographer.profileImage }}</code>
              </div>
            </mat-card-content>
          </mat-card>
        }
      </div>
    </div>
  `,
  styles: [`
    .avatars-test-container {
      padding: 16px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .photographers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .photographer-card {
      height: fit-content;
    }

    .photographer-avatar img {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--crm-border);
    }

    .image-info {
      margin-top: 12px;
    }

    .image-info code {
      background: var(--crm-surface-raised);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      display: block;
      margin-top: 4px;
      word-break: break-all;
    }

    h2 {
      text-align: center;
      margin-bottom: 24px;
    }
  `]
})
export class PhotographerAvatarsTestComponent {
  private log = inject(LoggerService);
  private photographerService = inject(PhotographerService);
  photographers = signal<Photographer[]>([]);

  constructor() {
    this.photographerService.getAll(true).subscribe(all => {
      this.photographers.set(all);
    });
  }

  handleImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    this.log.error('Ошибка загрузки изображения:', img.src);
    img.src = '/assets/images/default-avatar.jpg'; // Fallback изображение
  }

  handleImageLoad(_event: Event, name: string): void {
    this.log.debug(`Аватарка успешно загружена для: ${name}`);
  }
}
