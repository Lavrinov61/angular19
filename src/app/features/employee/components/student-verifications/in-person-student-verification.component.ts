import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { catchError, debounceTime, distinctUntilChanged, firstValueFrom, of, switchMap, tap } from 'rxjs';

import {
  type EducationDocumentType,
  type EducationRole,
  type InPersonMatchedUser,
  type InPersonStudentVerificationPayload,
  type StudentReferralChannel,
  StudentVerificationService,
} from '../../../../core/services/student-verification.service';
import { applyRuPhoneMask, extractRuPhoneDigits, formatRuPhone, isCompleteRuPhone, toFullRuPhone } from '../../../../core/utils/ru-phone';

type PhoneLookupState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'found'; readonly user: InPersonMatchedUser }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'error' };

function fullRuPhoneValidator(control: AbstractControl): ValidationErrors | null {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  if (value === '') return null;
  return isCompleteRuPhone(value) ? null : { ruPhone: true };
}

interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

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
  selector: 'app-in-person-student-verification',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="in-person">
      <form class="in-person-form" [formGroup]="form" (ngSubmit)="prepare()">
        <div class="form-head">
          <div>
            <h2>Очная заявка</h2>
            <p>Документ заверяет сотрудник, статус включается сразу</p>
          </div>
          <span class="form-badge">Без фото документа</span>
        </div>

        <div class="form-grid">
          <label class="field field--wide" [class.field--invalid]="form.controls.phone.invalid && form.controls.phone.touched">
            <span class="field-label">
              <mat-icon>phone</mat-icon>
              Телефон клиента
            </span>
            <input
              name="phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              formControlName="phone"
              placeholder="+7 (900) 123-45-67"
              (input)="onPhoneInput($event, 'phone')"
            />
            @if (form.controls.phone.invalid && form.controls.phone.touched) {
              <span class="field-hint field-hint--error">Введите полный номер: +7 и 10 цифр</span>
            } @else {
              <span class="field-hint">Полный номер клиента; если аккаунта нет, он будет создан</span>
            }

            @switch (lookup().kind) {
              @case ('searching') {
                <span class="phone-match phone-match--muted">
                  <mat-icon>sync</mat-icon> Проверяем клиента…
                </span>
              }
              @case ('found') {
                <span class="phone-match phone-match--ok">
                  <mat-icon>how_to_reg</mat-icon>
                  Найден клиент: {{ matchedClientLabel() }}
                </span>
              }
              @case ('not_found') {
                <span class="phone-match phone-match--warn">
                  <mat-icon>person_add</mat-icon>
                  Клиента с таким номером ещё нет — создадим аккаунт и включим статус
                </span>
              }
              @case ('error') {
                <span class="phone-match phone-match--muted">
                  <mat-icon>error_outline</mat-icon> Не удалось проверить номер
                </span>
              }
            }

            @if (phoneMismatch()) {
              <span class="phone-match phone-match--warn">
                <mat-icon>error_outline</mat-icon>
                Телефон не совпадает с номером в этом чате — проверьте
              </span>
            }
          </label>

          <label class="field field--wide" [class.field--invalid]="form.controls.institutionName.invalid && form.controls.institutionName.touched">
            <span class="field-label">
              <mat-icon>account_balance</mat-icon>
              Учебное заведение
            </span>
            <input
              name="institutionName"
              type="text"
              autocomplete="organization"
              formControlName="institutionName"
              placeholder="РИНХ"
            />
          </label>

          <label class="field">
            <span class="field-label">
              <mat-icon>person</mat-icon>
              Роль
            </span>
            <select name="educationRole" formControlName="educationRole">
              @for (option of educationRoleOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>

          <label class="field">
            <span class="field-label">
              <mat-icon>badge</mat-icon>
              Документ
            </span>
            <select name="documentType" formControlName="documentType">
              @for (option of documentTypeOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>

          <label class="field" [class.field--invalid]="form.controls.documentExpiresAt.invalid && form.controls.documentExpiresAt.touched">
            <span class="field-label">
              <mat-icon>event</mat-icon>
              Действует до
            </span>
            <input name="documentExpiresAt" type="date" formControlName="documentExpiresAt" [attr.min]="minDate()" />
          </label>

          <label class="field">
            <span class="field-label">
              <mat-icon>campaign</mat-icon>
              Откуда узнал
            </span>
            <select name="referralChannel" formControlName="referralChannel">
              @for (option of referralChannelOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>

          <label class="field field--wide field--optional">
            <span class="field-label">
              <mat-icon>group_add</mat-icon>
              Телефон пригласившего
            </span>
            <input
              name="referrerPhone"
              type="tel"
              inputmode="tel"
              autocomplete="off"
              formControlName="referrerPhone"
              placeholder="+7 (900) 000-00-00"
              (input)="onPhoneInput($event, 'referrerPhone')"
            />
            <span class="field-hint">Если номер совпадёт с клиентом, зачтём как реферала</span>
          </label>
        </div>

        <div class="form-actions">
          <button mat-flat-button color="primary" type="submit" [disabled]="loading()">
            @if (loading()) {
              <mat-spinner diameter="18" />
            } @else {
              <mat-icon>verified_user</mat-icon>
            }
            <span>{{ loading() ? 'Готовим...' : 'Заверить документ' }}</span>
          </button>
        </div>
      </form>

      <aside class="prepared" [class.prepared--ready]="prepared()">
        @if (prepared(); as payload) {
          <div class="prepared__head">
            <mat-icon>task_alt</mat-icon>
            <div>
              <h2>Статус активирован</h2>
              <p>{{ statusText(payload) }}</p>
            </div>
          </div>

          <dl class="prepared__facts">
            <div><dt>Телефон</dt><dd>{{ payload.verification.phone_normalized || '—' }}</dd></div>
            <div><dt>Вуз</dt><dd>{{ payload.verification.institution_name || '—' }}</dd></div>
            <div><dt>Срок</dt><dd>{{ payload.verification.document_expires_at | date: 'dd.MM.yyyy' }}</dd></div>
            <div><dt>Клиент</dt><dd>{{ payload.matched_user?.display_name || payload.matched_user?.phone || 'создан по телефону' }}</dd></div>
          </dl>

          <div class="student-send">
            <mat-icon>verified</mat-icon>
            <div>
              <small>Образовательный аккаунт готов</small>
              <span>Образовательные цены доступны клиенту сразу</span>
              <em>Дополнительная ссылка подтверждения не требуется</em>
            </div>
          </div>
        } @else {
          <div class="prepared__head prepared__head--idle">
            <mat-icon>verified_user</mat-icon>
            <div>
              <h2>Готово к проверке</h2>
              <p>После заверения образовательные цены включатся сразу</p>
            </div>
          </div>

          <div class="flow-list" aria-label="Состояние очной проверки">
            <div>
              <mat-icon>search</mat-icon>
              <span>Поиск только по полному телефону</span>
            </div>
            <div>
              <mat-icon>visibility</mat-icon>
              <span>Сотрудник видел оригинал документа</span>
            </div>
            <div>
              <mat-icon>lock</mat-icon>
              <span>Скидка включится сразу после заверения</span>
            </div>
          </div>
        }
      </aside>
    </section>
  `,
  styles: [`
    :host {
      display: block;
    }

    .in-person {
      display: grid;
      grid-template-columns: minmax(560px, 712px) minmax(300px, 360px);
      gap: 16px;
      align-items: start;
      max-width: 1096px;
    }

    .in-person-form,
    .prepared {
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.1));
      border-radius: 8px;
      background: var(--crm-gradient-card, rgba(16, 24, 39, 0.76));
      box-shadow: var(--crm-shadow-card, 0 16px 38px rgba(0, 0, 0, 0.2));
    }

    .in-person-form {
      padding: 16px;
    }

    .form-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
    }

    .form-head h2 {
      margin: 0;
      color: var(--crm-text-primary, #f5f7fb);
      font-size: 18px;
      line-height: 1.2;
    }

    .form-head p {
      margin: 4px 0 0;
      color: var(--crm-text-muted, #7d8797);
      font-size: 12px;
      line-height: 1.35;
    }

    .form-badge {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 0 9px;
      border: 1px solid rgba(134, 239, 172, 0.22);
      border-radius: 999px;
      background: rgba(34, 197, 94, 0.1);
      color: #bbf7d0;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 13px;
    }

    .field--wide {
      grid-column: 1 / -1;
    }

    .field {
      display: grid;
      gap: 6px;
      color: var(--crm-text-secondary, #a7b0c0);
      font-size: 12px;
      font-weight: 800;
    }

    .field-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 18px;
    }

    .field-label mat-icon {
      width: 15px;
      height: 15px;
      font-size: 15px;
      color: var(--crm-accent, #f59e0b);
    }

    .field-hint {
      color: var(--crm-text-muted, #7d8797);
      font-size: 11px;
      font-weight: 500;
      line-height: 1.3;
    }

    .field-hint--error {
      color: #fca5a5;
      font-weight: 700;
    }

    .phone-match {
      display: inline-flex;
      align-items: flex-start;
      gap: 6px;
      margin-top: 2px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.35;
    }

    .phone-match mat-icon {
      flex: 0 0 auto;
      width: 15px;
      height: 15px;
      font-size: 15px;
      margin-top: 1px;
    }

    .phone-match--ok {
      color: #86efac;
    }

    .phone-match--warn {
      color: #fcd34d;
    }

    .phone-match--muted {
      color: var(--crm-text-muted, #7d8797);
    }

    input,
    select {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.12));
      border-radius: 8px;
      background-color: rgba(0, 0, 0, 0.24);
      color: var(--crm-text-primary, #f5f7fb);
      font: inherit;
      font-weight: 700;
      padding: 0 11px;
      outline: none;
      transition:
        border-color var(--crm-transition-fast, 140ms ease),
        box-shadow var(--crm-transition-fast, 140ms ease),
        background var(--crm-transition-fast, 140ms ease);
    }

    input:focus,
    select:focus {
      border-color: rgba(245, 158, 11, 0.65);
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.16);
      background-color: rgba(0, 0, 0, 0.32);
    }

    .field--invalid input,
    .field--invalid select {
      border-color: rgba(248, 113, 113, 0.7);
    }

    .field--optional {
      opacity: 0.9;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
      padding-top: 13px;
      border-top: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
    }

    .form-actions button {
      min-height: 44px;
      border-radius: 8px;
      font-weight: 800;
    }

    .form-actions mat-spinner {
      margin-right: 8px;
    }

    .prepared {
      min-height: 100%;
      padding: 16px;
      display: grid;
      gap: 14px;
      align-content: start;
      background:
        linear-gradient(180deg, rgba(245, 158, 11, 0.07), rgba(245, 158, 11, 0) 42%),
        var(--crm-gradient-card, rgba(16, 24, 39, 0.76));
    }

    .prepared--ready {
      background:
        linear-gradient(180deg, rgba(34, 197, 94, 0.08), rgba(34, 197, 94, 0) 42%),
        var(--crm-gradient-card, rgba(16, 24, 39, 0.76));
    }

    .prepared__head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .prepared__head mat-icon {
      color: #86efac;
      width: 24px;
      height: 24px;
      font-size: 24px;
      margin-top: 1px;
    }

    .prepared__head--idle mat-icon {
      color: #fbbf24;
    }

    .prepared h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
    }

    .prepared p {
      margin: 3px 0 0;
      color: var(--crm-text-secondary, #a7b0c0);
      font-size: 12px;
      line-height: 1.35;
    }

    .prepared__facts {
      margin: 0;
      display: grid;
      grid-template-columns: 1fr;
      gap: 9px;
    }

    .prepared__facts div {
      display: grid;
      gap: 2px;
    }

    .prepared__facts dt {
      color: var(--crm-text-muted, #7d8797);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .prepared__facts dd {
      margin: 0;
      color: var(--crm-text-primary, #f5f7fb);
      font-size: 14px;
      font-weight: 700;
      word-break: break-word;
    }

    .student-send {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-height: 54px;
      padding: 11px 12px;
      border-radius: 8px;
      border: 1px solid rgba(134, 239, 172, 0.24);
      background: rgba(34, 197, 94, 0.12);
      color: #bbf7d0;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .student-send--muted {
      border-color: var(--crm-glass-border, rgba(255, 255, 255, 0.1));
      background: rgba(0, 0, 0, 0.18);
      color: var(--crm-text-secondary, #a7b0c0);
    }

    .student-send--warn {
      border-color: rgba(252, 211, 77, 0.32);
      background: rgba(245, 158, 11, 0.12);
      color: #fcd34d;
    }

    .student-send--warn mat-icon {
      color: #fcd34d;
    }

    .student-send--warn small,
    .student-send--warn em {
      color: rgba(252, 211, 77, 0.72);
    }

    .student-send mat-icon {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      font-size: 22px;
      color: #86efac;
    }

    .student-send--muted mat-icon {
      color: var(--crm-text-muted, #7d8797);
    }

    .student-send div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .student-send small {
      color: rgba(187, 247, 208, 0.72);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .student-send--muted small {
      color: var(--crm-text-muted, #7d8797);
    }

    .student-send span {
      font-size: 14px;
      font-weight: 800;
    }

    .student-send em {
      color: rgba(187, 247, 208, 0.7);
      font-size: 11px;
      font-weight: 600;
      font-style: normal;
      line-height: 1.35;
    }

    .student-link {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-height: 54px;
      padding: 10px 11px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.1);
      color: #fde68a;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .student-link--secondary {
      min-height: 0;
      padding: 8px 11px;
      background: rgba(0, 0, 0, 0.18);
      color: var(--crm-text-muted, #7d8797);
      font-weight: 600;
    }

    .student-link mat-icon {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      font-size: 22px;
    }

    .student-link--secondary mat-icon {
      width: 17px;
      height: 17px;
      font-size: 17px;
      margin-top: 1px;
    }

    .student-link div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .student-link small {
      color: rgba(253, 230, 138, 0.72);
      font-size: 11px;
      font-weight: 700;
    }

    .student-link--secondary small {
      color: var(--crm-text-muted, #7d8797);
      font-size: 10px;
    }

    .student-link--secondary span {
      font-size: 12px;
      font-weight: 700;
    }

    .flow-list {
      display: grid;
      gap: 10px;
      margin-top: 2px;
    }

    .flow-list div {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 9px;
      align-items: center;
      min-height: 42px;
      padding: 8px 10px;
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.18);
      color: var(--crm-text-secondary, #a7b0c0);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }

    .flow-list mat-icon {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.12);
      font-size: 17px;
    }

    @media (max-width: 900px) {
      .in-person,
      .form-grid {
        grid-template-columns: 1fr;
      }

      .form-head {
        flex-direction: column;
      }
    }
  `],
})
export class InPersonStudentVerificationComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly service = inject(StudentVerificationService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly loading = signal(false);
  protected readonly prepared = signal<InPersonStudentVerificationPayload | null>(null);
  protected readonly minDate = computed(() => new Date().toISOString().slice(0, 10));

  protected readonly educationRoleOptions: readonly SelectOption<EducationRole>[] = [
    { value: 'student', label: 'Студент' },
    { value: 'applicant', label: 'Абитуриент' },
    { value: 'teacher', label: 'Учитель' },
    { value: 'lecturer', label: 'Преподаватель' },
    { value: 'staff', label: 'Сотрудник' },
  ];

  protected readonly documentTypeOptions: readonly SelectOption<EducationDocumentType>[] = [
    { value: 'student_card', label: 'Студенческий билет' },
    { value: 'grade_book', label: 'Зачётка' },
    { value: 'study_certificate', label: 'Справка об обучении' },
    { value: 'teacher_id', label: 'Удостоверение' },
    { value: 'admission_document', label: 'Документ абитуриента' },
    { value: 'other', label: 'Другое' },
  ];

  protected readonly referralChannelOptions: readonly SelectOption<StudentReferralChannel>[] = [
    { value: 'walk_in', label: 'Пришёл сам' },
    { value: 'classmate', label: 'Одногруппник' },
    { value: 'friend', label: 'Друг' },
    { value: 'social', label: 'Соцсети' },
    { value: 'repeat_customer', label: 'Был раньше' },
    { value: 'employee_told', label: 'Сотрудник рассказал' },
    { value: 'other', label: 'Другое' },
  ];

  protected readonly form = this.fb.group({
    phone: ['', [Validators.required, fullRuPhoneValidator]],
    institutionName: ['', [Validators.required, Validators.minLength(2)]],
    educationRole: ['student' as EducationRole, [Validators.required]],
    documentType: ['student_card' as EducationDocumentType, [Validators.required]],
    documentExpiresAt: ['', [Validators.required]],
    referralChannel: ['walk_in' as StudentReferralChannel, [Validators.required]],
    referrerPhone: ['', [fullRuPhoneValidator]],
  });

  /** Телефон, на который зарегистрирован чат (telegram без номера → null). */
  readonly prefillPhone = input<string | null>(null);
  /** UUID диалога, из которого вызвана регистрация (walk-in → null). */
  readonly conversationId = input<string | null>(null);

  protected readonly lookup = signal<PhoneLookupState>({ kind: 'idle' });

  // Текущее значение поля телефона как сигнал — для реактивного phoneMismatch.
  private readonly phoneValue = signal('');

  // Последние извлечённые цифры по каждому полю — нужны live-маске, чтобы backspace
  // по разделителю (')' и т.п.) удалял соседнюю цифру, а не «застревал».
  private readonly lastDigits: Record<'phone' | 'referrerPhone', string> = { phone: '', referrerPhone: '' };

  // Мягкое non-blocking предупреждение: введённый номер не совпадает с номером чата.
  // Показываем только когда чат принёс номер и введён полный, но иной номер.
  protected readonly phoneMismatch = computed(() => {
    const prefill = this.prefillPhone();
    if (!prefill) return false;
    const expected = toFullRuPhone(prefill);
    if (!expected) return false;
    const entered = toFullRuPhone(this.phoneValue());
    if (!entered) return false;
    return entered !== expected;
  });

  protected readonly matchedClientLabel = computed(() => {
    const state = this.lookup();
    if (state.kind !== 'found') return '';
    const user = state.user;
    const name = user.display_name?.trim();
    const phone = user.phone ? formatRuPhone(user.phone) : '';
    if (name && phone) return `${name} · ${phone}`;
    return name || phone || 'клиент найден';
  });

  constructor() {
    // Префилл телефона из диалога. effect в DI-контексте конструктора;
    // ставим один раз, дальше сотрудник может править вручную.
    let prefillApplied = false;
    effect(() => {
      const prefill = this.prefillPhone();
      if (prefillApplied || !prefill) return;
      const formatted = formatRuPhone(prefill);
      if (!formatted) return;
      prefillApplied = true;
      this.lastDigits.phone = extractRuPhoneDigits(formatted);
      this.form.controls.phone.setValue(formatted);
    });

    this.form.controls.phone.valueChanges
      .pipe(
        tap(value => this.phoneValue.set(value)),
        debounceTime(350),
        distinctUntilChanged((a, b) => extractRuPhoneDigits(a) === extractRuPhoneDigits(b)),
        tap(value => {
          if (!isCompleteRuPhone(value)) this.lookup.set({ kind: 'idle' });
        }),
        switchMap(value => {
          if (!isCompleteRuPhone(value)) return of<PhoneLookupState>({ kind: 'idle' });
          this.lookup.set({ kind: 'searching' });
          return this.service.lookupInPerson(value).pipe(
            switchMap(user => of<PhoneLookupState>(user ? { kind: 'found', user } : { kind: 'not_found' })),
            catchError(() => of<PhoneLookupState>({ kind: 'error' })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(state => this.lookup.set(state));
  }

  /** Live-маска +7 (XXX) XXX-XX-XX: форматирует поле на каждый ввод и держит курсор на месте. */
  protected onPhoneInput(event: Event, field: 'phone' | 'referrerPhone'): void {
    const input = event.target as HTMLInputElement;
    const result = applyRuPhoneMask(
      input.value,
      input.selectionStart ?? input.value.length,
      (event as InputEvent).inputType,
      this.lastDigits[field],
    );
    this.lastDigits[field] = result.digits;
    if (result.value === input.value) return;

    this.form.controls[field].setValue(result.value);
    try {
      input.setSelectionRange(result.caret, result.caret);
    } catch {
      // setSelectionRange может не поддерживаться для текущего состояния поля — не критично.
    }
  }

  protected async prepare(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.snackBar.open('Заполните телефон, вуз и срок действия документа', 'OK', { duration: 3000 });
      return;
    }

    const value = this.form.getRawValue();
    this.loading.set(true);
    try {
      const payload = await firstValueFrom(this.service.prepareInPerson({
        phone: value.phone,
        institutionName: value.institutionName,
        educationRole: value.educationRole,
        documentType: value.documentType,
        documentExpiresAt: value.documentExpiresAt,
        referralChannel: value.referralChannel,
        referrerPhone: value.referrerPhone.trim() || null,
        conversationId: this.conversationId(),
      }));
      this.prepared.set(payload);
      this.snackBar.open('Очная заявка подготовлена', 'OK', { duration: 2500 });
    } catch (error: unknown) {
      this.snackBar.open(this.readErrorMessage(error), 'OK', { duration: 4500 });
    } finally {
      this.loading.set(false);
    }
  }

  protected statusText(payload: InPersonStudentVerificationPayload): string {
    return payload.verification.status === 'pending_in_person'
      ? 'Старая заявка ожидает обработки'
      : 'Образовательный статус активирован';
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return readApiErrorBodyMessage(error.error) ?? error.message ?? 'Не удалось подготовить заявку';
    }
    if (error instanceof Error && error.message) return error.message;
    return readApiErrorBodyMessage(error) ?? 'Не удалось подготовить заявку';
  }
}
