import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-photographer-profile-minimal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule
  ],
  template: `
    <div class="container">
      <h1>Профиль фотографа (Минимальная версия)</h1>
      <p>Это упрощенная демонстрационная версия профиля фотографа.</p>
      
      <mat-card>
        <mat-card-header>
          <mat-card-title>Виталий Бойко</mat-card-title>
          <mat-card-subtitle>Свадебный и портретный фотограф</mat-card-subtitle>
        </mat-card-header>
        
        <mat-card-content>
          <p>Профессиональный фотограф с опытом более 8 лет.</p>
          <p>Специализация: свадебная фотография, портреты.</p>
        </mat-card-content>
        
        <mat-card-actions>
          <a mat-button routerLink="/photographers">Назад к списку</a>
          <a mat-flat-button color="primary" routerLink="/booking">Забронировать</a>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [`
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
  `]
})
export class PhotographerProfileMinimalComponent {}
