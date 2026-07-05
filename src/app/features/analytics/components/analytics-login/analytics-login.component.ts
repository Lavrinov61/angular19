import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { checkAnalyticsKey, saveAnalyticsKey } from '../../guards/analytics.guard';

@Component({
  selector: 'app-analytics-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <mat-icon mat-card-avatar class="header-icon">analytics</mat-icon>
          <mat-card-title>Аналитика</mat-card-title>
          <mat-card-subtitle>Введите ключ доступа</mat-card-subtitle>
        </mat-card-header>
        
        <mat-card-content>
          <form (ngSubmit)="onSubmit()" class="login-form">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Ключ доступа</mat-label>
              <input 
                matInput 
                [type]="hidePassword() ? 'password' : 'text'"
                [(ngModel)]="accessKey"
                name="accessKey"
                placeholder="Введите секретный ключ"
                autocomplete="off"
              />
              <button 
                mat-icon-button 
                matSuffix 
                type="button"
                (click)="togglePassword()"
              >
                <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </mat-form-field>
            
            @if (error()) {
              <div class="error-message">
                <mat-icon>error</mat-icon>
                <span>{{ error() }}</span>
              </div>
            }
            
            <button 
              mat-raised-button 
              color="primary" 
              type="submit"
              class="full-width submit-btn"
              [disabled]="loading()"
            >
              <ng-container>
                @if (loading()) {
                  <mat-spinner diameter="20" />
                } @else {
                  <mat-icon>login</mat-icon>
                  Войти
                }
              </ng-container>
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a237e 0%, #0d47a1 50%, #01579b 100%);
      padding: 16px;
    }
    
    .login-card {
      max-width: 400px;
      width: 100%;
      padding: 24px;
    }
    
    .header-icon {
      background: linear-gradient(135deg, #1976d2, #1565c0);
      color: white;
      padding: 8px;
      border-radius: 50%;
      font-size: 24px;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .login-form {
      margin-top: 24px;
    }
    
    .full-width {
      width: 100%;
    }
    
    .submit-btn {
      margin-top: 16px;
      height: 48px;
      font-size: 16px;
    }
    
    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #f44336;
      margin-bottom: 16px;
      padding: 12px;
      background: #ffebee;
      border-radius: 8px;
    }
    
    .error-message mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
  `]
})
export class AnalyticsLoginComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  
  accessKey = '';
  hidePassword = signal(true);
  loading = signal(false);
  error = signal<string | null>(null);
  
  togglePassword(): void {
    this.hidePassword.update(v => !v);
  }
  
  onSubmit(): void {
    if (!this.accessKey.trim()) {
      this.error.set('Введите ключ доступа');
      return;
    }
    
    this.loading.set(true);
    this.error.set(null);
    
    // Проверяем ключ
    setTimeout(() => {
      if (checkAnalyticsKey(this.accessKey)) {
        saveAnalyticsKey(this.accessKey);
        
        // Получаем URL для редиректа
        const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/analytics';
        this.router.navigateByUrl(returnUrl);
      } else {
        this.error.set('Неверный ключ доступа');
        this.loading.set(false);
      }
    }, 500); // Небольшая задержка для UX
  }
}

