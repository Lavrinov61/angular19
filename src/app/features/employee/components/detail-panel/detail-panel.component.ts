import { Component, input, output, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { InboxItem } from '../../models/inbox.model';
import { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';
import { ChatDetailComponent } from './chat-detail.component';
import { TaskDetailPanelComponent } from './task-detail-panel.component';
import { BookingDetailPanelComponent } from './booking-detail-panel.component';
import { OrderDetailPanelComponent } from './order-detail-panel.component';
import { ApprovalUploadPanelComponent } from './approval-upload-panel.component';
import { DashboardViewComponent } from '../dashboard-view/dashboard-view.component';

@Component({
  selector: 'app-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    ChatDetailComponent,
    TaskDetailPanelComponent,
    BookingDetailPanelComponent,
    OrderDetailPanelComponent,
    ApprovalUploadPanelComponent,
    DashboardViewComponent,
  ],
  template: `
    @if (!item()) {
      <app-dashboard-view
        (selectItem)="selectItem.emit($event)"
        (createOrder)="createOrder.emit()"
        (createTask)="createTask.emit()"
        (openDialer)="openDialer.emit()"
        (openPos)="openPos.emit()"
        (openStudentVerification)="openStudentVerification.emit()" />
    } @else {
      @if (!photoWorkspaceFocus()) {
        <div class="detail-header-bar">
          <button class="back-btn" (click)="back.emit()">
            <mat-icon>arrow_back</mat-icon>
            <span>Пульт</span>
          </button>
          <span class="detail-title">{{ detailTitle() }}</span>
        </div>
      }
      @switch (item()!.type) {
        @case ('chat') {
          <app-chat-detail
            [sessionId]="item()!.id"
            (clientPhoneResolved)="clientPhoneResolved.emit($event)"
            (clientUserIdResolved)="clientUserIdResolved.emit($event)"
            (clientContactIdResolved)="clientContactIdResolved.emit($event)"
            (cartItemsToAdd)="cartItemsToAdd.emit($event)"
            (navigateToItem)="selectItem.emit($event)"
            (createOrderFromChat)="createOrderFromChat.emit()" />
        }
        @case ('task') {
          <app-task-detail-panel
            [taskId]="item()!.id"
            (clientPhoneResolved)="clientPhoneResolved.emit($event)" />
        }
        @case ('booking') {
          <app-booking-detail-panel
            [bookingId]="item()!.id"
            (clientPhoneResolved)="clientPhoneResolved.emit($event)" />
        }
        @case ('order') {
          <app-order-detail-panel
            [orderId]="item()!.id"
            (clientPhoneResolved)="clientPhoneResolved.emit($event)"
            (clientUserIdResolved)="clientUserIdResolved.emit($event)"
            (chatSessionResolved)="orderChatSession.emit($event)"
            (photoWorkspaceFocusChange)="onPhotoWorkspaceFocusChange($event)" />
        }
        @case ('approval') {
          <app-approval-upload-panel
            [sessionId]="item()!.id"
            (navigateToItem)="selectItem.emit($event)" />
        }
      }
    }
  `,
  styles: [`
    @keyframes crmPanelIn { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes crmShimmer { from { background-position: -200px 0; } to { background-position: 200px 0; } }

    :host { display: block; height: 100%; display: flex; flex-direction: column; }

    app-dashboard-view,
    app-chat-detail,
    app-task-detail-panel,
    app-booking-detail-panel,
    app-order-detail-panel,
    app-approval-upload-panel {
      flex: 1;
      min-height: 0;
    }

    .detail-header-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px 6px 6px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
    }

    .back-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px 4px 6px;
      border: none;
      background: none;
      border-radius: var(--crm-radius-md);
      color: var(--crm-accent);
      font-size: 13px;
      font-weight: 500;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: background var(--crm-transition-fast);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { background: var(--crm-accent-muted); }
    }

    .detail-title {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: var(--crm-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `],
})
export class DetailPanelComponent {
  item = input<InboxItem | null>(null);
  clientPhoneResolved = output<string | null>();
  clientUserIdResolved = output<string>();
  clientContactIdResolved = output<string>();
  back = output<void>();
  selectItem = output<{ type: string; id: string }>();
  createTask = output<void>();
  createOrder = output<void>();
  openDialer = output<void>();
  openPos = output<void>();
  openStudentVerification = output<void>();
  orderChatSession = output<string | null>();
  cartItemsToAdd = output<SyncCartItem[]>();
  createOrderFromChat = output<void>();
  photoWorkspaceFocusChange = output<boolean>();
  photoWorkspaceFocus = signal(false);

  detailTitle = computed(() => {
    const it = this.item();
    if (!it) return '';
    if (it.clientName) return it.clientName;
    const labels: Record<string, string> = {
      chat: 'Чат', task: 'Задача', booking: 'Запись', order: 'Заказ', approval: 'Ретушь',
    };
    return labels[it.type] || '';
  });

  onPhotoWorkspaceFocusChange(focused: boolean): void {
    this.photoWorkspaceFocus.set(focused);
    this.photoWorkspaceFocusChange.emit(focused);
  }
}
