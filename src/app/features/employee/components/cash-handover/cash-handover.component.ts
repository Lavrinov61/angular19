import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { PosApiService, PosShift, ShiftReport } from '../../services/pos-api.service';
import { AuthService } from '../../../../core/services/auth.service';

interface Denomination {
  value: number;
  type: 'banknote' | 'coin';
  label: string;
  color: string;
}

const DENOMINATIONS: Denomination[] = [
  { value: 5000, type: 'banknote', label: '5 000', color: '#c47862' },
  { value: 2000, type: 'banknote', label: '2 000', color: '#5b8dbc' },
  { value: 1000, type: 'banknote', label: '1 000', color: '#5ca89a' },
  { value: 500,  type: 'banknote', label: '500',   color: '#9b7bb8' },
  { value: 200,  type: 'banknote', label: '200',   color: '#6daa6d' },
  { value: 100,  type: 'banknote', label: '100',   color: '#b89058' },
  { value: 50,   type: 'banknote', label: '50',    color: '#7a9ab5' },
  { value: 10,   type: 'coin',     label: '10',    color: '#c4a95a' },
  { value: 5,    type: 'coin',     label: '5',     color: '#a8a8a8' },
  { value: 2,    type: 'coin',     label: '2',     color: '#a8a8a8' },
  { value: 1,    type: 'coin',     label: '1',     color: '#a8a8a8' },
];

