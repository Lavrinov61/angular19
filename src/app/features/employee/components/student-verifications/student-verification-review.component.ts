import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import {
  type EducationRole,
  StudentVerificationAdminItem,
  StudentVerificationFilter,
  StudentVerificationService,
} from '../../../../core/services/student-verification.service';
import { InPersonStudentVerificationComponent } from './in-person-student-verification.component';

interface ApprovalDateEntry {
  readonly id: string;
  readonly value: string;
}

type ReviewActionKind = 'reject' | 'revoke';
type VerificationReviewMode = 'queue' | 'in_person';

interface ReviewDialogState {
  readonly kind: ReviewActionKind;
  readonly item: StudentVerificationAdminItem;
}

interface ApiErrorBody {
  readonly error?: unknown;
  readonly message?: unknown;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null;
}

function readApiErrorBodyMessage(value: unknown): string | null {
  if (!isApiErrorBody(value)) {
    return null;
  }
  if (typeof value.error === 'string' && value.error.length > 0) {
    return value.error;
  }
  if (typeof value.message === 'string' && value.message.length > 0) {
    return value.message;
  }
  return null;
}

/**
 * Гибрид «список → фокус»: компактный список заявок слева, фокус-карточка справа
 * (крупное фото документа + поля идентификации + редактируемая дата окончания + действия).
 * Открывается инлайн на главной панели (ФотоПульт) и как fallback-страница.
 */
