import { Injectable, inject, signal, computed, effect, untracked, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, switchMap, tap } from 'rxjs/operators';
import { ApiResponse } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { InboxService } from './inbox.service';
import { CrmReportsApiService, DailySummary } from './crm-reports-api.service';
import { TasksApiService, WorkdayData, WorkdayShift, WorkTask } from './tasks-api.service';
import { OrdersApiService, PhotoPrintOrder } from './orders-api.service';
import { ShiftsApiService, EmployeeShift } from './shifts-api.service';
import { PosSalesApiService } from './pos-sales-api.service';
import { PosApiService } from './pos-api.service';
import { WebSocketService } from '../../../core/services/websocket.service';
import {
  WorkdayEndReminderDialogComponent,
  type WorkdayEndReminderDialogData,
  type WorkdayEndReminderDialogResult,
} from '../components/workday-end-reminder-dialog/workday-end-reminder-dialog.component';
import {
  WorkdayCashCountDialogComponent,
  type WorkdayCashCountDialogData,
  type WorkdayCashCountDialogResult,
} from '../components/workday-cash-count-dialog/workday-cash-count-dialog.component';
import {
  clearWorkdayEndReminderSnooze,
  readWorkdayEndReminderSnooze,
  saveWorkdayEndReminderSnooze,
} from './workday-end-reminder-snooze.storage';

export interface GamificationStats {
  totalXP: number;
  level: number;
  levelProgress: number;
  nextLevelXP: number;
  streak: number;
  dailyQuests: DailyQuest[];
  recentAchievements: Achievement[];
}

export interface DailyQuest {
  id: string;
  quest_type: string;
  title: string;
  target: number;
  progress: number;
  xp_reward: number;
  completed: boolean;
}

export interface Achievement {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  unlocked: boolean;
  unlocked_at?: string;
}

export interface EmployeeKpi {
  retouchConversion: number;   // %
  reviewsCollected: number;
  reviewsTarget: number;
  portraitUpsells: number;
  satisfactionScore: number;
}

export interface SatisfactionEntry {
  id: string;
  clientName: string;
  rating: number;
  service: string;
  time: string;
}

export interface PeriodMetrics {
  orders: number;
  revenue: number;
  avgCheck: number;
  posReceipts: number;
  posRevenue: number;
  chatSessions?: number;
  chatMessages?: number;
}

export interface DashboardMetrics {
  today: PeriodMetrics;
  week: PeriodMetrics;
  conversionRate: number;
}

export interface ShiftCommissionData {
  todayCommission: number;
  todayRevenue: number;
  commissionRate: number;
  posCount: number;
  onlineCount: number;
}

export interface OrderQueueItem extends PhotoPrintOrder {
  sla_deadline?: string;
  time_remaining_ms?: number;
  is_overdue?: boolean;
  escalation_level?: number;
  resolved_phone?: string | null;
  deadline?: string;
  photo_url?: string | null;
  // Связанная задача ретуши / согласование (для согласования прямо с карточки)
  retouch_task_id?: string | null;
  retouch_status?: string | null;
  revision_count?: number;
  revision_requested?: boolean;
  approval_session_id?: string | null;
  approval_status?: string | null;
  retouch_result_url?: string | null;
}

export interface DocumentTemplate {
  id: string;
  slug: string;
  name: string;
  category: string;
  country_code: string | null;
  photo_width_mm: number | null;
  photo_height_mm: number | null;
  default_media_size: string | null;
  photos_per_sheet: number | null;
  is_active: boolean;
  sort_order: number;
}

const DOCUMENT_SLUG_ALIAS_MAP: Record<string, string> = {
  'voditelskie-prava': 'driver-license',
  'voennyj-bilet': 'military-id',
  'medknizhka': 'medical-book',
};

const VISA_COUNTRY_CODE_MAP: Record<string, string> = {
  us: 'usa',
  cn: 'china',
};

const WORKDAY_END_REMINDER_TIME = '19:45';
const WORKDAY_END_REMINDER_SNOOZE_FALLBACK_MINUTES = 10;
const MOSCOW_UTC_OFFSET_HOURS = 3;
type WorkdayPosShiftStartStatus = 'ready' | 'skipped' | 'failed';

