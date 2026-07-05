import { Injectable, inject, signal, computed } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { PosApiService, PosShift, ShiftReport } from './pos-api.service';
import { PosService } from './pos.service';
import { StudioService } from './studio.service';
import { AuthService } from '../../../core/services/auth.service';
import { PosSoundService } from './pos-sound.service';

type FiscalShiftWaitMode = 'open' | 'close';

interface BackendErrorLike {
  error?: {
    error?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class PosShiftService {
  private readonly posApi = inject(PosApiService);
  private readonly posService = inject(PosService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly soundService = inject(PosSoundService);

  readonly shift = signal<PosShift | null>(null);
  readonly shiftLoading = signal(true);
  readonly shiftOpening = signal(false);
  readonly fiscalShiftOpening = signal(false);
  readonly fiscalShiftClosing = signal(false);
  readonly shiftClosing = signal(false);
  readonly skipShift = signal(false);
  readonly showCloseShift = signal(false);
  readonly showReport = signal(false);
  readonly reportLoading = signal(false);
  readonly shiftReport = signal<ShiftReport | null>(null);

  private readonly studioService = inject(StudioService);
  private fiscalShiftPollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private fiscalShiftWaitStartedAt = 0;

  readonly studioName = computed(() => {
    const s = this.shift();
    if (!s) return '';
    return this.studioService.studioName(s.studio_id);
  });

  checkCurrentShift(employeeId: string): void {
    this.shiftLoading.set(true);
    this.posApi.getCurrentShift(employeeId).subscribe({
      next: (shift) => {
        if (shift) {
          this.shift.set(shift);
          this.posService.shiftId.set(shift.id);
          this.posService.studioId.set(shift.studio_id);
        }
        this.shiftLoading.set(false);
      },
      error: () => this.shiftLoading.set(false),
    });
  }

  openShift(studioId: string, cashAtOpen: number | null, fiscalEnabled = true): void {
    const user = this.authService.currentUser();
    if (!user?.id || !studioId) return;
    if (cashAtOpen == null || !Number.isFinite(cashAtOpen) || cashAtOpen < 0) {
      this.snackBar.open('Укажите наличные в кассе', 'OK', { duration: 3000 });
      return;
    }

    this.shiftOpening.set(true);
    this.posApi.openShiftWithFiscalCommand({
      employee_id: user.id,
      studio_id: studioId,
      cash_at_open: cashAtOpen,
      fiscal_enabled: fiscalEnabled,
    }).subscribe({
      next: (response) => {
        const shift = response.shift;
        this.shift.set(shift);
        this.posService.shiftId.set(shift.id);
        this.posService.studioId.set(shift.studio_id);
        this.posService.employeeId.set(user.id);
        this.shiftOpening.set(false);
        this.soundService.play('shift_open');

        if (fiscalEnabled && response.fiscalTransactionId) {
          this.fiscalShiftOpening.set(true);
          this.snackBar.open(`Смена #${shift.shift_number} открыта, ФР открывается на АТОЛ`, 'OK', { duration: 4000 });
          this.waitForFiscalShiftOpen(shift, response.fiscalTransactionId);
          return;
        }

        if (fiscalEnabled && !shift.fiscal_enabled) {
          this.snackBar.open(`Смена #${shift.shift_number} открыта, но команда ФР не создана`, 'OK', { duration: 5000 });
          return;
        }

        this.snackBar.open(`Смена #${shift.shift_number} открыта`, 'OK', { duration: 3000 });
      },
      error: (err: { error?: { error?: string } }) => {
        this.shiftOpening.set(false);
        this.snackBar.open(`Ошибка: ${err.error?.error || 'Не удалось открыть смену'}`, 'OK', { duration: 5000 });
      },
    });
  }

  openFiscalShift(): void {
    void this.openFiscalShiftForPayment();
  }

  async openFiscalShiftForPayment(): Promise<boolean> {
    const s = this.shift();
    if (!s || this.fiscalShiftOpening() || this.fiscalShiftClosing()) return false;
    if (s.fiscal_status?.available !== true) {
      this.snackBar.open('Для этой точки фискальный регистратор не настроен', 'OK', { duration: 5000 });
      return false;
    }
    if (s.fiscal_status.ready === true) return true;

    this.clearFiscalShiftPolling();
    this.fiscalShiftOpening.set(true);
    try {
      const response = await firstValueFrom(this.posApi.openShiftFiscalWithCommand(s.id));
      this.shift.set(response.shift);
      this.posService.shiftId.set(response.shift.id);
      this.posService.studioId.set(response.shift.studio_id);

      if (response.shift.fiscal_status?.ready === true) {
        this.fiscalShiftOpening.set(false);
        this.soundService.play('shift_open');
        this.snackBar.open('Фискальная смена уже открыта на АТОЛ', 'OK', { duration: 3000 });
        return true;
      }

      if (!response.fiscalTransactionId) {
        this.fiscalShiftOpening.set(false);
        this.snackBar.open('Команда открытия ФР не создана', 'OK', { duration: 5000 });
        return false;
      }

      this.snackBar.open('Команда открытия ФР отправлена на АТОЛ', 'OK', { duration: 4000 });
      return await this.waitForFiscalShiftTransaction(response.shift, response.fiscalTransactionId, 'open');
    } catch (err: unknown) {
      this.fiscalShiftOpening.set(false);
      this.snackBar.open(`Ошибка: ${this.backendErrorMessage(err, 'Не удалось открыть фискальную смену')}`, 'OK', {
        duration: 5000,
      });
      return false;
    }
  }

  async openShiftWithFiscalForPayment(studioId: string): Promise<boolean> {
    const user = this.authService.currentUser();
    if (!user?.id || !studioId || this.shiftOpening() || this.fiscalShiftOpening() || this.fiscalShiftClosing()) {
      return false;
    }

    this.clearFiscalShiftPolling();
    this.shiftOpening.set(true);
    this.fiscalShiftOpening.set(true);
    try {
      const response = await firstValueFrom(this.posApi.openShiftWithFiscalCommand({
        employee_id: user.id,
        studio_id: studioId,
        cash_at_open: 0,
        fiscal_enabled: true,
      }));

      const shift = response.shift;
      this.shift.set(shift);
      this.posService.shiftId.set(shift.id);
      this.posService.studioId.set(shift.studio_id);
      this.posService.employeeId.set(user.id);
      this.shiftOpening.set(false);

      if (shift.fiscal_status?.ready === true) {
        this.fiscalShiftOpening.set(false);
        this.soundService.play('shift_open');
        this.snackBar.open(`Смена #${shift.shift_number} и ФР открыты`, 'OK', { duration: 3000 });
        return true;
      }

      if (!response.fiscalTransactionId) {
        this.fiscalShiftOpening.set(false);
        this.snackBar.open(`Смена #${shift.shift_number} открыта, но команда ФР не создана`, 'OK', { duration: 5000 });
        return false;
      }

      this.snackBar.open(`Смена #${shift.shift_number} открыта, ФР открывается на АТОЛ`, 'OK', { duration: 4000 });
      return await this.waitForFiscalShiftTransaction(shift, response.fiscalTransactionId, 'open');
    } catch (err: unknown) {
      this.shiftOpening.set(false);
      this.fiscalShiftOpening.set(false);
      this.snackBar.open(`Ошибка: ${this.backendErrorMessage(err, 'Не удалось открыть смену с ФР')}`, 'OK', {
        duration: 5000,
      });
      return false;
    }
  }

  private waitForFiscalShiftOpen(shift: PosShift, transactionId: string): void {
    this.clearFiscalShiftPolling();
    this.fiscalShiftWaitStartedAt = Date.now();
    this.scheduleFiscalShiftPoll(shift, transactionId, 'open', 800);
  }

  closeFiscalShift(): void {
    const s = this.shift();
    if (!s || this.fiscalShiftOpening() || this.fiscalShiftClosing()) return;
    if (s.fiscal_status?.available !== true) {
      this.snackBar.open('Для этой точки фискальный регистратор не настроен', 'OK', { duration: 5000 });
      return;
    }
    if (s.fiscal_status.ready !== true) {
      this.snackBar.open('Фискальная смена уже закрыта', 'OK', { duration: 3000 });
      return;
    }

    this.fiscalShiftClosing.set(true);
    this.posApi.closeShiftFiscalWithCommand(s.id).subscribe({
      next: (response) => {
        this.shift.set(response.shift);
        this.posService.shiftId.set(response.shift.id);
        this.posService.studioId.set(response.shift.studio_id);

        if (response.shift.fiscal_status?.ready === false) {
          this.fiscalShiftClosing.set(false);
          this.refreshCurrentShiftSnapshot(response.shift);
          this.soundService.play('shift_close');
          this.snackBar.open('Фискальная смена уже закрыта на АТОЛ', 'OK', { duration: 3000 });
          return;
        }

        if (!response.fiscalTransactionId) {
          this.fiscalShiftClosing.set(false);
          this.snackBar.open('Команда закрытия ФР не создана', 'OK', { duration: 5000 });
          return;
        }

        this.snackBar.open('Команда закрытия ФР отправлена на АТОЛ', 'OK', { duration: 4000 });
        this.waitForFiscalShiftClose(response.shift, response.fiscalTransactionId);
      },
      error: (err: { error?: { error?: string } }) => {
        this.fiscalShiftClosing.set(false);
        this.snackBar.open(`Ошибка: ${err.error?.error || 'Не удалось закрыть фискальную смену'}`, 'OK', { duration: 5000 });
      },
    });
  }

  private waitForFiscalShiftClose(shift: PosShift, transactionId: string): void {
    this.clearFiscalShiftPolling();
    this.fiscalShiftWaitStartedAt = Date.now();
    this.scheduleFiscalShiftPoll(shift, transactionId, 'close', 800);
  }

  private scheduleFiscalShiftPoll(
    shift: PosShift,
    transactionId: string,
    mode: FiscalShiftWaitMode,
    delayMs = 1200,
  ): void {
    if (this.fiscalShiftPollTimeoutId) clearTimeout(this.fiscalShiftPollTimeoutId);
    this.fiscalShiftPollTimeoutId = setTimeout(() => {
      this.pollFiscalShiftCommand(shift, transactionId, mode);
    }, delayMs);
  }

  private pollFiscalShiftCommand(shift: PosShift, transactionId: string, mode: FiscalShiftWaitMode): void {
    if (this.shift()?.id !== shift.id) {
      this.setFiscalShiftWaiting(mode, false);
      this.clearFiscalShiftPolling();
      return;
    }

    this.posApi.getBridgeTransaction(transactionId).subscribe({
      next: (transaction) => {
        if (transaction.status === 'completed') {
          const completedShift = this.completedFiscalShift(shift, mode);
          this.setFiscalShiftWaiting(mode, false);
          this.clearFiscalShiftPolling();
          this.refreshCurrentShiftSnapshot(completedShift);
          this.soundService.play(mode === 'open' ? 'shift_open' : 'shift_close');
          this.snackBar.open(
            mode === 'open' ? 'Фискальная смена открыта на АТОЛ' : 'Фискальная смена закрыта на АТОЛ',
            'OK',
            { duration: 3000 },
          );
          return;
        }

        if (transaction.status === 'failed' || transaction.status === 'cancelled' || transaction.status === 'timeout') {
          this.setFiscalShiftWaiting(mode, false);
          this.clearFiscalShiftPolling();
          this.snackBar.open(
            transaction.error_message || (
              mode === 'open'
                ? 'АТОЛ27Ф не открыл фискальную смену'
                : 'АТОЛ27Ф не закрыл фискальную смену'
            ),
            'OK',
            { duration: 6000 },
          );
          return;
        }

        if (Date.now() - this.fiscalShiftWaitStartedAt > 60_000) {
          this.setFiscalShiftWaiting(mode, false);
          this.clearFiscalShiftPolling();
          this.snackBar.open(
            mode === 'open'
              ? 'АТОЛ27Ф не подтвердил открытие ФР за 60 секунд'
              : 'АТОЛ27Ф не подтвердил закрытие ФР за 60 секунд',
            'OK',
            { duration: 6000 },
          );
          return;
        }

        this.scheduleFiscalShiftPoll(shift, transactionId, mode);
      },
      error: () => {
        if (Date.now() - this.fiscalShiftWaitStartedAt > 60_000) {
          this.setFiscalShiftWaiting(mode, false);
          this.clearFiscalShiftPolling();
          this.snackBar.open(
            mode === 'open'
              ? 'Не удалось получить подтверждение открытия ФР от АТОЛ27Ф'
              : 'Не удалось получить подтверждение закрытия ФР от АТОЛ27Ф',
            'OK',
            { duration: 6000 },
          );
          return;
        }
        this.scheduleFiscalShiftPoll(shift, transactionId, mode);
      },
    });
  }

  private async waitForFiscalShiftTransaction(
    shift: PosShift,
    transactionId: string,
    mode: FiscalShiftWaitMode,
  ): Promise<boolean> {
    this.setFiscalShiftWaiting(mode, true);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= 60_000) {
      await this.delay(1200);

      if (this.shift()?.id !== shift.id) {
        this.setFiscalShiftWaiting(mode, false);
        return false;
      }

      try {
        const transaction = await firstValueFrom(this.posApi.getBridgeTransaction(transactionId));
        if (transaction.status === 'completed') {
          const completedShift = this.completedFiscalShift(shift, mode);
          this.setFiscalShiftWaiting(mode, false);
          this.refreshCurrentShiftSnapshot(completedShift);
          this.soundService.play(mode === 'open' ? 'shift_open' : 'shift_close');
          this.snackBar.open(
            mode === 'open' ? 'Фискальная смена открыта на АТОЛ' : 'Фискальная смена закрыта на АТОЛ',
            'OK',
            { duration: 3000 },
          );
          return true;
        }

        if (transaction.status === 'failed' || transaction.status === 'cancelled' || transaction.status === 'timeout') {
          this.setFiscalShiftWaiting(mode, false);
          this.snackBar.open(
            transaction.error_message || (
              mode === 'open'
                ? 'АТОЛ27Ф не открыл фискальную смену'
                : 'АТОЛ27Ф не закрыл фискальную смену'
            ),
            'OK',
            { duration: 6000 },
          );
          return false;
        }
      } catch {
        if (Date.now() - startedAt > 55_000) {
          this.setFiscalShiftWaiting(mode, false);
          this.snackBar.open(
            mode === 'open'
              ? 'Не удалось получить подтверждение открытия ФР от АТОЛ27Ф'
              : 'Не удалось получить подтверждение закрытия ФР от АТОЛ27Ф',
            'OK',
            { duration: 6000 },
          );
          return false;
        }
      }
    }

    this.setFiscalShiftWaiting(mode, false);
    this.snackBar.open(
      mode === 'open'
        ? 'АТОЛ27Ф не подтвердил открытие ФР за 60 секунд'
        : 'АТОЛ27Ф не подтвердил закрытие ФР за 60 секунд',
      'OK',
      { duration: 6000 },
    );
    return false;
  }

  private completedFiscalShift(fallbackShift: PosShift, mode: FiscalShiftWaitMode): PosShift {
    const currentShift = this.shift() ?? fallbackShift;
    const ready = mode === 'open';
    const completedShift: PosShift = {
      ...currentShift,
      fiscal_enabled: ready,
      fiscal_status: currentShift.fiscal_status
        ? {
            ...currentShift.fiscal_status,
            ready,
            source: 'transaction',
            command_status: 'completed',
          }
        : currentShift.fiscal_status,
    };
    this.shift.set(completedShift);
    return completedShift;
  }

  private setFiscalShiftWaiting(mode: FiscalShiftWaitMode, waiting: boolean): void {
    if (mode === 'open') {
      this.fiscalShiftOpening.set(waiting);
    } else {
      this.fiscalShiftClosing.set(waiting);
    }
  }

  private clearFiscalShiftPolling(): void {
    if (this.fiscalShiftPollTimeoutId) {
      clearTimeout(this.fiscalShiftPollTimeoutId);
      this.fiscalShiftPollTimeoutId = null;
    }
  }

  private refreshCurrentShiftSnapshot(fallbackShift: PosShift): void {
    const user = this.authService.currentUser();
    if (!user?.id) return;

    this.posApi.getCurrentShift(user.id).subscribe({
      next: (shift) => {
        if (!shift || shift.id !== fallbackShift.id) return;
        this.shift.set(shift);
        this.posService.shiftId.set(shift.id);
        this.posService.studioId.set(shift.studio_id);
      },
      error: () => undefined,
    });
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, delayMs);
    });
  }

  private backendErrorMessage(err: unknown, fallback: string): string {
    if (!this.isBackendErrorLike(err)) return fallback;
    return err.error?.error || fallback;
  }

  private isBackendErrorLike(err: unknown): err is BackendErrorLike {
    if (typeof err !== 'object' || err === null || !('error' in err)) return false;
    const body = err.error;
    if (body === undefined) return true;
    return typeof body === 'object' && body !== null && (!('error' in body) || typeof body.error === 'string');
  }

  closeShift(cashAtClose: number): void {
    const s = this.shift();
    const user = this.authService.currentUser();
    if (!s || !user?.id) return;

    this.clearFiscalShiftPolling();
    this.fiscalShiftOpening.set(false);
    this.fiscalShiftClosing.set(false);
    this.shiftClosing.set(true);
    this.posApi.closeShift({
      shift_id: s.id,
      employee_id: user.id,
      cash_at_close: cashAtClose || 0,
    }).subscribe({
      next: (_result) => {
        this.shift.set(null);
        this.posService.shiftId.set(null);
        this.posService.studioId.set(null);
        this.posService.clear();
        this.shiftClosing.set(false);
        this.showCloseShift.set(false);
        this.soundService.play('shift_close');
        this.snackBar.open('Смена закрыта', 'OK', { duration: 3000 });
      },
      error: (err: { error?: { error?: string } }) => {
        this.shiftClosing.set(false);
        this.snackBar.open(`Ошибка: ${err.error?.error || 'Не удалось закрыть смену'}`, 'OK', { duration: 5000 });
      },
    });
  }

  loadShiftReport(): void {
    const s = this.shift();
    if (!s) return;

    this.showReport.set(true);
    this.reportLoading.set(true);
    this.posApi.getShiftReport(s.id).subscribe({
      next: (report) => {
        this.shiftReport.set(report);
        this.reportLoading.set(false);
      },
      error: () => {
        this.reportLoading.set(false);
        this.snackBar.open('Не удалось загрузить отчёт', 'OK', { duration: 3000 });
      },
    });
  }

  updateShiftAfterReceipt(receiptTotal: number): void {
    const s = this.shift();
    if (s) {
      this.shift.set({
        ...s,
        total_sales: s.total_sales + receiptTotal,
        receipt_count: s.receipt_count + 1,
      });
    }
  }
}
