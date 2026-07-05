import { Component, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-oauth-pending',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule, MatIconModule],
  template: `
    <div class="pending-container">
      <mat-card class="pending-card">
        <mat-card-content>
          <div class="pending-content">
            <mat-icon class="mail-icon">mark_email_read</mat-icon>
            <h2>Подтвердите привязку</h2>
            <p>
              Мы отправили письмо на <strong>{{ maskedEmail() }}</strong>
              для подтверждения привязки аккаунта.
            </p>
            <p class="hint">Перейдите по ссылке в письме. Ссылка действительна 1 час.</p>
            <button mat-stroked-button (click)="goToLogin()">
              Вернуться на страницу входа
            </button>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .pending-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .pending-card { max-width: 420px; width: 100%; }
    .pending-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }
    .mail-icon { font-size: 48px; width: 48px; height: 48px; color: #1565c0; }
    h2 { margin: 0; font-size: 22px; font-weight: 600; }
    p { margin: 0; font-size: 15px; line-height: 1.5; color: #555; }
    .hint { font-size: 13px; color: #999; }
  `]
})
export class OAuthPendingComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private params = toSignal(this.route.queryParams, { initialValue: {} as Record<string, string> });
  maskedEmail = computed(() => this.params()['email'] || '***@***');

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