@Injectable({ providedIn: 'root' })
export class DashboardDataService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly inboxService = inject(InboxService);
  private readonly reportsApi = inject(CrmReportsApiService);
  private readonly tasksApi = inject(TasksApiService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly shiftsApi = inject(ShiftsApiService);
  private readonly salesApi = inject(PosSalesApiService);
  private readonly posApi = inject(PosApiService);
  private readonly ws = inject(WebSocketService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  // === Core data ===
  readonly workday = signal<WorkdayData | null>(null);
  readonly workdayLoaded = signal(false);
  readonly dailySummary = signal<DailySummary | null>(null);
  readonly assignedTasks = signal<WorkTask[]>([]);
  readonly createdTasks = signal<WorkTask[]>([]);
  readonly myTasks = computed(() => this.assignedTasks());
  readonly orderQueue = signal<OrderQueueItem[]>([]);
  readonly archivedOrderQueue = signal<OrderQueueItem[]>([]);
  readonly archivedOrderQueueTotal = signal(0);
  readonly staleOrderQueue = signal<OrderQueueItem[]>([]);
  readonly staleOrderQueueTotal = signal(0);
  readonly gamification = signal<GamificationStats | null>(null);
  readonly dashboardMetrics = signal<DashboardMetrics | null>(null);

  // === Commission ===
  readonly shiftCommission = signal<ShiftCommissionData | null>(null);
  readonly monthlyCommission = signal<number>(0);
  readonly loadingCommission = signal(false);

  // === Document templates (shared across order forms) ===
  readonly documentTemplates = signal<DocumentTemplate[]>([]);
  readonly loadingDocumentTemplates = signal(false);

  readonly documentTemplatesBySlug = computed(() =>
    new Map(this.documentTemplates().map(t => [t.slug, t])),
  );
  readonly documentTemplatesById = computed(() =>
    new Map(this.documentTemplates().map(t => [t.id, t])),
  );

  // === Employee KPIs (mock — API позже) ===
  readonly employeeKpi = signal<EmployeeKpi>({
    retouchConversion: 67,
    reviewsCollected: 3,
    reviewsTarget: 5,
    portraitUpsells: 2,
    satisfactionScore: 4.8,
  });

  // === Satisfaction feed (mock — API позже) ===
  readonly satisfactionFeed = signal<SatisfactionEntry[]>([
    { id: '1', clientName: 'Иванов И.', rating: 5, service: 'Портрет', time: '14:32' },
    { id: '2', clientName: 'Петрова А.', rating: 4, service: 'Фото на паспорт', time: '13:15' },
    { id: '3', clientName: 'Сидоров К.', rating: 5, service: 'Семейная съёмка', time: '12:40' },
    { id: '4', clientName: 'Козлова М.', rating: 5, service: 'Портрет', time: '11:20' },
    { id: '5', clientName: 'Новикова Е.', rating: 4, service: 'Фото на документы', time: '10:05' },
    { id: '6', clientName: 'Морозов Д.', rating: 3, service: 'Печать фото', time: '09:30' },
  ]);

  // Loading states
  readonly loadingWorkday = signal(false);
  readonly startingWorkday = signal(false);
  readonly loadingRevenue = signal(false);
  readonly loadingQueue = signal(false);
  readonly loadingOrderArchive = signal(false);
  readonly loadingStaleOrderQueue = signal(false);
  readonly loadingGamification = signal(false);
  readonly loadingMetrics = signal(false);

  // Computed
  readonly counts = computed(() => this.inboxService.counts());

  readonly revenueChange = computed(() => {
    const s = this.dailySummary();
    if (!s || !s.yesterday.revenue) return null;
    return Math.round(((s.today.net - s.yesterday.revenue) / s.yesterday.revenue) * 100);
  });

  readonly urgentTaskCount = computed(() => {
    const w = this.workday();
    return w?.summary.urgent ?? 0;
  });

  readonly overdueTaskCount = computed(() => {
    const w = this.workday();
    return w?.summary.overdue ?? 0;
  });

  readonly shiftActive = computed(() => {
    const w = this.workday();
    return w?.shift?.status === 'active';
  });

  // Failsafe timers (редкие, primary = WS events)
  private timers: ReturnType<typeof setInterval>[] = [];
  private workdayEndReminderTimer: ReturnType<typeof setTimeout> | null = null;
  private workdayEndReminderShiftId: string | null = null;
  private workdayEndReminderSnoozedUntil = 0;
  private workdayEndReminderDialogRef: MatDialogRef<WorkdayEndReminderDialogComponent, WorkdayEndReminderDialogResult> | null = null;
  private initialized = false;

  private readonly stage2Timers: ReturnType<typeof setTimeout>[] = [];

  init(): void {
    if (this.initialized || !isPlatformBrowser(this.platformId)) return;
    this.initialized = true;

    // Стадийная загрузка: вся студия сидит за одним NAT-IP и упирается в nginx
    // limit_conn, поэтому не выпускаем 10 запросов залпом.
    //
    // Stage 1 — критично для первого экрана дашборда (рабочий день, очередь
    // заказов, мои задачи). Грузим сразу.
    this.loadWorkday();
    this.loadOrderQueue();
    this.loadMyTasks();

    // Stage 2 — фоновые данные (выручка, архив, геймификация, метрики,
    // комиссия, шаблоны документов). Откладываем после первого рендера и
    // выпускаем маленькими батчами, чтобы сгладить пик одновременных запросов.
    const stage2Batches: (() => void)[][] = [
      [() => this.loadDailySummary(), () => this.loadOrderArchiveCount()],
      [() => this.loadCommission(), () => this.loadDocumentTemplates()],
      [() => this.loadMetrics(), () => this.loadGamification()],
    ];
    stage2Batches.forEach((batch, index) => {
      // index*120мс — небольшой разнос между батчами; setTimeout(0) на первом
      // гарантирует выполнение после первого рендера.
      const timer = setTimeout(() => batch.forEach(load => load()), index * 120);
      this.stage2Timers.push(timer);
    });

    // WS event-driven refreshes (основной механизм обновления)
    // order:paid / order:created → обновляем выручку и очередь
    effect(() => {
      const evt = this.ws.orderEvent();
      if (!evt) return;
      if (['order:paid', 'order:created', 'order:status-changed', 'order:updated', 'order:deleted'].includes(evt.event)) {
        untracked(() => {
          this.loadDailySummary();
          this.loadOrderQueue();
          this.refreshOrderArchive();
        });
      }
    });

    // task:* → обновляем workday + myTasks
    effect(() => {
      const evt = this.ws.taskEvent();
      if (!evt) return;
      if (['task:created', 'task:updated', 'task:assigned'].includes(evt.event)) {
        this.loadWorkday();
        this.loadMyTasks();
      }
    });

    // retouch:* (в т.ч. revision_requested) → перезагружаем очередь:
    // сброшенный обратный отсчёт + бейдж «Доработка» появляются вживую
    effect(() => {
      const evt = this.ws.retouchQueueEvent();
      if (!evt) return;
      untracked(() => this.loadOrderQueue());
    });

    // approval:* (клиент посмотрел / одобрил / запросил доработку) → перезагружаем очередь
    effect(() => {
      const evt = this.ws.approvalEvent();
      if (!evt) return;
      if (['approval:photo-reviewed', 'approval:session-completed'].includes(evt.event)) {
        untracked(() => this.loadOrderQueue());
      }
    });

    effect(() => {
      const evt = this.ws.paymentLinkEvent();
      if (!evt || evt.event !== 'payment-link:paid') return;
      untracked(() => {
        const d = evt.data || {};
        const name = d.contactName || d.clientName || 'Клиент';
        const amount = d.amount ? `${d.amount}₽` : '';
        const ref = d.orderRef ? ` по ссылке ${d.orderRef}` : '';
        const parts = [`${name} оплатил${amount ? ' ' + amount : ''}${ref}.`, 'Создайте заказ вручную.'];
        const contactId = d.contactId;
        const action = contactId ? 'Открыть клиента' : 'OK';
        const snackRef = this.snackBar.open(parts.join(' '), action, { duration: 10000, panelClass: ['snack-success'] });
        if (contactId) {
          snackRef.onAction().subscribe(() => {
            this.router.navigate(['/employee/inbox'], { queryParams: { contactId } });
          });
        }
        this.loadDailySummary();
        this.loadWorkday();
        this.loadCommission();
      });
    });

    effect(() => {
      const loaded = this.workdayLoaded();
      const shift = this.workday()?.shift ?? null;
      if (!loaded && !shift) return;
      untracked(() => this.scheduleWorkdayEndReminder(shift));
    });

    // Failsafe: редкое polling (15 мин) — страховка на случай пропущенных WS событий
    this.timers.push(setInterval(() => this.loadWorkday(), 15 * 60_000));
    this.timers.push(setInterval(() => this.loadDailySummary(), 15 * 60_000));
    this.timers.push(setInterval(() => this.loadMyTasks(), 15 * 60_000));
    this.timers.push(setInterval(() => this.loadOrderQueue(), 10 * 60_000));
    this.timers.push(setInterval(() => this.refreshOrderArchive(), 10 * 60_000));
    this.timers.push(setInterval(() => this.loadGamification(), 10 * 60_000));
    this.timers.push(setInterval(() => this.loadMetrics(), 5 * 60_000));
    this.timers.push(setInterval(() => this.loadCommission(), 10 * 60_000));

    this.destroyRef.onDestroy(() => {
      this.timers.forEach(t => clearInterval(t));
      this.timers = [];
      this.stage2Timers.forEach(t => clearTimeout(t));
      this.stage2Timers.length = 0;
      this.clearWorkdayEndReminderTimer();
      this.workdayEndReminderDialogRef?.close();
      this.workdayEndReminderDialogRef = null;
      this.initialized = false;
    });
  }

  // === Loaders ===

  loadWorkday(): void {
    this.loadingWorkday.set(true);
    this.tasksApi.getWorkday().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.workday.set(res.data);
        }
        this.loadingWorkday.set(false);
        this.workdayLoaded.set(true);
      },
      error: () => {
        this.loadingWorkday.set(false);
        this.workdayLoaded.set(true);
      },
    });
  }

  loadDailySummary(): void {
    if (!this.auth.hasPermission('reports:view')) {
      this.dailySummary.set(null);
      this.loadingRevenue.set(false);
      return;
    }
    this.loadingRevenue.set(true);
    this.reportsApi.getDailySummary().subscribe({
      next: (data) => {
        this.dailySummary.set(data);
        this.loadingRevenue.set(false);
      },
      error: () => this.loadingRevenue.set(false),
    });
  }

  loadMyTasks(): void {
    this.tasksApi.getMyTasks({ scope: 'all' }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          const active = res.data.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
          this.assignedTasks.set(
            active
              .filter(t => t.viewer_relation === 'assignee' || t.viewer_relation === 'assignee_creator')
              .slice(0, 8),
          );
          this.createdTasks.set(
            active
              .filter(t => t.viewer_relation === 'creator' || t.viewer_relation === 'assignee_creator')
              .slice(0, 8),
          );
        }
      },
    });
  }

  loadOrderQueue(): void {
    this.loadingQueue.set(true);
    this.ordersApi.getOrderQueue('active').subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.orderQueue.set(res.data);
          this.staleOrderQueueTotal.set(res.staleTotal ?? 0);
          // Если зависших не осталось — сбросим кэш списка, чтобы вкладка не висела пустой.
          if ((res.staleTotal ?? 0) === 0) {
            this.staleOrderQueue.set([]);
          }
        }
        this.loadingQueue.set(false);
      },
      error: () => this.loadingQueue.set(false),
    });
  }

  loadStaleOrderQueue(): void {
    this.loadingStaleOrderQueue.set(true);
    this.ordersApi.getOrderQueue('stale').subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.staleOrderQueue.set(res.data);
          this.staleOrderQueueTotal.set(res.total);
        }
        this.loadingStaleOrderQueue.set(false);
      },
      error: () => this.loadingStaleOrderQueue.set(false),
    });
  }

  loadOrderArchive(): void {
    this.loadingOrderArchive.set(true);
    this.ordersApi.getArchivedOrders(10).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.archivedOrderQueue.set(res.data);
          this.archivedOrderQueueTotal.set(res.total);
        }
        this.loadingOrderArchive.set(false);
      },
      error: () => this.loadingOrderArchive.set(false),
    });
  }

  loadOrderArchiveCount(): void {
    this.ordersApi.getArchivedOrders(1).subscribe({
      next: (res) => {
        if (res.success) {
          this.archivedOrderQueueTotal.set(res.total);
          if (res.total === 0) {
            this.archivedOrderQueue.set([]);
          }
        }
      },
      error: () => undefined,
    });
  }

  refreshOrderArchive(): void {
    if (this.archivedOrderQueue().length > 0) {
      this.loadOrderArchive();
      return;
    }
    this.loadOrderArchiveCount();
  }

  loadGamification(): void {
    this.loadingGamification.set(true);
    this.http.get<{ success: boolean; data: GamificationStats }>(
      '/api/gamification/my-stats'
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.gamification.set(res.data);
        }
        this.loadingGamification.set(false);
      },
      error: () => this.loadingGamification.set(false),
    });
  }

  loadMetrics(): void {
    this.loadingMetrics.set(true);
    this.http.get<{ success: boolean; data: DashboardMetrics }>(
      '/api/crm/dashboard/metrics'
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.dashboardMetrics.set(res.data);
        }
        this.loadingMetrics.set(false);
      },
      error: () => this.loadingMetrics.set(false),
    });
  }

  loadDocumentTemplates(): void {
    if (this.documentTemplates().length > 0) return;
    this.loadingDocumentTemplates.set(true);
    this.http.get<{ success: boolean; data: DocumentTemplate[] }>('/api/document-templates')
      .pipe(catchError(() => of({ success: false, data: [] as DocumentTemplate[] })))
      .subscribe(res => {
        if (res.success) this.documentTemplates.set(res.data);
        this.loadingDocumentTemplates.set(false);
      });
  }

  resolveDocumentTemplateId(uiSlug: string | undefined | null, visaCountry: string | null = null): string | null {
    if (!uiSlug) return null;
    let dbSlug: string | null;
    if (uiSlug === 'visa') {
      const country = visaCountry ? (VISA_COUNTRY_CODE_MAP[visaCountry] ?? visaCountry) : null;
      dbSlug = country ? `visa-${country}` : null;
    } else {
      dbSlug = DOCUMENT_SLUG_ALIAS_MAP[uiSlug] ?? uiSlug;
    }
    return dbSlug ? this.documentTemplatesBySlug().get(dbSlug)?.id ?? null : null;
  }

  loadCommission(): void {
    this.loadingCommission.set(true);
    this.salesApi.getDashboard().subscribe({
      next: (d) => {
        this.shiftCommission.set({
          todayCommission: d.total_commission,
          todayRevenue: d.total_sales,
          commissionRate: d.total_sales > 0 ? Math.round((d.total_commission / d.total_sales) * 100) : 0,
          posCount: d.receipts_count,
          onlineCount: 0,
        });
        this.loadingCommission.set(false);
      },
      error: () => this.loadingCommission.set(false),
    });

    // Monthly commission
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.http.get<{ success: boolean; data: { commission: number } }>(
      '/api/shifts/my/earnings', { params: { month } },
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.monthlyCommission.set(res.data.commission);
        }
      },
      error: () => undefined,
    });
  }

  // Shift actions
  checkIn(shiftId: string, cashAtOpen: number): void {
    this.shiftsApi.checkIn(shiftId, cashAtOpen).subscribe({
      next: () => this.loadWorkday(),
    });
  }

  startWorkday(
    studioId: string | undefined,
    warningAcknowledged: boolean,
    cashAtOpen: number,
    fiscalEnabled = true,
    openPosShift = true,
  ): Observable<ApiResponse<EmployeeShift>> {
    if (this.startingWorkday()) {
      return this.shiftsApi.startWorkday(studioId, warningAcknowledged, cashAtOpen);
    }

    this.startingWorkday.set(true);
    return this.shiftsApi.startWorkday(studioId, warningAcknowledged, cashAtOpen).pipe(
      switchMap(response => (openPosShift
        ? this.ensurePosShiftForWorkday(studioId, cashAtOpen, fiscalEnabled)
        : of('skipped' as const)
      ).pipe(
        map(posShiftStatus => ({ response, posShiftStatus })),
        catchError(() => of({ response, posShiftStatus: 'failed' as const })),
      )),
      tap(({ posShiftStatus }) => {
        this.loadWorkday();
        this.loadCommission();
        if (!openPosShift) {
          this.snackBar.open('Рабочий день начат.', 'OK', { duration: 3000 });
          return;
        }
        if (posShiftStatus === 'failed') {
          this.snackBar.open('Рабочий день начат, но кассовую смену открыть не удалось', 'OK', {
            duration: 5000,
            panelClass: ['snack-error'],
          });
          return;
        }
        const message = posShiftStatus === 'ready'
          ? fiscalEnabled
            ? 'Рабочий день и кассовая смена начаты. ФР открывается.'
            : 'Рабочий день и кассовая смена начаты.'
          : 'Рабочий день начат. Откройте кассовую смену в кассе.';
        this.snackBar.open(message, 'OK', {
          duration: 3000,
          panelClass: posShiftStatus === 'ready' ? ['snack-success'] : undefined,
        });
      }),
      map(({ response }) => response),
      catchError((error: unknown) => {
        this.snackBar.open(this.errorMessage(error, 'Не удалось начать рабочий день'), 'OK', { duration: 4000, panelClass: ['snack-error'] });
        return throwError(() => error);
      }),
      finalize(() => this.startingWorkday.set(false)),
    );
  }

  private ensurePosShiftForWorkday(
    studioId: string | undefined,
    cashAtOpen: number,
    fiscalEnabled: boolean,
  ): Observable<WorkdayPosShiftStartStatus> {
    const employeeId = this.auth.currentUser()?.id;
    if (!studioId || !employeeId) return of('skipped');

    return this.posApi.getCurrentShift(employeeId).pipe(
      switchMap(currentShift => {
        if (currentShift?.status === 'open') return of('ready' as const);
        return this.posApi.openShiftWithFiscalCommand({
          employee_id: employeeId,
          studio_id: studioId,
          cash_at_open: cashAtOpen,
          fiscal_enabled: fiscalEnabled,
        }).pipe(map(() => 'ready' as const));
      }),
    );
  }

  requestCheckOut(shift: WorkdayShift): void {
    if (this.isCashlessWorkdayShift(shift)) {
      this.checkOut(shift.id, 0);
      return;
    }

    const dialogRef = this.dialog.open<
      WorkdayCashCountDialogComponent,
      WorkdayCashCountDialogData,
      WorkdayCashCountDialogResult
    >(WorkdayCashCountDialogComponent, {
      data: {
        mode: 'close',
        studioName: this.workdayShiftLocationLabel(shift),
        initialAmount: shift.cash_at_close ?? null,
      },
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false,
      restoreFocus: false,
      panelClass: ['crm-dialog', 'workday-cash-count-dialog-panel'],
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) return;
      this.checkOut(shift.id, result.amount);
    });
  }

  checkOut(shiftId: string, cashAtClose: number): void {
    this.shiftsApi.checkOut(shiftId, cashAtClose).subscribe({
      next: () => {
        this.workdayEndReminderSnoozedUntil = 0;
        this.clearPersistedWorkdayEndReminderSnooze();
        this.clearWorkdayEndReminderTimer();
        this.closeFiscalShiftOnCheckout();
        this.loadWorkday();
        this.snackBar.open('Смена завершена', 'OK', { duration: 3000, panelClass: ['snack-success'] });
      },
      error: (error: unknown) => {
        this.snackBar.open(this.errorMessage(error, 'Не удалось завершить смену'), 'OK', { duration: 4000, panelClass: ['snack-error'] });
      },
    });
  }

  /**
   * При завершении рабочего дня закрываем и фискальную смену ATOL 27Ф на ККТ.
   * Без этого check-out закрывает только employee_shift, фискальная смена остаётся открытой
   * и через 24ч протухает («ФР истёк», ATOL error 83 на следующий день).
   * Best-effort: касса в БД (pos_shifts) не трогается — закрывается только смена на ККТ.
   * Допущение: одна касса/ФР на студию (один POS-агент). Для мультикассовых точек нужен
   * last-shift guard на стороне /fiscal/close.
   */
  private closeFiscalShiftOnCheckout(): void {
    const employeeId = this.auth.currentUser()?.id;
    if (!employeeId) return;
    this.posApi.getCurrentShift(employeeId).pipe(
      switchMap(shift => {
        if (!shift || shift.status !== 'open') return of(null);
        return this.posApi.closeShiftFiscalWithCommand(shift.id);
      }),
    ).subscribe({
      next: (result) => {
        if (result?.fiscalCommandEnqueued) {
          this.snackBar.open('Фискальная смена ATOL закрывается…', 'OK', { duration: 3000, panelClass: ['snack-success'] });
        }
      },
      error: (error: unknown) => {
        this.snackBar.open(this.errorMessage(error, 'Не удалось закрыть фискальную смену ATOL'), 'OK', { duration: 5000, panelClass: ['snack-error'] });
      },
    });
  }

  private scheduleWorkdayEndReminder(shift: WorkdayShift | null): void {
    this.clearWorkdayEndReminderTimer();
    if (!isPlatformBrowser(this.platformId)) return;

    if (!shift) {
      this.workdayEndReminderShiftId = null;
      this.workdayEndReminderSnoozedUntil = 0;
      this.workdayEndReminderDialogRef?.close();
      this.workdayEndReminderDialogRef = null;
      return;
    }

    if (shift.status !== 'active') {
      this.workdayEndReminderShiftId = null;
      this.workdayEndReminderSnoozedUntil = 0;
      this.clearPersistedWorkdayEndReminderSnooze();
      this.workdayEndReminderDialogRef?.close();
      this.workdayEndReminderDialogRef = null;
      return;
    }

    const now = Date.now();
    if (this.workdayEndReminderShiftId !== shift.id) {
      this.workdayEndReminderShiftId = shift.id;
      this.workdayEndReminderSnoozedUntil = this.readPersistedWorkdayEndReminderSnooze(shift.id, now);
    } else {
      const persistedSnooze = this.readPersistedWorkdayEndReminderSnooze(shift.id, now);
      if (persistedSnooze > now) {
        this.workdayEndReminderSnoozedUntil = Math.max(this.workdayEndReminderSnoozedUntil, persistedSnooze);
      }
      if (this.workdayEndReminderSnoozedUntil <= now) {
        this.workdayEndReminderSnoozedUntil = 0;
      }
    }

    const reminderAt = this.workdayEndReminderAt(shift).getTime();
    const target = this.workdayEndReminderSnoozedUntil > now
      ? this.workdayEndReminderSnoozedUntil
      : reminderAt;
    const delay = Math.max(0, target - now);

    this.workdayEndReminderTimer = setTimeout(() => {
      this.openWorkdayEndReminder(shift.id);
    }, Math.min(delay, 2_147_483_647));
  }

  private clearWorkdayEndReminderTimer(): void {
    if (this.workdayEndReminderTimer) {
      clearTimeout(this.workdayEndReminderTimer);
      this.workdayEndReminderTimer = null;
    }
  }

  private openWorkdayEndReminder(shiftId: string): void {
    const shift = this.workday()?.shift ?? null;
    if (!shift || shift.id !== shiftId || shift.status !== 'active') return;
    if (this.workdayEndReminderDialogRef) return;

    const now = Date.now();
    if (this.workdayEndReminderSnoozedUntil > now) {
      this.scheduleWorkdayEndReminder(shift);
      return;
    }

    const cashlessAtClose = this.isCashlessWorkdayShift(shift);
    const data: WorkdayEndReminderDialogData = {
      shiftId: shift.id,
      studioName: this.workdayShiftLocationLabel(shift),
      endTime: `${WORKDAY_END_REMINDER_TIME} МСК`,
      cashAtClose: cashlessAtClose ? 0 : shift.cash_at_close ?? null,
      cashlessAtClose,
      fiscalEnabled: shift.fiscal_enabled === true,
      fiscalDeviceLabel: shift.fiscal_device_label ?? null,
    };

    this.workdayEndReminderDialogRef = this.dialog.open<
      WorkdayEndReminderDialogComponent,
      WorkdayEndReminderDialogData,
      WorkdayEndReminderDialogResult
    >(WorkdayEndReminderDialogComponent, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
      disableClose: true,
      closeOnNavigation: false,
      autoFocus: false,
      restoreFocus: false,
      panelClass: ['crm-dialog', 'workday-end-reminder-dialog-panel'],
    });

    this.workdayEndReminderDialogRef.afterClosed().subscribe((result) => {
      this.workdayEndReminderDialogRef = null;
      if (!result) return;

      if (result.action === 'close_workday') {
        this.workdayEndReminderSnoozedUntil = 0;
        this.clearPersistedWorkdayEndReminderSnooze();
        this.checkOut(shift.id, result.cashAtClose);
        return;
      }

      const minutes = Number.isFinite(result.minutes) && result.minutes > 0
        ? result.minutes
        : WORKDAY_END_REMINDER_SNOOZE_FALLBACK_MINUTES;
      this.workdayEndReminderSnoozedUntil = Date.now() + minutes * 60_000;
      this.savePersistedWorkdayEndReminderSnooze(shift.id, this.workdayEndReminderSnoozedUntil);
      this.snackBar.open(`Напомним через ${minutes} мин`, 'OK', { duration: 2500 });
      this.scheduleWorkdayEndReminder(this.workday()?.shift ?? null);
    });
  }

  private readPersistedWorkdayEndReminderSnooze(shiftId: string, now: number): number {
    if (!isPlatformBrowser(this.platformId)) return 0;
    return readWorkdayEndReminderSnooze(localStorage, shiftId, now);
  }

  private savePersistedWorkdayEndReminderSnooze(shiftId: string, snoozedUntil: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    saveWorkdayEndReminderSnooze(localStorage, shiftId, snoozedUntil);
  }

  private clearPersistedWorkdayEndReminderSnooze(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    clearWorkdayEndReminderSnooze(localStorage);
  }

  private workdayEndReminderAt(_shift: WorkdayShift): Date {
    const moscowNow = new Date(Date.now() + MOSCOW_UTC_OFFSET_HOURS * 60 * 60_000);
    return new Date(Date.UTC(
      moscowNow.getUTCFullYear(),
      moscowNow.getUTCMonth(),
      moscowNow.getUTCDate(),
      19 - MOSCOW_UTC_OFFSET_HOURS,
      45,
      0,
      0,
    ));
  }

  private workdayShiftLocationLabel(shift: WorkdayShift): string {
    if (this.isCashlessWorkdayShift(shift)) return 'Пульт';
    return this.compactAddress(shift.studio_address ?? null)
      || this.locationAddress(shift.location_code ?? null)
      || this.stripStudioBrand(shift.studio_name ?? '')
      || 'адресу смены';
  }

  private isCashlessWorkdayShift(shift: Pick<WorkdayShift, 'is_virtual' | 'shift_kind' | 'location_code'>): boolean {
    return shift.is_virtual === true || shift.shift_kind === 'virtual' || shift.location_code === 'online';
  }

  private locationAddress(locationCode: string | null): string {
    switch (locationCode) {
      case 'barrikadnaya-4':
        return '2-ая Баррикадная 4';
      case 'soborny':
      case 'soborny-21':
        return 'Соборный 21';
      default:
        return '';
    }
  }

  private compactAddress(address: string | null): string {
    if (!address) return '';
    return address
      .split(',')[0]
      ?.trim()
      .replace(/^(ул\.?|улица|пер\.?|переулок)\s+/i, '')
      .trim() ?? '';
  }

  private stripStudioBrand(name: string): string {
    return name
      .replace(/^\s*сво[ёе]\s*фото\s*[—–-]?\s*/i, '')
      .trim();
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const payload: unknown = error.error;
      if (typeof payload === 'object' && payload !== null) {
        const message = 'message' in payload ? Reflect.get(payload, 'message') : Reflect.get(payload, 'error');
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
    return fallback;
  }

  refresh(): void {
    this.loadWorkday();
    this.loadDailySummary();
    this.loadMyTasks();
    this.loadOrderQueue();
    this.refreshOrderArchive();
    this.loadGamification();
    this.loadMetrics();
    this.loadCommission();
  }
}