@Component({
  selector: 'app-student-verification-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    InPersonStudentVerificationComponent,
  ],
  template: `
    <div class="review">
      <header class="toolbar">
        <div class="toolbar-title">
          <p class="eyebrow">Образование</p>
          <h1>{{ mode() === 'queue' ? 'Фото-верификация студентов' : 'Студенческая программа на точке' }}</h1>
          @if (mode() === 'queue') {
            <p class="queue-note">
              {{ pendingCount() }} ожидают проверки · показано {{ filteredVerifications().length }}
            </p>
          } @else {
            <p class="queue-note">Очное заверение документа без активации скидки сотрудником</p>
          }
        </div>

        <div class="toolbar-actions">
          <div class="mode-tabs" role="tablist" aria-label="Режим проверки студентов">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="mode() === 'queue'"
              [class.mode-tab--active]="mode() === 'queue'"
              (click)="setMode('queue')"
            >
              <mat-icon>photo_camera</mat-icon>
              Фото
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="mode() === 'in_person'"
              [class.mode-tab--active]="mode() === 'in_person'"
              (click)="setMode('in_person')"
            >
              <mat-icon>badge</mat-icon>
              На точке
            </button>
          </div>

          @if (mode() === 'queue') {
            <label class="search-field">
              <mat-icon>search</mat-icon>
              <input
                type="search"
                placeholder="Имя, телефон, организация..."
                [ngModel]="searchQuery()"
                (input)="setSearchQuery($event)"
              />
            </label>

            <mat-select class="status-select" [ngModel]="filter()" (ngModelChange)="setFilter($event)">
              <mat-option value="pending">На проверке</mat-option>
              <mat-option value="pending_in_person">На точке</mat-option>
              <mat-option value="approved">Одобрены</mat-option>
              <mat-option value="rejected">Отклонены</mat-option>
              <mat-option value="cancelled">Отменены</mat-option>
              <mat-option value="all">Все</mat-option>
            </mat-select>

            <button mat-stroked-button type="button" (click)="reload()" [disabled]="loading()">
              <mat-icon>refresh</mat-icon>
              Обновить
            </button>
          }
        </div>
      </header>

      @if (mode() === 'queue') {
      <div class="layout">
        <!-- Master list -->
        <aside class="list-pane" [class.list-pane--hidden-mobile]="selectedItem()">
          @if (loading()) {
            <div class="empty-state">
              <mat-spinner diameter="30" />
              <span>Загружаем заявки</span>
            </div>
          } @else if (filteredVerifications().length === 0) {
            <div class="empty-state">
              <mat-icon>school</mat-icon>
              <span>{{ verifications().length === 0 ? 'Заявок в выбранном статусе нет' : 'Ничего не найдено по поиску' }}</span>
            </div>
          } @else {
            <ul class="list">
              @for (item of filteredVerifications(); track item.id) {
                <li>
                  <button
                    type="button"
                    class="list-row"
                    [class.list-row--active]="item.id === selectedItem()?.id"
                    [class.list-row--pending]="item.status === 'pending'"
                    (click)="select(item)"
                  >
                    <span class="thumb">
                      @if (item.document_url) {
                        <img [src]="item.document_url" alt="" />
                      } @else {
                        <mat-icon>badge</mat-icon>
                      }
                    </span>
                    <span class="list-main">
                      <span class="list-name">{{ displayName(item) }}</span>
                      <span class="list-meta">
                        {{ item.institution_name || 'Организация не указана' }}
                        @if (item.document_expires_at) {
                          · до {{ item.document_expires_at | date: 'dd.MM.yy' }}
                        }
                      </span>
                    </span>
                    <span class="list-pill" [class.list-pill--ok]="item.status === 'approved'">
                      {{ statusLabel(item.status) }}
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </aside>

        <!-- Focus card -->
        <section class="focus-pane">
          @if (selectedItem(); as item) {
            <div class="focus-card">
              <div class="focus-head">
                <button class="mobile-back" type="button" (click)="clearSelection()">
                  <mat-icon>arrow_back</mat-icon>
                </button>
                <div class="focus-id">
                  <div class="focus-name">{{ displayName(item) }}</div>
                  <div class="focus-sub">{{ educationRoleLabel(item.education_role) }} · {{ accountLabel(item.account_status) }}</div>
                </div>
                <div class="focus-nav">
                  <button
                    mat-icon-button
                    type="button"
                    aria-label="Предыдущая"
                    [disabled]="selectedIndex() <= 0"
                    (click)="goPrev()"
                  >
                    <mat-icon>chevron_left</mat-icon>
                  </button>
                  <span class="focus-counter">{{ selectedIndex() + 1 }} / {{ filteredVerifications().length }}</span>
                  <button
                    mat-icon-button
                    type="button"
                    aria-label="Следующая"
                    [disabled]="selectedIndex() >= filteredVerifications().length - 1"
                    (click)="goNext()"
                  >
                    <mat-icon>chevron_right</mat-icon>
                  </button>
                </div>
              </div>

              <div class="focus-body">
                <a
                  class="focus-photo"
                  [class.focus-photo--empty]="!item.document_url"
                  [href]="item.document_url || undefined"
                  target="_blank"
                  rel="noopener"
                >
                  @if (item.document_url) {
                    <img [src]="item.document_url" alt="Фото образовательного документа" />
                    <span class="photo-zoom">
                      <mat-icon>zoom_in</mat-icon>
                      Открыть оригинал
                    </span>
                  } @else {
                    <mat-icon>image_not_supported</mat-icon>
                    <span>Фото документа недоступно</span>
                  }
                </a>

                <div class="focus-info">
                  <dl class="facts">
                    <div><dt>Телефон</dt><dd>{{ item.user_phone || '—' }}</dd></div>
                    <div><dt>Email</dt><dd>{{ item.user_email || '—' }}</dd></div>
                    <div>
                      <dt>Дата рождения</dt>
                      <dd>{{ item.user_date_of_birth ? (item.user_date_of_birth | date: 'dd.MM.yyyy') : 'не указана' }}</dd>
                    </div>
                    <div><dt>Учебное заведение</dt><dd>{{ item.institution_name || 'не указано' }}</dd></div>
                    <div>
                      <dt>Срок в документе</dt>
                      <dd>{{ item.document_expires_at ? (item.document_expires_at | date: 'dd.MM.yyyy') : 'не указан' }}</dd>
                    </div>
                    <div><dt>Заявка подана</dt><dd>{{ item.submitted_at | date: 'dd.MM.yyyy HH:mm' }}</dd></div>
                  </dl>

                  @if (item.rejection_reason) {
                    <div class="reason">
                      <mat-icon>info</mat-icon>
                      {{ item.rejection_reason }}
                    </div>
                  }

                  <div class="actions">
                    @if (item.status === 'pending') {
                      <label class="date-field">
                        <span>Одобрить до (можно исправить, если клиент ввёл срок неверно)</span>
                        <input
                          type="date"
                          [ngModel]="approvalDate(item)"
                          (ngModelChange)="setApprovalDate(item.id, $event)"
                        />
                      </label>
                      <div class="action-buttons">
                        <button mat-flat-button type="button" color="primary" (click)="approve(item)" [disabled]="isBusy(item.id)">
                          <mat-icon>check</mat-icon>
                          Одобрить
                        </button>
                        <button mat-stroked-button type="button" color="warn" (click)="reject(item)" [disabled]="isBusy(item.id)">
                          <mat-icon>close</mat-icon>
                          Отклонить
                        </button>
                      </div>
                    } @else if (item.account_status === 'verified') {
                      <button mat-stroked-button type="button" color="warn" (click)="revoke(item)" [disabled]="isBusy(item.id)">
                        <mat-icon>block</mat-icon>
                        Отозвать статус
                      </button>
                    }
                  </div>
                </div>
              </div>
            </div>
          } @else {
            <div class="empty-state focus-empty">
              <mat-icon>fact_check</mat-icon>
              <span>Выберите заявку слева, чтобы проверить документ</span>
            </div>
          }
        </section>
      </div>
      } @else {
        <app-in-person-student-verification />
      }

      @if (reviewDialog(); as dialog) {
        <div
          class="review-dialog-backdrop"
          role="presentation"
          tabindex="-1"
          (click)="closeReviewDialog()"
          (keydown.escape)="closeReviewDialog()"
        >
          <section
            class="review-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-review-dialog-title"
            tabindex="-1"
            (click)="$event.stopPropagation()"
            (keydown.escape)="closeReviewDialog()"
          >
            <div class="review-dialog-head">
              <div>
                <p class="review-kicker">{{ dialog.kind === 'reject' ? 'Отказ в заявке' : 'Отзыв статуса' }}</p>
                <h2 id="student-review-dialog-title">{{ reviewDialogTitle(dialog) }}</h2>
              </div>
              <button
                mat-icon-button
                type="button"
                aria-label="Закрыть"
                [disabled]="isBusy(dialog.item.id)"
                (click)="closeReviewDialog()"
              >
                <mat-icon>close</mat-icon>
              </button>
            </div>

            <div class="review-target">
              <span>{{ displayName(dialog.item) }}</span>
              <small>{{ dialog.item.user_phone || dialog.item.user_email || 'Контакт не указан' }}</small>
            </div>

            <div class="reason-presets">
              @for (reason of reviewReasonPresets(dialog.kind); track reason) {
                <button
                  type="button"
                  class="reason-preset"
                  [disabled]="isBusy(dialog.item.id)"
                  (click)="setReviewReason(reason)"
                >
                  {{ reason }}
                </button>
              }
            </div>

            <label class="review-reason-field">
              <span>Причина</span>
              <textarea
                rows="4"
                [ngModel]="reviewReason()"
                [disabled]="isBusy(dialog.item.id)"
                (ngModelChange)="setReviewReason($event)"
                placeholder="Например: фото документа не читается, не видно срок действия"
              ></textarea>
            </label>

            @if (reviewReasonError()) {
              <div class="review-error">
                <mat-icon>error</mat-icon>
                {{ reviewReasonError() }}
              </div>
            }

            <div class="review-dialog-actions">
              <button
                mat-stroked-button
                type="button"
                [disabled]="isBusy(dialog.item.id)"
                (click)="closeReviewDialog()"
              >
                Отмена
              </button>
              <button
                mat-flat-button
                type="button"
                color="warn"
                [disabled]="isBusy(dialog.item.id) || !isReviewReasonValid()"
                (click)="confirmReviewDialog()"
              >
                @if (isBusy(dialog.item.id)) {
                  <mat-spinner diameter="18" />
                } @else {
                  <mat-icon>{{ dialog.kind === 'reject' ? 'close' : 'block' }}</mat-icon>
                }
                <span>{{ isBusy(dialog.item.id) ? 'Отправляем...' : (dialog.kind === 'reject' ? 'Отклонить заявку' : 'Отозвать статус') }}</span>
              </button>
            </div>
          </section>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
        color: var(--crm-text-primary, #f5f7fb);
      }

      .review {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px;
        min-height: 100%;
      }

      .toolbar {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }

      .eyebrow {
        margin: 0 0 4px;
        color: var(--crm-accent, #f59e0b);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-family: var(--crm-font-display, 'Oswald', sans-serif);
        font-size: 22px;
        font-weight: 500;
        line-height: 1.1;
      }

      .queue-note {
        margin: 6px 0 0;
        color: var(--crm-text-secondary, #a7b0c0);
        font-size: 12px;
      }

      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .mode-tabs {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        min-height: 40px;
        padding: 3px;
        border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.1));
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.2);
      }

      .mode-tabs button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--crm-text-secondary, #a7b0c0);
        font: inherit;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
      }

      .mode-tabs mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      .mode-tabs .mode-tab--active {
        background: rgba(245, 158, 11, 0.16);
        color: #fde68a;
      }

      .search-field {
        min-width: 200px;
        max-width: 320px;
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 0 12px;
        border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.1));
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.2);
        color: var(--crm-text-secondary, #a7b0c0);
      }

      .search-field mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      .search-field input {
        width: 100%;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--crm-text-primary, #f5f7fb);
        font: inherit;
      }

      .status-select {
        width: 170px;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        flex: 1;
        min-height: 0;
      }

      .list-pane,
      .focus-pane {
        border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.1));
        border-radius: 10px;
        background: var(--crm-gradient-card, rgba(16, 24, 39, 0.76));
        box-shadow: var(--crm-shadow-card, 0 16px 38px rgba(0, 0, 0, 0.2));
        min-height: 320px;
      }

      .list-pane {
        overflow: hidden;
      }

      .list {
        list-style: none;
        margin: 0;
        padding: 6px;
        display: grid;
        gap: 6px;
      }

      .list-row {
        width: 100%;
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.02);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: background 140ms ease, border-color 140ms ease;
      }

      .list-row:hover {
        background: rgba(255, 255, 255, 0.06);
      }

      .list-row--pending {
        border-color: rgba(245, 158, 11, 0.28);
      }

      .list-row--active {
        border-color: var(--crm-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.12);
      }

      .thumb {
        width: 40px;
        height: 40px;
        border-radius: 6px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.3);
        color: var(--crm-text-muted, #7d8797);
      }

      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .list-main {
        min-width: 0;
        display: grid;
        gap: 2px;
      }

      .list-name {
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .list-meta {
        font-size: 11px;
        color: var(--crm-text-secondary, #a7b0c0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .list-pill {
        align-self: center;
        padding: 3px 7px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.14);
        color: #fde68a;
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .list-pill--ok {
        background: rgba(34, 197, 94, 0.14);
        color: #bbf7d0;
      }

      .focus-pane {
        padding: 0;
        min-height: 0;
      }

      .focus-card {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .focus-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.1));
      }

      .mobile-back {
        display: none;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--crm-accent, #f59e0b);
        cursor: pointer;
      }

      .focus-id {
        flex: 1;
        min-width: 0;
      }

      .focus-name {
        font-size: 17px;
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .focus-sub {
        margin-top: 2px;
        font-size: 12px;
        color: var(--crm-text-secondary, #a7b0c0);
      }

      .focus-nav {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .focus-counter {
        font-size: 12px;
        color: var(--crm-text-secondary, #a7b0c0);
        font-variant-numeric: tabular-nums;
        min-width: 44px;
        text-align: center;
      }

      .focus-body {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
        gap: 14px;
        padding: 14px;
        align-items: start;
      }

      .focus-photo {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 8px;
        min-height: 300px;
        max-height: 60vh;
        border-radius: 10px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.28);
        color: var(--crm-text-muted, #7d8797);
        text-decoration: none;
      }

      .focus-photo img {
        width: 100%;
        height: 100%;
        max-height: 60vh;
        object-fit: contain;
      }

      .focus-photo--empty {
        cursor: default;
        font-size: 13px;
      }

      .photo-zoom {
        position: absolute;
        left: 10px;
        bottom: 10px;
        display: flex;
        align-items: center;
        gap: 5px;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        opacity: 0;
        transition: opacity 140ms ease;
      }

      .focus-photo:hover .photo-zoom,
      .focus-photo:focus-visible .photo-zoom {
        opacity: 1;
      }

      .focus-info {
        display: grid;
        gap: 12px;
        align-content: start;
      }

      .facts {
        margin: 0;
        display: grid;
        gap: 8px;
      }

      .facts > div {
        display: grid;
        gap: 2px;
      }

      .facts dt {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--crm-text-muted, #7d8797);
      }

      .facts dd {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--crm-text-primary, #f5f7fb);
        word-break: break-word;
      }

      .reason {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 10px;
        border-left: 3px solid rgba(239, 68, 68, 0.7);
        border-radius: 6px;
        background: rgba(239, 68, 68, 0.08);
        color: #fecaca;
        font-size: 13px;
      }

      .reason mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      .actions {
        display: grid;
        gap: 10px;
      }

      .date-field {
        display: grid;
        gap: 5px;
        color: var(--crm-text-muted, #7d8797);
        font-size: 12px;
        font-weight: 600;
      }

      .date-field input {
        min-height: 40px;
        padding: 0 12px;
        border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.2);
        color: var(--crm-text-primary, #f5f7fb);
        font: inherit;
      }

      .action-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .action-buttons button {
        flex: 1;
        min-width: 130px;
        min-height: 42px;
      }

      .empty-state {
        min-height: 300px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: var(--crm-text-secondary, #a7b0c0);
        text-align: center;
        padding: 24px;
      }

      .empty-state mat-icon {
        width: 38px;
        height: 38px;
        font-size: 38px;
        opacity: 0.6;
      }

      .review-dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(2, 6, 12, 0.74);
        backdrop-filter: blur(8px);
      }

      .review-dialog {
        width: min(560px, 100%);
        display: grid;
        gap: 16px;
        padding: 18px;
        border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.12));
        border-radius: 10px;
        background: #12161d;
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.46);
      }

      .review-dialog-head,
      .review-dialog-actions,
      .review-target {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .review-dialog-head {
        justify-content: space-between;
      }

      .review-kicker {
        margin: 0 0 4px;
        color: var(--crm-accent, #f59e0b);
        font-size: 11px;
        font-weight: 900;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .review-dialog h2 {
        margin: 0;
        font-size: 19px;
        line-height: 1.2;
      }

      .review-target {
        justify-content: space-between;
        padding: 10px 12px;
        border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.1));
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
      }

      .review-target span {
        font-weight: 800;
      }

      .review-target small {
        color: var(--crm-text-secondary, #a7b0c0);
      }

      .reason-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .reason-preset {
        min-height: 34px;
        padding: 0 10px;
        border: 1px solid rgba(245, 158, 11, 0.28);
        border-radius: 8px;
        background: rgba(245, 158, 11, 0.09);
        color: #fde68a;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }

      .reason-preset:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .review-reason-field {
        display: grid;
        gap: 7px;
        color: var(--crm-text-secondary, #a7b0c0);
        font-size: 13px;
        font-weight: 800;
      }

      .review-reason-field textarea {
        width: 100%;
        min-height: 112px;
        resize: vertical;
        padding: 11px 12px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 8px;
        outline: none;
        background: rgba(0, 0, 0, 0.22);
        color: var(--crm-text-primary, #f5f7fb);
        font: inherit;
        line-height: 1.45;
      }

      .review-error {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #fecaca;
        font-size: 13px;
      }

      .review-error mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      .review-dialog-actions {
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .review-dialog-actions button {
        min-height: 40px;
      }

      .review-dialog-actions mat-spinner {
        margin-right: 8px;
      }

      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .focus-body {
          grid-template-columns: 1fr;
        }

        .list-pane--hidden-mobile {
          display: none;
        }

        .mobile-back {
          display: inline-flex;
        }
      }
    `,
  ],
})
export class StudentVerificationReviewComponent implements OnInit {
  private readonly studentVerificationService = inject(StudentVerificationService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly rejectReasonPresets = [
    'Фото документа не читается',
    'Не видно срок действия документа',
    'Документ не подтверждает образовательный статус',
  ] as const;
  private readonly revokeReasonPresets = [
    'Истек срок действия документа',
    'Образовательный статус больше не подтвержден',
    'Документ не прошел повторную проверку',
  ] as const;
  private readonly educationRoleLabels: Record<EducationRole, string> = {
    student: 'Студент',
    applicant: 'Абитуриент',
    teacher: 'Учитель',
    lecturer: 'Преподаватель',
    staff: 'Сотрудник',
  };

  protected readonly filter = signal<StudentVerificationFilter>('pending');
  protected readonly mode = signal<VerificationReviewMode>('queue');
  protected readonly searchQuery = signal('');
  protected readonly verifications = signal<StudentVerificationAdminItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly busyItem = signal<string | null>(null);
  protected readonly approvalDates = signal<readonly ApprovalDateEntry[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly reviewDialog = signal<ReviewDialogState | null>(null);
  protected readonly reviewReason = signal('');
  protected readonly reviewReasonTouched = signal(false);

  protected readonly filteredVerifications = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) {
      return this.verifications();
    }
    return this.verifications().filter(item => this.matchesSearch(item, query));
  });
  protected readonly selectedItem = computed(() => {
    const id = this.selectedId();
    if (!id) {
      return null;
    }
    return this.filteredVerifications().find(item => item.id === id) ?? null;
  });
  protected readonly selectedIndex = computed(() => {
    const id = this.selectedId();
    return id ? this.filteredVerifications().findIndex(item => item.id === id) : -1;
  });
  protected readonly pendingCount = computed(() =>
    this.verifications().filter(item => item.status === 'pending' || item.status === 'pending_in_person').length,
  );
  protected readonly isReviewReasonValid = computed(() => this.reviewReason().trim().length >= 3);
  protected readonly reviewReasonError = computed(() => {
    if (!this.reviewReasonTouched()) {
      return '';
    }
    return this.isReviewReasonValid() ? '' : 'Укажите причину не короче 3 символов.';
  });

  ngOnInit(): void {
    void this.reload();
  }

  protected setFilter(value: StudentVerificationFilter): void {
    this.filter.set(value);
    void this.reload();
  }

  protected setMode(value: VerificationReviewMode): void {
    this.mode.set(value);
  }

  protected setSearchQuery(event: Event): void {
    this.searchQuery.set(this.readInputValue(event));
    this.ensureSelection();
  }

  protected select(item: StudentVerificationAdminItem): void {
    this.selectedId.set(item.id);
  }

  protected clearSelection(): void {
    this.selectedId.set(null);
  }

  protected goPrev(): void {
    const index = this.selectedIndex();
    if (index > 0) {
      this.selectedId.set(this.filteredVerifications()[index - 1]!.id);
    }
  }

  protected goNext(): void {
    const list = this.filteredVerifications();
    const index = this.selectedIndex();
    if (index >= 0 && index < list.length - 1) {
      this.selectedId.set(list[index + 1]!.id);
    }
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const items = await firstValueFrom(this.studentVerificationService.listAdmin(this.filter(), 250));
      this.verifications.set(items);
      this.approvalDates.update(existing => {
        const next = [...existing];
        for (const item of items) {
          if (!next.some(entry => entry.id === item.id)) {
            next.push({ id: item.id, value: this.defaultApprovalDate(item) });
          }
        }
        return next;
      });
      this.ensureSelection();
    } catch (error: unknown) {
      this.showError(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected approvalDate(item: StudentVerificationAdminItem): string {
    return this.approvalDates().find(entry => entry.id === item.id)?.value ?? this.defaultApprovalDate(item);
  }

  protected setApprovalDate(id: string, value: string): void {
    this.approvalDates.update(dates =>
      dates.some(entry => entry.id === id)
        ? dates.map(entry => (entry.id === id ? { id, value } : entry))
        : [...dates, { id, value }],
    );
  }

  protected isBusy(id: string): boolean {
    return this.busyItem() === id;
  }

  protected async approve(item: StudentVerificationAdminItem): Promise<void> {
    await this.runAction(item, async () => {
      const expiresAt = this.approvalDate(item);
      if (!expiresAt) {
        throw new Error('Укажите срок действия статуса.');
      }
      await firstValueFrom(this.studentVerificationService.approve(item.id, { expiresAt }));
      this.snackBar.open('Статус одобрен', 'OK', { duration: 2500 });
    });
  }

  protected reject(item: StudentVerificationAdminItem): void {
    this.openReviewDialog('reject', item);
  }

  protected revoke(item: StudentVerificationAdminItem): void {
    this.openReviewDialog('revoke', item);
  }

  protected reviewDialogTitle(dialog: ReviewDialogState): string {
    return dialog.kind === 'reject' ? 'Отклонить фото-верификацию' : 'Отозвать образовательный статус';
  }

  protected reviewReasonPresets(kind: ReviewActionKind): readonly string[] {
    return kind === 'reject' ? this.rejectReasonPresets : this.revokeReasonPresets;
  }

  protected setReviewReason(reason: string): void {
    this.reviewReason.set(reason);
    this.reviewReasonTouched.set(true);
  }

  protected closeReviewDialog(): void {
    const dialog = this.reviewDialog();
    if (dialog && this.isBusy(dialog.item.id)) {
      return;
    }
    this.reviewDialog.set(null);
    this.reviewReason.set('');
    this.reviewReasonTouched.set(false);
  }

  protected async confirmReviewDialog(): Promise<void> {
    const dialog = this.reviewDialog();
    if (!dialog) {
      return;
    }

    this.reviewReasonTouched.set(true);
    const reason = this.reviewReason().trim();
    if (!this.isReviewReasonValid()) {
      return;
    }

    const completed = await this.runAction(dialog.item, async () => {
      this.assertReason(reason);
      if (dialog.kind === 'reject') {
        await firstValueFrom(this.studentVerificationService.reject(dialog.item.id, { reason }));
        this.snackBar.open('Заявка отклонена', 'OK', { duration: 2500 });
        return;
      }
      if (!dialog.item.account_id) {
        throw new Error('У этой записи нет активного образовательного аккаунта.');
      }
      await firstValueFrom(this.studentVerificationService.revoke(dialog.item.account_id, reason));
      this.snackBar.open('Статус отозван', 'OK', { duration: 2500 });
    });

    if (completed) {
      this.closeReviewDialog();
    }
  }

  protected displayName(item: StudentVerificationAdminItem): string {
    return item.user_display_name || item.user_phone || item.user_email || `Заявка ${item.id.slice(0, 8)}`;
  }

  protected statusLabel(status: string): string {
    switch (status) {
      case 'approved':
        return 'Одобрена';
      case 'rejected':
        return 'Отклонена';
      case 'cancelled':
        return 'Отменена';
      case 'pending_in_person':
        return 'На точке';
      default:
        return 'На проверке';
    }
  }

  protected accountLabel(status: string | null): string {
    switch (status) {
      case 'verified':
        return 'аккаунт активен';
      case 'rejected':
        return 'аккаунт отклонён';
      case 'expired':
        return 'аккаунт истёк';
      case 'revoked':
        return 'аккаунт отозван';
      default:
        return 'аккаунт ожидает';
    }
  }

  protected educationRoleLabel(role: EducationRole): string {
    return this.educationRoleLabels[role];
  }

  private ensureSelection(): void {
    const list = this.filteredVerifications();
    const current = this.selectedId();
    if (current && list.some(item => item.id === current)) {
      return;
    }
    this.selectedId.set(list[0]?.id ?? null);
  }

  private async runAction(
    item: StudentVerificationAdminItem,
    action: () => Promise<void>,
  ): Promise<boolean> {
    this.busyItem.set(item.id);
    try {
      await action();
      await this.reload();
      return true;
    } catch (error: unknown) {
      this.showError(error);
      return false;
    } finally {
      if (this.busyItem() === item.id) {
        this.busyItem.set(null);
      }
    }
  }

  private openReviewDialog(kind: ReviewActionKind, item: StudentVerificationAdminItem): void {
    this.reviewDialog.set({ kind, item });
    this.reviewReason.set('');
    this.reviewReasonTouched.set(false);
  }

  private matchesSearch(item: StudentVerificationAdminItem, query: string): boolean {
    const searchable = [
      this.displayName(item),
      item.user_phone,
      item.user_email,
      item.institution_name,
      this.educationRoleLabel(item.education_role),
      item.id,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLowerCase();

    return searchable.includes(query);
  }

  private readInputValue(event: Event): string {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      return target.value;
    }
    return '';
  }

  private defaultApprovalDate(item: StudentVerificationAdminItem): string {
    const existing = item.document_expires_at ?? item.expires_at;
    if (existing) {
      return existing.slice(0, 10);
    }
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    return nextYear.toISOString().slice(0, 10);
  }

  private showError(error: unknown): void {
    this.snackBar.open(this.readErrorMessage(error), 'OK', { duration: 4000 });
  }

  private assertReason(reason: string): void {
    if (reason.length < 3) {
      throw new Error('Укажите причину не короче 3 символов.');
    }
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const apiMessage = readApiErrorBodyMessage(error.error);
      if (apiMessage) {
        return apiMessage;
      }
      return error.message || 'Операция не выполнена.';
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    const apiMessage = readApiErrorBodyMessage(error);
    if (apiMessage) {
      return apiMessage;
    }
    return 'Операция не выполнена.';
  }
}
