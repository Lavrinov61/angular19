import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CashControlOrphan,
  CashControlShift,
  PosApiService,
} from '../../services/pos-api.service';

type PeriodFilter = 'today' | 'yesterday' | '7d' | '30d';

interface DateRange {
  from: string;
  to: string;
}

interface SalesStudio {
  id: string;
  name: string;
  address: string | null;
  location_code: string | null;
}

interface SalesStudiosResponse {
  data?: SalesStudio[];
  studios?: SalesStudio[];
}

interface StudioFilterOption extends SalesStudio {
  label: string;
}

interface CashierSummary {
  employee_id: string;
  employee_name: string;
  shifts: number;
  reconciled: number;
  totalDiff: number;
  shortage: number;
  surplus: number;
}

interface CashControlTotals {
  totalDiff: number;
  shortageTotal: number;
  surplusTotal: number;
  shortageShifts: number;
  reconciledShifts: number;
  unreconciledShifts: number;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function rangeForPeriod(period: PeriodFilter): DateRange {
  const now = new Date();
  const to = endOfDay(now);
  const from = startOfDay(now);

  if (period === 'yesterday') {
    from.setDate(from.getDate() - 1);
    const yesterdayTo = endOfDay(from);
    return { from: from.toISOString(), to: yesterdayTo.toISOString() };
  }
  if (period === '7d') from.setDate(from.getDate() - 6);
  if (period === '30d') from.setDate(from.getDate() - 29);

  return { from: from.toISOString(), to: to.toISOString() };
}

function parsePeriod(value: unknown): PeriodFilter | null {
  switch (value) {
    case 'today':
    case 'yesterday':
    case '7d':
    case '30d':
      return value;
    default:
      return null;
  }
}

@Component({
  selector: 'app-cash-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './cash-control.component.html',
  styleUrl: './cash-control.component.scss',
})
export class CashControlComponent implements OnInit {
  private readonly posApi = inject(PosApiService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly period = signal<PeriodFilter>('7d');
  protected readonly selectedStudioId = signal('all');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly studios = signal<SalesStudio[]>([]);
  protected readonly shifts = signal<CashControlShift[]>([]);
  protected readonly orphanCash = signal<CashControlOrphan>({ count: 0, sum: 0, by_day: [], by_employee: [] });

  protected readonly studioOptions = computed<StudioFilterOption[]>(() =>
    this.studios().map((studio) => ({ ...studio, label: this.studioFilterLabel(studio) })),
  );

  protected readonly showStudioColumn = computed(() => this.selectedStudioId() === 'all');

  protected readonly byCashier = computed<CashierSummary[]>(() => {
    const map = new Map<string, CashierSummary>();
    for (const shift of this.shifts()) {
      const current = map.get(shift.employee_id) ?? {
        employee_id: shift.employee_id,
        employee_name: shift.employee_name,
        shifts: 0,
        reconciled: 0,
        totalDiff: 0,
        shortage: 0,
        surplus: 0,
      };
      current.shifts += 1;
      if (shift.reconciled && shift.diff !== null) {
        current.reconciled += 1;
        current.totalDiff += shift.diff;
        if (shift.diff < 0) current.shortage += shift.diff;
        else if (shift.diff > 0) current.surplus += shift.diff;
      }
      map.set(shift.employee_id, current);
    }
    return [...map.values()].sort((a, b) => a.totalDiff - b.totalDiff);
  });

  protected readonly totals = computed<CashControlTotals>(() => {
    let totalDiff = 0;
    let shortageTotal = 0;
    let surplusTotal = 0;
    let shortageShifts = 0;
    let reconciledShifts = 0;
    let unreconciledShifts = 0;
    for (const shift of this.shifts()) {
      if (shift.reconciled && shift.diff !== null) {
        reconciledShifts += 1;
        totalDiff += shift.diff;
        if (shift.diff < 0) {
          shortageTotal += shift.diff;
          shortageShifts += 1;
        } else if (shift.diff > 0) {
          surplusTotal += shift.diff;
        }
      } else {
        unreconciledShifts += 1;
      }
    }
    return { totalDiff, shortageTotal, surplusTotal, shortageShifts, reconciledShifts, unreconciledShifts };
  });

  ngOnInit(): void {
    this.loadStudios();
    this.load();
  }

  protected reload(): void {
    this.load();
  }

  protected onPeriodChange(value: unknown): void {
    const period = parsePeriod(value);
    if (!period) return;
    this.period.set(period);
    this.load();
  }

  protected onStudioChange(value: unknown): void {
    if (typeof value !== 'string') return;
    this.selectedStudioId.set(value);
    this.load();
  }

  protected periodLabel(): string {
    switch (this.period()) {
      case 'today': return 'Сегодня';
      case 'yesterday': return 'Вчера';
      case '7d': return '7 дней';
      case '30d': return '30 дней';
    }
  }

  protected selectedStudioLabel(): string {
    if (this.selectedStudioId() === 'all') return 'Все точки';
    return this.studioOptions().find((studio) => studio.id === this.selectedStudioId())?.label ?? 'Точка';
  }

  protected diffClass(diff: number | null): string {
    if (diff === null) return 'diff-none';
    if (diff < 0) return 'diff-negative';
    if (diff > 0) return 'diff-positive';
    return 'diff-zero';
  }

  private loadStudios(): void {
    this.http.get<SalesStudiosResponse>('/api/studios', { params: { limit: '50' } })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const studios = response.data ?? response.studios ?? [];
          this.studios.set(studios.filter((studio) => !!studio.id));
        },
        error: () => this.studios.set([]),
      });
  }

  private load(): void {
    const range = rangeForPeriod(this.period());
    const studioId = this.selectedStudioId();
    this.loading.set(true);
    this.error.set(null);

    this.posApi.getCashControl({
      date_from: range.from,
      date_to: range.to,
      ...(studioId !== 'all' ? { studio_id: studioId } : {}),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.shifts.set(data.shifts);
        this.orphanCash.set(data.orphan_cash);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Не удалось загрузить контроль кассы. Проверьте доступ (нужно право «Отчёты»).');
      },
    });
  }

  private studioFilterLabel(studio: SalesStudio): string {
    switch (studio.location_code) {
      case 'soborny':
        return 'Соборный 21';
      case 'barrikadnaya':
      case 'barrikadnaya-4':
        return 'Баррикадная 4';
      default:
        return studio.name || studio.address || 'Точка';
    }
  }
}
