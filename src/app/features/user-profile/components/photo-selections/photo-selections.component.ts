import {
  Component, OnInit, inject, signal, computed, ChangeDetectionStrategy, PLATFORM_ID
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';

import { PhotoApprovalService } from '../../../../core/services/photo-approval.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ResponsiveLayoutService } from '../../../../core/services/responsive-layout.service';
import { PricingCategory } from '../../../../core/services/pricing-api.service';
import type { PhotoForApproval, ApprovalSession, ApprovalStats, PageState } from './photo-selections.types';

import { EmptyStateCatalogComponent } from './empty-state-catalog.component';
import { SessionListPanelComponent } from './session-list-panel.component';
import { OrderSubmitPanelComponent } from './order-submit-panel.component';
import { PhotoDetailPanelComponent } from '../../../../shared/photo-approval/components/photo-detail-panel.component';

@Component({
  selector: 'app-photo-selections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatProgressSpinnerModule,
    MatIconModule,
    EmptyStateCatalogComponent,
    SessionListPanelComponent,
    OrderSubmitPanelComponent,
    PhotoDetailPanelComponent,
  ],
  template: `
    <div class="page-root">

      <!-- LOADING -->
      @if (pageState() === 'loading') {
        <div class="state-center">
          <mat-spinner diameter="44" />
          <p class="state-label">Загрузка согласований...</p>
        </div>
      }

      <!-- ERROR -->
      @if (pageState() === 'error') {
        <div class="state-center">
          <div class="state-icon"><mat-icon>error_outline</mat-icon></div>
          <p class="state-label">{{ errorMsg() }}</p>
          <button class="btn-retry" (click)="reload()">Попробовать снова</button>
        </div>
      }

      <!-- ORDERING: multi-step order form -->
      @if (pageState() === 'ordering') {
        <div class="ordering-wrap">
          @if (!isAuthenticated()) {
            <div class="auth-hint-banner">
              <mat-icon>person_outline</mat-icon>
              <div class="auth-hint-text">
                <strong>Войдите в аккаунт</strong>, чтобы отслеживать статус заказа и согласовывать результат обработки
              </div>
              <a class="btn-login" routerLink="/auth/login" [queryParams]="{returnUrl: '/user-profile/photo-selections'}">
                Войти
              </a>
            </div>
          }
          <app-order-submit-panel
            [category]="selectedCategory()"
            (orderPlaced)="onOrderPlaced()"
            (cancelled)="onOrderCancelled()"
          />
        </div>
      }

      <!-- EMPTY: no approvals, show service catalog -->
      @if (pageState() === 'empty') {
        @if (!isAuthenticated()) {
          <div class="auth-hint-banner">
            <mat-icon>person_outline</mat-icon>
            <div class="auth-hint-text">
              <strong>Войдите в аккаунт</strong>, чтобы отслеживать статус заказа и согласовывать результат обработки
            </div>
            <a class="btn-login" routerLink="/auth/login" [queryParams]="{returnUrl: '/user-profile/photo-selections'}">
              Войти
            </a>
          </div>
        }
        <app-empty-state-catalog
          (serviceSelected)="onServiceSelected($event)"
        />
      }

      <!-- SESSIONS: main approval interface -->
      @if (pageState() === 'sessions') {
        <div class="sessions-layout">

          <!-- Page header (full-width) -->
          <div class="page-header">
            <div class="header-row">
              <div class="header-title-row">
                <div class="header-icon" aria-hidden="true"><mat-icon>photo_camera</mat-icon></div>
                <div>
                  <h1 class="page-title">Согласование фотографий</h1>
                  <p class="page-subtitle">Просмотрите варианты обработки и подтвердите результат</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Main layout: session list + reviewer -->
          <div class="main-layout">

            <!-- Sessions panel (left) -->
            <div class="sessions-col">
              <app-session-list-panel
                [sessions]="sessions()"
                [selectedSessionId]="selectedSessionId()"
                [stats]="stats()"
                (sessionSelected)="openSession($event)"
                (orderNewClicked)="startOrdering()"
              />
            </div>

            <!-- Reviewer (right panel) -->
            <div class="reviewer-col hide-on-mobile">
              @if (selectedToken()) {
                <app-photo-detail-panel
                  [token]="selectedToken()!"
                  (photoReviewed)="onStatusChanged($event)"
                  (sessionCompleted)="onSessionCompleted()" />
              } @else {
                <div class="reviewer-empty">
                  <div class="re-icon"><mat-icon>touch_app</mat-icon></div>
                  <p class="re-text">Выберите заявку из списка слева для просмотра</p>
                  <p class="re-sub">или <button class="re-link" (click)="startOrdering()">закажите обработку</button></p>
                </div>
              }
            </div>

          </div>
        </div>
      }

    </div>
  `,
  styles: `
    :host { display: block; }

    .page-root {
      min-height: 400px;
      padding: 24px 28px 48px;
      color: #20242a;
      --ed-surface: #f1f2f4;
      --ed-surface-container: #ffffff;
      --ed-surface-container-low: #ffffff;
      --ed-surface-container-high: #f5f6f8;
      --ed-outline: #cfd5dd;
      --ed-outline-variant: #dfe3e8;
      --ed-on-surface: #20242a;
      --ed-on-surface-variant: #6f7782;
      --ed-on-surface-muted: #8a929d;
      --ed-accent: #f59e0b;
      --ed-accent-container: #fff4df;
      --ed-on-accent: #111111;
      --ed-on-accent-container: #8a4b00;
    }

    /* ── Full-page states ── */
    .state-center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      min-height: 400px;
      text-align: center;
      padding: 40px 24px;
    }

    .state-icon mat-icon { font-size: 3rem; width: 3rem; height: 3rem; color: #f59e0b; }

    .state-label {
      font-size: 0.9rem;
      color: #6f7782;
      margin: 0;
    }

    .btn-retry {
      padding: 9px 22px;
      background: none;
      border: 1px solid rgba(245,158,11,0.4);
      border-radius: 999px;
      color: #f59e0b;
      font-size: 0.85rem;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s;
    }

    .btn-retry:hover { background: rgba(245,158,11,0.08); }

    /* ── Auth hint banner ── */
    .auth-hint-banner {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 20px;
      margin-bottom: 20px;
      background: #fff7e8;
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 12px;
    }

    .auth-hint-banner mat-icon {
      font-size: 1.5rem;
      width: 1.5rem;
      height: 1.5rem;
      color: #f59e0b;
      flex-shrink: 0;
    }

    .auth-hint-text {
      flex: 1;
      font-size: 0.88rem;
      color: #6f7782;
      line-height: 1.4;
    }

    .auth-hint-text strong {
      color: #20242a;
    }

    .btn-login {
      flex-shrink: 0;
      display: inline-block;
      padding: 8px 18px;
      background: none;
      border: 1px solid rgba(245, 158, 11, 0.5);
      border-radius: 999px;
      color: #f59e0b;
      font-size: 0.83rem;
      font-family: inherit;
      text-decoration: none;
      white-space: nowrap;
      transition: background 0.2s, border-color 0.2s;
      cursor: pointer;
    }

    .btn-login:hover {
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.8);
    }

    @media (max-width: 600px) {
      .auth-hint-banner {
        flex-wrap: wrap;
        gap: 10px;
      }
      .btn-login {
        width: 100%;
        text-align: center;
      }
    }

    /* ── Ordering wrap ── */
    .ordering-wrap {
      padding: 24px 0;
      animation: fade-in 0.3s ease both;
    }

    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ── Sessions layout ── */
    .sessions-layout {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Page header */
    .page-header {
      padding: 0;
    }

    .header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .header-title-row {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .header-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: #fff4df;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .header-icon mat-icon { font-size: 24px; width: 24px; height: 24px; color: #f59e0b; }

    .page-title {
      font-size: clamp(1.6rem, 3vw, 2.25rem);
      font-weight: 800;
      letter-spacing: 0;
      color: #20242a;
      margin: 0 0 6px;
      line-height: 1.1;
    }

    .page-subtitle {
      font-size: 0.95rem;
      color: #6f7782;
      margin: 0;
    }

    /* Main 2-column layout */
    .main-layout {
      display: grid;
      grid-template-columns: 290px minmax(0, 1fr);
      gap: 24px;
      align-items: start;
    }

    .sessions-col {
      position: sticky;
      top: 16px;
      max-height: calc(100vh - 120px);
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #cfd5dd transparent;
    }

    .reviewer-col {
      min-height: 500px;
      overflow: visible;
    }

    /* Reviewer empty state */
    .reviewer-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 400px;
      background: #ffffff;
      border: 1px solid #dfe3e8;
      border-radius: 18px;
      text-align: center;
      gap: 12px;
      box-shadow: 0 10px 28px rgba(20, 27, 38, 0.06);
    }

    .re-icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: #f2f3f5;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .re-icon mat-icon { font-size: 34px; width: 34px; height: 34px; color: #8a929d; }

    .re-text {
      font-size: 0.9rem;
      color: #4b5563;
      margin: 0;
      max-width: 260px;
    }

    .re-sub {
      font-size: 0.82rem;
      color: #8a929d;
      margin: 0;
    }

    .re-link {
      background: none;
      border: none;
      color: #f59e0b;
      font-size: inherit;
      font-family: inherit;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
    }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .main-layout {
        grid-template-columns: 1fr;
      }

      .sessions-col {
        position: static;
        max-height: none;
        overflow-y: visible;
      }

      .hide-on-mobile {
        display: none !important;
      }
    }

    @media (max-width: 600px) {
      .page-root {
        padding: 18px 12px 104px;
      }

      .header-title-row {
        gap: 12px;
      }
    }
  `
})
export class PhotoSelectionsComponent implements OnInit {
  private readonly approvalService = inject(PhotoApprovalService);
  private readonly authService = inject(AuthService);
  private readonly layout = inject(ResponsiveLayoutService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly isAuthenticated = this.authService.isAuthenticated;
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });

  // ── Data ──
  private readonly _approvals = signal<PhotoForApproval[]>([]);
  readonly stats = signal<ApprovalStats | null>(null);
  readonly errorMsg = signal<string | null>(null);

  // ── Page state ──
  readonly pageState = signal<PageState>('loading');
  readonly selectedSessionId = signal<string | null>(null);
  readonly selectedToken = signal<string | null>(null);
  readonly selectedCategory = signal<PricingCategory | null>(null);

  // ── Derived ──
  readonly sessions = computed(() => this.groupBySessions(this._approvals()));

  // ── Lifecycle ──

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      void this.loadAll();
    }
  }

  async reload() {
    this.pageState.set('loading');
    this.errorMsg.set(null);
    await this.loadAll();
  }

  private async loadAll() {
    if (!this.authService.isAuthenticated()) {
      this.pageState.set('empty');
      return;
    }

    // If redirected with token, link the session first
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) {
      try {
        await firstValueFrom(this.approvalService.linkSession(token));
      } catch { /* link failed, still try loading */ }
    }

    await Promise.all([this.loadApprovals(), this.loadStats()]);
  }

  private async loadApprovals() {
    try {
      const list = await firstValueFrom(this.approvalService.getPhotosForApproval());
      this._approvals.set(list);
      this.pageState.set(list.length === 0 ? 'empty' : 'sessions');
    } catch {
      this.errorMsg.set('Не удалось загрузить данные. Попробуйте позже.');
      this.pageState.set('error');
    }
  }

  private async loadStats() {
    try {
      const raw = await firstValueFrom(this.approvalService.getApprovalStats());
      this.stats.set({
        pending:           Number(raw['pending'] ?? 0),
        approved:          Number(raw['approved'] ?? 0),
        rejected:          Number(raw['rejected'] ?? 0),
        changes_requested: Number(raw['changes_requested'] ?? 0),
        total:             Number(raw['total'] ?? 0),
      });
    } catch { /* non-critical */ }
  }

  // ── Session actions ──

  openSession(sessionId: string) {
    const session = this.sessions().find(s => s.sessionId === sessionId);
    if (!session?.publicToken) return;

    if (this.isMobile()) {
      void this.router.navigate(['/photo-review', session.publicToken]);
    } else {
      this.selectedSessionId.set(sessionId);
      this.selectedToken.set(session.publicToken);
    }
  }

  startOrdering() {
    this.selectedCategory.set(null);
    this.pageState.set('ordering');
  }

  onServiceSelected(category: PricingCategory) {
    this.selectedCategory.set(category);
    this.pageState.set('ordering');
  }

  onOrderPlaced() {
    // Reload approvals after a short delay (employee might not have processed yet)
    // Show the page back in sessions/empty state
    void this.reload();
  }

  onOrderCancelled() {
    // Return to previous view
    const hadApprovals = this._approvals().length > 0;
    this.pageState.set(hadApprovals ? 'sessions' : 'empty');
  }

  // ── Status update from reviewer ──

  onStatusChanged(event: { id: string; status: string }) {
    this._approvals.update(items =>
      items.map(item => item.id === event.id ? { ...item, status: event.status as PhotoForApproval['status'] } : item)
    );
    void this.loadStats();
  }

  onSessionCompleted() {
    void this.reload();
  }

  // ── Session grouping ──

  private groupBySessions(approvals: PhotoForApproval[]): ApprovalSession[] {
    const map = new Map<string, PhotoForApproval[]>();

    for (const a of approvals) {
      const key = a.sessionId || a.orderId || a.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }

    return Array.from(map.entries())
      .map(([sessionId, items]) => {
        const first = items[0];
        const name = first.sessionName || first.serviceName || 'Обработка фотографий';

        const statuses = new Set(items.map(i => i.status));
        let overallStatus: ApprovalSession['overallStatus'];
        if (statuses.size === 1) {
          overallStatus = [...statuses][0] as ApprovalSession['overallStatus'];
        } else if (statuses.has('changes_requested')) {
          overallStatus = 'changes_requested';
        } else if (statuses.has('rejected')) {
          overallStatus = 'rejected';
        } else if (statuses.has('pending')) {
          overallStatus = 'pending';
        } else {
          overallStatus = 'mixed';
        }

        return {
          sessionId,
          name,
          items,
          overallStatus,
          pendingCount:  items.filter(i => i.status === 'pending').length,
          approvedCount: items.filter(i => i.status === 'approved').length,
          publicToken: first.publicToken,
          createdAt: first.createdAt ?? new Date(),
        };
      })
      .sort((a, b) => {
        if (a.overallStatus === 'pending' && b.overallStatus !== 'pending') return -1;
        if (b.overallStatus === 'pending' && a.overallStatus !== 'pending') return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }
}