@Component({
  selector: 'app-cash-handover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatTooltipModule,
  ],
  template: `
    <!-- ═══════ HEADER ═══════ -->
    <header class="handover-header">
      <button class="back-btn" (click)="goBack()">
        <mat-icon>arrow_back</mat-icon>
        <span class="back-label">Касса</span>
      </button>
      <div class="header-center">
        <h1>СДАЧА КАССЫ</h1>
      </div>
      @if (shift()) {
        <div class="header-badge">
          <span class="badge-label">Смена</span>
          <span class="badge-number">#{{ shift()!.shift_number }}</span>
        </div>
      }
    </header>

    <!-- ═══════ LOADING ═══════ -->
    @if (loading()) {
      <div class="loading-state">
        <mat-spinner diameter="48" />
        <span>Загрузка данных смены...</span>
      </div>
    }

    <!-- ═══════ NO SHIFT ═══════ -->
    @if (!loading() && !shift()) {
      <div class="no-shift-state">
        <div class="no-shift-icon">
          <mat-icon>point_of_sale</mat-icon>
        </div>
        <h2>Нет открытой смены</h2>
        <p>Для сдачи кассы необходима открытая кассовая смена</p>
        <button mat-flat-button class="go-pos-btn" (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
          Открыть смену в Кассе
        </button>
      </div>
    }

    <!-- ═══════ MAIN CONTENT ═══════ -->
    @if (!loading() && shift()) {
      <div class="handover-layout">

        <!-- ── LEFT: DENOMINATIONS ── -->
        <section class="denom-section">

          <div class="section-title">
            <div class="title-accent"></div>
            <span>КУПЮРЫ</span>
          </div>

          <div class="bills-grid">
            @for (d of banknotes; track d.value) {
              <div class="denom-tile" [style.--denom-accent]="d.color"
                   [class.has-count]="getCount(d.value) > 0"
                   (click)="increment(d.value)"
                   (keydown.enter)="increment(d.value)"
                   tabindex="0">
                <div class="tile-accent-bar"></div>
                <div class="tile-body">
                  <div class="tile-value">{{ d.label }}<span class="ruble">₽</span></div>
                  <div class="tile-counter" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
                    <button class="counter-btn decrement"
                            [disabled]="getCount(d.value) === 0"
                            (click)="decrement(d.value)">
                      <mat-icon>remove</mat-icon>
                    </button>
                    <input class="counter-input"
                           type="number" min="0" max="999"
                           [value]="getCount(d.value)"
                           (input)="setCount(d.value, $event)">
                    <button class="counter-btn increment"
                            (click)="increment(d.value)">
                      <mat-icon>add</mat-icon>
                    </button>
                  </div>
                  <div class="tile-subtotal"
                       [class.visible]="getCount(d.value) > 0">
                    {{ formatAmount(getSubtotal(d.value)) }}
                  </div>
                </div>
              </div>
            }
          </div>

          <div class="section-title coins-title">
            <div class="title-accent coin-accent"></div>
            <span>МОНЕТЫ</span>
          </div>

          <div class="coins-grid">
            @for (d of coins; track d.value) {
              <div class="coin-tile" [class.has-count]="getCount(d.value) > 0"
                   (click)="increment(d.value)"
                   (keydown.enter)="increment(d.value)"
                   tabindex="0">
                <div class="coin-face" [style.--coin-color]="d.color">
                  <span class="coin-value">{{ d.label }}</span>
                  <span class="coin-ruble">₽</span>
                </div>
                <div class="coin-counter" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
                  <button class="counter-btn small"
                          [disabled]="getCount(d.value) === 0"
                          (click)="decrement(d.value)">−</button>
                  <input class="counter-input small"
                         type="number" min="0" max="999"
                         [value]="getCount(d.value)"
                         (input)="setCount(d.value, $event)">
                  <button class="counter-btn small"
                          (click)="increment(d.value)">+</button>
                </div>
                @if (getCount(d.value) > 0) {
                  <div class="coin-subtotal">{{ formatAmount(getSubtotal(d.value)) }}</div>
                }
              </div>
            }
          </div>

          <button class="reset-btn" (click)="resetAll()"
                  [disabled]="countedTotal() === 0">
            <mat-icon>restart_alt</mat-icon>
            Сбросить всё
          </button>
        </section>

        <!-- ── RIGHT: SUMMARY ── -->
        <aside class="summary-section">

          <!-- Counted Total -->
          <div class="summary-card counted-card">
            <div class="card-header">
              <mat-icon>calculate</mat-icon>
              <span>Пересчитано</span>
            </div>
            <div class="card-amount">
              {{ formatAmount(countedTotal()) }}<span class="currency">₽</span>
            </div>
            @if (totalBills() > 0 || totalCoins() > 0) {
              <div class="card-breakdown">
                @if (totalBills() > 0) {
                  <span class="breakdown-item">{{ totalBills() }} купюр</span>
                }
                @if (totalCoins() > 0) {
                  <span class="breakdown-item">{{ totalCoins() }} монет</span>
                }
              </div>
            }
          </div>

          <!-- Expected -->
          <div class="summary-card expected-card">
            <div class="card-header">
              <mat-icon>account_balance</mat-icon>
              <span>Ожидается в кассе</span>
            </div>
            <div class="card-amount">
              {{ formatAmount(expectedCash()) }}<span class="currency">₽</span>
            </div>
            <div class="card-breakdown">
              <span class="breakdown-item">{{ formatAmount(shift()!.cash_at_open) }} на начало</span>
              @if (report()) {
                <span class="breakdown-item">+ {{ formatAmount(report()!.cash_payments) }} наличные</span>
                @if (cashWithdrawals() > 0) {
                  <span class="breakdown-item">− {{ formatAmount(cashWithdrawals()) }} изъято</span>
                }
              }
            </div>
          </div>

          <!-- Discrepancy -->
          <div class="summary-card discrepancy-card"
               [class.surplus]="discrepancy() > 0"
               [class.shortage]="discrepancy() < 0"
               [class.match]="discrepancy() === 0 && countedTotal() > 0">
            <div class="card-header">
              @if (discrepancy() > 0) {
                <mat-icon>trending_up</mat-icon>
                <span>Излишек</span>
              } @else if (discrepancy() < 0) {
                <mat-icon>trending_down</mat-icon>
                <span>Недостача</span>
              } @else {
                <mat-icon>check_circle</mat-icon>
                <span>Расхождение</span>
              }
            </div>
            <div class="card-amount">
              @if (discrepancy() > 0) { + }
              {{ formatAmount(discrepancy()) }}<span class="currency">₽</span>
            </div>
          </div>

          <!-- Progress indicator -->
          @if (expectedCash() > 0) {
            <div class="progress-block">
              <div class="progress-bar">
                <div class="progress-fill" [style.width.%]="progressPercent()"></div>
              </div>
              <span class="progress-label">{{ progressPercent() }}%</span>
            </div>
          }

          <!-- Cash withdrawal -->
          @if (report()) {
            <div class="withdrawal-card">
              <div class="withdrawal-header">
                <div>
                  <span class="withdrawal-title">Изъятие наличных</span>
                  <span class="withdrawal-total">{{ formatAmount(cashWithdrawals()) }}₽ за смену</span>
                </div>
                <mat-icon>payments</mat-icon>
              </div>

              <mat-form-field appearance="outline" class="withdrawal-field">
                <mat-label>Сумма</mat-label>
                <input matInput [(ngModel)]="withdrawAmount" type="number" min="0" step="100">
                <mat-icon matPrefix>remove_circle_outline</mat-icon>
              </mat-form-field>

              <mat-form-field appearance="outline" class="withdrawal-field">
                <mat-label>На что изъяли</mat-label>
                <input matInput [(ngModel)]="withdrawReason" maxlength="500">
                <mat-icon matPrefix>edit_note</mat-icon>
              </mat-form-field>

              <button class="withdrawal-submit"
                      [disabled]="withdrawing() || !canSubmitWithdrawal()"
                      (click)="submitWithdrawal()">
                @if (withdrawing()) {
                  <mat-icon class="spin">sync</mat-icon>
                  <span>Записываю...</span>
                } @else {
                  <mat-icon>save</mat-icon>
                  <span>Записать изъятие</span>
                }
              </button>
            </div>
          }

          <!-- Shift Stats -->
          @if (report()) {
            <div class="shift-stats">
              <div class="stats-title">Итоги смены</div>
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-label">Чеков</span>
                  <span class="stat-value">{{ report()!.receipts_count }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Возвратов</span>
                  <span class="stat-value">{{ report()!.refunds_count }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Продажи</span>
                  <span class="stat-value">{{ formatAmount(report()!.total_sales) }}₽</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Нетто</span>
                  <span class="stat-value accent">{{ formatAmount(report()!.net_sales) }}₽</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Наличные</span>
                  <span class="stat-value">{{ formatAmount(report()!.cash_payments) }}₽</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Изъято</span>
                  <span class="stat-value">{{ formatAmount(cashWithdrawals()) }}₽</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Карты</span>
                  <span class="stat-value">{{ formatAmount(report()!.card_payments) }}₽</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">СБП</span>
                  <span class="stat-value">{{ formatAmount(report()!.sbp_payments) }}₽</span>
                </div>
              </div>
            </div>
          }

          <!-- Notes -->
          <mat-form-field appearance="outline" class="notes-field">
            <mat-label>Комментарий к сдаче</mat-label>
            <textarea matInput [(ngModel)]="notes" rows="2"
                      placeholder="Причина расхождения, замечания..."></textarea>
          </mat-form-field>

          <!-- Submit -->
          <button class="submit-btn" [disabled]="submitting() || withdrawing()"
                  (click)="submitHandover()">
            @if (submitting()) {
              <mat-icon class="spin">sync</mat-icon>
              <span>Закрываю смену...</span>
            } @else {
              <mat-icon>lock</mat-icon>
              <span>Закрыть смену</span>
            }
          </button>

        </aside>
      </div>
    }

    <!-- ═══════ CONFIRM DIALOG ═══════ -->
    @if (showConfirm()) {
      <div class="confirm-overlay" (click)="showConfirm.set(false)" (keydown.enter)="showConfirm.set(false)" tabindex="0">
        <div class="confirm-card" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
          @if (Math.abs(discrepancy()) > 0) {
            <div class="confirm-icon warning">
              <mat-icon>warning_amber</mat-icon>
            </div>
            <h3>Обнаружено расхождение</h3>
            <p class="confirm-detail">
              @if (discrepancy() < 0) {
                Недостача <strong>{{ formatAmount(Math.abs(discrepancy())) }}₽</strong>
              } @else {
                Излишек <strong>{{ formatAmount(Math.abs(discrepancy())) }}₽</strong>
              }
            </p>
          } @else {
            <div class="confirm-icon success">
              <mat-icon>check_circle</mat-icon>
            </div>
            <h3>Касса сходится</h3>
          }
          <p>Закрыть смену #{{ shift()!.shift_number }}?</p>
          <div class="confirm-actions">
            <button mat-button (click)="showConfirm.set(false)">Отмена</button>
            <button mat-flat-button (click)="confirmClose()"
                    [disabled]="submitting()">
              @if (submitting()) {
                <mat-icon class="spin">sync</mat-icon>
              }
              Подтвердить
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--crm-surface-base);
      overflow: hidden;
    }

    /* ═══════ HEADER ═══════ */
    .handover-header {
      display: flex;
      align-items: center;
      padding: 0 var(--crm-space-4);
      height: 56px;
      min-height: 56px;
      background: var(--crm-surface);
      border-bottom: 1px solid var(--crm-border);
      gap: var(--crm-space-3);
    }

    .back-btn {
      display: flex;
      align-items: center;
      gap: var(--crm-space-1);
      background: none;
      border: none;
      color: var(--crm-text-secondary);
      cursor: pointer;
      padding: var(--crm-space-2);
      border-radius: var(--crm-radius-md);
      transition: all var(--crm-transition-fast);
      font-family: var(--crm-font-sans);
      font-size: var(--crm-text-base);

      &:hover {
        background: var(--crm-surface-hover);
        color: var(--crm-text-primary);
      }

      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }

    .back-label {
      @media (max-width: 600px) { display: none; }
    }

    .header-center {
      flex: 1;
      text-align: center;

      h1 {
        margin: 0;
        font-family: var(--crm-font-display);
        font-size: 18px;
        font-weight: 600;
        letter-spacing: 2px;
        color: var(--crm-text-primary);
      }
    }

    .header-badge {
      display: flex;
      align-items: baseline;
      gap: 4px;
      padding: 4px 12px;
      background: var(--crm-accent-muted);
      border-radius: 20px;
      font-family: var(--crm-font-mono);
    }

    .badge-label {
      font-size: 10px;
      color: var(--crm-accent-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .badge-number {
      font-size: 14px;
      font-weight: 700;
      color: var(--crm-accent);
    }

    /* ═══════ LOADING & EMPTY ═══════ */
    .loading-state, .no-shift-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--crm-space-4);
      color: var(--crm-text-secondary);
    }

    .no-shift-icon mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      opacity: 0.3;
    }

    .no-shift-state {
      h2 {
        margin: 0;
        font-family: var(--crm-font-display);
        font-size: 22px;
        color: var(--crm-text-primary);
      }
      p {
        margin: 0;
        font-size: var(--crm-text-base);
        max-width: 320px;
        text-align: center;
      }
    }

    .go-pos-btn {
      height: 44px;
      font-size: var(--crm-text-md);
    }

    /* ═══════ MAIN LAYOUT ═══════ */
    .handover-layout {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      @media (min-width: 900px) {
        flex-direction: row;
      }
    }

    /* ── DENOMINATIONS SECTION ── */
    .denom-section {
      flex: 1;
      overflow-y: auto;
      padding: var(--crm-space-4);
      padding-bottom: 80px;

      @media (min-width: 900px) {
        flex: 3;
        border-right: 1px solid var(--crm-border);
        padding-bottom: var(--crm-space-4);
      }
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      margin-bottom: var(--crm-space-3);
      font-family: var(--crm-font-display);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 2px;
      color: var(--crm-text-muted);
      text-transform: uppercase;
    }

    .title-accent {
      width: 3px;
      height: 16px;
      background: var(--crm-accent);
      border-radius: 2px;
    }

    .coin-accent { background: #c4a95a; }

    .coins-title { margin-top: var(--crm-space-5); }

    /* ── BILLS GRID ── */
    .bills-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;

      @media (min-width: 600px) {
        grid-template-columns: repeat(3, 1fr);
      }

      @media (min-width: 1200px) {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    .denom-tile {
      position: relative;
      border-radius: var(--crm-radius-lg);
      background: var(--crm-glass-bg);
      border: 1px solid var(--crm-border);
      overflow: hidden;
      cursor: pointer;
      transition:
        transform var(--crm-transition-fast),
        border-color var(--crm-transition-fast),
        box-shadow var(--crm-transition-normal);
      user-select: none;

      &:hover {
        transform: translateY(-1px);
        border-color: var(--denom-accent, var(--crm-border));
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      }

      &:active {
        transform: scale(0.97);
      }

      &.has-count {
        border-color: color-mix(in srgb, var(--denom-accent) 60%, transparent);
        background: color-mix(in srgb, var(--denom-accent) 6%, var(--crm-surface-raised));
        box-shadow: 0 0 20px color-mix(in srgb, var(--denom-accent) 10%, transparent);
      }
    }

    .tile-accent-bar {
      height: 3px;
      background: var(--denom-accent);
      opacity: 0.6;

      .has-count & { opacity: 1; }
    }

    .tile-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .tile-value {
      font-family: var(--crm-font-display);
      font-size: 26px;
      font-weight: 700;
      color: var(--crm-text-primary);
      line-height: 1;

      .has-count & { color: var(--denom-accent); }
    }

    .ruble {
      font-size: 18px;
      opacity: 0.5;
      margin-left: 2px;
    }

    /* ── COUNTER CONTROLS ── */
    .tile-counter, .coin-counter {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .counter-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid var(--crm-border);
      background: var(--crm-surface);
      color: var(--crm-text-secondary);
      cursor: pointer;
      transition: all var(--crm-transition-fast);
      font-size: 18px;
      font-family: var(--crm-font-sans);
      padding: 0;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover:not(:disabled) {
        background: var(--crm-surface-overlay);
        color: var(--crm-text-primary);
        border-color: var(--crm-text-muted);
      }

      &:active:not(:disabled) { transform: scale(0.9); }
      &:disabled { opacity: 0.25; cursor: default; }

      &.small {
        width: 28px;
        height: 28px;
        font-size: 16px;
      }

      &.increment:hover:not(:disabled) {
        background: var(--crm-accent-muted);
        border-color: var(--crm-accent-dim);
        color: var(--crm-accent);
      }
    }

    .counter-input {
      width: 48px;
      height: 36px;
      border-radius: var(--crm-radius-sm);
      border: 1px solid var(--crm-border);
      background: var(--crm-surface);
      color: var(--crm-text-primary);
      font-family: var(--crm-font-mono);
      font-size: 18px;
      font-weight: 700;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;

      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button { -webkit-appearance: none; }

      &:focus {
        border-color: var(--crm-accent);
        box-shadow: 0 0 0 2px var(--crm-accent-muted);
      }

      &.small { width: 40px; height: 30px; font-size: 15px; }
    }

    .tile-subtotal {
      font-family: var(--crm-font-mono);
      font-size: 13px;
      color: var(--crm-text-muted);
      height: 16px;
      opacity: 0;
      transition: opacity var(--crm-transition-fast);

      &.visible { opacity: 1; color: var(--crm-text-secondary); }
    }

    /* ── COINS GRID ── */
    .coins-grid {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .coin-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px;
      border-radius: var(--crm-radius-lg);
      background: var(--crm-glass-bg);
      border: 1px solid var(--crm-border);
      cursor: pointer;
      transition: all var(--crm-transition-fast);
      min-width: 80px;

      &:hover {
        border-color: var(--crm-border-focus);
        transform: translateY(-1px);
      }

      &:active { transform: scale(0.97); }

      &.has-count {
        border-color: #c4a95a80;
        background: rgba(196, 169, 90, 0.06);
      }
    }

    .coin-face {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background:
        radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15), transparent 60%),
        linear-gradient(145deg, color-mix(in srgb, var(--coin-color) 80%, white), var(--coin-color));
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow:
        inset 0 1px 2px rgba(255,255,255,0.2),
        0 2px 4px rgba(0,0,0,0.4);
    }

    .coin-value {
      font-family: var(--crm-font-display);
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
      line-height: 1;
    }

    .coin-ruble {
      font-size: 9px;
      color: #333;
      margin-top: -1px;
    }

    .coin-subtotal {
      font-family: var(--crm-font-mono);
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .reset-btn {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      margin-top: var(--crm-space-5);
      padding: var(--crm-space-2) var(--crm-space-4);
      background: none;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      color: var(--crm-text-muted);
      cursor: pointer;
      font-family: var(--crm-font-sans);
      font-size: var(--crm-text-sm);
      transition: all var(--crm-transition-fast);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover:not(:disabled) {
        background: var(--crm-status-error-container);
        border-color: var(--crm-status-error);
        color: var(--crm-status-error);
      }

      &:disabled { opacity: 0.3; cursor: default; }
    }

    /* ═══════ SUMMARY SECTION ═══════ */
    .summary-section {
      display: flex;
      flex-direction: column;
      gap: var(--crm-space-3);
      padding: var(--crm-space-4);
      overflow-y: auto;

      @media (min-width: 900px) {
        flex: 0 0 340px;
        position: sticky;
        top: 0;
      }

      @media (min-width: 1200px) {
        flex: 0 0 380px;
      }
    }

    .summary-card {
      padding: var(--crm-space-4);
      border-radius: var(--crm-radius-lg);
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: var(--crm-space-2);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .card-amount {
      font-family: var(--crm-font-mono);
      font-size: 32px;
      font-weight: 700;
      color: var(--crm-text-primary);
      line-height: 1;
      margin-bottom: var(--crm-space-1);
    }

    .currency {
      font-size: 20px;
      opacity: 0.5;
      margin-left: 2px;
    }

    .card-breakdown {
      display: flex;
      gap: var(--crm-space-3);
      flex-wrap: wrap;
    }

    .breakdown-item {
      font-size: var(--crm-text-xs);
      color: var(--crm-text-muted);
      font-family: var(--crm-font-mono);
    }

    .counted-card {
      background:
        linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%);
      border-color: rgba(245, 158, 11, 0.15);

      .card-amount { color: var(--crm-accent); }
    }

    .expected-card {
      background:
        linear-gradient(135deg, rgba(96, 165, 250, 0.06) 0%, rgba(96, 165, 250, 0.01) 100%);
      border-color: rgba(96, 165, 250, 0.12);

      .card-amount { color: var(--crm-status-info); }
    }

    .discrepancy-card {
      transition: all var(--crm-transition-normal);

      &.surplus {
        background: linear-gradient(135deg, rgba(52, 211, 153, 0.08) 0%, rgba(52, 211, 153, 0.02) 100%);
        border-color: rgba(52, 211, 153, 0.2);

        .card-header mat-icon { color: var(--crm-status-success); }
        .card-amount { color: var(--crm-status-success); }
      }

      &.shortage {
        background: linear-gradient(135deg, rgba(248, 113, 113, 0.08) 0%, rgba(248, 113, 113, 0.02) 100%);
        border-color: rgba(248, 113, 113, 0.2);

        .card-header mat-icon { color: var(--crm-status-error); }
        .card-amount { color: var(--crm-status-error); }
      }

      &.match {
        background: linear-gradient(135deg, rgba(52, 211, 153, 0.08) 0%, rgba(52, 211, 153, 0.02) 100%);
        border-color: rgba(52, 211, 153, 0.25);

        .card-header mat-icon { color: var(--crm-status-success); }
        .card-amount { color: var(--crm-status-success); }
      }
    }

    /* ── PROGRESS ── */
    .progress-block {
      display: flex;
      align-items: center;
      gap: var(--crm-space-3);
    }

    .progress-bar {
      flex: 1;
      height: 6px;
      border-radius: 3px;
      background: var(--crm-surface-overlay);
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--crm-accent);
      transition: width var(--crm-transition-normal);
      max-width: 100%;
    }

    .progress-label {
      font-family: var(--crm-font-mono);
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
      min-width: 36px;
      text-align: right;
    }

    /* ── SHIFT STATS ── */
    .shift-stats {
      padding: var(--crm-space-3);
      border-radius: var(--crm-radius-lg);
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
    }

    .stats-title {
      font-family: var(--crm-font-display);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--crm-text-muted);
      margin-bottom: var(--crm-space-3);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--crm-space-2) var(--crm-space-4);
    }

    .stat-item {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }

    .stat-label {
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
    }

    .stat-value {
      font-family: var(--crm-font-mono);
      font-size: var(--crm-text-base);
      font-weight: 600;
      color: var(--crm-text-primary);

      &.accent { color: var(--crm-accent); }
    }

    /* ── CASH WITHDRAWAL ── */
    .withdrawal-card {
      display: grid;
      gap: var(--crm-space-3);
      padding: var(--crm-space-3);
      border-radius: var(--crm-radius-lg);
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
    }

    .withdrawal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--crm-space-3);

      mat-icon {
        color: var(--crm-accent);
        opacity: 0.9;
      }
    }

    .withdrawal-title {
      display: block;
      font-family: var(--crm-font-display);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--crm-text-muted);
    }

    .withdrawal-total {
      display: block;
      margin-top: 2px;
      font-family: var(--crm-font-mono);
      font-size: var(--crm-text-base);
      font-weight: 700;
      color: var(--crm-text-primary);
    }

    .withdrawal-field {
      width: 100%;

      :host ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    }

    .withdrawal-submit {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--crm-space-2);
      width: 100%;
      min-height: 42px;
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: var(--crm-radius-md);
      background: rgba(245, 158, 11, 0.1);
      color: var(--crm-accent);
      font-family: var(--crm-font-sans);
      font-size: var(--crm-text-sm);
      font-weight: 700;
      cursor: pointer;
      transition: all var(--crm-transition-fast);

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover:not(:disabled) {
        background: rgba(245, 158, 11, 0.16);
        border-color: rgba(245, 158, 11, 0.55);
      }

      &:disabled {
        opacity: 0.45;
        cursor: default;
      }
    }

    /* ── NOTES ── */
    .notes-field {
      width: 100%;

      :host ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    }

    /* ── SUBMIT BUTTON ── */
    .submit-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--crm-space-2);
      width: 100%;
      height: 52px;
      border: none;
      border-radius: var(--crm-radius-lg);
      background: var(--crm-gradient-accent);
      color: var(--crm-on-accent);
      font-family: var(--crm-font-display);
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all var(--crm-transition-normal);
      box-shadow: 0 4px 16px rgba(245, 158, 11, 0.2);

      mat-icon { font-size: 20px; width: 20px; height: 20px; }

      &:hover:not(:disabled) {
        box-shadow: 0 6px 24px rgba(245, 158, 11, 0.35);
        transform: translateY(-1px);
      }

      &:active:not(:disabled) { transform: scale(0.98); }

      &:disabled {
        opacity: 0.4;
        cursor: default;
        box-shadow: none;
      }
    }

    /* ═══════ CONFIRM DIALOG ═══════ */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--crm-z-modal);
      animation: fadeIn 0.15s ease;
    }

    .confirm-card {
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-xl);
      padding: var(--crm-space-6);
      max-width: 380px;
      width: calc(100% - 32px);
      text-align: center;
      box-shadow: var(--crm-shadow-lg);
      animation: slideUp 0.2s ease;

      h3 {
        margin: var(--crm-space-3) 0 var(--crm-space-2);
        font-family: var(--crm-font-display);
        font-size: 20px;
        color: var(--crm-text-primary);
      }

      p {
        margin: 0 0 var(--crm-space-4);
        color: var(--crm-text-secondary);
        font-size: var(--crm-text-md);
      }
    }

    .confirm-detail strong {
      font-family: var(--crm-font-mono);
    }

    .confirm-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;

      mat-icon { font-size: 28px; width: 28px; height: 28px; }

      &.warning {
        background: var(--crm-status-warning-container);
        mat-icon { color: var(--crm-status-warning); }
      }

      &.success {
        background: var(--crm-status-success-container);
        mat-icon { color: var(--crm-status-success); }
      }
    }

    .confirm-actions {
      display: flex;
      justify-content: center;
      gap: var(--crm-space-3);
    }

    /* ═══════ UTILITIES ═══════ */
    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `],
})
export class CashHandoverComponent implements OnInit {
  protected readonly Math = Math;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly posApi = inject(PosApiService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  readonly banknotes = DENOMINATIONS.filter(d => d.type === 'banknote');
  readonly coins = DENOMINATIONS.filter(d => d.type === 'coin');

  readonly shift = signal<PosShift | null>(null);
  readonly report = signal<ShiftReport | null>(null);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly withdrawing = signal(false);
  readonly showConfirm = signal(false);
  readonly counts = signal<Record<number, number>>({});
  notes = '';
  withdrawAmount: number | null = null;
  withdrawReason = '';

  readonly countedTotal = computed(() => {
    const c = this.counts();
    return DENOMINATIONS.reduce((sum, d) => sum + (c[d.value] || 0) * d.value, 0);
  });

  readonly totalBills = computed(() => {
    const c = this.counts();
    return this.banknotes.reduce((sum, d) => sum + (c[d.value] || 0), 0);
  });

  readonly totalCoins = computed(() => {
    const c = this.counts();
    return this.coins.reduce((sum, d) => sum + (c[d.value] || 0), 0);
  });

  readonly expectedCash = computed(() => {
    const s = this.shift();
    const r = this.report();
    if (!s) return 0;
    return (s.cash_at_open || 0) + (r?.cash_payments || 0) - (r?.cash_withdrawals || 0);
  });

  readonly cashWithdrawals = computed(() => this.report()?.cash_withdrawals ?? 0);

  readonly discrepancy = computed(() => this.countedTotal() - this.expectedCash());

  readonly progressPercent = computed(() => {
    const expected = this.expectedCash();
    if (expected <= 0) return 0;
    return Math.min(100, Math.round((this.countedTotal() / expected) * 100));
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadShiftData();
  }

  private loadShiftData(): void {
    const user = this.authService.currentUser();
    if (!user?.id) {
      this.loading.set(false);
      return;
    }

    this.posApi.getCurrentShift(user.id).subscribe({
      next: (shift) => {
        this.shift.set(shift);
        if (shift) {
          this.loadReport(shift.id, true);
        } else {
          this.loading.set(false);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private loadReport(shiftId: string, finishLoading = false): void {
    this.posApi.getShiftReport(shiftId).subscribe({
      next: (report) => {
        this.report.set(report);
        if (finishLoading) this.loading.set(false);
      },
      error: (error: unknown) => {
        if (finishLoading) this.loading.set(false);
        this.snackBar.open(
          this.errorMessage(error, 'Не удалось обновить итоги смены'),
          'OK',
          { duration: 4000 },
        );
      },
    });
  }

  getCount(denomination: number): number {
    return this.counts()[denomination] || 0;
  }

  getSubtotal(denomination: number): number {
    return (this.counts()[denomination] || 0) * denomination;
  }

  increment(denomination: number): void {
    this.counts.update(c => ({ ...c, [denomination]: (c[denomination] || 0) + 1 }));
  }

  decrement(denomination: number): void {
    this.counts.update(c => ({
      ...c,
      [denomination]: Math.max(0, (c[denomination] || 0) - 1),
    }));
  }

  setCount(denomination: number, event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    if (isNaN(value) || value < 0) return;
    this.counts.update(c => ({ ...c, [denomination]: Math.min(999, value) }));
  }

  resetAll(): void {
    this.counts.set({});
  }

  formatAmount(value: number): string {
    return Math.round(value).toLocaleString('ru-RU');
  }

  submitHandover(): void {
    this.showConfirm.set(true);
  }

  canSubmitWithdrawal(): boolean {
    return Boolean(this.shift())
      && Number(this.withdrawAmount) > 0
      && this.withdrawReason.trim().length >= 2;
  }

  submitWithdrawal(): void {
    const s = this.shift();
    const amount = Number(this.withdrawAmount);
    const reason = this.withdrawReason.trim();
    if (!s || amount <= 0 || reason.length < 2) return;

    this.withdrawing.set(true);
    this.posApi.createCashWithdrawal(s.id, { amount, reason }).subscribe({
      next: () => {
        this.withdrawing.set(false);
        this.withdrawAmount = null;
        this.withdrawReason = '';
        this.snackBar.open('Изъятие наличных записано', 'OK', { duration: 3000 });
        this.loadReport(s.id);
      },
      error: (error: unknown) => {
        this.withdrawing.set(false);
        this.snackBar.open(
          this.errorMessage(error, 'Не удалось записать изъятие'),
          'OK',
          { duration: 5000 },
        );
      },
    });
  }

  confirmClose(): void {
    const s = this.shift();
    const user = this.authService.currentUser();
    if (!s || !user?.id) return;

    this.submitting.set(true);

    const denominations = DENOMINATIONS
      .filter(d => (this.counts()[d.value] || 0) > 0)
      .map(d => ({
        denomination: d.value,
        type: d.type,
        count: this.counts()[d.value] || 0,
      }));

    const shiftId = s.id;
    const shiftNumber = s.shift_number;

    this.posApi.closeShift({
      shift_id: s.id,
      employee_id: user.id,
      cash_at_close: this.countedTotal(),
      notes: this.notes || undefined,
      denominations: denominations.length > 0 ? denominations : undefined,
    }).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.showConfirm.set(false);
        this.snackBar.open(
          `Смена #${shiftNumber} закрыта · ${this.formatAmount(this.countedTotal())}₽ в кассе`,
          'OK',
          { duration: 5000 },
        );
        this.openEndOfDaySummary(shiftId, shiftNumber, result.zReportSent);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.snackBar.open(
          this.errorMessage(err, 'Не удалось закрыть смену'),
          'OK',
          { duration: 5000 },
        );
      },
    });
  }

  private openEndOfDaySummary(shiftId: string, shiftNumber: number, zReportSent = false): void {
    import('../pos/dialogs/pos-shift-report-dialog.component').then(m => {
      const ref = this.dialog.open(m.PosShiftReportDialogComponent, {
        width: '480px',
        maxHeight: '85vh',
        data: { shiftId, shiftNumber, isCloseShiftSummary: true, zReportSent },
      });
      ref.afterClosed().subscribe(() => {
        this.router.navigate(['/employee/pos']);
      });
    });
  }

  goBack(): void {
    this.router.navigate(['/employee/pos']);
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
}
