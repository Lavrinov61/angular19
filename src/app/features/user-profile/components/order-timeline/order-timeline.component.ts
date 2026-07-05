import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { OrderStatus, OrderType } from '../../../../core/models/order-history.model';

interface TimelineStep {
  label: string;
  icon: string;
  reached: boolean;
  current: boolean;
}

@Component({
  selector: 'app-order-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="timeline" [attr.data-steps]="steps().length">
      @for (step of steps(); track step.label; let i = $index) {
        <div class="timeline-step" [class.reached]="step.reached" [class.current]="step.current">
          <div class="step-dot" [class.pulse]="step.current">
            <mat-icon>{{ step.icon }}</mat-icon>
          </div>
          <span class="step-label">{{ step.label }}</span>
        </div>
        @if (i < steps().length - 1) {
          <div class="step-connector" [class.filled]="steps()[i + 1].reached"></div>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      --tl-amber: #f59e0b;
      --tl-green: #22c55e;
      --tl-muted: #555;
      --tl-bg: #2a2a2a;
    }

    .timeline {
      display: flex;
      align-items: flex-start;
      gap: 0;
      padding: 8px 4px 4px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .timeline-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      min-width: 56px;
    }

    .step-dot {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--tl-bg);
      border: 2px solid var(--tl-muted);
      transition: all 0.3s ease;
    }

    .step-dot mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--tl-muted);
    }

    .reached .step-dot {
      background: rgba(34, 197, 94, 0.15);
      border-color: var(--tl-green);
    }

    .reached .step-dot mat-icon {
      color: var(--tl-green);
    }

    .current .step-dot {
      background: rgba(245, 158, 11, 0.2);
      border-color: var(--tl-amber);
    }

    .current .step-dot mat-icon {
      color: var(--tl-amber);
    }

    .step-dot.pulse {
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
      50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
    }

    .step-label {
      font-size: 0.62rem;
      font-weight: 500;
      color: var(--tl-muted);
      text-align: center;
      line-height: 1.2;
      max-width: 64px;
      white-space: nowrap;
    }

    .reached .step-label {
      color: var(--tl-green);
    }

    .current .step-label {
      color: var(--tl-amber);
      font-weight: 700;
    }

    .step-connector {
      flex: 1;
      height: 2px;
      background: var(--tl-muted);
      min-width: 16px;
      margin-top: 14px;
      border-radius: 1px;
      opacity: 0.4;
      transition: all 0.3s ease;
    }

    .step-connector.filled {
      background: var(--tl-green);
      opacity: 1;
    }
  `,
})
export class OrderTimelineComponent {
  readonly status = input.required<OrderStatus | string>();
  readonly orderType = input<OrderType | string>();

  readonly steps = computed<TimelineStep[]>(() => {
    const s = this.status();
    const type = this.orderType();
    const isPhotoSession = type === OrderType.PHOTO_SESSION;

    const baseSteps: { key: string; label: string; icon: string }[] = [
      { key: 'new', label: 'Оформлен', icon: 'receipt' },
      { key: 'processing', label: 'В работе', icon: 'autorenew' },
    ];

    if (isPhotoSession) {
      baseSteps.push({ key: 'waiting', label: 'Ретушь', icon: 'face_retouching_natural' });
    }

    baseSteps.push(
      { key: 'ready', label: 'Готов', icon: 'check_circle' },
      { key: 'completed', label: 'Выдан', icon: 'done_all' },
    );

    const statusOrder = baseSteps.map(step => step.key);
    const currentIndex = this.resolveStatusIndex(s, statusOrder);

    return baseSteps.map((step, i) => ({
      label: step.label,
      icon: step.icon,
      reached: i <= currentIndex,
      current: i === currentIndex,
    }));
  });

  private resolveStatusIndex(status: string, statusOrder: string[]): number {
    if (status === 'cancelled' || status === 'refunded') {
      return -1;
    }
    if (status === 'pending_payment') {
      return 0;
    }
    const idx = statusOrder.indexOf(status);
    return idx >= 0 ? idx : 0;
  }
}
