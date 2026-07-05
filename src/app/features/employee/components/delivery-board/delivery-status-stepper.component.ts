import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { ShipmentStatus } from '../../../../core/services/delivery.service';

interface StepDef {
  key: ShipmentStatus;
  label: string;
  icon: string;
}

/** Линейная последовательность статусов отправления (терминальные cancelled/failed — вне степпера). */
export const DELIVERY_STEPS: readonly StepDef[] = [
  { key: 'pending', label: 'Ожидает', icon: 'schedule' },
  { key: 'created', label: 'Создано', icon: 'add_box' },
  { key: 'courier_assigned', label: 'Курьер', icon: 'person_pin' },
  { key: 'picked_up', label: 'Забрал', icon: 'inventory_2' },
  { key: 'in_transit', label: 'В пути', icon: 'local_shipping' },
  { key: 'delivered', label: 'Доставлено', icon: 'check_circle' },
];

/** Терминальный статус — отправление завершено отменой/сбоем (вне линейного степпера). */
export function isTerminalShipmentStatus(status: ShipmentStatus | null): boolean {
  return status === 'cancelled' || status === 'failed';
}

/** Индекс активного шага в DELIVERY_STEPS; null/неизвестный статус → 0 (pending). */
export function deliveryStepIndex(status: ShipmentStatus | null): number {
  if (!status) return 0;
  const idx = DELIVERY_STEPS.findIndex((step) => step.key === status);
  return idx < 0 ? 0 : idx;
}

/**
 * Переиспользуемый горизонтальный степпер статуса курьерского отправления:
 * pending→created→courier_assigned→picked_up→in_transit→delivered.
 * Терминальные `cancelled`/`failed` показываются отдельной плашкой.
 */
@Component({
  selector: 'app-delivery-status-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (isTerminal()) {
      <div class="terminal" [class.failed]="status() === 'failed'">
        <mat-icon>{{ status() === 'failed' ? 'error' : 'cancel' }}</mat-icon>
        <span>{{ status() === 'failed' ? 'Сбой доставки' : 'Отменено' }}</span>
      </div>
    } @else {
      <ol class="stepper">
        @for (step of steps; track step.key; let i = $index) {
          <li
            class="step"
            [class.done]="i < activeIndex()"
            [class.active]="i === activeIndex()">
            <span class="dot">
              <mat-icon>{{ i < activeIndex() ? 'check' : step.icon }}</mat-icon>
            </span>
            <span class="step-label">{{ step.label }}</span>
          </li>
        }
      </ol>
    }
  `,
  styles: [`
    :host { display: block; }
    .stepper {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      align-items: flex-start;
      gap: 0;
    }
    .step {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      position: relative;
      min-width: 0;
    }
    /* Соединительная линия между шагами */
    .step:not(:first-child)::before {
      content: '';
      position: absolute;
      top: 11px;
      left: -50%;
      width: 100%;
      height: 2px;
      background: var(--mat-sys-outline-variant);
      z-index: 0;
    }
    .step.done::before,
    .step.active::before {
      background: var(--mat-sys-primary);
    }
    .dot {
      position: relative;
      z-index: 1;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
      border: 2px solid var(--mat-sys-outline-variant);
    }
    .step.done .dot,
    .step.active .dot {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      border-color: var(--mat-sys-primary);
    }
    .dot mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .step-label {
      font-size: 10px;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .step.active .step-label { color: var(--mat-sys-primary); font-weight: 600; }
    .terminal {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }
    .terminal mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .terminal.failed { color: var(--mat-sys-error); }
  `],
})
export class DeliveryStatusStepperComponent {
  /** Текущий статус отправления; null трактуется как 'pending' (курьер не вызван). */
  readonly status = input<ShipmentStatus | null>(null);

  readonly steps = DELIVERY_STEPS;

  readonly isTerminal = computed(() => isTerminalShipmentStatus(this.status()));

  /** Индекс активного шага в DELIVERY_STEPS; неизвестный/null статус → 0 (pending). */
  readonly activeIndex = computed(() => deliveryStepIndex(this.status()));
}
