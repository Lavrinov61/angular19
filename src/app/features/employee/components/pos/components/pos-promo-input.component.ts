import {
  Component, ChangeDetectionStrategy, inject, signal, output,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { FormsModule } from '@angular/forms';

export interface PromoAppliedEvent {
  code: string;
  discount_percent: number | null;
  discount_amount: number | null;
  title: string;
}

interface ValidateResponse {
  valid: boolean;
  error?: string;
  promo?: {
    id: string;
    title: string;
    discount_percent: number | null;
    discount_amount: number | null;
  };
}

@Component({
  selector: 'app-pos-promo-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatChipsModule, FormsModule,
  ],
  host: { class: 'pos-promo-input' },
  template: `
    @if (applied()) {
      <div class="promo-applied">
        <mat-icon class="promo-applied-icon">local_offer</mat-icon>
        <span class="promo-code">{{ applied()!.code }}</span>
        <span class="promo-discount">
          @if (applied()!.discount_percent) {
            -{{ applied()!.discount_percent }}%
          } @else if (applied()!.discount_amount) {
            -{{ applied()!.discount_amount }}\u20BD
          }
        </span>
        <button mat-icon-button (click)="removePromo()" class="promo-remove">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    } @else {
      <div class="promo-form">
        <mat-form-field appearance="outline" class="promo-field">
          <mat-label>Промокод</mat-label>
          <input matInput [(ngModel)]="code" (keydown.enter)="validate()"
                 placeholder="Введите промокод" [disabled]="validating()">
          <mat-icon matPrefix>local_offer</mat-icon>
        </mat-form-field>
        <button mat-flat-button (click)="validate()"
                [disabled]="!code.trim() || validating()" class="promo-btn">
          @if (validating()) {
            <mat-icon class="spin">sync</mat-icon>
          } @else {
            Применить
          }
        </button>
      </div>
      @if (error()) {
        <div class="promo-error">{{ error() }}</div>
      }
    }
  `,
  styles: [`
    :host {
      display: block;
      padding: 4px 12px;
    }

    .promo-form {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .promo-field {
      flex: 1;
      ::ng-deep .mat-mdc-form-field-infix { padding-top: 8px !important; padding-bottom: 8px !important; }
      ::ng-deep .mdc-text-field { min-height: 40px; }
    }
    .promo-btn {
      min-height: 40px;
      flex-shrink: 0;
    }

    .promo-applied {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-status-success) 10%, var(--mat-sys-surface));
      border: 1px solid color-mix(in srgb, var(--crm-status-success) 30%, transparent);
    }
    .promo-applied-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-status-success);
    }
    .promo-code {
      font-weight: 600;
      font-size: 13px;
      color: var(--mat-sys-on-surface);
    }
    .promo-discount {
      font-size: 13px;
      color: var(--crm-status-success);
      font-weight: 600;
    }
    .promo-remove {
      margin-left: auto;
      width: 28px;
      height: 28px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .promo-error {
      font-size: 11px;
      color: var(--mat-sys-error);
      padding: 4px 0 0;
    }

    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class PosPromoInputComponent {
  private readonly http = inject(HttpClient);

  readonly promoApplied = output<PromoAppliedEvent>();
  readonly promoRemoved = output<void>();

  code = '';
  readonly applied = signal<PromoAppliedEvent | null>(null);
  readonly validating = signal(false);
  readonly error = signal<string | null>(null);

  validate(): void {
    const trimmed = this.code.trim();
    if (!trimmed) return;

    this.validating.set(true);
    this.error.set(null);

    this.http.get<ValidateResponse>(`/api/promotions/validate/${encodeURIComponent(trimmed)}`)
      .subscribe({
        next: (res) => {
          this.validating.set(false);
          if (res.valid && res.promo) {
            const event: PromoAppliedEvent = {
              code: trimmed.toUpperCase(),
              discount_percent: res.promo.discount_percent,
              discount_amount: res.promo.discount_amount,
              title: res.promo.title,
            };
            this.applied.set(event);
            this.promoApplied.emit(event);
          } else {
            this.error.set(res.error || 'Промокод недействителен');
          }
        },
        error: () => {
          this.validating.set(false);
          this.error.set('Ошибка проверки промокода');
        },
      });
  }

  removePromo(): void {
    this.applied.set(null);
    this.code = '';
    this.promoRemoved.emit();
  }
}
