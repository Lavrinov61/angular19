import { Component, inject, signal, computed, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { AuthService } from '../../../../core/services/auth.service';
import { AuthChatService } from '../../../../core/services/auth-chat.service';
import { OAUTH_BUTTONS } from '../oauth-providers.data';

@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
  ],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private visitorChatService = inject(AuthChatService);
  private sanitizer = inject(DomSanitizer);
  private platformId = inject(PLATFORM_ID);
  private route = inject(ActivatedRoute);
  protected returnUrl = '/';

  registerForm: FormGroup;

  hidePassword = signal(true);
  hideConfirmPassword = signal(true);
  isLoading = signal(false);
  error = signal<string | null>(null);
  registeredEmail = signal<string | null>(null); // показывает "проверьте почту"
  resendLoading = signal(false);
  resendDone = signal(false);

  /** Кнопки провайдеров, которые реально настроены на бэкенде */
  availableButtons = computed(() =>
    OAUTH_BUTTONS
      .filter(btn => this.authService.availableProviders().some(p => p.id === btn.id))
      .map(btn => ({ ...btn, safeSvg: this.sanitizer.bypassSecurityTrustHtml(btn.svgIcon) as SafeHtml }))
  );

  // Password strength
  passwordStrength = computed(() => {
    const pw = this.registerForm?.get('password')?.value || '';
    if (!pw) return { level: 0, label: '' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 2) return { level: 1, label: 'Слабый' };
    if (score <= 3) return { level: 2, label: 'Средний' };
    return { level: 3, label: 'Надёжный' };
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.authService.loadAvailableProviders().subscribe();
    }
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
    this.registerForm = this.fb.group({
      displayName: [''],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
      agreeTerms: [false, [Validators.requiredTrue]]
    }, { validators: this.passwordMatchValidator });
  }

  private passwordMatchValidator(form: AbstractControl) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');
    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
    } else if (confirmPassword?.hasError('passwordMismatch')) {
      confirmPassword.setErrors(null);
    }
    return null;
  }

  onSubmit(): void {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    const { email, password, displayName } = this.registerForm.value;
    this.error.set(null);
    this.isLoading.set(true);

    // Save returnUrl so login page can redirect after email verification
    if (this.returnUrl !== '/') {
      localStorage.setItem('auth_return_url', this.returnUrl);
    }

    this.authService.register(email, password, displayName || undefined).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.requiresVerification) {
          this.registeredEmail.set(email);
        } else {
          this.router.navigateByUrl(this.returnUrl);
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.error.set(err.error || err.message || 'Ошибка регистрации. Попробуйте ещё раз.');
      }
    });
  }

  onResendVerification(): void {
    const email = this.registeredEmail();
    if (!email || this.resendLoading()) return;
    this.resendLoading.set(true);
    this.resendDone.set(false);
    this.authService.resendVerificationEmail(email).subscribe({
      next: () => {
        this.resendLoading.set(false);
        this.resendDone.set(true);
      },
      error: () => {
        this.resendLoading.set(false);
        this.resendDone.set(true); // тихо, не пугаем пользователя
      }
    });
  }

  onOAuthSignIn(providerId: string): void {
    this.authService.signInWithProvider(providerId).subscribe();
  }
}
