import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
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
  selector: 'app-reset-password',
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
            <mat-icon>lock_open</mat-icon>
          </div>
        </div>

        @if (success()) {
          <h1 class="auth-title">Пароль изменён</h1>
          <p class="auth-subtitle">Теперь вы можете войти с новым паролем</p>
          <p class="auth-footer-text">
            <a routerLink="/auth/login" class="auth-link">Войти</a>
          </p>
        } @else if (tokenError()) {
          <h1 class="auth-title">Ссылка устарела</h1>
          <p class="auth-subtitle">Ссылка для сброса пароля недействительна или истёк срок действия (1 час)</p>
          <p class="auth-footer-text">
            <a routerLink="/auth/forgot-password" class="auth-link">Запросить новую ссылку</a>
          </p>
        } @else {
          <h1 class="auth-title">Новый пароль</h1>
          <p class="auth-subtitle">Придумайте надёжный пароль, не менее 8 символов</p>

          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="auth-form">
            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Новый пароль</mat-label>
              <input
                matInput
                [type]="showPassword() ? 'text' : 'password'"
                formControlName="newPassword"
                autocomplete="new-password"
              />
              <mat-icon matPrefix>lock</mat-icon>
              <button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())">
                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (form.controls.newPassword.hasError('minlength') && form.controls.newPassword.touched) {
                <mat-error>Минимум 8 символов</mat-error>
              } @else if (form.controls.newPassword.hasError('required') && form.controls.newPassword.touched) {
                <mat-error>Введите пароль</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="auth-field">
              <mat-label>Повторите пароль</mat-label>
              <input
                matInput
                [type]="showPassword() ? 'text' : 'password'"
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
                Сохранить пароль
              }
            </button>
          </form>
        }

      </div>
    </div>
  `,
  styleUrl: '../forgot-password/forgot-password.component.scss',
})
export class ResetPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private token = '';

  loading = signal(false);
  success = signal(false);
  tokenError = signal(false);
  showPassword = signal(false);
  errorMessage = signal<string | null>(null);

  form = this.fb.group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.tokenError.set(true);
    }
  }

  onSubmit(): void {
    if (this.form.invalid || this.loading()) return;

    this.errorMessage.set(null);
    this.loading.set(true);

    this.authService.resetPassword(this.token, this.form.value.newPassword!).subscribe({
      next: () => {
        this.loading.set(false);
        this.success.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.message || err?.message || '';
        if (msg.includes('недействит') || msg.includes('устарел') || msg.includes('invalid')) {
          this.tokenError.set(true);
        } else {
          this.errorMessage.set('Не удалось изменить пароль. Попробуйте ещё раз.');
        }
      },
    });
  }
}
