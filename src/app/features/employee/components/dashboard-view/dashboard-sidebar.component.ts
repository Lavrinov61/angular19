import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../../core/services/auth.service';
import { DashboardTeamChatComponent } from './dashboard-team-chat.component';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  employee: 'Сотрудник',
  photographer: 'Фотограф',
};

@Component({
  selector: 'app-dashboard-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    DashboardTeamChatComponent,
  ],
  template: `
    <div class="sidebar-layout">
      <!-- Profile quick card -->
      <a routerLink="/employee/my-profile" class="profile-card">
        <div class="profile-avatar">{{ initials() }}</div>
        <div class="profile-info">
          <span class="profile-name">{{ userName() }}</span>
          <span class="profile-role">{{ roleLabel() }}</span>
        </div>
        <mat-icon class="profile-arrow">chevron_right</mat-icon>
      </a>

      <!-- Team Chat — fills remaining height -->
      <div class="team-chat-card">
        <app-dashboard-team-chat />
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .sidebar-layout {
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
    }

    .profile-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 0.15s, box-shadow 0.15s;

      &:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      }
    }

    .profile-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--crm-gradient-accent);
      color: #fff;
      font-weight: 700;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .profile-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .profile-name {
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .profile-role {
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .profile-arrow {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }

    .team-chat-card {
      flex: 1;
      min-height: 0;
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-lg);
      box-shadow: var(--crm-shadow-card);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
    }

    .team-chat-card ::ng-deep app-dashboard-team-chat {
      flex: 1;
      min-height: 0;
      height: auto;
    }
  `],
})
export class DashboardSidebarComponent {
  private readonly auth = inject(AuthService);

  readonly userName = computed(() => {
    const u = this.auth.currentUser();
    return u?.display_name || u?.displayName || 'Сотрудник';
  });

  readonly roleLabel = computed(() => {
    const role = this.auth.currentUser()?.role;
    return role ? (ROLE_LABELS[role] || role) : '';
  });

  readonly initials = computed(() => {
    const name = this.userName();
    const parts = name.split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  });
}
