import { Component, inject, input, output, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-dashboard-quick-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="hero-row">
      <button class="kasssa-btn" (click)="openPos.emit()">
        <mat-icon>point_of_sale</mat-icon>
        <span>КАССА</span>
      </button>

      <div class="secondary-actions">
        <button class="sec-btn" (click)="createTask.emit()">
          <mat-icon>add_task</mat-icon>
          Задача
        </button>
        <button class="sec-btn" (click)="openDialer.emit()">
          <mat-icon>phone</mat-icon>
          Звонок
        </button>
        <button class="sec-btn" (click)="navigate('/employee/approvals')">
          <mat-icon>photo_library</mat-icon>
          Фото
        </button>
        @if (canReviewStudents()) {
          <button class="sec-btn" (click)="openStudentVerification.emit()">
            <mat-icon>school</mat-icon>
            Студенты
            @if (studentPendingCount() > 0) {
              <span class="sec-badge">{{ studentPendingCount() }}</span>
            }
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .hero-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .kasssa-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 20px;
      border: none;
      border-radius: 999px;
      background: linear-gradient(135deg, #d97706, #f59e0b, #fbbf24);
      color: #0a0a0a;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(245, 158, 11, 0.25);
      transition:
        transform var(--crm-transition-spring),
        box-shadow var(--crm-transition-smooth);
      flex-shrink: 0;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.35);
      }
      &:active { transform: scale(0.97); }
    }

    .secondary-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .sec-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 14px;
      border: 1px solid var(--crm-border);
      border-radius: 999px;
      background: transparent;
      color: var(--crm-text-secondary);
      font-size: 12px;
      font-weight: 500;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition:
        color var(--crm-transition-fast),
        border-color var(--crm-transition-fast),
        background var(--crm-transition-fast);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &:hover {
        color: var(--crm-text-primary);
        border-color: rgba(255, 255, 255, 0.12);
        background: var(--crm-surface-hover);
      }
    }

    .sec-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--crm-accent, #f59e0b);
      color: #0a0a0a;
      font-size: 10px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 600px) {
      .hero-row { flex-direction: column; align-items: stretch; }
      .kasssa-btn { justify-content: center; }
      .secondary-actions { justify-content: center; }
    }
  `],
})
export class DashboardQuickActionsComponent {
  private readonly router = inject(Router);
  canReviewStudents = input<boolean>(false);
  studentPendingCount = input<number>(0);
  createTask = output<void>();
  openDialer = output<void>();
  openPos = output<void>();
  openStudentVerification = output<void>();

  navigate(path: string): void {
    this.router.navigateByUrl(path);
  }
}
