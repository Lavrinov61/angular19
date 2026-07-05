import {
  Component, ChangeDetectionStrategy, input, output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DecimalPipe } from '@angular/common';

export type CardPaymentStatus =
  | 'waiting'
  | 'processing'
  | 'fiscalizing'
  | 'success'
  | 'error'
  | 'fiscal_error'
  | 'in_doubt'
  | 'cancelled';

@Component({
  selector: 'app-pos-card-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, DecimalPipe],
  template: `
    <div class="card-progress">
      @switch (status()) {
        @case ('waiting') {
          <div class="status-block waiting">
            <mat-icon class="nfc-icon pulse">contactless</mat-icon>
            <p class="status-text">Приложите или вставьте карту</p>
            <p class="status-amount">{{ amount() | number:'1.0-0' }} ₽</p>
            <button mat-stroked-button class="cancel-btn" (click)="cancelRequested.emit()">
              Отменить
            </button>
          </div>
        }
        @case ('processing') {
          <div class="status-block processing">
            <mat-spinner diameter="48" />
            <p class="status-text">Обработка...</p>
            <p class="status-amount">{{ amount() | number:'1.0-0' }} ₽</p>
          </div>
        }
        @case ('fiscalizing') {
          <div class="status-block fiscalizing">
            <mat-spinner diameter="48" />
            <p class="status-text">Оплата одобрена, пробиваем чек</p>
            <p class="status-amount">{{ amount() | number:'1.0-0' }} ₽</p>
          </div>
        }
        @case ('success') {
          <div class="status-block success">
            <mat-icon class="result-icon success-icon check-appear">check_circle</mat-icon>
            <p class="status-text">Оплата и чек готовы</p>
          </div>
        }
        @case ('error') {
          <div class="status-block error">
            <mat-icon class="result-icon error-icon">error</mat-icon>
            <p class="status-text">Оплата не прошла</p>
            @if (errorMessage()) {
              <p class="status-detail">{{ errorMessage() }}</p>
            }
            <button mat-flat-button class="retry-btn" (click)="retryRequested.emit()">
              Попробовать ещё раз
            </button>
          </div>
        }
        @case ('fiscal_error') {
          <div class="status-block error">
            <mat-icon class="result-icon error-icon">receipt_long</mat-icon>
            <p class="status-text">Чек не пробит</p>
            @if (errorMessage()) {
              <p class="status-detail">{{ errorMessage() }}</p>
            }
            <button mat-flat-button class="retry-btn" (click)="retryRequested.emit()">
              Повторить чек
            </button>
          </div>
        }
        @case ('in_doubt') {
          <div class="status-block in-doubt">
            <mat-icon class="result-icon in-doubt-icon">help_outline</mat-icon>
            <p class="status-text">Статус оплаты неизвестен</p>
            <p class="status-detail">
              Деньги могли списаться, проверьте, не запускайте оплату повторно.
            </p>
            @if (errorMessage()) {
              <p class="status-detail">{{ errorMessage() }}</p>
            }
            <div class="in-doubt-actions">
              <button mat-flat-button class="retry-btn" (click)="acknowledgeRequested.emit()">
                Проверить позже
              </button>
              <button mat-stroked-button class="cancel-btn" (click)="closeRequested.emit()">
                Закрыть
              </button>
            </div>
          </div>
        }
        @case ('cancelled') {
          <div class="status-block cancelled">
            <mat-icon class="result-icon">cancel</mat-icon>
            <p class="status-text">Отменено</p>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .card-progress {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 280px;
    }

    .status-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      text-align: center;
      padding: 24px;
    }

    .nfc-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: var(--mat-sys-primary);
    }

    .pulse {
      animation: pulse 2s ease-in-out infinite;
    }

    .status-text {
      font-size: 18px;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
      margin: 0;
    }

    .status-amount {
      font-size: 32px;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
      margin: 0;
    }

    .status-detail {
      max-width: min(360px, 70vw);
      color: var(--mat-sys-on-surface-variant);
      font-size: 14px;
      line-height: 1.35;
      margin: -6px 0 0;
      overflow-wrap: anywhere;
    }

    .result-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
    }

    .success-icon {
      color: var(--mat-sys-primary);
    }

    .check-appear {
      animation: check-appear 0.4s ease-out;
    }

    .error-icon {
      color: var(--mat-sys-error);
    }

    .in-doubt-icon {
      color: var(--mat-sys-tertiary, #b58900);
    }

    .in-doubt-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
    }

    .cancel-btn, .retry-btn {
      min-height: 48px;
      min-width: 160px;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes check-appear {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }
  `],
})
export class PosCardProgressComponent {
  readonly amount = input.required<number>();
  readonly status = input.required<CardPaymentStatus>();
  readonly errorMessage = input<string | null>(null);
  readonly cancelRequested = output<void>();
  readonly retryRequested = output<void>();
  /** «Проверить позже» — оставить оплату как сомнительную, закрыть диалог без повтора. */
  readonly acknowledgeRequested = output<void>();
  /** «Закрыть» — закрыть диалог без повтора оплаты. */
  readonly closeRequested = output<void>();
}
