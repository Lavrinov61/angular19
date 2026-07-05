import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavigationService } from '../../services/navigation.service';
import { UserMenuComponent } from '../user-menu/user-menu.component';
import { NotificationMenuComponent } from '../notification-menu/notification-menu.component';

@Component({
  selector: 'app-sidenav-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatListModule,
    MatIconModule,
    MatDividerModule,
    MatButtonModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    UserMenuComponent,
    NotificationMenuComponent,
  ],
  template: `
    <div class="sidenav-wrapper" [class.collapsed]="!expanded()">
      <!-- Header -->
      <div class="sidenav-header">
        @if (expanded()) {
          <span class="brand-name">Своё Фото</span>
        }
        <button
          mat-icon-button
          (click)="onToggle()"
          [attr.aria-label]="toggleAriaLabel()"
          [matTooltip]="!expanded() ? toggleAriaLabel() : ''">
          <mat-icon>{{ toggleIcon() }}</mat-icon>
        </button>
      </div>

      <!-- Main navigation -->
      <mat-nav-list class="nav-main">
        @for (item of navigationService.menuItems(); track item.href) {
          <a mat-list-item
             [routerLink]="item.href"
             routerLinkActive="active-item"
             [routerLinkActiveOptions]="{ exact: item.href === '/' }"
             (click)="onNavItemClick()"
             [matTooltip]="!expanded() ? item.label : ''"
             matTooltipPosition="right">
            <mat-icon matListItemIcon>
              {{ navigationService.isActive(item.href) ? (item.activeIcon || item.icon) : item.icon }}
            </mat-icon>
            @if (expanded()) {
              <span matListItemTitle>{{ item.label }}</span>
            }
            @if (item.badge && item.badge > 0 && expanded()) {
              <span matListItemMeta class="badge">{{ item.badge }}</span>
            }
          </a>
        }
      </mat-nav-list>

      <!-- Cabinet menu (Мой кабинет) -->
      @if (navigationService.cabinetMenuItems().length > 0) {
        <mat-divider />
        @if (expanded()) {
          <div class="section-label">Мой кабинет</div>
        }
        <mat-nav-list class="nav-secondary">
          @for (item of navigationService.cabinetMenuItems(); track item.href) {
            <a mat-list-item
               [routerLink]="item.href"
               routerLinkActive="active-item"
               (click)="onNavItemClick()"
               [matTooltip]="!expanded() ? item.label : ''"
               matTooltipPosition="right">
              <mat-icon matListItemIcon>
                {{ navigationService.isActive(item.href) ? (item.activeIcon || item.icon) : item.icon }}
              </mat-icon>
              @if (expanded()) {
                <span matListItemTitle>{{ item.label }}</span>
              }
            </a>
          }
        </mat-nav-list>
      }

      <!-- Secondary menu (role-specific: admin/employee) -->
      @if (navigationService.secondaryMenuItems().length > 0) {
        <mat-divider />
        <mat-nav-list class="nav-secondary">
          @for (item of navigationService.secondaryMenuItems(); track item.href) {
            <a mat-list-item
               [routerLink]="item.href"
               routerLinkActive="active-item"
               (click)="onNavItemClick()"
               [matTooltip]="!expanded() ? item.label : ''"
               matTooltipPosition="right">
              <mat-icon matListItemIcon>
                {{ navigationService.isActive(item.href) ? (item.activeIcon || item.icon) : item.icon }}
              </mat-icon>
              @if (expanded()) {
                <span matListItemTitle>{{ item.label }}</span>
              }
            </a>
          }
        </mat-nav-list>
      }

      <!-- Spacer -->
      <div class="sidenav-spacer"></div>

      <!-- Bottom actions -->
      <mat-divider />
      <div class="sidenav-actions">
        <app-notification-menu [showLabel]="expanded()" />
      </div>

      <!-- User section -->
      <mat-divider />
      <div class="sidenav-user">
        <app-user-menu [showLabel]="expanded()" />
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .sidenav-wrapper {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .sidenav-header {
      display: flex;
      align-items: center;
      padding: 12px;
      min-height: 56px;
      gap: 8px;
    }

    .brand-name {
      flex: 1;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-transform: uppercase;
      color: var(--ed-accent, #f59e0b);
      padding-left: 8px;
      white-space: nowrap;
      overflow: hidden;
    }

    .nav-main, .nav-secondary {
      padding: 4px 8px;
    }

    .section-label {
      padding: 12px 20px 4px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--ed-on-surface-muted, #666666);
    }

    /* Collapsed mode: center icons, hide text via host class */
    .collapsed .sidenav-header {
      justify-content: center;
      padding: 12px 8px;
    }

    .collapsed .nav-main,
    .collapsed .nav-secondary {
      padding: 4px;
    }

    .collapsed .sidenav-actions,
    .collapsed .sidenav-user {
      padding: 8px 4px;
      align-items: center;
    }

    .sidenav-spacer {
      flex: 1;
    }

    .sidenav-actions {
      display: flex;
      flex-direction: column;
      padding: 8px 12px;
      gap: 4px;
    }

    .sidenav-user {
      padding: 8px 12px;
    }

    .badge {
      background: var(--ed-error, #ef4444);
      color: var(--ed-on-error, #fff);
      border-radius: 12px;
      padding: 0 6px;
      min-width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 500;
    }

    /* Hover, subtle amber tint */
    :host ::ng-deep a[mat-list-item]:hover {
      background: rgba(245, 158, 11, 0.05);
      border-radius: 28px;
    }

    /* Active item indicator, editorial accent */
    :host ::ng-deep .active-item .mdc-list-item__primary-text {
      color: var(--ed-accent, #f59e0b);
    }
    :host ::ng-deep .active-item .mat-mdc-list-item-icon {
      color: var(--ed-accent, #f59e0b);
    }
    :host ::ng-deep .active-item {
      --mat-list-list-item-leading-icon-color: var(--ed-accent, #f59e0b);
      background: rgba(245, 158, 11, 0.1);
      border-radius: 28px;
    }
  `]
})
export class SidenavContentComponent {
  protected navigationService = inject(NavigationService);

  protected expanded = this.navigationService.sidenavExpanded;

  protected toggleIcon = computed(() => {
    if (this.navigationService.isMobile()) return 'close';
    return this.expanded() ? 'menu_open' : 'menu';
  });

  protected toggleAriaLabel = computed(() => {
    if (this.navigationService.isMobile()) return 'Закрыть меню';
    return this.expanded() ? 'Свернуть меню' : 'Развернуть меню';
  });

  onToggle(): void {
    if (this.navigationService.isMobile()) {
      this.navigationService.closeSidenav();
    } else {
      this.navigationService.toggleExpanded();
    }
  }

  onNavItemClick(): void {
    if (this.navigationService.isMobile()) {
      this.navigationService.closeSidenav();
    }
  }
}
