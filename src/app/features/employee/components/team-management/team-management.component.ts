import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators, ValidatorFn } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { DatePipe } from '@angular/common';
import {
  UsersApiService, StaffUser, CreateUserDto, UpdateUserDto, UserRole,
  Department, DEPARTMENT_LABELS, DEPARTMENT_COLORS, buildDisplayName,
} from '../../services/users-api.service';
import { OnlineStaffService } from '../../services/online-staff.service';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';

type ViewMode = 'list' | 'form';
type FilterRole = 'all' | 'employee' | 'photographer' | 'manager' | 'admin';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  employee: 'Сотрудник',
  photographer: 'Фотограф',
  client: 'Клиент',
};

const ROLE_COLORS: Record<string, string> = {
  admin: '#7c3aed',
  manager: '#0ea5e9',
  employee: '#10b981',
  photographer: '#f59e0b',
  client: '#6b7280',
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const PHONE_PATTERN = /^\+?[0-9\s()\-]{7,20}$/;
const optionalPhoneValidator: ValidatorFn = (control) => {
  const value = String(control.value ?? '').trim();
  return !value || PHONE_PATTERN.test(value) ? null : { phone: true };
};

@Component({
  selector: 'app-team-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, ReactiveFormsModule, MatIconModule, MatTooltipModule,
    MatSelectModule, MatFormFieldModule, MatChipsModule,
    DatePipe, HasPermissionDirective,
  ],
  template: `
<div class="tm-page">

  <!-- Header -->
  <div class="tm-header">
    <div class="tm-header-left">
      @if (view() !== 'list') {
        <button class="btn-icon" (click)="backToList()" matTooltip="Назад">
          <mat-icon>arrow_back</mat-icon>
        </button>
      }
      <h2 class="tm-title">
        @if (view() === 'list') { Управление командой }
        @if (view() === 'form' && !editingId()) { Добавить сотрудника }
        @if (view() === 'form' && editingId()) { Редактировать сотрудника }
      </h2>
    </div>
    <ng-container *appHasPermission="'users:manage'">
      @if (view() === 'list') {
        <button class="btn-primary" (click)="openCreate()">
          <mat-icon>person_add</mat-icon> Добавить
        </button>
      }
    </ng-container>
    @if (view() === 'form') {
      <button class="btn-primary" [disabled]="saving() || form.invalid" (click)="save()">
        <mat-icon>{{ saving() ? 'hourglass_empty' : 'save' }}</mat-icon>
        {{ saving() ? 'Сохранение…' : 'Сохранить' }}
      </button>
    }
  </div>

  <!-- Error banner -->
  @if (error()) {
    <div class="tm-error">
      <mat-icon>error_outline</mat-icon> {{ error() }}
      <button class="btn-icon-sm" (click)="error.set(null)"><mat-icon>close</mat-icon></button>
    </div>
  }

  <!-- LIST VIEW -->
  @if (view() === 'list') {
    <!-- Фильтры -->
    <div class="filter-bar">
      <div class="role-tabs">
        @for (f of roleFilters; track f.value) {
          <button class="role-tab" [class.role-tab--active]="roleFilter() === f.value"
                  (click)="roleFilter.set(f.value)">
            {{ f.label }}
            <span class="role-tab-count">{{ f.count() }}</span>
          </button>
        }
      </div>
      <div class="dept-tabs">
        <button class="dept-tab" [class.dept-tab--active]="deptFilter() === 'all'"
                (click)="setDeptFilter('all')">Все отделы</button>
        @for (d of departmentOptions; track d.value) {
          <button class="dept-tab" [class.dept-tab--active]="deptFilter() === d.value"
                  (click)="setDeptFilter(d.value)"
                  [style.border-color]="deptFilter() === d.value ? getDeptColor(d.value) : null"
                  [style.color]="deptFilter() === d.value ? getDeptColor(d.value) : null">
            {{ d.label }}
          </button>
        }
      </div>
      <div class="search-wrap">
        <mat-icon class="search-icon">search</mat-icon>
        <input class="search-input" [(ngModel)]="searchQuery"
               (ngModelChange)="onSearch($event)"
               placeholder="Имя, email или телефон…" />
      </div>
    </div>

    <!-- Статистика -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-num">{{ activeCount() }}</div>
        <div class="stat-label">Активных</div>
      </div>
      <div class="stat-card">
        <div class="stat-num stat-num--online">{{ onlineCount() }}</div>
        <div class="stat-label">Онлайн сейчас</div>
      </div>
      <div class="stat-card">
        <div class="stat-num stat-num--inactive">{{ inactiveCount() }}</div>
        <div class="stat-label">Деактивировано</div>
      </div>
    </div>

    <!-- Карточки сотрудников -->
    @if (loading()) {
      <div class="loading-state">
        <mat-icon class="spin">autorenew</mat-icon> Загрузка…
      </div>
    } @else if (filteredUsers().length === 0) {
      <div class="empty-state">
        <mat-icon>group_off</mat-icon>
        <p>Сотрудников не найдено</p>
        @if (roleFilter() === 'all' && !searchQuery) {
          <button class="btn-primary" (click)="openCreate()">
            <mat-icon>person_add</mat-icon> Добавить первого сотрудника
          </button>
        }
      </div>
    } @else {
      <div class="users-grid">
        @for (user of filteredUsers(); track user.id) {
          <div class="user-card" [class.user-card--inactive]="!user.is_active">
            <!-- Аватар -->
            <div class="user-avatar" [style.background]="getRoleColor(user.role)">
              {{ getInitials(user) }}
            </div>

            <!-- Онлайн-индикатор -->
            @if (isOnline(user.id)) {
              <div class="online-dot" matTooltip="Онлайн"></div>
            }

            <!-- Инфо -->
            <div class="user-info">
              <div class="user-name">{{ getFullName(user) }}</div>
              <div class="user-role-line">
                <span class="user-role-badge" [style.background]="getRoleColor(user.role) + '20'"
                      [style.color]="getRoleColor(user.role)">
                  {{ getRoleLabel(user.role) }}
                </span>
                @if (user.department) {
                  <span class="dept-chip" [style.background]="getDeptColor(user.department) + '18'"
                                          [style.color]="getDeptColor(user.department)">
                    {{ getDeptLabel(user.department) }}
                  </span>
                }
              </div>
              <div class="user-email">{{ user.email }}</div>
              @if (user.phone) {
                <div class="user-phone">{{ user.phone }}</div>
              }
              @if (!user.is_active) {
                <div class="inactive-badge">Деактивирован</div>
              }
            </div>

            <!-- Дата добавления -->
            <div class="user-since">с {{ user.created_at | date:'dd.MM.yyyy' }}</div>

            <!-- Действия -->
            <div class="user-actions" *appHasPermission="'users:manage'">
              <button class="btn-action" (click)="openEdit(user)" matTooltip="Редактировать">
                <mat-icon>edit</mat-icon>
              </button>
              @if (user.is_active) {
                <button class="btn-action btn-action--danger"
                        (click)="deactivate(user)" matTooltip="Деактивировать">
                  <mat-icon>person_off</mat-icon>
                </button>
              } @else {
                <button class="btn-action btn-action--success"
                        (click)="activate(user)" matTooltip="Активировать">
                  <mat-icon>person</mat-icon>
                </button>
              }
            </div>
          </div>
        }
      </div>
    }
  }

  <!-- FORM VIEW (создание / редактирование) -->
  @if (view() === 'form') {
    <form [formGroup]="form" class="emp-form" autocomplete="off" (ngSubmit)="save()">
      <div class="form-grid">

        <!-- Фамилия -->
        <div class="form-field">
          <span class="form-label">Фамилия</span>
          <input class="form-input" formControlName="last_name" autocomplete="off" placeholder="Иванова" />
        </div>

        <!-- Имя -->
        <div class="form-field">
          <span class="form-label">Имя <span class="required">*</span></span>
          <input class="form-input" formControlName="first_name" autocomplete="off" placeholder="Анна" />
          @if (form.get('first_name')?.invalid && form.get('first_name')?.touched) {
            <span class="field-error">Введите имя</span>
          }
        </div>

        <!-- Email -->
        <div class="form-field">
          <span class="form-label" aria-label="Email">Email *</span>
          <input class="form-input" formControlName="email" type="email"
                 name="staff-email"
                 autocomplete="off"
                 placeholder="anna@svoefoto.ru"
                 [readonly]="!!editingId()" />
          @if (form.get('email')?.invalid && form.get('email')?.touched) {
            <span class="field-error">Введите корректный email</span>
          }
        </div>

        <!-- Телефон -->
        <div class="form-field">
          <span class="form-label" aria-label="Телефон">Телефон</span>
          <input class="form-input" formControlName="phone" type="tel"
                 name="staff-phone"
                 inputmode="tel"
                 autocomplete="tel"
                 placeholder="+7 901 000-00-00" />
          @if (form.get('phone')?.invalid && form.get('phone')?.touched) {
            <span class="field-error">Введите телефон, например +7 901 000-00-00</span>
          }
        </div>

        <!-- Роль -->
        <div class="form-field">
          <span class="form-label" aria-label="Роль">Роль *</span>
          <select class="form-select" formControlName="role">
            <option value="employee">Сотрудник</option>
            <option value="photographer">Фотограф</option>
            <option value="manager">Менеджер</option>
            @if (editingId()) {
              <option value="admin">Администратор</option>
            }
          </select>
        </div>

        <!-- Отдел -->
        <div class="form-field">
          <span class="form-label">Отдел</span>
          <select class="form-select" formControlName="department">
            <option [ngValue]="null">— не назначен —</option>
            @for (d of departmentOptions; track d.value) {
              <option [ngValue]="d.value">{{ d.label }}</option>
            }
          </select>
        </div>

        <!-- Опциональный display_name -->
        <div class="form-field form-field--full">
          <details class="display-name-override">
            <summary class="form-hint-summary">Отобразить иначе (опционально)</summary>
            <input class="form-input" formControlName="display_name"
                   autocomplete="off"
                   placeholder="По умолчанию: Фамилия Имя" />
          </details>
        </div>

        <!-- Пароль -->
        <div class="form-field form-field--full">
          <span class="form-label" aria-label="Пароль">
            Пароль
            @if (!editingId()) { <span class="required">*</span> }
            @if (editingId()) { <span class="form-hint">(оставьте пустым, чтобы не менять)</span> }
          </span>
          <div class="password-row">
            <input class="form-input" formControlName="password"
                   name="staff-new-password"
                   autocomplete="new-password"
                   [type]="showPassword() ? 'text' : 'password'"
                   placeholder="{{ editingId() ? 'Новый пароль…' : 'Минимум 6 символов' }}" />
            <button type="button" class="btn-icon" (click)="toggleShowPassword()" matTooltip="Показать/скрыть">
              <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            <button type="button" class="btn-secondary" (click)="generatePwd()" matTooltip="Сгенерировать пароль">
              <mat-icon>casino</mat-icon> Генерировать
            </button>
          </div>
        </div>

      </div>

      <!-- Подсказка: скопировать данные -->
      @if (createdCreds()) {
        <div class="creds-box">
          <mat-icon class="creds-icon">check_circle</mat-icon>
          <div class="creds-text">
            <strong>Сотрудник создан!</strong> Данные для входа:
            <code>{{ createdCreds()?.email }} / {{ createdCreds()?.password }}</code>
          </div>
          <button type="button" class="btn-secondary" (click)="copyCreds()">
            <mat-icon>content_copy</mat-icon> Скопировать
          </button>
        </div>
      }
    </form>
  }

</div>
  `,
  styles: [`
    .tm-page { max-width: 900px; margin: 0 auto; padding: 16px; }

    .tm-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 12px;
    }
    .tm-header-left { display: flex; align-items: center; gap: 10px; }
    .tm-title { font-size: 20px; font-weight: 600; margin: 0; color: var(--crm-text-primary); }

    /* Buttons */
    .btn-primary {
      display: flex; align-items: center; gap: 6px; padding: 8px 16px;
      background: var(--crm-accent); color: #fff; border: none; border-radius: 8px;
      font-size: 14px; font-weight: 500; cursor: pointer; transition: opacity 0.15s;
      &:hover { opacity: 0.88; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .btn-secondary {
      display: flex; align-items: center; gap: 6px; padding: 7px 14px;
      background: var(--crm-bg-secondary); color: var(--crm-text-primary);
      border: 1px solid var(--crm-border); border-radius: 8px;
      font-size: 14px; cursor: pointer; transition: background 0.15s;
      &:hover { background: var(--crm-bg-hover); }
    }
    .btn-icon {
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: none; background: transparent;
      border-radius: 8px; cursor: pointer; color: var(--crm-text-secondary);
      &:hover { background: var(--crm-bg-hover); color: var(--crm-text-primary); }
    }
    .btn-icon-sm { width: 28px; height: 28px; }
    .btn-action {
      display: flex; align-items: center; padding: 6px;
      border: 1px solid var(--crm-border); border-radius: 6px;
      background: var(--crm-bg-secondary); cursor: pointer; color: var(--crm-text-secondary);
      transition: all 0.15s;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &:hover { background: var(--crm-bg-hover); color: var(--crm-text-primary); }
    }
    .btn-action--danger:hover { border-color: #ef4444; color: #ef4444; }
    .btn-action--success:hover { border-color: #10b981; color: #10b981; }

    /* Error */
    .tm-error {
      display: flex; align-items: center; gap: 8px; padding: 12px 16px;
      background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
      color: #dc2626; margin-bottom: 16px; font-size: 14px;
      mat-icon { font-size: 20px; }
      .btn-icon-sm { margin-left: auto; color: #dc2626; }
    }

    /* Filter bar */
    .filter-bar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .role-tabs { display: flex; gap: 4px; }
    .role-tab {
      display: flex; align-items: center; gap: 6px; padding: 6px 12px;
      border: 1px solid var(--crm-border); border-radius: 20px;
      background: transparent; font-size: 13px; cursor: pointer;
      color: var(--crm-text-secondary); transition: all 0.15s;
      &:hover { border-color: var(--crm-accent); color: var(--crm-accent); }
    }
    .role-tab--active {
      background: var(--crm-accent); border-color: var(--crm-accent);
      color: #fff;
    }
    .role-tab-count {
      font-size: 11px; background: rgba(0,0,0,0.12); border-radius: 10px;
      padding: 0 6px; min-width: 18px; text-align: center;
    }
    .role-tab--active .role-tab-count { background: rgba(255,255,255,0.3); }

    .dept-tabs {
      display: flex; gap: 4px; flex-wrap: wrap;
      padding-left: 8px; border-left: 1px solid var(--crm-border);
    }
    .dept-tab {
      padding: 6px 12px; border: 1px solid var(--crm-border);
      border-radius: 20px; background: transparent;
      font-size: 13px; cursor: pointer; color: var(--crm-text-secondary);
      transition: all 0.15s;
      &:hover { border-color: var(--crm-accent); color: var(--crm-accent); }
    }
    .dept-tab--active {
      background: var(--crm-bg-secondary);
      font-weight: 500;
    }

    .search-wrap {
      display: flex; align-items: center; gap: 6px;
      border: 1px solid var(--crm-border); border-radius: 8px;
      padding: 6px 10px; flex: 1; min-width: 200px; max-width: 320px;
      background: var(--crm-bg-secondary);
    }
    .search-icon { font-size: 18px; color: var(--crm-text-secondary); }
    .search-input { border: none; background: transparent; outline: none; flex: 1; font-size: 14px; color: var(--crm-text-primary); }

    /* Stats */
    .stats-row { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-card {
      flex: 1; min-width: 100px; padding: 12px 16px;
      background: var(--crm-bg-secondary); border: 1px solid var(--crm-border);
      border-radius: 10px; text-align: center;
    }
    .stat-num { font-size: 28px; font-weight: 700; color: var(--crm-text-primary); }
    .stat-num--online { color: #10b981; }
    .stat-num--inactive { color: #6b7280; }
    .stat-label { font-size: 12px; color: var(--crm-text-secondary); margin-top: 2px; }

    /* Loading / empty */
    .loading-state, .empty-state {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 48px 16px; color: var(--crm-text-secondary); text-align: center;
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; }

    /* Users grid */
    .users-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;
    }
    .user-card {
      position: relative; background: var(--crm-bg-secondary);
      border: 1px solid var(--crm-border); border-radius: 12px;
      padding: 20px 16px 14px; display: flex; flex-direction: column; align-items: center;
      gap: 6px; transition: box-shadow 0.15s;
      &:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
    }
    .user-card--inactive { opacity: 0.6; }
    .user-avatar {
      width: 64px; height: 64px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; font-weight: 700; color: #fff; margin-bottom: 4px;
    }
    .online-dot {
      position: absolute; top: 14px; right: 14px; width: 12px; height: 12px;
      background: #10b981; border-radius: 50%; border: 2px solid var(--crm-bg-secondary);
    }
    .user-info { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; }
    .user-name { font-size: 16px; font-weight: 600; color: var(--crm-text-primary); }
    .user-role-line {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      justify-content: center;
    }
    .user-role-badge {
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
      padding: 2px 10px; border-radius: 12px;
    }
    .dept-chip {
      font-size: 11px; font-weight: 500;
      padding: 2px 10px; border-radius: 12px;
      letter-spacing: 0.2px;
    }
    .user-email { font-size: 13px; color: var(--crm-text-secondary); }
    .user-phone { font-size: 13px; color: var(--crm-text-secondary); }
    .inactive-badge {
      font-size: 11px; background: #fef2f2; color: #dc2626;
      padding: 2px 8px; border-radius: 10px; margin-top: 2px;
    }
    .user-since { font-size: 11px; color: var(--crm-text-muted, var(--crm-text-secondary)); margin-top: 2px; }
    .user-actions { display: flex; gap: 8px; margin-top: 8px; }

    /* Form */
    .emp-form { margin-top: 8px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-field { display: flex; flex-direction: column; gap: 6px; }
    .form-field--full { grid-column: 1 / -1; }
    .form-label { font-size: 13px; font-weight: 500; color: var(--crm-text-primary); }
    .required { color: #ef4444; }
    .form-hint { font-size: 12px; color: var(--crm-text-secondary); font-weight: 400; }
    .form-input, .form-select {
      padding: 9px 12px; border: 1px solid var(--crm-border); border-radius: 8px;
      background: var(--crm-bg-secondary); color: var(--crm-text-primary);
      font-size: 14px; outline: none; transition: border-color 0.15s;
      &:focus { border-color: var(--crm-accent); }
      &[readonly] { opacity: 0.6; cursor: not-allowed; }
    }
    .field-error {
      font-size: 11px; color: var(--color-error, #ef4444); margin-top: 4px;
    }
    .password-row { display: flex; gap: 8px; align-items: center; }
    .password-row .form-input { flex: 1; }

    .display-name-override summary {
      cursor: pointer; color: var(--crm-text-secondary);
      font-size: 12px; padding: 4px 0; list-style: none;
    }
    .display-name-override summary::before { content: '▸ '; font-size: 10px; }
    .display-name-override[open] summary::before { content: '▾ '; }
    .form-hint-summary { user-select: none; }

    /* Creds box */
    .creds-box {
      display: flex; align-items: center; gap: 12px; margin-top: 20px;
      padding: 14px 16px; background: #f0fdf4; border: 1px solid #86efac;
      border-radius: 10px;
    }
    .creds-icon { color: #16a34a; font-size: 24px; }
    .creds-text { flex: 1; font-size: 14px; color: var(--crm-text-primary); }
    .creds-text code { display: block; margin-top: 4px; font-family: monospace; font-size: 13px; }
  `],
})
export class TeamManagementComponent implements OnInit {
  private readonly api = inject(UsersApiService);
  private readonly onlineStaff = inject(OnlineStaffService);
  private readonly snack = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);

  readonly view = signal<ViewMode>('list');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly showPassword = signal(false);
  readonly createdCreds = signal<{ email: string; password: string } | null>(null);

  readonly roleFilter = signal<FilterRole>('all');
  readonly deptFilter = signal<Department | 'all'>('all');
  searchQuery = '';
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly allUsers = signal<StaffUser[]>([]);

  readonly departmentOptions = (Object.keys(DEPARTMENT_LABELS) as Department[])
    .map(value => ({ value, label: DEPARTMENT_LABELS[value] }));

  readonly form = this.fb.group({
    last_name: [''],
    first_name: ['', Validators.required],
    display_name: [''],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', optionalPhoneValidator],
    role: ['employee' as string, Validators.required],
    department: [null as Department | null],
    password: [''],
  });

  // Computed: filtered list
  readonly filteredUsers = computed(() => {
    const role = this.roleFilter();
    const dept = this.deptFilter();
    return this.allUsers().filter(u =>
      (role === 'all' || u.role === role) &&
      (dept === 'all' || u.department === dept),
    );
  });

  readonly activeCount = computed(() => this.allUsers().filter(u => u.is_active).length);
  readonly inactiveCount = computed(() => this.allUsers().filter(u => !u.is_active).length);
  readonly onlineCount = computed(() => {
    const onlineIds = new Set(this.onlineStaff.staff().map(s => s.id));
    return this.allUsers().filter(u => onlineIds.has(u.id)).length;
  });

  readonly roleFilters: { value: FilterRole; label: string; count: () => number }[] = [
    { value: 'all', label: 'Все', count: () => this.allUsers().length },
    { value: 'employee', label: 'Сотрудники', count: () => this.allUsers().filter(u => u.role === 'employee').length },
    { value: 'photographer', label: 'Фотографы', count: () => this.allUsers().filter(u => u.role === 'photographer').length },
    { value: 'manager', label: 'Менеджеры', count: () => this.allUsers().filter(u => u.role === 'manager').length },
    { value: 'admin', label: 'Админы', count: () => this.allUsers().filter(u => u.role === 'admin').length },
  ];

  ngOnInit(): void {
    this.loadUsers();
    this.onlineStaff.init();
  }

  private loadUsers(search?: string): void {
    this.loading.set(true);
    this.error.set(null);
    const dept = this.deptFilter();
    this.api.getUsers({
      search,
      department: dept === 'all' ? undefined : dept,
    }).subscribe({
      next: (users) => { this.allUsers.set(users); this.loading.set(false); },
      error: (err) => { this.error.set(err?.error?.message || 'Ошибка загрузки'); this.loading.set(false); },
    });
  }

  onSearch(query: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadUsers(query || undefined), 300);
  }

  setDeptFilter(d: Department | 'all'): void {
    this.deptFilter.set(d);
    this.loadUsers(this.searchQuery || undefined);
  }

  openCreate(): void {
    this.editingId.set(null);
    this.createdCreds.set(null);
    this.showPassword.set(false);
    this.form.reset({
      last_name: '',
      first_name: '',
      display_name: '',
      email: '',
      phone: '',
      role: 'employee',
      department: null,
      password: '',
    });
    this.form.get('email')!.enable();
    this.form.get('password')!.setValidators([Validators.required, Validators.minLength(6)]);
    this.form.get('password')!.updateValueAndValidity();
    this.view.set('form');
  }

  openEdit(user: StaffUser): void {
    this.editingId.set(user.id);
    this.createdCreds.set(null);
    this.showPassword.set(false);
    const fallbackFirst = user.display_name?.split(' ').slice(-1)[0] ?? '';
    this.form.reset({
      last_name: user.last_name ?? '',
      first_name: user.first_name ?? fallbackFirst,
      display_name: user.display_name,
      email: user.email,
      phone: user.phone || '',
      role: user.role,
      department: user.department ?? null,
      password: '',
    });
    this.form.get('email')!.disable();
    this.form.get('password')!.clearValidators();
    this.form.get('password')!.updateValueAndValidity();
    this.view.set('form');
  }

  backToList(): void {
    this.view.set('list');
    this.editingId.set(null);
    this.createdCreds.set(null);
  }

  generatePwd(): void {
    const pwd = generatePassword();
    this.form.get('password')!.setValue(pwd);
    this.showPassword.set(true);
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);

    const raw = this.form.getRawValue();
    const id = this.editingId();
    const firstName = (raw.first_name ?? '').trim();
    const lastName = (raw.last_name ?? '').trim();

    if (!firstName) {
      this.saving.set(false);
      this.error.set('Введите имя');
      return;
    }

    const displayName = (raw.display_name ?? '').trim()
      || buildDisplayName(firstName, lastName, '');
    const phone = (raw.phone ?? '').trim();

    if (id) {
      // Update
      const dto: UpdateUserDto = {};
      dto.first_name = firstName;
      dto.last_name = lastName || null;
      if (displayName) dto.display_name = displayName;
      dto.department = raw.department ?? null;
      dto.phone = phone || null;
      if (raw.role) dto.role = raw.role as UserRole;
      if (raw.password) dto.password = raw.password;

      this.api.updateUser(id, dto).subscribe({
        next: (user) => {
          this.saving.set(false);
          this.snack.open(`${this.getFullName(user)} обновлён`, 'OK', { duration: 2500 });
          this.loadUsers();
          this.backToList();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(err?.error?.message || 'Ошибка сохранения');
        },
      });
    } else {
      // Create
      const dto: CreateUserDto = {
        email: raw.email!,
        first_name: firstName,
        last_name: lastName || undefined,
        display_name: displayName || undefined,
        department: raw.department || undefined,
        phone: phone || undefined,
        role: (raw.role as 'employee' | 'photographer' | 'manager'),
        password: raw.password!,
      };

      this.api.createUser(dto).subscribe({
        next: (user) => {
          this.saving.set(false);
          this.createdCreds.set({ email: user.email, password: raw.password! });
          this.loadUsers();
          this.snack.open(`${this.getFullName(user)} добавлен в команду!`, 'OK', { duration: 3000 });
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(err?.error?.message || 'Ошибка создания');
        },
      });
    }
  }

  deactivate(user: StaffUser): void {
    if (!confirm(`Деактивировать ${this.getFullName(user)}? Сотрудник не сможет войти в систему.`)) return;
    this.api.deactivateUser(user.id).subscribe({
      next: () => {
        this.snack.open('Сотрудник деактивирован', 'OK', { duration: 2500 });
        this.loadUsers();
      },
      error: (err) => this.error.set(err?.error?.message || 'Ошибка'),
    });
  }

  activate(user: StaffUser): void {
    this.api.updateUser(user.id, { is_active: true }).subscribe({
      next: () => {
        this.snack.open('Сотрудник активирован', 'OK', { duration: 2500 });
        this.loadUsers();
      },
      error: (err) => this.error.set(err?.error?.message || 'Ошибка'),
    });
  }

  copyCreds(): void {
    const c = this.createdCreds();
    if (!c) return;
    navigator.clipboard.writeText(`Email: ${c.email}\nПароль: ${c.password}`);
    this.snack.open('Данные скопированы в буфер', 'OK', { duration: 2000 });
  }

  getRoleLabel(role: string): string {
    return ROLE_LABELS[role] || role;
  }

  getRoleColor(role: string): string {
    return ROLE_COLORS[role] || '#6b7280';
  }

  getFullName(u: StaffUser): string {
    return buildDisplayName(u.first_name, u.last_name, u.display_name);
  }

  getDeptLabel(d: Department | null): string {
    return d ? DEPARTMENT_LABELS[d] : '';
  }

  getDeptColor(d: Department | null): string {
    return d ? DEPARTMENT_COLORS[d] : '#6b7280';
  }

  getInitials(user: StaffUser): string {
    const name = this.getFullName(user);
    return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  }

  toggleShowPassword(): void {
    this.showPassword.update(v => !v);
  }

  isOnline(userId: string): boolean {
    return this.onlineStaff.staff().some(s => s.id === userId);
  }
}
