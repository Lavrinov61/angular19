import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  type EducationDocumentType,
  type EducationRole,
  StudentVerification,
  StudentVerificationService,
} from '../../core/services/student-verification.service';

interface ApiErrorBody {
  readonly error?: unknown;
  readonly message?: unknown;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null;
}

function readApiErrorBodyMessage(value: unknown): string | null {
  if (!isApiErrorBody(value)) return null;
  if (typeof value.error === 'string' && value.error.length > 0) return value.error;
  if (typeof value.message === 'string' && value.message.length > 0) return value.message;
  return null;
}

@Component({
  selector: 'app-in-person-student-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <main class="confirm-page">
      <section class="confirm-panel">
        <header class="confirm-head">
          <div class="confirm-icon"><mat-icon>school</mat-icon></div>
          <div>
            <p class="eyebrow">Студенческая программа</p>
            <h1>Подтверждение данных</h1>
          </div>
        </header>

        @if (loading()) {
          <div class="state">
            <mat-spinner diameter="32" />
            <span>Проверяем заявку</span>
          </div>
        } @else if (confirmed()) {
          <div class="state state--ok">
            <mat-icon>task_alt</mat-icon>
            <span>Статус активирован</span>
            <a routerLink="/user-profile/education">Открыть кабинет</a>
          </div>
        } @else if (errorMessage()) {
          <div class="state state--error">
            <mat-icon>error</mat-icon>
            <span>{{ errorMessage() }}</span>
          </div>
        } @else if (verification(); as item) {
          <dl class="facts">
            <div><dt>Вуз</dt><dd>{{ item.institution_name || '—' }}</dd></div>
            <div><dt>Роль</dt><dd>{{ educationRoleLabel(item.education_role) }}</dd></div>
            <div><dt>Документ</dt><dd>{{ documentTypeLabel(item.document_type) }}</dd></div>
            <div><dt>Действует до</dt><dd>{{ item.document_expires_at | date: 'dd.MM.yyyy' }}</dd></div>
          </dl>

          <form [formGroup]="form" (ngSubmit)="confirm(item)" class="consent-form">
            <label class="consent-row">
              <input name="consent" type="checkbox" formControlName="consent" />
              <span>
                Согласен на обработку данных об учебном статусе оператором ИП Лавринова Елена Борисовна
                для участия в студенческой программе, проверки права на скидку и аналитики программы.
                Данные хранятся до достижения цели или отзыва согласия, образовательные поля очищаются после окончания срока.
                Согласие можно отозвать в кабинете.
              </span>
            </label>

            <label class="consent-row consent-row--muted">
              <input name="marketingConsent" type="checkbox" formControlName="marketingConsent" />
              <span>Получать отдельные сообщения о студенческих предложениях</span>
            </label>

            <a class="privacy-link" routerLink="/privacy" target="_blank">Политика конфиденциальности</a>

            <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || submitting()">
              @if (submitting()) {
                <mat-spinner diameter="18" />
              } @else {
                <mat-icon>verified</mat-icon>
              }
              <span>{{ submitting() ? 'Подтверждаем...' : 'Подтвердить' }}</span>
            </button>
          </form>
        } @else {
          <div class="state state--waiting">
            <mat-icon>hourglass_top</mat-icon>
            <span>Ждём заверение сотрудника</span>
            <p class="state-note">
              Как только сотрудник заверит документ, заявка появится здесь автоматически.
              Не закрывайте страницу.
            </p>
            <button mat-stroked-button type="button" (click)="refresh()" [disabled]="loading()">
              <mat-icon>refresh</mat-icon>
              <span>Обновить</span>
            </button>
          </div>
        }
      </section>
    </main>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #f6f7f9;
      color: #16181d;
    }

    .confirm-page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 20px;
    }

    .confirm-panel {
      width: min(560px, 100%);
      display: grid;
      gap: 18px;
      padding: 22px;
      border: 1px solid #e1e5eb;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(19, 25, 37, 0.12);
    }

    .confirm-head {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .confirm-icon {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: #fff3d7;
      color: #9a5b00;
    }

    .eyebrow {
      margin: 0 0 4px;
      color: #8a5a0a;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.15;
    }

    .facts {
      margin: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .facts div {
      padding: 10px 12px;
      border: 1px solid #e6e9ef;
      border-radius: 8px;
      background: #fafbfc;
    }

    .facts dt {
      color: #6a7280;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .facts dd {
      margin: 4px 0 0;
      font-size: 15px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .consent-form {
      display: grid;
      gap: 12px;
    }

    .consent-row {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      color: #2a3039;
      font-size: 13px;
      line-height: 1.45;
    }

    .consent-row input {
      margin-top: 3px;
    }

    .consent-row--muted {
      color: #5f6875;
    }

    .privacy-link {
      color: #8a5a0a;
      font-size: 13px;
      font-weight: 800;
      width: fit-content;
    }

    button[type="submit"] {
      min-height: 44px;
      justify-self: stretch;
    }

    button[type="submit"] mat-spinner {
      margin-right: 8px;
    }

    .state {
      min-height: 180px;
      display: grid;
      place-items: center;
      gap: 10px;
      text-align: center;
      color: #5f6875;
      font-weight: 800;
    }

    .state mat-icon {
      width: 38px;
      height: 38px;
      font-size: 38px;
    }

    .state-note {
      margin: 0;
      max-width: 320px;
      color: #6a7280;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.45;
    }

    .state--waiting button {
      margin-top: 4px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .state--ok {
      color: #166534;
    }

    .state--ok a {
      color: #166534;
    }

    .state--error {
      color: #b91c1c;
    }

    @media (max-width: 560px) {
      .confirm-page {
        padding: 12px;
        place-items: stretch;
      }

      .confirm-panel {
        padding: 16px;
      }

      .facts {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class InPersonStudentConfirmComponent implements OnInit, OnDestroy {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly service = inject(StudentVerificationService);
  private readonly platformId = inject(PLATFORM_ID);

  private static readonly POLL_INTERVAL_MS = 4000;
  private static readonly POLL_MAX_ATTEMPTS = 45; // ~3 минуты ожидания заверения сотрудником
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollAttempts = 0;

  protected readonly consentVersion = 'student-program-v1';
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly verification = signal<StudentVerification | null>(null);
  protected readonly confirmed = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly form = this.fb.group({
    consent: [false, [Validators.requiredTrue]],
    marketingConsent: [false],
  });

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  protected refresh(): void {
    this.pollAttempts = 0;
    void this.load();
  }

  protected async confirm(item: StudentVerification): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.submitting.set(true);
    this.errorMessage.set('');
    try {
      await firstValueFrom(this.service.confirmInPerson(item.id, {
        consentVersion: this.consentVersion,
        marketingConsent: value.marketingConsent,
      }));
      this.stopPolling();
      this.confirmed.set(true);
    } catch (error: unknown) {
      this.errorMessage.set(this.readErrorMessage(error));
    } finally {
      this.submitting.set(false);
    }
  }

  protected educationRoleLabel(role: EducationRole): string {
    switch (role) {
      case 'applicant':
        return 'Абитуриент';
      case 'teacher':
        return 'Учитель';
      case 'lecturer':
        return 'Преподаватель';
      case 'staff':
        return 'Сотрудник';
      default:
        return 'Студент';
    }
  }

  protected documentTypeLabel(type: EducationDocumentType | null): string {
    switch (type) {
      case 'grade_book':
        return 'Зачётка';
      case 'study_certificate':
        return 'Справка об обучении';
      case 'teacher_id':
        return 'Удостоверение';
      case 'admission_document':
        return 'Документ абитуриента';
      case 'other':
        return 'Другой документ';
      default:
        return 'Студенческий билет';
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const status = await firstValueFrom(this.service.loadMine());
      if (status.account?.status === 'verified') {
        this.verification.set(status.latest_verification);
        this.confirmed.set(true);
        this.stopPolling();
        return;
      }

      const found = await firstValueFrom(this.service.loadPendingInPerson());
      this.verification.set(found);
      if (found) {
        this.stopPolling();
      } else {
        this.startPolling();
      }
    } catch (error: unknown) {
      this.stopPolling();
      this.errorMessage.set(this.readLoadErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Тихий опрос заявки без полноэкранного спиннера — пока сотрудник не заверит документ. */
  private startPolling(): void {
    if (!isPlatformBrowser(this.platformId) || this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      this.pollAttempts += 1;
      if (this.pollAttempts > InPersonStudentConfirmComponent.POLL_MAX_ATTEMPTS) {
        this.stopPolling();
        return;
      }
      void this.pollOnce();
    }, InPersonStudentConfirmComponent.POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.confirmed() || this.verification()) {
      this.stopPolling();
      return;
    }
    try {
      const status = await firstValueFrom(this.service.loadMine());
      if (status.account?.status === 'verified') {
        this.verification.set(status.latest_verification);
        this.confirmed.set(true);
        this.stopPolling();
        return;
      }

      const found = await firstValueFrom(this.service.loadPendingInPerson());
      if (found) {
        this.verification.set(found);
        this.stopPolling();
      }
    } catch {
      // Тихо игнорируем сетевые сбои опроса — следующий тик повторит.
    }
  }

  private readLoadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status >= 500) {
      return 'Статус теперь включает сотрудник на точке. Если скидка не появилась, обратитесь к сотруднику.';
    }
    return this.readErrorMessage(error);
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return readApiErrorBodyMessage(error.error) ?? error.message ?? 'Не удалось загрузить заявку';
    }
    if (error instanceof Error && error.message) return error.message;
    return readApiErrorBodyMessage(error) ?? 'Не удалось загрузить заявку';
  }
}
