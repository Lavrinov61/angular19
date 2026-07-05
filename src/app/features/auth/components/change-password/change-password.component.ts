import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('newPassword')?.value;
  const confirm = control.get('confirmPassword')?.value;
  if (password && confirm && password !== confirm) {
    return { mismatch: true };
  }
  return null;
}

@Component({
  selector: 'app-change-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="auth-page">
      <div class="auth-card">

        <div class="auth-icon-header">
          <div class="icon-circle">
            <mat-icon>vpn_key</mat-icon>
          </div>
        </div>

        @if (success()) {
          <h1 class="auth-title">Пароль изменён</h1>
          <p class="auth-subtitle">Новый пароль сохранён. Можете продолжить работу.</p>
          <button
            mat-flat-button
            color="primary"
            class="auth-submit"
            (click)="goToDashboard()"
          >
            Продолжить
          </button>
        } @else {
          <h1 class="auth-title">Смена пароля</h1>
          <p class="auth-subtitle">Введите текущий пароль и придумайте новый (не менее 10 символов, буква + цифра)</p>

          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="auth-form">
            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Текущий пароль</mat-label>
              <input
                matInput
                [type]="showCurrent() ? 'text' : 'password'"
                formControlName="currentPassword"
                autocomplete="current-password"
              />
              <mat-icon matPrefix>lock_outline</mat-icon>
              <button mat-icon-button matSuffix type="button" (click)="showCurrent.set(!showCurrent())">
                <mat-icon>{{ showCurrent() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (form.controls.currentPassword.hasError('required') && form.controls.currentPassword.touched) {
                <mat-error>Введите текущий пароль</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Новый пароль</mat-label>
              <input
                matInput
                [type]="showNew() ? 'text' : 'password'"
                formControlName="newPassword"
                autocomplete="new-password"
              />
              <mat-icon matPrefix>lock</mat-icon>
              <button mat-icon-button matSuffix type="button" (click)="showNew.set(!showNew())">
                <mat-icon>{{ showNew() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (form.controls.newPassword.hasError('minlength') && form.controls.newPassword.touched) {
                <mat-error>Минимум 10 символов</mat-error>
              } @else if (form.controls.newPassword.hasError('required') && form.controls.newPassword.touched) {
                <mat-error>Введите новый пароль</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Повторите новый пароль</mat-label>
              <input
                matInput
                [type]="showNew() ? 'text' : 'password'"
                formControlName="confirmPassword"
                autocomplete="new-password"
              />
              <mat-icon matPrefix>lock_outline</mat-icon>
              @if (form.hasError('mismatch') && form.controls.confirmPassword.touched) {
                <mat-error>Пароли не совпадают</mat-error>
              }
            </mat-form-field>

            @if (errorMessage()) {
              <p class="auth-error">{{ errorMessage() }}</p>
            }

            <button
              mat-flat-button
              color="primary"
              type="submit"
              class="auth-submit"
              [disabled]="form.invalid || loading()"
            >
              @if (loading()) {
                <mat-spinner diameter="20" />
              } @else {
                Сменить пароль
              }
            </button>
          </form>
        }

      </div>
    </div>
  `,
  styleUrl: '../forgot-password/forgot-password.component.scss',
})
export class ChangePasswordComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);

  loading = signal(false);
  success = signal(false);
  showCurrent = signal(false);
  showNew = signal(false);
  errorMessage = signal<string | null>(null);

  form = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(10)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  onSubmit(): void {
    if (this.form.invalid || this.loading()) return;

    this.errorMessage.set(null);
    this.loading.set(true);

    const { currentPassword, newPassword } = this.form.value;

    this.authService.changePassword(currentPassword!, newPassword!).subscribe({
      next: () => {
        this.loading.set(false);
        this.success.set(true);
      },
      error: (err: { error?: { error?: string; message?: string }; message?: string }) => {
        this.loading.set(false);
        const msg = err?.error?.error || err?.error?.message || err?.message || '';
        if (msg.includes('Неверный текущий')) {
          this.errorMessage.set('Неверный текущий пароль');
        } else if (msg.includes('Слабый пароль')) {
          this.errorMessage.set(msg);
        } else {
          this.errorMessage.set('Не удалось сменить пароль. Попробуйте ещё раз.');
        }
      },
    });
  }

  goToDashboard(): void {
    const role = this.authService.currentUser()?.role;
    if (role === 'admin' || role === 'manager') {
      this.router.navigate(['/admin']);
    } else if (role === 'employee') {
      this.router.navigate(['/employee']);
    } else {
      this.router.navigate(['/']);
    }
  }
}
