import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PartnerApiService, PartnerProfile } from '../services/partner-api.service';

@Component({
  selector: 'app-partner-dashboard-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
<div class="pd-root">

  <!-- Sidebar -->
  <aside class="pd-sidebar">
    <div class="pd-logo">
      <a routerLink="/" class="pd-logo-link">← Своё Фото</a>
      <div class="pd-logo-title">Кабинет партнёра</div>
    </div>

    @if (partner()) {
      <div class="pd-profile">
        <div class="pd-avatar">{{ initials() }}</div>
        <div>
          <div class="pd-profile-name">{{ partner()!.name }}</div>
          <div class="pd-profile-badge" [class]="'pd-badge--' + partner()!.status">
            {{ statusLabel(partner()!.status) }}
          </div>
        </div>
      </div>
    }

    <nav class="pd-nav">
      <a routerLink="overview" routerLinkActive="pd-nav-link--active" class="pd-nav-link">
        <span class="pd-nav-icon">📊</span> Обзор
      </a>
      <a routerLink="referrals" routerLinkActive="pd-nav-link--active" class="pd-nav-link">
        <span class="pd-nav-icon">👥</span> Рефералы
      </a>
      <a routerLink="payouts" routerLinkActive="pd-nav-link--active" class="pd-nav-link">
        <span class="pd-nav-icon">💳</span> Выплаты
      </a>
      <a routerLink="settings" routerLinkActive="pd-nav-link--active" class="pd-nav-link">
        <span class="pd-nav-icon">⚙️</span> Настройки
      </a>
    </nav>

    <div class="pd-sidebar-footer">
      <a href="tel:+78633226575" class="pd-support">📞 Поддержка</a>
      <a routerLink="/partners" class="pd-back-link">О программе</a>
    </div>
  </aside>

  <!-- Main -->
  <main class="pd-main">
    @if (loading()) {
      <div class="pd-loading">
        <div class="pd-spinner"></div>
        <div>Загрузка...</div>
      </div>
    } @else if (error()) {
      <div class="pd-error-box">
        <div class="pd-error-icon">⚠️</div>
        <div class="pd-error-title">Нет доступа к кабинету</div>
        <div class="pd-error-desc">{{ error() }}</div>
        <a routerLink="/partners" class="pd-btn-primary">Стать партнёром</a>
      </div>
    } @else {
      @if (partner()?.status === 'pending') {
        <div class="pd-banner pd-banner--warning">
          ⏳ Ваша заявка на рассмотрении. Мы одобрим её в течение 1 рабочего дня.
        </div>
      }
      @if (partner()?.status === 'suspended') {
        <div class="pd-banner pd-banner--danger">
          Ваш аккаунт партнёра приостановлен. Свяжитесь с поддержкой.
        </div>
      }
      @if (partner()?.self_employed_status === 'rejected') {
        <div class="pd-banner pd-banner--danger">
          Статус самозанятого не подтверждён. Оформите самозанятость в приложении «Мой налог» и
          <a routerLink="/partners" fragment="register">повторите проверку ИНН</a>.
        </div>
      }
      @if (partner()?.self_employed_status === 'pending') {
        <div class="pd-banner pd-banner--warning">
          Проверка статуса самозанятого в процессе. Мы уведомим вас о результате.
        </div>
      }
      <router-outlet />
    }
  </main>

</div>
  `,
  styles: [`
    .pd-root {
      display: flex; min-height: 100vh;
      background: #0f0f0f; color: #f5f5f5;
      font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
    }

    /* Sidebar */
    .pd-sidebar {
      width: 240px; flex-shrink: 0;
      background: #141414; border-right: 1px solid rgba(255,255,255,0.06);
      display: flex; flex-direction: column; padding: 24px 0;
      position: sticky; top: 0; height: 100vh; overflow-y: auto;
    }
    .pd-logo { padding: 0 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .pd-logo-link { font-size: 12px; color: #6b7280; text-decoration: none; display: block; margin-bottom: 8px; &:hover { color: #f59e0b; } }
    .pd-logo-title { font-size: 16px; font-weight: 700; color: #f5f5f5; }
    .pd-profile { display: flex; align-items: center; gap: 12px; padding: 20px; }
    .pd-avatar {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: rgba(245,158,11,0.2); color: #f59e0b;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700;
    }
    .pd-profile-name { font-size: 14px; font-weight: 600; color: #f5f5f5; }
    .pd-profile-badge {
      display: inline-block; font-size: 10px; font-weight: 700;
      letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; border-radius: 99px; margin-top: 3px;
    }
    .pd-badge--approved { background: rgba(16,185,129,0.15); color: #10b981; }
    .pd-badge--pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .pd-badge--suspended { background: rgba(239,68,68,0.15); color: #ef4444; }
    .pd-badge--rejected { background: rgba(239,68,68,0.15); color: #ef4444; }
    .pd-nav { padding: 12px 0; flex: 1; }
    .pd-nav-link {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 20px; font-size: 14px; color: #9ca3af;
      text-decoration: none; border-left: 3px solid transparent;
      transition: all 0.2s;
      &:hover { color: #f5f5f5; background: rgba(255,255,255,0.04); }
    }
    .pd-nav-link--active { color: #f59e0b; border-left-color: #f59e0b; background: rgba(245,158,11,0.05); }
    .pd-nav-icon { font-size: 16px; }
    .pd-sidebar-footer { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.06); }
    .pd-support { display: block; font-size: 13px; color: #9ca3af; text-decoration: none; margin-bottom: 8px; &:hover { color: #f59e0b; } }
    .pd-back-link { font-size: 12px; color: #6b7280; text-decoration: none; &:hover { color: #9ca3af; } }

    /* Main */
    .pd-main { flex: 1; padding: 32px; overflow-y: auto; min-width: 0; }
    .pd-loading {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 200px; gap: 16px; color: #9ca3af;
    }
    .pd-spinner {
      width: 32px; height: 32px; border: 3px solid rgba(245,158,11,0.3);
      border-top-color: #f59e0b; border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .pd-error-box { text-align: center; padding: 60px 24px; }
    .pd-error-icon { font-size: 48px; margin-bottom: 16px; }
    .pd-error-title { font-size: 22px; font-weight: 700; color: #f5f5f5; margin-bottom: 8px; }
    .pd-error-desc { font-size: 15px; color: #9ca3af; margin-bottom: 24px; }
    .pd-btn-primary {
      display: inline-flex; padding: 14px 28px; border-radius: 6px;
      background: #f59e0b; color: #0a0a0a; font-weight: 700; font-size: 15px;
      text-decoration: none; border: none; cursor: pointer;
      &:hover { background: #fbbf24; }
    }
    .pd-banner {
      padding: 14px 20px; border-radius: 8px; font-size: 14px;
      margin-bottom: 24px; display: flex; align-items: center; gap: 8px;
    }
    .pd-banner--warning { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); color: #fbbf24; }
    .pd-banner--danger { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }

    @media (max-width: 768px) {
      .pd-root { flex-direction: column; }
      .pd-sidebar { width: 100%; height: auto; position: static; flex-direction: row; flex-wrap: wrap; padding: 12px 16px; }
      .pd-logo { border-bottom: none; padding: 0 16px 0 0; }
      .pd-profile { padding: 0; }
      .pd-nav { display: flex; padding: 0; flex: none; }
      .pd-sidebar-footer { display: none; }
      .pd-nav-link { padding: 8px 12px; border-left: none; border-bottom: 3px solid transparent; }
      .pd-nav-link--active { border-left: none; border-bottom-color: #f59e0b; }
      .pd-main { padding: 20px 16px; }
    }
  `],
})
export class PartnerDashboardShellComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly partnerApi = inject(PartnerApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly partner = signal<PartnerProfile | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }
    this.partnerApi.getProfile().subscribe({
      next: (p) => {
        this.partner.set(p);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        if (err?.status === 404) {
          this.error.set('Вы не зарегистрированы в партнёрской программе.');
        } else {
          this.error.set('Ошибка загрузки данных. Попробуйте позже.');
        }
      },
    });
  }

  initials(): string {
    const name = this.partner()?.name || '';
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      approved: 'Активен',
      pending: 'На рассмотрении',
      suspended: 'Приостановлен',
      rejected: 'Отклонён',
    };
    return labels[status] || status;
  }
}
