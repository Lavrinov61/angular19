import {
  Component, ChangeDetectionStrategy, inject, input, signal, effect, untracked,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  PaymentsService, PaymentLink, PaymentLinkStatus, ChannelType,
} from '../../../services/payments.service';
import { WebSocketService } from '../../../../../core/services/websocket.service';
import { ToastService } from '../../../../../core/services/toast.service';
import { UnifiedOrderComponent } from '../../unified-order/unified-order.component';
import {
  PaymentLinkQrDialogComponent,
} from '../../client-profile-panel/payment-link-qr-dialog/payment-link-qr-dialog.component';
import { PaymentDialogComponent } from '../../payment-dialog/payment-dialog.component';
import type {
  PaymentDialogData,
  PaymentDialogResult,
} from '../../payment-dialog/models/payment-dialog.models';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../confirm-dialog.component';

const CHANNEL_LABELS: Record<ChannelType, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  vk: 'ВКонтакте',
  max: 'MAX',
  web: 'Веб-чат',
  email: 'Email',
  sms: 'SMS',
  instagram: 'Instagram',
};
const CHANNEL_ICONS: Record<ChannelType, string> = {
  telegram: 'send',
  whatsapp: 'chat',
  vk: 'groups',
  max: 'forum',
  web: 'language',
  email: 'email',
  sms: 'sms',
  instagram: 'photo_camera',
};
const RESEND_CHANNELS: ChannelType[] = [
  'telegram', 'whatsapp', 'max', 'vk', 'web', 'email', 'sms', 'instagram',
];

@Component({
  selector: 'app-payments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, RouterLink, DatePipe,
    MatButtonModule, MatIconModule, MatMenuModule,
    MatTooltipModule, MatProgressSpinnerModule, MatDialogModule,
  ],
  template: `
    @if (loading()) {
      <div class="tab-empty"><mat-spinner diameter="20" /></div>
    } @else if (paymentLinks().length) {
      <div class="payments-list">
        @for (link of paymentLinks(); track link.id) {
          <div class="payment-card" [class.is-paid]="link.status === 'paid'">
            <div class="pl-header">
              <strong class="pl-amount">{{ link.amount }}&nbsp;&#8381;</strong>
              <span class="pl-chip pl-chip--{{ link.status }}">{{ statusLabel_pl(link.status) }}</span>
              <time class="pl-time">{{ link.created_at | date:'dd.MM.yy HH:mm' }}</time>
            </div>
            <div class="pl-desc">{{ link.description || 'Без описания' }}</div>
            <div class="pl-actions">
              @if (link.status === 'paid' && !link.order_ref_linked) {
                <button mat-flat-button color="primary" class="pl-btn"
                        (click)="openCreateOrderDialog(link)">
                  <mat-icon>add_shopping_cart</mat-icon>
                  Создать заказ
                </button>
                <button mat-button class="pl-btn"
                        (click)="copyPaymentLink(link)">
                  <mat-icon>content_copy</mat-icon>
                  Скопировать
                </button>
              } @else if (link.status === 'paid' && link.order_ref_linked) {
                <a mat-stroked-button class="pl-btn"
                   [routerLink]="['/employee/orders', link.order_ref_linked]">
                  <mat-icon>receipt_long</mat-icon>
                  Заказ {{ link.order_ref_linked }}
                </a>
              } @else if (link.status === 'pending') {
                <button mat-icon-button class="pl-btn"
                        (click)="showQR(link)"
                        matTooltip="Показать QR-код" aria-label="QR-код">
                  <mat-icon>qr_code_2</mat-icon>
                </button>
                <button mat-button class="pl-btn"
                        (click)="copyPaymentLink(link)">
                  <mat-icon>content_copy</mat-icon>
                  Скопировать
                </button>
                <button mat-button class="pl-btn"
                        (click)="openEditPaymentDialog(link)">
                  <mat-icon>edit</mat-icon>
                  Редактировать
                </button>
                <button mat-button class="pl-btn pl-btn-danger"
                        (click)="cancelPaymentLink(link)">
                  <mat-icon>block</mat-icon>
                  Отменить
                </button>
                @if ((link.availableChannels?.length ?? 0) > 1) {
                  <button mat-button class="pl-btn"
                          [matMenuTriggerFor]="resendMenu"
                          [matMenuTriggerData]="{ link }">
                    <mat-icon>send</mat-icon>
                    Отправить
                    <mat-icon>arrow_drop_down</mat-icon>
                  </button>
                } @else {
                  <button mat-button class="pl-btn"
                          (click)="resendLink(link)">
                    <mat-icon>send</mat-icon>
                    Отправить повторно
                  </button>
                }
              }
            </div>
          </div>
        }
      </div>
    } @else {
      <div class="tab-empty">Платежей нет</div>
    }

    <mat-menu #resendMenu="matMenu">
      <ng-template matMenuContent let-link="link">
        @for (ch of RESEND_CHANNELS; track ch) {
          <button mat-menu-item
                  [disabled]="!isChannelAvailable(link, ch)"
                  [matTooltip]="channelTooltip(link, ch)"
                  (click)="resendLinkWithChannel(link, ch)">
            <mat-icon>{{ channelIconPl(ch) }}</mat-icon>
            {{ channelLabelPl(ch) }}
          </button>
        }
      </ng-template>
    </mat-menu>
  `,
  styles: [`
    @use '../../../../../../styles/status-chips' as chip;

    :host { display: block; }

    .tab-empty {
      padding: var(--crm-space-4);
      text-align: center;
      color: var(--crm-text-muted);
      font-size: var(--crm-text-sm);
    }

    .payments-list {
      display: flex;
      flex-direction: column;
      gap: var(--crm-space-2);
    }

    .payment-card {
      padding: var(--crm-space-2) var(--crm-space-3);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: var(--crm-bg-elevated);
      display: flex;
      flex-direction: column;
      gap: var(--crm-space-1);
    }
    .payment-card.is-paid { border-color: var(--crm-status-success); }

    .pl-header {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      flex-wrap: wrap;
    }
    .pl-amount { font-size: var(--crm-text-md); font-weight: 700; color: var(--crm-text); }
    .pl-time { color: var(--crm-text-muted); font-size: var(--crm-text-xs); margin-left: auto; white-space: nowrap; }
    .pl-desc { color: var(--crm-text-muted); font-size: var(--crm-text-sm); }
    .pl-actions {
      display: flex;
      gap: var(--crm-space-1);
      flex-wrap: wrap;
      margin-top: var(--crm-space-1);
    }
    .pl-btn { min-width: auto; }
    .pl-btn-danger { color: var(--crm-status-error); }
    .pl-btn mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }

    .pl-chip {
      @include chip.status-chip-base;
      border-radius: 999px;
      text-transform: uppercase;
    }
    .pl-chip--pending { @include chip.status-chip('warning'); }
    .pl-chip--paid { @include chip.status-chip('success'); }
    .pl-chip--expired { @include chip.status-chip('grey'); }
    .pl-chip--cancelled { @include chip.status-chip('error'); }
  `],
})
export class PaymentsTabComponent {
  readonly contactId = input<string | null>(null);
  readonly conversationId = input<string | null>(null);

