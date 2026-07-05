import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { RouterLink } from '@angular/router';
import { NavigationService } from '../../services/navigation.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-mobile-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    RouterLink,
  ],
  template: `
    <mat-toolbar class="mobile-toolbar">
      <button mat-icon-button (click)="openSidenav()" aria-label="Открыть меню">
        <mat-icon>menu</mat-icon>
      </button>
      <span class="toolbar-brand">Своё Фото</span>

      <span class="toolbar-spacer"></span>

      @if (authService.isAuthenticated()) {
        <a mat-icon-button routerLink="/user-profile" aria-label="Профиль">
          <mat-icon>account_circle</mat-icon>
        </a>
      } @else {
        <a mat-icon-button routerLink="/auth/login" aria-label="Войти">
          <mat-icon>login</mat-icon>
        </a>
      }
    </mat-toolbar>
  `,
  styles: [`
    :host {
      display: block;
      @media (min-width: 600px) { display: none; }
    }

    .mobile-toolbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .toolbar-brand {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-transform: uppercase;
      margin-left: 8px;
      color: var(--ed-accent, #f59e0b);
    }

    .toolbar-spacer { flex: 1; }
  `]
})
export class MobileToolbarComponent {
  private navigationService = inject(NavigationService);
  readonly authService = inject(AuthService);

  openSidenav(): void {
    this.navigationService.openSidenav();
  }
}
