import { Component, input, inject, output, computed, ChangeDetectionStrategy } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatRippleModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AuthService, UserProfile } from '../../services/auth.service';

@Component({
  selector: 'app-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatRippleModule,
    MatTooltipModule,
    RouterLink
],  template: `    <div class="user-menu-container" [class.clickable]="showLabel()">
      <!-- For authenticated users - button with menu -->
      @if (isAuthenticated()) {
        <div 
          #menuTrigger="matMenuTrigger"
          [matMenuTriggerFor]="userMenu"
          class="user-menu-wrapper"
          [matTooltip]="!showLabel() ? 'Профиль' : ''"
          matTooltipPosition="above"
          aria-label="Меню пользователя"
          aria-haspopup="menu">
          <button mat-icon-button class="user-menu-button">
            @if (userPhoto()) {
              <img [src]="userPhoto()" alt="Фото пользователя" class="user-avatar">
            } @else {
              <mat-icon>account_circle</mat-icon>
            }
          </button>
          
          @if (showLabel()) {
            <span class="user-menu-label">
              {{ userName() || 'Профиль' }}
            </span>
          }
        </div>
      }
      
      <!-- For non-authenticated users - login button without menu -->
      @if (!isAuthenticated()) {
        <div
          class="user-menu-wrapper login-button"
          [matTooltip]="!showLabel() ? 'Войти' : ''"
          matTooltipPosition="above"
          aria-label="Войти"
          (click)="navigateToLogin()"
          (keydown.enter)="navigateToLogin()"
          tabindex="0">
          <button mat-icon-button class="user-menu-button">
            <mat-icon>account_circle</mat-icon>
          </button>
          
          @if (showLabel()) {
            <span class="user-menu-label">
              Войти
            </span>
          }
        </div>
      }
    </div>

    <!-- Menu only for authenticated users -->
    <mat-menu #userMenu="matMenu" class="user-menu" [hasBackdrop]="true" xPosition="before">
      @if (isAuthenticated()) {
        <div class="user-info" [attr.aria-hidden]="true">
          <div class="user-avatar-container">
            @if (userPhoto()) {
              <img [src]="userPhoto()" alt="Фото пользователя" class="user-avatar-menu">
            } @else {
              <mat-icon class="user-icon-large">account_circle</mat-icon>
            }
          </div>        
          <div class="user-details">
            <div class="user-name">{{ userName() || 'Пользователь' }}</div>
            <div class="user-email">{{ userEmail() || '' }}</div>
            @if (userRole()) {
              <div class="user-role">
                <span class="role-badge" [class]="userRole()">
                  {{ getRoleName(userRole()) }}
                </span>
              </div>
            }
          </div>
        </div>
      }
      
      @if (!isAuthenticated()) {
        <div class="guest-info" [attr.aria-hidden]="true">
          <mat-icon class="user-icon-large">account_circle</mat-icon>
          <div class="user-details">
            <div class="user-name">Гость</div>
            <div class="user-message">Войдите, чтобы получить доступ к персональным функциям</div>
          </div>
        </div>
      }
      
      <mat-divider />
      
      <!-- Для авторизованных пользователей -->
      @if (isAuthenticated()) {
        <button mat-menu-item routerLink="/user-profile" [attr.aria-label]="'Перейти в мой профиль'">
          <mat-icon>person</mat-icon>
          <span>Мой профиль</span>
        </button>
        
        <button mat-menu-item routerLink="/user-profile/bookings" [attr.aria-label]="'Перейти к моим записям'">
          <mat-icon>calendar_today</mat-icon>
          <span>Мои записи</span>
        </button>

        <button mat-menu-item routerLink="/user-profile/orders" [attr.aria-label]="'Перейти к заказам'">
          <mat-icon>history</mat-icon>
          <span>Заказы</span>
        </button>

        <button mat-menu-item routerLink="/user-profile/approvals" [attr.aria-label]="'Перейти к согласованию фотографий'">
          <mat-icon>photo_library</mat-icon>
          <span>Согласование фото</span>
        </button>
        
        @if (hasPendingApprovals()) {
          <button mat-menu-item routerLink="/user-profile/confirmation-required" 
                  [attr.aria-label]="'Перейти к элементам, требующим подтверждения' + (pendingApprovalsCount() > 0 ? ', ' + pendingApprovalsCount() + ' элементов' : '')">
            <mat-icon>approval</mat-icon>
            <span>Требуется подтверждение</span>
            @if (pendingApprovalsCount() > 0) {
              <span class="menu-badge">{{ pendingApprovalsCount() }}</span>
            }
          </button>
        }
        
        <!-- Админ панель (только для админов) -->
        @if (userRole() === 'admin') {
          <button mat-menu-item routerLink="/admin" [attr.aria-label]="'Перейти в админ-панель'">
            <mat-icon>admin_panel_settings</mat-icon>
            <span>Админ-панель</span>
          </button>
        }
        
        <!-- Панель сотрудника (только для сотрудников) -->
        @if (userRole() === 'employee') {
          <button mat-menu-item routerLink="/employee" [attr.aria-label]="'Перейти в панель сотрудника'">
            <mat-icon>badge</mat-icon>
            <span>Панель сотрудника</span>
          </button>
        }
        
        <mat-divider />
        
        <button mat-menu-item routerLink="/user-profile" [attr.aria-label]="'Перейти к настройкам профиля'">
          <mat-icon>settings</mat-icon>
          <span>Настройки</span>
        </button>
        
        <button mat-menu-item routerLink="/help" [attr.aria-label]="'Перейти в раздел помощи'">
          <mat-icon>help</mat-icon>
          <span>Помощь</span>
        </button>
        
        <mat-divider />
        
        <button mat-menu-item class="logout-item" (click)="logout()" [attr.aria-label]="'Выйти из системы'">
          <mat-icon>logout</mat-icon>
          <span>Выйти</span>
        </button>
      }
      
      <!-- Для гостей -->
      @if (!isAuthenticated()) {
        <button mat-menu-item routerLink="/auth/login" [attr.aria-label]="'Войти в систему'">
          <mat-icon>login</mat-icon>
          <span>Войти</span>
        </button>
        
        <button mat-menu-item routerLink="/help" [attr.aria-label]="'Перейти в раздел помощи'">
          <mat-icon>help</mat-icon>
          <span>Помощь</span>
        </button>
      }
    </mat-menu>
  `,
  styleUrl: './user-menu.component.scss'
})
export class UserMenuComponent {
  showLabel = input<boolean>(false);
  logoutRequested = output<void>();
  
