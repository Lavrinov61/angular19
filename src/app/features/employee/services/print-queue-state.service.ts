/**
 * PrintQueueStateService — centralized state for print queue monitoring.
 * Owns all signals, computed values, WebSocket effects, filters, and batch selection.
 * PrintQueueComponent becomes a pure template controller that delegates here.
 */
import {
  Injectable, inject, signal, computed, effect, OnDestroy,
  afterNextRender, untracked, Injector,
} from '@angular/core';
import { finalize, forkJoin, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import {
  PrintApiService, PrintJob, Printer, BridgePrinterStatus, PrinterTelemetry, QueueFilters,
  PrintJobGroup,
} from './print-api.service';
import { InfraRealtimeService } from './infra-realtime.service';
import { WebSocketService } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

export interface PrintQueueSettings {
  defaultPrinter?: string;
  defaultPaperSize?: string;
  defaultQuality?: string;
  defaultColorMode?: string;
  autoRefreshInterval?: number;
}

@Injectable({ providedIn: 'root' })
export class PrintQueueStateService implements OnDestroy {
  private readonly printApi = inject(PrintApiService);
  private readonly infraRealtime = inject(InfraRealtimeService);
  private readonly ws = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private readonly injector = inject(Injector);
  readonly toast = inject(ToastService);

  // ─── Core state ──────────────────────────────────────
  readonly printers = signal<Printer[]>([]);
  readonly statuses = signal<BridgePrinterStatus[]>([]);
  readonly allJobs = signal<PrintJob[]>([]);
  readonly telemetry = signal<PrinterTelemetry[]>([]);
  readonly loading = signal(false);
  readonly printerQueueActions = signal<ReadonlySet<string>>(new Set());
  readonly wsConnected = computed(() => this.ws.isConnected());

  // ─── Pagination ──────────────────────────────────────
  readonly pageSize = signal(50);
  readonly currentOffset = signal(0);
  readonly totalJobs = signal(0);
  readonly loadingMore = signal(false);
  readonly hasMore = computed(() => this.allJobs().length < this.totalJobs());

  // ─── WebSocket reconnect UI ──────────────────────────
  readonly reconnectSeconds = computed(() => this.ws.wsReconnectSecondsLeft?.() ?? 0);
  readonly reconnectAttempt = computed(() => this.ws.wsReconnectAttempt?.() ?? 0);

  // ─── Supply forecast ─────────────────────────────────
  readonly forecastData = signal<{
    printer_id: string;
    printer_name: string;
    supplies: {
      name: string; color: string; current_level: number; daily_usage: number;
      days_remaining: number | null; estimated_empty_date: string | null; status: string;
    }[];
  }[]>([]);

  // ─── Filters ─────────────────────────────────────────
  private static readonly SS_KEY = 'print_queue_filters';
  readonly filterPrinter = signal(this.restoreFilter('printer', ''));
  readonly filterStatus = signal<string[]>(this.restoreFilter('status', []));
  readonly filterDateRange = signal<'today' | 'week' | 'month' | ''>('');
  readonly filterMyJobs = signal(false);
  readonly filterSearch = signal('');
  readonly filterSort = signal<'priority' | 'created_at' | ''>('');

  // ─── Search & date range ─────────────────────────────
  readonly searchQuery = signal(this.restoreFilter('search', ''));
  readonly dateRange = signal<{ from: Date; to: Date } | null>(null);
  readonly activeDatePreset = signal<'today' | 'yesterday' | 'week'>('today');
  readonly searchSubject = new Subject<string>();

  // ─── Batch selection ─────────────────────────────────
  readonly selectedJobs = signal<ReadonlySet<string>>(new Set());

  // ─── Expanded job detail ─────────────────────────────
  readonly expandedJobId = signal<string | null>(null);

  // ─── Job Groups ─────────────────────────────────────
  readonly groups = signal<PrintJobGroup[]>([]);
  readonly groupMap = computed(() => {
    const map = new Map<string, PrintJobGroup>();
    for (const g of this.groups()) map.set(g.id, g);
    return map;
  });

  // ─── Group Jobs (S15) ───────────────────────────────
  readonly groupByEnabled = signal(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('print_group_by') === 'true'
      : false
  );
  readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());

  // ─── Sound ───────────────────────────────────────────
  readonly soundEnabled = signal(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('print_sound_enabled') !== 'false'
      : true
  );

  // ─── Computed: current filters ───────────────────────
  readonly currentFilters = computed((): QueueFilters => {
    const filters: QueueFilters = {
      limit: this.pageSize(),
      offset: this.currentOffset(),
    };
    if (this.filterPrinter()) filters.printer_id = this.filterPrinter();
    if (this.filterStatus().length) filters.status = this.filterStatus().join(',');
    if (this.filterMyJobs()) {
      const userId = this.authService.currentUser()?.id;
      if (userId) filters.created_by = String(userId);
    }
    if (this.filterSearch()) filters.search = this.filterSearch();
    if (this.filterSort()) filters.sort_by = this.filterSort();
    const range = this.filterDateRange();
    if (range === 'today') {
      filters.date_from = new Date().toISOString().slice(0, 10);
      filters.date_to = filters.date_from;
    } else if (range === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      filters.date_from = d.toISOString().slice(0, 10);
    } else if (range === 'month') {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      filters.date_from = d.toISOString().slice(0, 10);
    }
    return filters;
  });

  // ─── Computed: filtered jobs ─────────────────────────
  readonly filteredJobs = computed(() => {
    let jobs = this.allJobs();
    const printer = this.filterPrinter();
    const statuses = this.filterStatus();
    if (printer) jobs = jobs.filter(j => j.printer_id === printer);
    if (statuses.length) jobs = jobs.filter(j => statuses.includes(j.status));
    const query = this.searchQuery().toLowerCase().trim();
    if (query) {
      jobs = jobs.filter(j =>
        (j.file_name ?? '').toLowerCase().includes(query) || j.id.toLowerCase().includes(query)
      );
    }
    return jobs;
  });

  // ─── Computed: active jobs (incl. new statuses) ──────
  private static readonly ACTIVE_STATUSES: ReadonlySet<string> = new Set([
    'queued', 'sending', 'processing', 'printing', 'converting', 'failed', 'cancelled',
    'paused', 'held', 'scheduled', 'splitting', 'finishing',
  ]);

  readonly activeJobs = computed(() =>
    this.filteredJobs()
      .filter(j => PrintQueueStateService.ACTIVE_STATUSES.has(j.status))
      .sort((a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
  );

  // ─── Computed: grouped active jobs (S15) ─────────────
  readonly groupedActiveJobs = computed(() => {
    const jobs = this.activeJobs();
    const groups = new Map<string, PrintJob[]>();
    const ungrouped: PrintJob[] = [];

    for (const job of jobs) {
      if (job.group_id) {
        const group = groups.get(job.group_id) ?? [];
        group.push(job);
        groups.set(job.group_id, group);
      } else {
        ungrouped.push(job);
      }
    }

    return {
      groups: [...groups.entries()].map(([id, items]) => ({
        id,
        jobs: items.sort((a, b) => (a.group_sequence ?? 0) - (b.group_sequence ?? 0)),
        completedCount: items.filter(j => j.status === 'completed').length,
        totalCount: items.length,
      })),
      ungrouped,
    };
  });

  toggleGroupBy(enabled: boolean): void {
    this.groupByEnabled.set(enabled);
    try { localStorage.setItem('print_group_by', String(enabled)); } catch { /* quota */ }
  }

  toggleGroupCollapse(groupId: string): void {
    this.collapsedGroups.update(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) { next.delete(groupId); } else { next.add(groupId); }
      return next;
    });
  }

  selectGroup(groupId: string): void {
    const group = this.groupedActiveJobs().groups.find(g => g.id === groupId);
    if (!group) return;
    this.selectedJobs.update(prev => {
      const next = new Set(prev);
      for (const j of group.jobs) next.add(j.id);
      return next;
    });
  }

  // ─── Computed: completed jobs ────────────────────────
  readonly completedJobs = computed(() => {
    const range = this.dateRange();
    const query = this.searchQuery().toLowerCase().trim();
    let jobs = this.allJobs().filter(j => j.status === 'completed' && j.completed_at);
    if (range) {
      const from = range.from.getTime();
      const to = range.to.getTime() + 86400000;
      jobs = jobs.filter(j => {
        const t = new Date(j.completed_at!).getTime();
        return t >= from && t < to;
      });
    } else {
      const today = new Date().toDateString();
      jobs = jobs.filter(j => new Date(j.completed_at!).toDateString() === today);
    }
    if (query) {
      jobs = jobs.filter(j =>
        (j.file_name ?? '').toLowerCase().includes(query) || j.id.toLowerCase().includes(query)
      );
    }
    return jobs.slice(0, 50);
  });

  // ─── Computed: queue health ──────────────────────────
  readonly queueHealth = computed(() => {
    const jobs = this.allJobs();
    const active = jobs.filter(j =>
      ['queued', 'converting', 'sending', 'processing', 'printing', 'splitting', 'finishing'].includes(j.status)
    );
    const failed = jobs.filter(j => j.status === 'failed').length;
    const paused = jobs.filter(j => j.status === 'paused').length;
    const held = jobs.filter(j => j.status === 'held').length;
    const ages = active.map(j => (Date.now() - new Date(j.created_at).getTime()) / 60000);
    const avgWait = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    return {
      total: active.length,
      failed,
      paused,
      held,
      avgWait,
      printersOnline: this.statuses().filter(s => s.online).length,
      printersTotal: this.printers().length,
    };
  });

  // ─── Computed: batch selection helpers ────────────────
  readonly allActiveSelected = computed(() => {
    const a = this.activeJobs();
    const s = this.selectedJobs();
    return a.length > 0 && a.every(j => s.has(j.id));
  });

  readonly someActiveSelected = computed(() =>
    this.activeJobs().some(j => this.selectedJobs().has(j.id))
  );

  readonly hasRetryableSelected = computed(() =>
    this.activeJobs().some(j =>
      this.selectedJobs().has(j.id) && ['failed', 'cancelled'].includes(j.status)
    )
  );

  readonly hasPausableSelected = computed(() =>
    this.activeJobs().some(j =>
      this.selectedJobs().has(j.id) && ['queued', 'sending'].includes(j.status)
    )
  );

  readonly scheduledJobs = computed(() =>
    this.filteredJobs().filter(j => j.status === 'scheduled')
      .sort((a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime())
  );

  readonly finishingJobs = computed(() =>
    this.filteredJobs().filter(j => j.status === 'finishing' || j.finishing_status === 'pending')
  );

  readonly hasHoldableSelected = computed(() =>
    this.activeJobs().some(j => this.selectedJobs().has(j.id) && ['queued', 'scheduled'].includes(j.status))
  );

  readonly hasResumableSelected = computed(() =>
    this.activeJobs().some(j => this.selectedJobs().has(j.id) && j.status === 'paused')
  );

  readonly hasReleasableSelected = computed(() =>
    this.activeJobs().some(j => this.selectedJobs().has(j.id) && j.status === 'held')
  );

  // ─── Supply alerts ──────────────────────────────────
  readonly supplyAlerts = signal<{ printer_id: string; supply: string; level: number; threshold: number }[]>([]);

  // ─── Settings persistence ───────────────────────────
  private static readonly SETTINGS_KEY = 'print_queue_settings';

  readonly savedSettings = signal<PrintQueueSettings>(this.loadSettings());

  private loadSettings(): PrintQueueSettings {
    try {
      const raw = localStorage.getItem(PrintQueueStateService.SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  saveSettings(settings: PrintQueueSettings): void {
    this.savedSettings.set(settings);
    try { localStorage.setItem(PrintQueueStateService.SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota */ }
  }

  // ─── Private state ──────────────────────────────────
  private interval?: ReturnType<typeof setInterval>;
  private prevJobStatuses = new Map<string, string>();
  private lastUpdateTs = new Map<string, number>();
  private initialized = false;

  constructor() {
    // Filter changes: reset offset and reload
    effect(() => {
      this.filterPrinter();
      this.filterStatus();
      this.filterDateRange();
      this.filterMyJobs();
      this.filterSearch();
      this.filterSort();
      untracked(() => {
        if (!this.initialized) return;
        this.currentOffset.set(0);
        this.refresh();
      });
    });

    // Reload on WS reconnect
    effect(() => {
      const connected = this.wsConnected();
      const attempt = this.reconnectAttempt();
      if (connected && attempt > 0) {
        untracked(() => this.refresh());
      }
    });

    // WS: full state sync
    effect(() => {
      const syncJobs = this.infraRealtime.activePrintJobs();
      if (!syncJobs.length) return;
      this.allJobs.update(current => {
        const map = new Map(current.map(j => [j.id, j]));
        for (const sj of syncJobs) {
          if (!map.has(sj.id)) {
            map.set(sj.id, {
              id: sj.id, printer_id: sj.printer_id, status: sj.status as PrintJob['status'],
              file_name: sj.file_name ?? '', file_url: '', paper_size: sj.paper_size,
              copies: sj.copies, created_at: sj.created_at, studio_id: sj.studio_id,
            } as PrintJob);
          } else {
            const existing = map.get(sj.id)!;
            map.set(sj.id, { ...existing, status: sj.status as PrintJob['status'] });
          }
        }
        return [...map.values()];
      });
    });

    // WS: incremental print job updates + sound
    effect(() => {
      const update = this.infraRealtime.printJobUpdate();
      if (!update) return;
      const dedupKey = `${update.job_id}:${update.status}`;
      const now = Date.now();
      const lastTs = this.lastUpdateTs.get(dedupKey);
      if (lastTs && (now - lastTs) < 500) return;
      this.lastUpdateTs.set(dedupKey, now);

      const prevStatus = this.prevJobStatuses.get(update.job_id);
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === update.job_id
          ? { ...j, status: update.status as PrintJob['status'], progress_percent: update.progress_percent }
          : j
        )
      );
      if (this.soundEnabled() && prevStatus && prevStatus !== update.status) {
        if (update.status === 'completed') this.playSound('success');
        else if (update.status === 'failed') this.playSound('error');
      }
      this.prevJobStatuses.set(update.job_id, update.status);
    });

    // WS: printer status updates
    effect(() => {
      const update = this.infraRealtime.printerStatus();
      if (!update) return;
      this.statuses.update(list =>
        list.map(s => s.printer_name === update.printer_name
          ? { ...s, online: update.status !== 'offline' }
          : s
        )
      );
    });

    // WS: queue paused
    effect(() => {
      const ev = this.infraRealtime.printQueuePaused();
      if (!ev) return;
      const printerId = ev.printer_id;
      this.printers.update(list =>
        list.map(p => p.id === printerId
          ? { ...p, queue_paused: true }
          : p
        )
      );
    });

    // WS: queue resumed
    effect(() => {
      const ev = this.infraRealtime.printQueueResumed();
      if (!ev) return;
      const printerId = ev.printer_id;
      this.printers.update(list =>
        list.map(p => p.id === printerId
          ? { ...p, queue_paused: false }
          : p
        )
      );
    });

    // WS: copy progress
    effect(() => {
      const progress = this.infraRealtime.printCopyProgress();
      if (!progress) return;
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === progress.job_id
          ? { ...j, progress_current_copy: progress.current_copy, progress_total_copies: progress.total_copies }
          : j
        )
      );
    });

    // WS: supply alerts broadcast (S12)
    effect(() => {
      const alert = this.infraRealtime.printSupplyAlert();
      if (!alert) return;
      const printerId = alert.printer_id;
      const alertItems = alert.alerts;
      if (!alertItems?.length) return;
      this.supplyAlerts.update(prev => {
        const filtered = prev.filter(a => a.printer_id !== printerId);
        const incoming = alertItems.map(a => ({
          printer_id: printerId,
          supply: a.name,
          level: a.level,
          threshold: 20,
        }));
        return [...filtered, ...incoming];
      });
      if (this.soundEnabled()) this.playSound('error');
    });

    // Persist filters to sessionStorage
    effect(() => {
      const data = {
        printer: this.filterPrinter(),
        status: this.filterStatus(),
        search: this.searchQuery(),
      };
      try {
        sessionStorage.setItem(PrintQueueStateService.SS_KEY, JSON.stringify(data));
      } catch { /* quota */ }
    });

    // Search debounce
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
    ).subscribe(q => this.searchQuery.set(q));

    afterNextRender(() => {
      this.initialized = true;
      this.infraRealtime.subscribe();
      this.infraRealtime.requestPrintSync();
      this.refresh();
      this.interval = setInterval(() => this.refresh(), 60_000);
    });
  }

  ngOnDestroy(): void {
    this.infraRealtime.unsubscribe();
    if (this.interval) clearInterval(this.interval);
    this.lastUpdateTs.clear();
  }

  // ─── Data loading ────────────────────────────────────
  refresh(): void {
    this.lastUpdateTs.clear();
    this.loading.set(true);
    let pending = 2;
    const done = () => { if (--pending === 0) this.loading.set(false); };

    this.printApi.getPrinters().subscribe({
      next: printers => { this.printers.set(printers); done(); },
      error: done,
    });
    this.fetchJobs().subscribe({
      next: resp => {
        this.allJobs.set(resp.jobs);
        this.totalJobs.set(resp.total);
        for (const j of resp.jobs) this.prevJobStatuses.set(j.id, j.status);
        done();
      },
      error: done,
    });
    this.printApi.getPrinterStatuses().subscribe({
      next: resp => this.statuses.set(resp.printers ?? []),
    });
    this.printApi.getTelemetry().subscribe({
      next: data => this.telemetry.set(data),
    });
    this.printApi.getConsumableForecast().subscribe({
      next: data => this.forecastData.set(data),
    });
    this.printApi.getJobGroups().subscribe({
      next: groups => this.groups.set(groups),
    });
    this.printApi.getConsumableAlerts().subscribe({
      next: alerts => this.supplyAlerts.set(
        alerts.map(a => ({
          printer_id: a.id,
          supply: a.consumable_type,
          level: a.percent_remaining ?? Math.round((a.current_amount / (a.low_threshold || 1)) * 100),
          threshold: a.low_threshold,
        }))
      ),
    });
  }

  private fetchJobs() {
    return this.printApi.getQueue(this.currentFilters());
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.currentOffset.update(v => v + this.pageSize());
    this.fetchJobs().subscribe({
      next: resp => {
        this.allJobs.update(prev => [...prev, ...resp.jobs]);
        this.totalJobs.set(resp.total);
        for (const j of resp.jobs) this.prevJobStatuses.set(j.id, j.status);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  // ─── Selection actions ───────────────────────────────
  toggleSelection(id: string): void {
    this.selectedJobs.update(p => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  selectAllActive(): void {
    this.selectedJobs.set(new Set(this.activeJobs().map(j => j.id)));
  }

  deselectAll(): void {
    this.selectedJobs.set(new Set());
  }

  toggleExpanded(jobId: string): void {
    this.expandedJobId.update(prev => prev === jobId ? null : jobId);
  }

  // ─── Job actions ─────────────────────────────────────
  cancelJob(jobId: string): void {
    this.printApi.cancelJob(jobId).subscribe(() => this.refresh());
  }

  retryJob(jobId: string): void {
    this.printApi.retryJob(jobId).subscribe(() => this.refresh());
  }

  reprintJob(jobId: string): void {
    this.printApi.reprintJob(jobId).subscribe(() => this.refresh());
  }

  pauseJob(jobId: string): void {
    this.printApi.pauseJob(jobId).subscribe(() => {
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === jobId ? { ...j, status: 'paused' as PrintJob['status'] } : j)
      );
    });
  }

  resumeJob(jobId: string): void {
    this.printApi.resumeJob(jobId).subscribe(() => {
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === jobId ? { ...j, status: 'queued' as PrintJob['status'] } : j)
      );
    });
  }

  holdJob(jobId: string): void {
    this.printApi.holdJob(jobId).subscribe(() => {
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === jobId ? { ...j, status: 'held' as PrintJob['status'] } : j)
      );
    });
  }

  releaseJob(jobId: string): void {
    this.printApi.releaseJob(jobId).subscribe(() => {
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === jobId ? { ...j, status: 'queued' as PrintJob['status'] } : j)
      );
    });
  }

  printerQueueBusy(printerId: string): boolean {
    return this.printerQueueActions().has(printerId);
  }

  pausePrinterQueue(printer: Printer): void {
    if (this.printerQueueBusy(printer.id)) return;
    const reason = 'Остановлено оператором';
    this.setPrinterQueueAction(printer.id, true);
    this.printApi.pausePrinterQueue(printer.id, reason).pipe(
      finalize(() => this.setPrinterQueueAction(printer.id, false)),
    ).subscribe({
      next: () => {
        this.printers.update(printers => printers.map(current =>
          current.id === printer.id
            ? {
              ...current,
              queue_paused: true,
              queue_paused_at: new Date().toISOString(),
              queue_paused_reason: reason,
            }
            : current
        ));
        this.toast.success(`Очередь ${printer.name} поставлена на паузу`);
        this.refresh();
      },
      error: () => this.toast.error('Не удалось поставить очередь принтера на паузу'),
    });
  }

  resumePrinterQueue(printer: Printer): void {
    if (this.printerQueueBusy(printer.id)) return;
    this.setPrinterQueueAction(printer.id, true);
    this.printApi.resumePrinterQueue(printer.id).pipe(
      finalize(() => this.setPrinterQueueAction(printer.id, false)),
    ).subscribe({
      next: () => {
        this.printers.update(printers => printers.map(current =>
          current.id === printer.id
            ? {
              ...current,
              queue_paused: false,
              queue_paused_at: undefined,
              queue_paused_reason: undefined,
            }
            : current
        ));
        this.toast.success(`Очередь ${printer.name} возобновлена`);
        this.refresh();
      },
      error: () => this.toast.error('Не удалось возобновить очередь принтера'),
    });
  }

  raisePriority(job: PrintJob): void {
    const newPriority = Math.min(10, (job.priority ?? 0) + 3);
    this.printApi.setPriority(job.id, newPriority).subscribe(() => {
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === job.id ? { ...j, priority: newPriority } : j)
      );
      this.toast.success(`Приоритет: ${newPriority}`);
    });
  }

  lowerPriority(job: PrintJob): void {
    const newPriority = Math.max(0, (job.priority ?? 0) - 3);
    this.printApi.setPriority(job.id, newPriority).subscribe(() => {
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === job.id ? { ...j, priority: newPriority } : j)
      );
      this.toast.success(`Приоритет: ${newPriority}`);
    });
  }

  setExactPriority(job: PrintJob, priority: number): void {
    this.printApi.setPriority(job.id, priority).subscribe(() => {
      this.allJobs.update(jobs =>
        jobs.map(j => j.id === job.id ? { ...j, priority } : j)
      );
    });
  }

  reassignJob(jobId: string, targetPrinterId: string): void {
    this.printApi.reassignJob(jobId, targetPrinterId).subscribe({
      next: () => {
        this.toast.success('Задание переназначено');
        this.refresh();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Ошибка переназначения'),
    });
  }

  updateFinishingOps(jobId: string, ops: string[]): void {
    this.printApi.updateFinishingOps(jobId, ops).subscribe({
      next: () => {
        this.allJobs.update(jobs =>
          jobs.map(j => j.id === jobId ? { ...j, finishing_ops: ops } : j)
        );
        this.toast.success('Финишная обработка обновлена');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Ошибка обновления'),
    });
  }

  // ─── Group actions ──────────────────────────────────
  createGroup(name: string, _customerName?: string): void {
    this.printApi.createJobGroup({ name, job_ids: [] }).subscribe({
      next: group => {
        this.groups.update(prev => [...prev, group]);
        this.toast.success('Группа создана');
      },
    });
  }

  assignToGroup(jobId: string, groupId: string): void {
    this.printApi.assignJobToGroup(jobId, groupId).subscribe({
      next: () => {
        this.allJobs.update(jobs =>
          jobs.map(j => j.id === jobId ? { ...j, group_id: groupId } : j)
        );
      },
    });
  }

  removeFromGroup(jobId: string): void {
    this.printApi.removeJobFromGroup(jobId).subscribe({
      next: () => {
        this.allJobs.update(jobs =>
          jobs.map(j => j.id === jobId ? { ...j, group_id: undefined, group_sequence: undefined } : j)
        );
      },
    });
  }

  pauseGroup(groupId: string): void {
    const group = this.groupedActiveJobs().groups.find(g => g.id === groupId);
    if (!group) return;
    const ids = group.jobs.filter(j => ['queued', 'sending'].includes(j.status)).map(j => j.id);
    if (!ids.length) return;
    forkJoin(ids.map(id => this.printApi.pauseJob(id))).subscribe(() => this.refresh());
  }

  cancelGroup(groupId: string): void {
    const group = this.groupedActiveJobs().groups.find(g => g.id === groupId);
    if (!group) return;
    const ids = group.jobs.filter(j => !['completed', 'cancelled'].includes(j.status)).map(j => j.id);
    if (!ids.length) return;
    forkJoin(ids.map(id => this.printApi.cancelJob(id))).subscribe(() => this.refresh());
  }

  raiseGroupPriority(groupId: string): void {
    const group = this.groupedActiveJobs().groups.find(g => g.id === groupId);
    if (!group) return;
    forkJoin(
      group.jobs.map(j => this.printApi.setPriority(j.id, Math.min(10, (j.priority ?? 0) + 3)))
    ).subscribe(() => this.refresh());
  }

  // ─── Bulk actions ────────────────────────────────────
  bulkCancel(): void {
    const ids = [...this.selectedJobs()];
    forkJoin(
      ids.map(id => this.printApi.cancelJob(id))
    ).subscribe(() => { this.toast.success(`Отменено ${ids.length} заданий`); this.deselectAll(); this.refresh(); });
  }

  bulkRetry(): void {
    const ids = [...this.selectedJobs()].filter(id =>
      this.activeJobs().some(j => j.id === id && ['failed', 'cancelled'].includes(j.status))
    );
    forkJoin(ids.map(id => this.printApi.retryJob(id)))
      .subscribe(() => { this.toast.success(`Повторяется ${ids.length} заданий`); this.deselectAll(); this.refresh(); });
  }

  bulkRaisePriority(): void {
    const jobs = this.activeJobs().filter(j => this.selectedJobs().has(j.id));
    forkJoin(
      jobs.map(j => this.printApi.setPriority(j.id, Math.min(10, (j.priority ?? 0) + 3)))
    ).subscribe(() => { this.toast.success(`Приоритет повышен для ${jobs.length} заданий`); this.deselectAll(); this.refresh(); });
  }

  bulkPause(): void {
    const ids = [...this.selectedJobs()].filter(id =>
      this.activeJobs().some(j => j.id === id && ['queued', 'sending'].includes(j.status))
    );
    forkJoin(ids.map(id => this.printApi.pauseJob(id)))
      .subscribe(() => { this.toast.success(`Приостановлено ${ids.length} заданий`); this.deselectAll(); this.refresh(); });
  }

  bulkHold(): void {
    const ids = [...this.selectedJobs()].filter(id =>
      this.activeJobs().some(j => j.id === id && ['queued', 'scheduled'].includes(j.status))
    );
    if (!ids.length) return;
    forkJoin(ids.map(id => this.printApi.holdJob(id))).subscribe(() => { this.toast.success(`Удержано ${ids.length} заданий`); this.deselectAll(); this.refresh(); });
  }

  bulkRelease(): void {
    const ids = [...this.selectedJobs()].filter(id =>
      this.activeJobs().some(j => j.id === id && j.status === 'held')
    );
    if (!ids.length) return;
    forkJoin(ids.map(id => this.printApi.releaseJob(id))).subscribe(() => { this.toast.success(`Отпущено ${ids.length} заданий`); this.deselectAll(); this.refresh(); });
  }

  bulkResume(): void {
    const ids = [...this.selectedJobs()].filter(id =>
      this.activeJobs().some(j => j.id === id && j.status === 'paused')
    );
    if (!ids.length) return;
    forkJoin(ids.map(id => this.printApi.resumeJob(id))).subscribe(() => { this.toast.success(`Возобновлено ${ids.length} заданий`); this.deselectAll(); this.refresh(); });
  }

  // ─── Sound ───────────────────────────────────────────
  toggleSound(enabled: boolean): void {
    this.soundEnabled.set(enabled);
    localStorage.setItem('print_sound_enabled', String(enabled));
  }

  private playSound(type: 'success' | 'error'): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = type === 'success' ? 800 : 300;
      osc.type = type === 'success' ? 'sine' : 'square';
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // AudioContext not available (SSR)
    }
  }

  // ─── Filter helpers ──────────────────────────────────
  private restoreFilter<T>(key: string, fallback: T): T {
    try {
      const raw = sessionStorage.getItem(PrintQueueStateService.SS_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed[key] ?? fallback;
    } catch { return fallback; }
  }

  onDatePreset(preset: 'today' | 'yesterday' | 'week'): void {
    this.activeDatePreset.set(preset);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    switch (preset) {
      case 'today': this.dateRange.set(null); break;
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(now.getDate() - 1);
        this.dateRange.set({ from: startOfDay(y), to: startOfDay(y) });
        break;
      }
      case 'week': {
        const w = new Date(now);
        w.setDate(now.getDate() - 7);
        this.dateRange.set({ from: startOfDay(w), to: startOfDay(now) });
        break;
      }
    }
  }

  private setPrinterQueueAction(printerId: string, active: boolean): void {
    this.printerQueueActions.update(current => {
      const next = new Set(current);
      if (active) {
        next.add(printerId);
      } else {
        next.delete(printerId);
      }
      return next;
    });
  }
}