  private readonly paymentsService = inject(PaymentsService);
  private readonly ws = inject(WebSocketService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);

  readonly paymentLinks = signal<PaymentLink[]>([]);
  readonly loading = signal(false);

  readonly RESEND_CHANNELS = RESEND_CHANNELS;

  private readonly loadEffect = effect(() => {
    const cid = this.contactId();
    const convId = this.conversationId();
    untracked(() => {
      this.paymentLinks.set([]);
      if (cid || convId) this.loadPaymentLinks();
    });
  });

  private readonly wsEffect = effect(() => {
    const evt = this.ws.paymentLinkEvent();
    if (!evt) return;
    untracked(() => {
      const cid = this.contactId();
      const convId = this.conversationId();
      const evtContactId = evt.data.contactId;
      const evtConvId = evt.data.conversationId;
      const matches =
        (cid && evtContactId === cid) ||
        (convId && evtConvId === convId);
      if (!matches) return;
      this.loadPaymentLinks();
    });
  });

  loadPaymentLinks(): void {
    const cid = this.contactId();
    const convId = this.conversationId();
    if (!cid && !convId) return;
    if (this.loading()) return;
    this.loading.set(true);
    const source$ = cid
      ? this.paymentsService.getLinksForContact(cid)
      : this.paymentsService.getLinksForConversation(convId!);
    source$.subscribe({
      next: links => {
        this.paymentLinks.set(links);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  statusLabel_pl(s: PaymentLinkStatus): string {
    const map: Record<PaymentLinkStatus, string> = {
      pending: 'Ожидание',
      paid: 'Оплачено',
      expired: 'Истекло',
      cancelled: 'Отменено',
    };
    return map[s];
  }

  copyPaymentLink(link: PaymentLink): void {
    const url = `https://svoefoto.ru/pay/${link.order_ref}`;
    navigator.clipboard.writeText(url).then(
      () => this.toast.success('Ссылка скопирована'),
      () => this.toast.error('Не удалось скопировать'),
    );
  }

  resendLink(link: PaymentLink): void {
    this.paymentsService.resendLink(link.order_ref).subscribe({
      next: () => {
        this.toast.success('Ссылка отправлена повторно');
        this.loadPaymentLinks();
      },
      error: () => this.toast.error('Не удалось отправить повторно'),
    });
  }

  resendLinkWithChannel(link: PaymentLink, channel: ChannelType): void {
    this.paymentsService.resendLink(link.order_ref, channel).subscribe({
      next: () => {
        this.toast.success(`Ссылка отправлена: ${CHANNEL_LABELS[channel] ?? channel}`);
        this.loadPaymentLinks();
      },
      error: () => this.toast.error('Не удалось отправить повторно'),
    });
  }

  showQR(link: PaymentLink): void {
    const origin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://svoefoto.ru';
    this.dialog.open(PaymentLinkQrDialogComponent, {
      width: '360px',
      maxWidth: '95vw',
      data: {
        paymentLink: link,
        payUrl: `${origin}/pay/${link.order_ref}`,
      },
    });
  }

  openEditPaymentDialog(link: PaymentLink): void {
    const ref = this.dialog.open<PaymentDialogComponent, PaymentDialogData, PaymentDialogResult>(
      PaymentDialogComponent,
      {
        width: 'calc(100vw - 24px)',
        maxWidth: '100vw',
        height: 'calc(100vh - 24px)',
        maxHeight: '100vh',
        panelClass: 'payment-dialog-panel',
        data: {
          mode: 'chat',
          phone: link.contact_phone ?? '',
          clientName: link.contact_name ?? '',
          sessionId: link.conversation_id ?? undefined,
          editPaymentLink: {
            id: link.id,
            orderRef: link.order_ref,
            amount: Number(link.amount) || 0,
            description: link.description,
            services: link.services,
          },
        },
      },
    );

    ref.afterClosed().subscribe((result) => {
      if (!result || result.type === 'cancelled') return;
      if (result.type === 'updated') {
        this.toast.success('Оплата обновлена');
      }
      this.loadPaymentLinks();
    });
  }

  cancelPaymentLink(link: PaymentLink): void {
    const amount = Number(link.amount) || 0;
    const confirmData: ConfirmDialogData = {
      title: 'Отменить оплату?',
      message: `Счёт ${link.order_ref} на ${amount.toLocaleString('ru-RU')} ₽ станет недоступен для оплаты.`,
      confirmLabel: 'Отменить оплату',
      cancelLabel: 'Не отменять',
      icon: 'block',
      warn: true,
    };

    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        width: '420px',
        maxWidth: '95vw',
        data: confirmData,
      },
    );

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) return;
      this.paymentsService.cancelLink(link.id).subscribe({
        next: () => {
          this.toast.success('Оплата отменена');
          this.loadPaymentLinks();
        },
        error: () => this.toast.error('Не удалось отменить оплату'),
      });
    });
  }

  openCreateOrderDialog(link: PaymentLink): void {
    const ref = this.dialog.open<UnifiedOrderComponent>(UnifiedOrderComponent, {
      width: '920px',
      maxWidth: '95vw',
      panelClass: 'unified-order-dialog',
    });
    ref.componentRef?.setInput('mode', 'dialog');
    ref.componentRef?.setInput('dialogClientName', link.contact_name ?? '');
    ref.componentRef?.setInput('dialogPhone', link.contact_phone ?? '');
    ref.componentRef?.setInput('presetPaymentLinkId', link.id);
    ref.componentRef?.setInput('presetCartItems', link.services);
    ref.componentRef?.setInput('lockAmount', +link.amount);
    ref.afterClosed().subscribe(() => this.loadPaymentLinks());
  }

  channelLabelPl(ch: ChannelType): string {
    return CHANNEL_LABELS[ch] ?? ch;
  }

  channelIconPl(ch: ChannelType): string {
    return CHANNEL_ICONS[ch] ?? 'send';
  }

  isChannelAvailable(link: PaymentLink, ch: ChannelType): boolean {
    return link.availableChannels?.includes(ch) ?? false;
  }

  channelTooltip(link: PaymentLink, ch: ChannelType): string {
    return this.isChannelAvailable(link, ch) ? '' : 'Канал недоступен для клиента';
  }
}