  private authService = inject(AuthService);
  private router = inject(Router);
  
  protected isAuthenticated = computed(() => !!this.authService.user());
  
  // Извлечение свойств пользователя с проверкой на существование
  userProfile = computed<UserProfile | null>(() => this.authService.profile() || null);
  protected userName = computed(() => this.userProfile()?.displayName || '');
  protected userEmail = computed(() => this.userProfile()?.email || '');  protected userPhoto = computed(() => this.userProfile()?.photoURL || '');
  protected userRole = computed(() => this.userProfile()?.role || null);
  
  // Проверка на ожидающие подтверждения
  protected hasPendingApprovals = computed(() => !!(this.userProfile()?.pendingApprovals));
  protected pendingApprovalsCount = computed(() => this.userProfile()?.pendingApprovals || 0);
  
  // Навигация к странице входа для неавторизованных пользователей
  navigateToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
  
  getRoleName(role: string | undefined | null): string {
    switch(role) {
      case 'admin': return 'Администратор';
      case 'employee': return 'Сотрудник';
      case 'client': return 'Клиент';
      default: return 'Пользователь';
    }
  }
    async logout(): Promise<void> {
    try {
      await this.authService.signOut();
      this.logoutRequested.emit(); // Генерируем событие для обновления меню
      // Навигация на главную страницу после выхода
      this.router.navigate(['/'], { 
        queryParams: { 'auth_state': 'logged_out' },
        replaceUrl: true 
      });
    } catch {
      // logout error, ignore
    }
  }
}
