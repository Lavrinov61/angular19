import {
  Component, ChangeDetectionStrategy, inject, input, signal, effect,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  DeliveryService, type DeliveryShipment, type ShipmentStatus,
} from '../../../../../../core/services/delivery.service';

interface StatusStep {
  status: ShipmentStatus;
  label: string;
  icon: string;
}

/** Порядок нормализованных статусов доставки для прогресс-цепочки. */
const STATUS_FLOW: readonly StatusStep[] = [
  { status: 'created', label: 'Заказ оформлен', icon: 'receipt_long' },
  { status: 'courier_assigned', label: 'Курьер назначен', icon: 'person_pin_circle' },
  { status: 'picked_up', label: 'Забрали из студии', icon: 'inventory_2' },
  { status: 'in_transit', label: 'В пути', icon: 'local_shipping' },
  { status: 'delivered', label: 'Доставлено', icon: 'check_circle' },
];

/**
 * Трекинг курьерской доставки заказа печати.
 *
 * Дёргает `GET /api/delivery/shipments/:orderId` (IDOR на backend) и показывает
 * нормализованный статус, ETA, курьера и ссылку отслеживания. Если у заказа нет
 * курьерской доставки, компонент ничего не рендерит (status=null).
 */
@Component({
  selector: 'app-delivery-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatProgressSpinnerModule],
  host: { class: 'delivery-tracking' },
  template: `
    @if (loading()) {
      <div class="dt-loading">
        <mat-progress-spinner mode="indeterminate" diameter="22" />
        <span>Загружаем статус доставки…</span>
      </div>
    } @else if (shipment()) {
      @let s = shipment()!;
      <div class="dt-card">
        <div class="dt-head">
          <mat-icon>local_shipping</mat-icon>
          <div class="dt-head-text">
            <h4>Курьерская доставка</h4>
            <span class="dt-status" [class.dt-status--terminal]="isTerminal(s.status)">
              {{ statusLabel(s.status) }}
            </span>
          </div>
        </div>

        @if (s.status === 'cancelled' || s.status === 'failed') {
          <p class="dt-problem">
            <mat-icon>error_outline</mat-icon>
            Возникла проблема с доставкой. Свяжитесь со студией, мы поможем.
          </p>
        } @else {
          <ol class="dt-flow">
            @for (step of statusFlow; track step.status) {
              <li class="dt-step"
                  [class.dt-step--done]="stepIndex(s.status) >= stepIndex(step.status)"
                  [class.dt-step--current]="s.status === step.status">
                <span class="dt-step-icon"><mat-icon>{{ step.icon }}</mat-icon></span>
                <span class="dt-step-label">{{ step.label }}</span>
              </li>
            }
          </ol>
        }

        <div class="dt-meta">
          @if (s.etaMinutes !== null && s.status !== 'delivered') {
            <span class="dt-meta-item">
              <mat-icon>schedule</mat-icon>
              ~{{ s.etaMinutes }} мин
            </span>
          }
          @let courier = s.courier;
          @if (courier) {
            <span class="dt-meta-item">
              <mat-icon>person</mat-icon>
              {{ courier.name }}@if (courier.phone) {, {{ courier.phone }}}
            </span>
          }
          @if (s.trackingUrl) {
            <a class="dt-track-link" [href]="s.trackingUrl" target="_blank" rel="noopener">
              <mat-icon>open_in_new</mat-icon>
              Отслеживать на карте
            </a>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; }

    .dt-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.88rem;
    }

    .dt-card {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 16px;
      background: var(--ed-surface-container, #1a1a1a);
    }

    .dt-head {
      display: flex;
      align-items: center;
      gap: 12px;

      > mat-icon {
        font-size: 26px;
        width: 26px;
        height: 26px;
        color: var(--ed-accent, #f59e0b);
      }
    }

    .dt-head-text h4 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .dt-status {
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .dt-status--terminal {
      color: #22c55e;
      font-weight: 600;
    }

    .dt-flow {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .dt-step {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--ed-on-surface-muted, #666666);
    }

    .dt-step-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--ed-surface-container-high, #222222);
      flex-shrink: 0;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .dt-step-label {
      font-size: 0.86rem;
    }

    .dt-step--done {
      color: var(--ed-on-surface, #f5f5f5);

      .dt-step-icon {
        background: rgba(245, 158, 11, 0.15);
        color: var(--ed-accent, #f59e0b);
      }
    }

    .dt-step--current .dt-step-icon {
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.18);
    }

    .dt-problem {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      font-size: 0.85rem;

      mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    }

    .dt-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      padding-top: 4px;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .dt-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .dt-track-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--ed-accent, #f59e0b);
      text-decoration: none;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
  `,
})
export class DeliveryTrackingComponent {
  private readonly deliveryService = inject(DeliveryService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Идентификатор заказа печати */
  readonly orderId = input.required<string>();

  readonly shipment = signal<DeliveryShipment | null>(null);
  readonly loading = signal(false);

  readonly statusFlow = STATUS_FLOW;

  constructor() {
    effect(() => {
      const id = this.orderId();
      if (!id || !isPlatformBrowser(this.platformId)) return;
      this.load(id);
    });
  }

  statusLabel(status: ShipmentStatus): string {
    const labels: Record<string, string> = {
      pending: 'Готовим к отправке',
      created: 'Заказ оформлен',
      courier_assigned: 'Курьер назначен',
      picked_up: 'Забрали из студии',
      in_transit: 'В пути',
      delivered: 'Доставлено',
      cancelled: 'Доставка отменена',
      failed: 'Ошибка доставки',
    };
    return labels[status] ?? 'Статус уточняется';
  }

  isTerminal(status: ShipmentStatus): boolean {
    return status === 'delivered';
  }

  stepIndex(status: ShipmentStatus): number {
    if (status === 'pending') return -1;
    return STATUS_FLOW.findIndex(step => step.status === status);
  }

  private load(orderId: string): void {
    this.loading.set(true);
    this.deliveryService.getShipment(orderId).subscribe(shipment => {
      this.shipment.set(shipment);
      this.loading.set(false);
    });
  }
}
