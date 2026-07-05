import { Component, inject, input, effect, signal, computed, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { PosApiService, type StudentDiscountInfo } from '../../services/pos-api.service';
import { TelephonyService } from '../../services/telephony.service';
import { TelephonyApiService, CallLog } from '../../services/telephony-api.service';
import { CrmClientsApiService, ClientNote } from '../../services/crm-clients-api.service';
import { CrmCustomerTagsApiService, CustomerTag, ContactTagAssignment } from '../../services/crm-customer-tags-api.service';
import { ClientTimelineComponent } from './client-timeline.component';
import { ReplayApiService, ReplaySession } from '../../services/replay-api.service';
import { OperatorCartPanelComponent, type OperatorCartCheckoutRequest } from '../operator-cart-panel/operator-cart-panel.component';
import { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';
import {
  channelIcon, channelLabel, paymentStatusIcon,
  statusLabel, formatRelativeTime, formatDateTime,
} from '../../utils/crm-helpers';
import { getLevelProgress } from '../../../../shared/utils/loyalty.utils';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import { PhoneMaskPipe } from '../../pipes/phone-mask.pipe';
import { maskPhone } from '../../utils/phone-mask';
import { PaymentsTabComponent } from '../shared/payments-tab/payments-tab.component';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import type {
  PaymentCartDetails,
  PaymentDialogPrefillService,
  PaymentDialogResult,
} from '../payment-dialog/models/payment-dialog.models';

interface RegisteredUser {
  is_registered: boolean;
  email: string | null;
  email_verified: boolean;
  registered_at: string | null;
  auth_providers: string[];
}

interface ClientProfile {
  name: string;
  phone: string | null;
  channels: string[];
  total_purchases: number;
  total_revenue: number;
  first_visit: string;
  unified_customer_id?: string;
  contact_id?: string | null;
  registered_user?: RegisteredUser | null;
}

interface ClientOrder {
  id: string;
  type: string;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
}

interface ClientBooking {
  id: string;
  start_time: string;
  status: string;
  service_id?: string | null;
  service_name?: string | null;
  studio_name?: string | null;
}

interface ClientTask {
  id: string;
  task_number: number;
  title: string;
  status: string;
  priority: string;
  due_date?: string;
}

interface ChannelUserInfo {
  channel: string;
  display_name: string | null;
  username: string | null;
  phone: string | null;
}

interface ApprovalSessionSummary {
  id: string;
  title: string | null;
  status: string | null;
  total_photos: number;
  approved_count: number;
  rejected_count: number;
  created_at: string | null;
}

interface ClientContext {
  profile: ClientProfile;
  orders: ClientOrder[];
  bookings: ClientBooking[];
  other_tasks: ClientTask[];
  channel_users?: ChannelUserInfo[];
  approval_sessions?: ApprovalSessionSummary[];
}

interface ChatSessionHistory {
  id: string;
  channel: string;
  status: string;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  message_count: string;
  assigned_operator_name: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  visitor_name: string | null;
}

interface PendingCartItemsEvent {
  readonly id: number;
  readonly items: SyncCartItem[];
}

interface LoyaltyInfo {
  id: string;
  points: number;
  totalPointsEarned: number;
  level: number;
  levelName: string;
  pointsAsRubles: number;
  conversionRate: number;
  total_spent: number;
  can_spend_points: number;
  referral_code: string | null;
  invited_count: number;
  referred_by_name: string | null;
}

interface SubscriptionInfo {
  id: string;
  plan_name: string;
  status: string;
  credits: { product_name: string; remaining: number }[];
}

interface AccountBadge {
  kind: 'guest' | 'standard' | 'student';
  active: boolean;
  icon: string;
  label: string;
  tooltip: string;
}

interface SubscriptionBadge {
  active: boolean;
  icon: string;
  label: string;
  tooltip: string;
}

interface Interaction {
  _type: 'call' | 'chat';
  _time: string;
  id: string;
  direction: string | null;
  operator_name: string | null;
  duration_seconds: number | null;
  channel: string | null;
  status: string | null;
  message_count: string | null;
  assigned_operator_name: string | null;
}

interface ServiceSurveyStatusView {
  tone: 'pending' | 'info' | 'success' | 'warning' | 'error' | 'muted';
  icon: string;
  label: string;
  detail: string;
}

@Component({
  selector: 'app-client-profile-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule, MatIconModule,
    MatChipsModule, MatDividerModule, MatProgressSpinnerModule,
    MatProgressBarModule, MatTooltipModule, MatMenuModule,
    RouterLink,
    OperatorCartPanelComponent,
    ClientTimelineComponent,
    PaymentsTabComponent,
    PhoneMaskPipe,
  ],
  template: `
    @if (!clientPhone() && !clientUserId() && !clientContactId()) {
      <div class="empty">
        <mat-icon>person_search</mat-icon>
        <p>Клиент определится автоматически при выборе элемента</p>
      </div>
    } @else if (loading()) {
      <div class="loading"><mat-spinner diameter="28" /></div>
    } @else if (ctx()) {
      <div class="profile">

        <!-- ═══ HEADER ═══ -->
        <div class="profile-header">
          <div class="avatar">{{ clientInitials() }}</div>
          <div class="header-info">
            <h3>{{ displayName() }}</h3>
            @if (resolvedClientPhone(); as phone) {
              <div class="phone-row">
                <a class="phone-link" [href]="'tel:' + phone">{{ phone | phoneMask }}</a>
                <button mat-icon-button class="copy-btn"
                        (click)="copyPhone()"
                        [matTooltip]="phoneCopied() ? 'Скопировано!' : 'Копировать телефон'">
                  <mat-icon>{{ phoneCopied() ? 'check' : 'content_copy' }}</mat-icon>
                </button>
              </div>
            }
            @if (clientEmail()) {
              <div class="client-email">{{ clientEmail() }}</div>
            }
          </div>
        </div>

        <!-- ═══ КАНАЛЫ СВЯЗИ ═══ -->
        @if (channelUsers().length) {
          <div class="channel-users-row">
            @for (cu of channelUsers(); track cu.channel) {
              <span class="channel-badge" [matTooltip]="cu.display_name || cu.username || cu.channel">
                <mat-icon>{{ channelIcon(cu.channel) }}</mat-icon>
                @if (cu.username) {
                  <span class="channel-username">{{ '@' + cu.username }}</span>
                } @else if (cu.display_name) {
                  <span class="channel-username">{{ cu.display_name }}</span>
                } @else {
                  <span class="channel-username">{{ channelLabel(cu.channel) }}</span>
                }
                @if (cu.phone && cu.phone !== resolvedClientPhone()) {
                  <span class="channel-phone">{{ cu.phone }}</span>
                }
              </span>
            }
          </div>
        }

        <!-- ═══ АККАУНТ И ПОДПИСКА ═══ -->
        <div class="status-row">
          @if (accountBadge(); as account) {
            <span class="badge account-badge"
                  [class.badge-student]="account.kind === 'student'"
                  [class.badge-standard]="account.kind === 'standard'"
                  [class.badge-guest]="account.kind === 'guest'"
                  [class.badge-inactive]="!account.active"
                  [matTooltip]="account.tooltip">
              <mat-icon>{{ account.icon }}</mat-icon>
              <span class="badge-label">{{ account.label }}</span>
            </span>
          }
          @if (subscriptionBadge(); as sub) {
            <span class="badge subscription-badge"
                  [class.subscription-active]="sub.active"
                  [class.subscription-empty]="!sub.active"
                  [matTooltip]="sub.tooltip">
              <mat-icon>{{ sub.icon }}</mat-icon>
              <span class="badge-label">{{ sub.label }}</span>
            </span>
          }
          <div class="quick-links">
            @if (clientEmail()) {
              <a mat-icon-button href="mailto:{{ clientEmail() }}" matTooltip="Написать email">
                <mat-icon>email</mat-icon>
              </a>
            }
          </div>
        </div>

        <!-- ═══ KPI ═══ -->
        <div class="kpi-row">
          <div class="kpi-card">
            <span class="kpi-val">{{ ctx()!.profile.total_purchases }}</span>
            <span class="kpi-label">{{ pluralize(ctx()!.profile.total_purchases, 'покупка', 'покупки', 'покупок') }}</span>
          </div>
          <div class="kpi-card kpi-card--accent">
            <span class="kpi-val">{{ formatCurrency(ctx()!.profile.total_revenue) }}</span>
            <span class="kpi-label">выручка</span>
          </div>
          @if (ctx()!.profile.first_visit) {
            <div class="kpi-card">
              <span class="kpi-val">{{ formatShortDate(ctx()!.profile.first_visit) }}</span>
              <span class="kpi-label">с нами с</span>
            </div>
          }
        </div>

        <!-- ═══ ТЕГИ КЛИЕНТА (скрыто — 0 назначений в БД) ═══ -->

        <!-- Фото-согласования убраны из CRM панели (privacy: сотрудник видит только метаданные заказов) -->

        <!-- ═══ ЛОЯЛЬНОСТЬ + ПОДПИСКА ═══ -->
        @if (loyaltyDisplay() || subscription()) {
          <div class="loyalty-card">
            @if (loyaltyDisplay(); as ld) {
              <div class="loyalty-top">
                <span class="loyalty-level"><mat-icon>stars</mat-icon> {{ ld.levelName }}</span>
                <span class="loyalty-points">{{ ld.points }} бонусов</span>
              </div>
              <mat-progress-bar mode="determinate" [value]="ld.progressPercent" class="loyalty-bar" />
              <div class="loyalty-meta">
                <span>= {{ formatCurrency(ld.pointsAsRubles) }}</span>
                @if (ld.canSpend > 0) {
                  <span class="loyalty-sep">·</span>
                  <span>Списать: до {{ ld.canSpend }} бонусов</span>
                }
                @if (ld.nextLevelSpent > ld.currentSpent) {
                  <span class="loyalty-sep">·</span>
                  <span class="loyalty-next">след. уровень: {{ formatCurrency(ld.nextLevelSpent - ld.currentSpent) }}</span>
                }
              </div>
              @if (ld.referralCode) {
                <div class="referral-info">
                  <div class="referral-row">
                    <mat-icon>person_add</mat-icon>
                    <span>Код: <strong>{{ ld.referralCode }}</strong></span>
                    @if (ld.invitedCount > 0) {
                      <span class="loyalty-sep">·</span>
                      <span>Привёл: <strong>{{ ld.invitedCount }}</strong></span>
                    }
                  </div>
                  @if (ld.referredByName) {
                    <div class="referral-row referral-by">
                      <mat-icon>how_to_reg</mat-icon>
                      <span>Привёл: {{ ld.referredByName }}</span>
                    </div>
                  }
                </div>
              }
            }
            @if (subscription()) {
              @if (loyaltyDisplay()) {
                <mat-divider class="loyalty-divider" />
              }
              <div class="sub-row">
                <mat-icon class="sub-icon">card_membership</mat-icon>
                <span class="sub-name">{{ subscription()!.plan_name }}</span>
                <span class="sub-status" [class]="'sub-' + subscription()!.status">
                  {{ subscriptionStatusLabel(subscription()!.status) }}
                </span>
              </div>
              @for (c of subscription()!.credits; track c.product_name) {
                @if (c.remaining > 0) {
                  <div class="credit-row">
                    <span class="credit-name">{{ c.product_name }}</span>
                    <span class="credit-nums">{{ c.remaining }} шт</span>
                  </div>
                }
              }
            }
          </div>
        }

        <!-- ═══ БЫСТРЫЕ ДЕЙСТВИЯ ═══ -->
        <div class="actions-row">
          @if (hasPhone()) {
            <button mat-stroked-button (click)="callClient()"
                    [disabled]="telephony.isInCall()" matTooltip="Позвонить">
              <mat-icon>phone</mat-icon> Звонок
            </button>
          }
          <a mat-stroked-button routerLink="/employee/bookings"
             [queryParams]="{ phone: resolvedClientPhone(), name: displayName() }"
             matTooltip="Записать на приём">
            <mat-icon>event</mat-icon> Запись
          </a>
          <button mat-stroked-button [matMenuTriggerFor]="moreMenu" matTooltip="Ещё действия">
            <mat-icon>more_horiz</mat-icon>
          </button>
        </div>

        @if (hasPhone()) {
          <div class="service-survey">
            <button mat-stroked-button class="survey-btn"
                    (click)="confirmServiceSurveyCall()"
                    [disabled]="serviceSurveyInProgress()"
                    matTooltip="Бот позвонит клиенту и спросит пожелания">
              @if (serviceSurveyRequesting()) {
                <mat-spinner diameter="16" />
              } @else {
                <mat-icon>record_voice_over</mat-icon>
              }
              <span>Запрос пожеланий</span>
            </button>

            @if (serviceSurveyStatus(); as survey) {
              <div class="survey-status"
                   [class.survey-status--pending]="survey.tone === 'pending'"
                   [class.survey-status--info]="survey.tone === 'info'"
                   [class.survey-status--success]="survey.tone === 'success'"
                   [class.survey-status--warning]="survey.tone === 'warning'"
                   [class.survey-status--error]="survey.tone === 'error'"
                   [class.survey-status--muted]="survey.tone === 'muted'">
                <mat-icon>{{ survey.icon }}</mat-icon>
                <div class="survey-status-text">
                  <span class="survey-status-label">{{ survey.label }}</span>
                  <span class="survey-status-detail">{{ survey.detail }}</span>
                </div>
              </div>
            }
          </div>
        }

        <mat-menu #moreMenu="matMenu">
          @if (hasPhone()) {
            <button mat-menu-item (click)="copyPhone()">
              <mat-icon>content_copy</mat-icon> Скопировать телефон
            </button>
          }
          <a mat-menu-item routerLink="/employee/tasks/new"
             [queryParams]="{ phone: resolvedClientPhone(), name: displayName() }">
            <mat-icon>add_task</mat-icon> Создать задачу
          </a>
          @if (hasPhone()) {
            <button mat-menu-item (click)="requestReview()" [disabled]="reviewRequested()">
              <mat-icon>{{ reviewRequested() ? 'check' : 'star' }}</mat-icon>
              {{ reviewRequested() ? 'Запрос отправлен' : 'Запросить отзыв' }}
            </button>
            <button mat-menu-item (click)="openPaymentDialog()">
              <mat-icon>payment</mat-icon> Ссылка на оплату
            </button>
          }
          <a mat-menu-item [href]="tipsLink()" target="_blank">
            <mat-icon>volunteer_activism</mat-icon> Чаевые
          </a>
          @if (hasPhone()) {
            <a mat-menu-item routerLink="/employee/pos"
               [queryParams]="{ phone: resolvedClientPhone(), name: displayName() }">
              <mat-icon>point_of_sale</mat-icon> Офлайн касса
            </a>
          }
          <mat-divider />
          <button mat-menu-item (click)="openMergeDialog()">
            <mat-icon>merge</mat-icon> Объединить клиента
          </button>
        </mat-menu>

        <mat-divider />

        <!-- ═══ ИСТОРИЯ (табы) ═══ -->
        <div class="history-tabs-scroll">
          <div class="history-tabs">
            <button class="hist-tab" [class.active]="activeHistoryTab() === 'orders'"
                    (click)="activeHistoryTab.set('orders')">
              Заказы
              @if (ctx()!.orders.length) {
                <span class="tab-count">{{ ctx()!.orders.length }}</span>
              }
            </button>
            <button class="hist-tab" [class.active]="activeHistoryTab() === 'bookings'"
                    (click)="activeHistoryTab.set('bookings')">
              Записи
              @if (ctx()!.bookings.length) {
                <span class="tab-count">{{ ctx()!.bookings.length }}</span>
              }
            </button>
            <button class="hist-tab" [class.active]="activeHistoryTab() === 'tasks'"
                    (click)="activeHistoryTab.set('tasks')">
              Задачи
              @if (ctx()!.other_tasks.length) {
                <span class="tab-count">{{ ctx()!.other_tasks.length }}</span>
              }
            </button>
            <button class="hist-tab" [class.active]="activeHistoryTab() === 'interactions'"
                    (click)="activeHistoryTab.set('interactions')">
              Чаты
              @if (interactions().length) {
                <span class="tab-count">{{ interactions().length }}</span>
              }
            </button>
            <button class="hist-tab" [class.active]="activeHistoryTab() === 'payments'"
                    (click)="activeHistoryTab.set('payments')">
              Платежи
            </button>
            @if (replaySessions().length || visitsLoaded) {
              <button class="hist-tab" [class.active]="activeHistoryTab() === 'visits'"
                      (click)="onVisitsTabClick()">
                Визиты
                @if (replaySessions().length) {
                  <span class="tab-count">{{ replaySessions().length }}</span>
                }
              </button>
            }
            @if (hasTimelineData()) {
              <button class="hist-tab" [class.active]="activeHistoryTab() === 'timeline'"
                      (click)="activeHistoryTab.set('timeline')">
                Хроно
              </button>
            }
          </div>
        </div>

        <div class="history-content">
          @if (activeHistoryTab() === 'orders') {
            @if (ctx()!.orders.length) {
              @for (o of ctx()!.orders.slice(0, 5); track o.id) {
                <div class="order-row">
                  <div class="order-info">
                    <span class="order-type">{{ o.type === 'print' ? 'Печать' : 'Заказ' }}</span>
                    <span class="order-amount">{{ formatCurrency(o.total_amount) }}</span>
                  </div>
                  <div class="order-meta">
                    @if (o.payment_status === 'pending' || o.payment_status === 'pending_payment' || o.payment_status === 'none' && o.status === 'pending_payment') {
                      <button class="order-action-btn order-action-paid" (click)="markOrderPaid(o.id)" matTooltip="Отметить оплаченным">
                        <mat-icon>check</mat-icon>
                      </button>
                      <button class="order-action-btn order-action-cancel" (click)="cancelOrderPayment(o.id)" matTooltip="Отменить платёж">
                        <mat-icon>close</mat-icon>
                      </button>
                    } @else {
                      <mat-icon class="pay-icon" [class]="'pay-' + o.payment_status">
                        {{ paymentStatusIcon(o.payment_status) }}
                      </mat-icon>
                    }
                    <span>{{ formatRelativeTime(o.created_at) }}</span>
                  </div>
                </div>
              }
            } @else {
              <div class="tab-empty">Нет заказов</div>
            }
          }

          @if (activeHistoryTab() === 'bookings') {
            @if (ctx()!.bookings.length) {
              @for (b of ctx()!.bookings.slice(0, 5); track b.id) {
                <div class="booking-row">
                  <div class="booking-summary">
                    <span class="booking-service">{{ b.service_name || 'Запись' }}</span>
                    <span class="booking-time">{{ formatDateTime(b.start_time) }}</span>
                    @if (b.studio_name) {
                      <span class="booking-studio">{{ b.studio_name }}</span>
                    }
                  </div>
                  <mat-chip class="mini-chip">{{ bookingStatus(b.status) }}</mat-chip>
                </div>
              }
            } @else {
              <div class="tab-empty">Нет записей</div>
            }
          }

          @if (activeHistoryTab() === 'tasks') {
            @if (ctx()!.other_tasks.length) {
              @for (t of ctx()!.other_tasks.slice(0, 5); track t.id) {
                <a class="task-row" [routerLink]="['/employee/tasks', t.id]">
                  <span class="task-num">#{{ t.task_number }}</span>
                  <span class="task-title">{{ t.title }}</span>
                  <mat-chip class="mini-chip">{{ statusLabel(t.status) }}</mat-chip>
                </a>
              }
            } @else {
              <div class="tab-empty">Нет задач</div>
            }
          }

          @if (activeHistoryTab() === 'interactions') {
            @if (interactions().length) {
              @for (item of interactions().slice(0, 10); track item.id) {
                @if (item._type === 'call') {
                  <div class="call-row">
                    <mat-icon class="call-dir">
                      {{ item.direction === 'inbound' ? 'phone_callback' : 'phone_forwarded' }}
                    </mat-icon>
                    <span class="call-info-text">
                      {{ item.operator_name || 'Оператор' }}
                      @if (item.duration_seconds) {
                        · {{ formatCallDuration(item.duration_seconds) }}
                      }
                    </span>
                    <span class="call-time">{{ formatRelativeTime(item._time) }}</span>
                  </div>
                } @else {
                  <div class="chat-session-row">
                    <mat-icon class="cs-icon">{{ channelIcon(item.channel || '') }}</mat-icon>
                    <div class="cs-info">
                      <span class="cs-channel">{{ channelLabel(item.channel || '') }}</span>
                      <span class="cs-meta">
                        {{ item.message_count }} сообщ.
                        @if (item.assigned_operator_name) {
                          · {{ item.assigned_operator_name }}
                        }
                      </span>
                    </div>
                    <div class="cs-right">
                      <span class="cs-status" [class]="'cs-' + item.status">
                        {{ chatStatusLabel(item.status || '') }}
                      </span>
                      <span class="cs-time">{{ formatRelativeTime(item._time) }}</span>
                    </div>
                  </div>
                }
              }
            } @else {
              <div class="tab-empty">Нет обращений</div>
            }
          }

          @if (activeHistoryTab() === 'payments') {
            <app-payments-tab [contactId]="ctx()?.profile?.contact_id ?? null" />
          }

          @if (activeHistoryTab() === 'visits') {
            @if (visitsLoading()) {
              <div class="tab-empty"><mat-spinner diameter="20" /></div>
            } @else if (replaySessions().length) {
              <!-- Heatmap кнопка -->
              <div class="visits-actions">
                <button mat-stroked-button class="heatmap-btn" (click)="openHeatmapDialog()">
                  <mat-icon>local_fire_department</mat-icon> Heatmap клиента
                </button>
              </div>
              @for (s of replaySessions().slice(0, 8); track s.id) {
                <div class="visit-row" (click)="openReplayDialog(s)" (keydown.enter)="openReplayDialog(s)" tabindex="0" [class.has-error]="s.has_error">
                  <div class="visit-info">
                    <span class="visit-device">
                      <mat-icon>{{ s.device_type === 'mobile' ? 'smartphone' : 'computer' }}</mat-icon>
                    </span>
                    <div class="visit-details">
                      <span class="visit-landing">{{ s.landing_page || '/' }}</span>
                      <span class="visit-meta">
                        {{ s.total_pages }} стр · {{ s.total_clicks }} кликов
                        @if (s.duration_seconds) { · {{ formatVisitDuration(s.duration_seconds) }} }
                      </span>
                    </div>
                  </div>
                  <div class="visit-right">
                    @if (s.has_error) {
                      <mat-icon class="err-icon" matTooltip="Ошибки JS">bug_report</mat-icon>
                    }
                    <span class="visit-time">{{ formatRelativeTime(s.started_at) }}</span>
                    <mat-icon class="play-icon">play_circle</mat-icon>
                  </div>
                </div>
              }
            } @else {
              <div class="tab-empty">Нет записей визитов</div>
            }
          }

          @if (activeHistoryTab() === 'timeline') {
            <app-client-timeline
              [phone]="resolvedClientPhone()"
              [userId]="clientUserId()" />
          }
        </div>

        <mat-divider />

        <!-- ═══ ЗАМЕТКИ (всегда видны) ═══ -->
        <div class="notes-section">
          <div class="notes-header">
            <span class="notes-title">
              <mat-icon>sticky_note_2</mat-icon>
              Заметки{{ notes().length ? ' (' + notes().length + ')' : '' }}
            </span>
          </div>
          <div class="note-input">
            <input class="note-text-input" placeholder="Добавить заметку..."
                   [(ngModel)]="newNoteText"
                   (keydown.enter)="addNote()">
            <button mat-icon-button (click)="addNote()" [disabled]="!newNoteText.trim()">
              <mat-icon>send</mat-icon>
            </button>
          </div>
          @for (note of notes(); track note.id) {
            <div class="note-row" [class.pinned]="note.pinned">
              @if (note.pinned) {
                <mat-icon class="pin-icon">push_pin</mat-icon>
              }
              <div class="note-content">
                <div class="note-text">{{ note.text }}</div>
                <div class="note-meta">{{ note.author_name }} · {{ formatRelativeTime(note.created_at) }}</div>
              </div>
              <div class="note-actions">
                <button mat-icon-button (click)="togglePinNote(note)">
                  <mat-icon>{{ note.pinned ? 'push_pin' : 'keep' }}</mat-icon>
                </button>
                <button mat-icon-button (click)="deleteNote(note.id)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>
          }
          @if (!notes().length) {
            <div class="notes-empty">Нет заметок</div>
          }
        </div>

      </div>

      <!-- ═══ КОРЗИНА ═══ -->
      @if (sessionId()) {
        <app-operator-cart-panel
          #cartPanel
          [sessionId]="sessionId()!"
          (checkoutRequested)="openPaymentDialog($event)"
        />
      }
    } @else {
      <div class="empty">
        <mat-icon>person_off</mat-icon>
        <p>Клиент не найден</p>
      </div>
    }

    <!-- Cart for chat without client profile -->
    @if (!ctx() && !loading() && sessionId()) {
      <app-operator-cart-panel
        #cartPanel
        [sessionId]="sessionId()!"
        (checkoutRequested)="openPaymentDialog($event)"
      />
    }

  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      padding: var(--crm-space-4);
    }

    .empty, .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--crm-text-muted);
      text-align: center;

      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
      p { font-size: var(--crm-text-base); margin-top: var(--crm-space-2); }
    }

    /* ─── Header ─── */
    .profile-header {
      display: flex;
      align-items: flex-start;
      gap: var(--crm-space-3);
      margin-bottom: var(--crm-space-3);
    }

    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--crm-accent-muted);
      color: var(--crm-accent);
      font-size: var(--crm-text-lg);
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      letter-spacing: 0.5px;
      border: 2px solid var(--crm-accent-container);
    }

    .header-info { flex: 1; min-width: 0; }
    .header-info h3 {
      margin: 0 0 2px;
      font-size: var(--crm-text-lg);
      font-weight: 600;
      line-height: 1.2;
      color: var(--crm-text-primary);
    }

    .phone-row {
      display: flex;
      align-items: center;
      gap: 0;
    }

    .phone-link {
      color: var(--crm-accent);
      text-decoration: none;
      font-size: var(--crm-text-base);
    }

    .copy-btn {
      width: 24px !important;
      height: 24px !important;
      line-height: 24px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .client-email {
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ─── Status row ─── */
    .status-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--crm-space-2);
      margin-bottom: var(--crm-space-3);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--crm-space-1);
      font-size: var(--crm-text-xs);
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 20px;
      min-width: 0;
      max-width: 100%;

      mat-icon { font-size: 10px; width: 10px; height: 10px; }
    }

    .badge-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge-standard {
      background: color-mix(in srgb, var(--crm-status-success) 15%, transparent);
      color: var(--crm-status-success);
      border: 1px solid color-mix(in srgb, var(--crm-status-success) 30%, transparent);
    }

    .badge-student {
      background: color-mix(in srgb, var(--crm-accent) 18%, transparent);
      color: var(--crm-accent);
      border: 1px solid color-mix(in srgb, var(--crm-accent) 35%, transparent);
    }

    .badge-guest {
      background: var(--crm-surface-hover);
      color: var(--crm-text-muted);
      border: 1px solid var(--crm-border);
    }

    .badge-inactive {
      opacity: 0.72;
    }

    .subscription-badge {
      max-width: min(190px, 100%);
    }

    .subscription-active {
      background: color-mix(in srgb, var(--crm-status-info) 15%, transparent);
      color: var(--crm-status-info);
      border: 1px solid color-mix(in srgb, var(--crm-status-info) 30%, transparent);
    }

    .subscription-empty {
      background: var(--crm-surface-hover);
      color: var(--crm-text-muted);
      border: 1px solid var(--crm-border);
    }

    .quick-links {
      margin-left: auto;
      display: flex;
      gap: 0;
      flex-shrink: 0;

      a { width: 28px !important; height: 28px !important; }
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    /* ─── KPI cards ─── */
    .kpi-row {
      display: flex;
      gap: var(--crm-space-2);
      margin-bottom: var(--crm-space-2);
    }

    .kpi-card {
      flex: 1;
      text-align: center;
      padding: var(--crm-space-3) var(--crm-space-2);
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      transition: border-color var(--crm-transition-fast);

      &:hover {
        border-color: var(--crm-border-subtle);
      }
    }

    .kpi-card--accent {
      border-color: var(--crm-accent-container);
      background: var(--crm-accent-muted);
    }

    .kpi-val {
      display: block;
      font-size: var(--crm-text-xl);
      font-weight: 700;
      color: var(--crm-text-primary);
      line-height: 1.2;
    }

    .kpi-card--accent .kpi-val {
      color: var(--crm-accent);
    }

    .kpi-label {
      display: block;
      font-size: var(--crm-text-xs);
      color: var(--crm-text-muted);
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* ─── Channel users ─── */
    .channel-users-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--crm-space-1);
      margin-bottom: var(--crm-space-3);
    }

    .channel-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: var(--crm-text-sm);
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      color: var(--crm-text-secondary);

      mat-icon {
        font-size: 12px;
        width: 12px;
        height: 12px;
        color: var(--crm-text-muted);
      }
    }

    .channel-username {
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .channel-phone {
      font-size: var(--crm-text-xs);
      color: var(--crm-text-muted);
      margin-left: 2px;
    }

    /* ─── Photo approvals ─── */
    .approvals-section {
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      padding: var(--crm-space-3);
      margin-bottom: var(--crm-space-4);
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      font-size: var(--crm-text-base);
      font-weight: 600;
      color: var(--crm-text-primary);
      margin-bottom: var(--crm-space-2);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-accent);
      }
    }

    .section-count {
      background: var(--crm-accent-muted);
      color: var(--crm-accent);
      border-radius: 10px;
      padding: 0 6px;
      font-size: var(--crm-text-xs);
      font-weight: 700;
      line-height: 18px;
      margin-left: auto;
    }

    .approval-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--crm-space-2) var(--crm-space-1);
      border-radius: var(--crm-radius-sm);
      text-decoration: none;
      color: var(--crm-text-primary);
      cursor: pointer;
      transition: background var(--crm-transition-fast);

      &:hover { background: var(--crm-surface-hover); }
    }

    .approval-info { flex: 1; min-width: 0; }

    .approval-title {
      display: block;
      font-size: var(--crm-text-base);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .approval-meta {
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
    }

    .approval-right {
      text-align: right;
      flex-shrink: 0;
      margin-left: var(--crm-space-2);
    }

    .approval-status {
      display: block;
      font-size: var(--crm-text-sm);
      font-weight: 500;
    }

    .as-pending { color: var(--crm-status-warning); }
    .as-in_progress { color: var(--crm-status-info); }
    .as-completed { color: var(--crm-status-success); }
    .as-expired { color: var(--crm-text-muted); }

    .approval-time {
      font-size: var(--crm-text-xs);
      color: var(--crm-text-muted);
      display: block;
    }

    /* ─── Tags ─── */
    .tags-section {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--crm-space-1);
      margin-bottom: var(--crm-space-3);
    }

    .client-tag {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: var(--crm-text-xs);
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 12px;
      border: 1px solid;

      mat-icon {
        font-size: 11px;
        width: 11px;
        height: 11px;
      }
    }

    .tag-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      margin-left: 2px;
      opacity: 0.6;
      color: inherit;

      &:hover { opacity: 1; }

      mat-icon {
        font-size: 10px;
        width: 10px;
        height: 10px;
      }
    }

    .tag-add-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px dashed var(--crm-border);
      background: transparent;
      cursor: pointer;
      color: var(--crm-text-muted);

      &:hover {
        background: var(--crm-surface-hover);
        color: var(--crm-text-primary);
      }

      mat-icon {
        font-size: 12px;
        width: 12px;
        height: 12px;
      }
    }

    /* ─── Loyalty card ─── */
    .loyalty-card {
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      padding: var(--crm-space-3);
      margin-bottom: var(--crm-space-4);
    }

    .loyalty-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--crm-space-2);
    }

    .loyalty-level {
      display: flex;
      align-items: center;
      gap: var(--crm-space-1);
      font-size: var(--crm-text-base);
      font-weight: 600;
      color: var(--crm-text-primary);

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: #f5a623; }
    }

    .loyalty-points {
      font-size: var(--crm-text-base);
      font-weight: 700;
      color: var(--crm-accent);
    }

    .loyalty-bar {
      border-radius: 4px;
      margin-bottom: var(--crm-space-2);
      height: 6px !important;
    }

    .loyalty-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--crm-space-1);
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
    }

    .loyalty-sep { opacity: 0.5; }

    .loyalty-next { color: var(--crm-text-secondary); }

    .loyalty-divider { margin: var(--crm-space-2) 0 !important; }

    .referral-info {
      margin-top: var(--crm-space-2);
      padding-top: var(--crm-space-2);
      border-top: 1px dashed var(--crm-border);
    }

    .referral-row {
      display: flex;
      align-items: center;
      gap: var(--crm-space-1);
      font-size: var(--crm-text-sm);
      color: var(--crm-text-secondary);

      mat-icon {
        font-size: 12px;
        width: 12px;
        height: 12px;
        color: var(--crm-accent);
      }

      strong {
        font-weight: 600;
        color: var(--crm-text-primary);
      }
    }

    .referral-by {
      margin-top: var(--crm-space-1);
    }

    .sub-row {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      font-size: var(--crm-text-base);
    }

    .sub-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-text-muted);
    }

    .sub-name { flex: 1; font-weight: 500; }

    .sub-status { font-size: var(--crm-text-sm); font-weight: 500; }
    .sub-active { color: var(--crm-status-success); }
    .sub-suspended, .sub-expired, .sub-cancelled { color: var(--crm-status-error); }

    .credit-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 2px 0 2px 20px;
      font-size: var(--crm-text-sm);
    }

    .credit-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-secondary);
    }

    .credit-nums { color: var(--crm-text-muted); font-size: var(--crm-text-sm); }

    /* ─── Quick actions ─── */
    .actions-row {
      display: flex;
      gap: var(--crm-space-2);
      margin-bottom: var(--crm-space-4);

      button, a {
        flex: 1;
        min-width: 0;
        font-size: var(--crm-text-sm);
        padding: 0 var(--crm-space-2);
      }
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: var(--crm-space-1); }
    }

    .service-survey {
      display: flex;
      flex-direction: column;
      gap: var(--crm-space-2);
      margin: 0 0 var(--crm-space-4);
    }

    .survey-btn {
      width: 100%;
      min-height: 34px;
      font-size: var(--crm-text-sm);

      mat-icon,
      mat-spinner {
        margin-right: var(--crm-space-1);
        flex-shrink: 0;
      }

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .survey-status {
      display: flex;
      align-items: flex-start;
      gap: var(--crm-space-2);
      padding: var(--crm-space-2);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);

      > mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        margin-top: 1px;
        flex-shrink: 0;
      }
    }

    .survey-status-text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .survey-status-label {
      font-size: var(--crm-text-sm);
      font-weight: 600;
      line-height: 1.25;
      color: var(--crm-text-primary);
    }

    .survey-status-detail {
      font-size: var(--crm-text-xs);
      line-height: 1.25;
      color: var(--crm-text-muted);
    }

    .survey-status--pending > mat-icon,
    .survey-status--info > mat-icon {
      color: var(--crm-status-info);
    }

    .survey-status--success > mat-icon {
      color: var(--crm-status-success);
    }

    .survey-status--warning > mat-icon {
      color: var(--crm-status-warning);
    }

    .survey-status--error > mat-icon {
      color: var(--crm-status-error);
    }

    .survey-status--muted > mat-icon {
      color: var(--crm-text-muted);
    }

    /* ─── History tabs (scrollable) ─── */
    .history-tabs-scroll {
      overflow-x: auto;
      margin: var(--crm-space-2) 0 0;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;

      &::-webkit-scrollbar { display: none; }
    }

    .history-tabs {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--crm-border);
      min-width: max-content;
    }

    .hist-tab {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--crm-space-1);
      padding: var(--crm-space-2) var(--crm-space-3);
      border: none;
      background: none;
      cursor: pointer;
      font-size: var(--crm-text-sm);
      font-weight: 500;
      color: var(--crm-text-muted);
      border-bottom: 2px solid transparent;
      transition: color var(--crm-transition-fast), border-color var(--crm-transition-fast);
      white-space: nowrap;

      &.active {
        color: var(--crm-accent);
        border-bottom-color: var(--crm-accent);
      }

      &:hover:not(.active) { color: var(--crm-text-primary); }
    }

    .tab-count {
      background: var(--crm-accent-muted);
      color: var(--crm-accent);
      border-radius: 10px;
      padding: 0 5px;
      font-size: var(--crm-text-xs);
      font-weight: 700;
      line-height: 16px;
    }

    .history-content {
      min-height: 48px;
      padding: var(--crm-space-1) 0 var(--crm-space-2);
    }

    .tab-empty {
      text-align: center;
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
      padding: var(--crm-space-3) 0;
    }

    /* ─── Order rows ─── */
    .order-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--crm-space-1) 0;
      font-size: var(--crm-text-base);
    }

    .order-info { display: flex; gap: var(--crm-space-2); align-items: center; }
    .order-type { color: var(--crm-text-muted); font-size: var(--crm-text-sm); }
    .order-amount { font-weight: 600; }

    .order-meta {
      display: flex;
      align-items: center;
      gap: var(--crm-space-1);
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
    }

    .pay-icon { font-size: 14px; width: 14px; height: 14px; }
    .pay-paid { color: var(--crm-status-success); }
    .pay-pending { color: var(--crm-status-warning); }
    .pay-failed { color: var(--crm-status-error); }
    .pay-cancelled { color: var(--crm-text-muted); }

    .order-action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1px solid var(--crm-border);
      background: transparent;
      cursor: pointer;
      padding: 0;
      transition: background var(--crm-transition-fast), border-color var(--crm-transition-fast);

      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }

    .order-action-paid {
      color: var(--crm-status-success);
      border-color: color-mix(in srgb, var(--crm-status-success) 40%, transparent);

      &:hover { background: color-mix(in srgb, var(--crm-status-success) 15%, transparent); }
    }

    .order-action-cancel {
      color: var(--crm-status-error);
      border-color: color-mix(in srgb, var(--crm-status-error) 40%, transparent);

      &:hover { background: color-mix(in srgb, var(--crm-status-error) 15%, transparent); }
    }

    /* ─── Booking rows ─── */
    .booking-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--crm-space-2);
      padding: var(--crm-space-1) 0;
      font-size: var(--crm-text-base);
    }

    .booking-summary {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .booking-service {
      color: var(--crm-text-primary);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .booking-time,
    .booking-studio {
      color: var(--crm-text-muted);
      font-size: var(--crm-text-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ─── Task rows ─── */
    .task-row {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      padding: var(--crm-space-1) 0;
      font-size: var(--crm-text-base);
      text-decoration: none;
      color: var(--crm-text-primary);

      &:hover { background: var(--crm-surface-hover); border-radius: var(--crm-radius-sm); }
    }

    .task-num { font-family: var(--crm-font-mono); color: var(--crm-text-muted); font-size: var(--crm-text-sm); }
    .task-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .mini-chip { font-size: var(--crm-text-xs); height: 20px; }

    /* ─── Call / chat rows ─── */
    .call-row {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      padding: var(--crm-space-1) 0;
      font-size: var(--crm-text-sm);
    }

    .call-dir { font-size: 14px; width: 14px; height: 14px; color: var(--crm-text-muted); }
    .call-info-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .call-time { color: var(--crm-text-muted); font-size: var(--crm-text-sm); white-space: nowrap; }

    .chat-session-row {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      padding: var(--crm-space-1) 0;
      font-size: var(--crm-text-sm);
    }

    .cs-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-text-muted); }
    .cs-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cs-channel { font-size: var(--crm-text-sm); font-weight: 500; }
    .cs-meta { font-size: var(--crm-text-sm); color: var(--crm-text-muted); }
    .cs-right { text-align: right; flex-shrink: 0; }
    .cs-status { font-size: var(--crm-text-sm); font-weight: 500; }
    .cs-time { font-size: var(--crm-text-xs); color: var(--crm-text-muted); display: block; }
    .cs-open, .cs-waiting { color: var(--crm-status-warning); }
    .cs-active { color: var(--crm-status-info); }
    .cs-resolved { color: var(--crm-status-success); }
    .cs-closed { color: var(--crm-text-muted); }

    /* ─── Notes ─── */
    .notes-section { padding: var(--crm-space-1) 0; }

    .notes-header { margin-bottom: var(--crm-space-2); }

    .notes-title {
      display: flex;
      align-items: center;
      gap: var(--crm-space-2);
      font-size: var(--crm-text-base);
      font-weight: 600;
      color: var(--crm-text-primary);

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); }
    }

    .note-input {
      display: flex;
      gap: var(--crm-space-1);
      align-items: center;
      margin-bottom: var(--crm-space-2);
    }

    .note-text-input {
      flex: 1;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      padding: var(--crm-space-2) var(--crm-space-3);
      font-size: var(--crm-text-base);
      background: var(--crm-surface-raised);
      color: var(--crm-text-primary);
      outline: none;

      &:focus { border-color: var(--crm-accent); }
      &::placeholder { color: var(--crm-text-muted); }
    }

    .note-row {
      display: flex;
      align-items: flex-start;
      gap: var(--crm-space-2);
      padding: var(--crm-space-2) var(--crm-space-1);
      border-radius: var(--crm-radius-sm);
      margin-bottom: var(--crm-space-1);

      &.pinned { background: var(--crm-accent-muted); padding: var(--crm-space-2); }
      &:hover .note-actions { opacity: 1; }
    }

    .pin-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-accent);
      margin-top: 2px;
      flex-shrink: 0;
    }

    .note-content { flex: 1; min-width: 0; }
    .note-text { font-size: var(--crm-text-base); color: var(--crm-text-primary); white-space: pre-wrap; word-break: break-word; }
    .note-meta { font-size: var(--crm-text-sm); color: var(--crm-text-muted); margin-top: 2px; }

    .note-actions {
      display: flex;
      opacity: 0;
      transition: opacity var(--crm-transition-fast);
      flex-shrink: 0;

      button { width: 28px; height: 28px; mat-icon { font-size: 16px; width: 16px; height: 16px; } }
    }

    .notes-empty {
      text-align: center;
      font-size: var(--crm-text-sm);
      color: var(--crm-text-muted);
      padding: var(--crm-space-2);
    }

    mat-divider { margin: var(--crm-space-3) 0; }

    /* ─── Visits tab ─── */
    .visits-actions {
      padding: var(--crm-space-1) 0 var(--crm-space-2);
    }

    .heatmap-btn {
      font-size: var(--crm-text-sm);
      height: 28px;
      line-height: 28px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; margin-right: var(--crm-space-1); color: #ff6b35; }
    }

    .visit-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--crm-space-1);
      border-radius: var(--crm-radius-sm);
      cursor: pointer;
      transition: background var(--crm-transition-fast);

      &:hover { background: var(--crm-surface-hover); }
      &.has-error { border-left: 2px solid var(--crm-status-error); padding-left: var(--crm-space-2); }
    }

    .visit-info { display: flex; align-items: center; gap: var(--crm-space-2); flex: 1; min-width: 0; }

    .visit-device {
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-text-muted); }
    }

    .visit-details { flex: 1; min-width: 0; }

    .visit-landing {
      display: block;
      font-size: var(--crm-text-sm);
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .visit-meta {
      display: block;
      font-size: var(--crm-text-xs);
      color: var(--crm-text-muted);
    }

    .visit-right {
      display: flex;
      align-items: center;
      gap: var(--crm-space-1);
      flex-shrink: 0;
    }

    .visit-time { font-size: var(--crm-text-xs); color: var(--crm-text-muted); white-space: nowrap; }

    .err-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
      color: var(--crm-status-error);
    }

    .play-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-accent);
      opacity: 0.7;
    }

    .visit-row:hover .play-icon { opacity: 1; }

  `],
})
export class ClientProfilePanelComponent {
  private readonly http = inject(HttpClient);
  private readonly posApi = inject(PosApiService);
  protected readonly telephony = inject(TelephonyService);
  private readonly telephonyApi = inject(TelephonyApiService);
  private readonly clientsApi = inject(CrmClientsApiService);
  private readonly tagsApi = inject(CrmCustomerTagsApiService);
  private readonly replayApi = inject(ReplayApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  clientPhone = input<string | null>(null);
  clientUserId = input<string | null>(null);
  clientContactId = input<string | null>(null);
  sessionId = input<string | null>(null);
  pendingCartItems = input<PendingCartItemsEvent | null>(null);
  private lastPendingCartItemsId: number | null = null;

  readonly cartPanel = viewChild<OperatorCartPanelComponent>('cartPanel');

  ctx = signal<ClientContext | null>(null);
  loyalty = signal<LoyaltyInfo | null>(null);
  subscription = signal<SubscriptionInfo | null>(null);
  studentDiscount = signal<StudentDiscountInfo | null>(null);
  callHistory = signal<CallLog[]>([]);
  chatSessions = signal<ChatSessionHistory[]>([]);
  notes = signal<ClientNote[]>([]);
  contactTags = signal<ContactTagAssignment[]>([]);
  allTags = signal<CustomerTag[]>([]);
  loading = signal(false);

  phoneCopied = signal(false);
  reviewRequested = signal(false);
  serviceSurveyRequesting = signal(false);
  serviceSurveyLastCallId = signal<string | null>(null);
  newNoteText = '';
  activeHistoryTab = signal<'orders' | 'bookings' | 'tasks' | 'interactions' | 'payments' | 'visits' | 'timeline'>('orders');

  // Replay sessions (визиты клиента)
  replaySessions = signal<ReplaySession[]>([]);
  visitsLoading  = signal(false);
  visitsLoaded = false;

  // Helpers
  readonly channelIcon = channelIcon;
  readonly channelLabel = channelLabel;
  readonly paymentStatusIcon = paymentStatusIcon;
  readonly statusLabel = statusLabel;
  readonly formatRelativeTime = formatRelativeTime;
  readonly formatDateTime = formatDateTime;

  // ─── Computed signals ───

  displayName = computed(() => {
    const p = this.ctx()?.profile;
    if (!p) return 'Клиент';
    if (p.name) return p.name;
    // Fallback: channel user display_name
    const cu = this.ctx()?.channel_users?.find(c => c.display_name);
    if (cu?.display_name) return cu.display_name;
    return 'Клиент';
  });

  clientInitials = computed(() => {
    const name = this.displayName();
    if (!name || name === 'Клиент') return '?';
    return name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  });

  isRegistered = computed(() =>
    this.ctx()?.profile?.registered_user?.is_registered ?? false
  );

  clientEmail = computed(() =>
    this.ctx()?.profile?.registered_user?.email || null
  );

  resolvedClientPhone = computed(() =>
    this.clientPhone() || this.ctx()?.profile?.phone || null
  );

  authProviders = computed(() =>
    this.ctx()?.profile?.registered_user?.auth_providers ?? []
  );

  accountBadge = computed((): AccountBadge => {
    const student = this.studentDiscount();
    if (student) {
      const expiry = student.expires_at ? ` до ${this.formatStudentDate(student.expires_at)}` : '';
      return {
        kind: 'student',
        active: student.status === 'active',
        icon: 'school',
        label: `Образовательный${this.studentTierSuffix(student.source_token)}`,
        tooltip: `${this.studentStatusLabel(student.status)}${expiry}`,
      };
    }

    if (this.isRegistered()) {
      return {
        kind: 'standard',
        active: true,
        icon: 'person',
        label: 'Стандартный',
        tooltip: 'Зарегистрированный клиентский аккаунт',
      };
    }

    return {
      kind: 'guest',
      active: false,
      icon: 'person_outline',
      label: 'Гость',
      tooltip: 'Клиентский аккаунт не найден',
    };
  });

  subscriptionBadge = computed((): SubscriptionBadge => {
    const sub = this.subscription();
    if (!sub) {
      return {
        active: false,
        icon: 'card_membership',
        label: 'Без подписки',
        tooltip: 'Активной подписки нет',
      };
    }

    const credits = sub.credits
      .filter(credit => credit.remaining > 0)
      .map(credit => `${credit.product_name}: ${credit.remaining}`)
      .join(', ');

    return {
      active: sub.status === 'active',
      icon: 'workspace_premium',
      label: sub.plan_name,
      tooltip: `Подписка ${sub.plan_name}: ${this.subscriptionStatusLabel(sub.status)}${
        credits ? '; остатки: ' + credits : ''
      }`,
    };
  });

  loyaltyDisplay = computed(() => {
    const l = this.loyalty();
    if (!l) return null;
    const conversionRate = l.conversionRate ?? 1;
    return {
      levelName: l.levelName || `Уровень ${l.level}`,
      points: l.points,
      pointsAsRubles: l.pointsAsRubles ?? Math.floor(l.points * conversionRate),
      canSpend: l.can_spend_points || 0,
      progressPercent: getLevelProgress(l.totalPointsEarned ?? 0, l.level),
      nextLevelSpent: 0,
      currentSpent: l.total_spent,
      referralCode: l.referral_code,
      invitedCount: l.invited_count || 0,
      referredByName: l.referred_by_name,
    };
  });

  channelUsers = computed((): ChannelUserInfo[] =>
    this.ctx()?.channel_users ?? []
  );

  approvalSessions = computed((): ApprovalSessionSummary[] =>
    this.ctx()?.approval_sessions ?? []
  );

  hasPhone = computed(() => !!this.resolvedClientPhone());

  hasTelegram = computed(() =>
    this.channelUsers().some(cu => cu.channel === 'telegram')
    || this.ctx()?.profile?.channels?.includes('telegram')
    || false
  );

  hasWhatsapp = computed(() =>
    this.channelUsers().some(cu => cu.channel === 'whatsapp')
    || this.ctx()?.profile?.channels?.includes('whatsapp')
    || false
  );

  primaryChannel = computed((): string | null => {
    const channels = this.ctx()?.profile?.channels;
    if (!channels?.length) return null;
    // Prefer messenger channels over website
    const preferred = ['telegram', 'whatsapp', 'vk', 'instagram', 'max'];
    for (const ch of preferred) {
      if (channels.includes(ch)) return ch;
    }
    return channels[0];
  });

  availableTagsFiltered = computed(() => {
    const assigned = new Set(this.contactTags().map(t => t.tag_id));
    return this.allTags().filter(t => !assigned.has(t.id));
  });

  hasTimelineData = computed(() => {
    const c = this.ctx();
    if (!c) return false;
    return c.orders.length > 0 || c.bookings.length > 0 || c.other_tasks.length > 0 || this.interactions().length > 0;
  });

  latestServiceSurveyCall = computed((): CallLog | null => {
    const calls = this.callHistory();
    const lastCallId = this.serviceSurveyLastCallId();
    if (lastCallId) {
      const matched = calls.find(call => call.id === lastCallId);
      if (matched) return matched;
    }
    return calls.find(call => this.isServiceSurveyCall(call)) ?? null;
  });

  serviceSurveyInProgress = computed(() => {
    if (this.serviceSurveyRequesting()) return true;
    const call = this.latestServiceSurveyCall();
    const status = call?.status;
    if (!call) return false;
    if (status === 'queued') return true;
    return this.isRecentSurveyCall(call)
      && (status === 'connecting' || status === 'ringing' || status === 'active');
  });

  serviceSurveyStatus = computed((): ServiceSurveyStatusView | null => {
    if (this.serviceSurveyRequesting()) {
      return {
        tone: 'pending',
        icon: 'hourglass_top',
        label: 'Запускаем звонок',
        detail: 'Отправляем запрос в Voximplant',
      };
    }

    const call = this.latestServiceSurveyCall();
    return call ? this.serviceSurveyStatusForCall(call) : null;
  });

  interactions = computed((): Interaction[] => {
    const calls: Interaction[] = this.callHistory().map(c => ({
      _type: 'call',
      _time: c.started_at,
      id: c.id,
      direction: c.direction,
      operator_name: c.operator_name,
      duration_seconds: c.duration_seconds,
      channel: null,
      status: null,
      message_count: null,
      assigned_operator_name: null,
    }));
    const chats: Interaction[] = this.chatSessions().map(s => ({
      _type: 'chat',
      _time: s.created_at,
      id: s.id,
      direction: null,
      operator_name: null,
      duration_seconds: null,
      channel: s.channel,
      status: s.status,
      message_count: s.message_count,
      assigned_operator_name: s.assigned_operator_name,
    }));
    return [...calls, ...chats].sort((a, b) =>
      new Date(b._time).getTime() - new Date(a._time).getTime()
    );
  });

  // ─── Effect ───

  private readonly loadEffect = effect(() => {
    const phone = this.clientPhone();
    const userId = this.clientUserId();
    const contactId = this.clientContactId();
    if (userId) {
      this.loadProfileByUserId(userId);
    } else if (phone) {
      this.loadProfile(phone);
    } else if (contactId) {
      this.loadProfileByContactId(contactId);
    } else {
      this.ctx.set(null);
      this.loyalty.set(null);
      this.subscription.set(null);
      this.studentDiscount.set(null);
      this.serviceSurveyRequesting.set(false);
      this.serviceSurveyLastCallId.set(null);
      this.chatSessions.set([]);
      this.callHistory.set([]);
      this.notes.set([]);
      this.contactTags.set([]);
      this.replaySessions.set([]);
      this.visitsLoaded = false;
      this.activeHistoryTab.set('orders');
    }
  });

  private readonly cartItemsEffect = effect(() => {
    const event = this.pendingCartItems();
    const cartPanel = this.cartPanel();
    if (!event?.items.length || !cartPanel || event.id === this.lastPendingCartItemsId) {
      return;
    }

    cartPanel.addItems(event.items);
    this.lastPendingCartItemsId = event.id;
  });

  private readonly telephonyRefreshEffect = effect(() => {
    const tick = this.telephony.callHistoryRefreshTick();
    if (tick === 0) return;

    const phone = this.resolvedClientPhone();
    if (phone) this.loadCallHistory(phone);
  });

  private loadProfile(phone: string): void {
    this.loading.set(true);
    this.resetServiceSurveyRequestState();
    this.loadAccountBenefits(phone);

    this.loadCallHistory(phone);

    // Load chat sessions history
    this.loadChatSessions({ phone });

    // Load client context
    this.http.get<{ success: boolean; data: ClientContext }>(
      `/api/crm-booking/client-context?phone=${encodeURIComponent(phone)}`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.ctx.set(res.data);
          this.loadContactTags(res.data.profile.contact_id);
        }
        this.loading.set(false);
      },
      error: () => {
        this.ctx.set(null);
        this.loading.set(false);
      },
    });

    // Load notes
    this.clientsApi.getNotes(phone).subscribe({
      next: (data) => this.notes.set(data),
      error: () => this.notes.set([]),
    });
  }

  private loadProfileByUserId(userId: string): void {
    this.loading.set(true);
    this.resetServiceSurveyRequestState();
    this.clearAccountBenefits();

    // Load client context by userId; backend resolves phone if available
    this.http.get<{ success: boolean; data: ClientContext }>(
      `/api/crm-booking/client-context?userId=${encodeURIComponent(userId)}`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.ctx.set(res.data);
          this.loadContactTags(res.data.profile.contact_id);
          // Load chat sessions (works with or without phone via contactId/userId)
          const phone = this.phoneFromProfileContext(res.data.profile.phone);
          this.loadChatSessions({
            phone: phone || undefined,
            userId,
            contactId: res.data.profile?.contact_id || undefined,
          });
          // If phone is available, load phone-dependent data
          if (phone) {
            this.loadCallHistory(phone);
            this.clientsApi.getNotes(phone).subscribe({
              next: (data) => this.notes.set(data),
              error: () => this.notes.set([]),
            });
            this.loadAccountBenefits(phone);
          } else {
            this.callHistory.set([]);
            this.notes.set([]);
            this.clearAccountBenefits();
          }
        }
        this.loading.set(false);
      },
      error: () => {
        this.ctx.set(null);
        this.loading.set(false);
      },
    });
  }

  private loadProfileByContactId(contactId: string): void {
    this.loading.set(true);
    this.resetServiceSurveyRequestState();
    this.clearAccountBenefits();

    this.http.get<{ success: boolean; data: ClientContext }>(
      `/api/crm-booking/client-context?contactId=${encodeURIComponent(contactId)}`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.ctx.set(res.data);
          this.loadContactTags(contactId);
          // Load chat sessions for this contact (works even without phone)
          const phone = this.phoneFromProfileContext(res.data.profile.phone);
          this.loadChatSessions({
            phone: phone || undefined,
            contactId,
          });
          if (phone) {
            this.loadCallHistory(phone);
            this.clientsApi.getNotes(phone).subscribe({
              next: (data) => this.notes.set(data),
              error: () => this.notes.set([]),
            });
            this.loadAccountBenefits(phone);
          } else {
            this.callHistory.set([]);
            this.notes.set([]);
            this.clearAccountBenefits();
          }
        }
        this.loading.set(false);
      },
      error: () => {
        this.ctx.set(null);
        this.loading.set(false);
      },
    });
  }

  private loadAccountBenefits(phone: string | null | undefined): void {
    this.clearAccountBenefits();
    const lookupPhone = this.phoneLookupKey(phone);
    if (!lookupPhone) return;

    this.posApi.lookupCustomer(lookupPhone).subscribe({
      next: (customer) => {
        if (this.currentPhoneLookupKey() !== lookupPhone) return;
        this.loyalty.set(customer.loyalty || null);
        this.subscription.set(customer.subscription || null);
        this.studentDiscount.set(customer.student_discount || null);
      },
      error: () => {
        if (this.currentPhoneLookupKey() !== lookupPhone) return;
        this.clearAccountBenefits();
      },
    });
  }

  private loadCallHistory(phone: string): void {
    this.telephonyApi.getCallHistory({ phone, limit: 10 }).subscribe({
      next: (res) => { if (res.success) this.callHistory.set(res.data); },
      error: () => undefined,
    });
  }

  private resetServiceSurveyRequestState(): void {
    this.serviceSurveyRequesting.set(false);
    this.serviceSurveyLastCallId.set(null);
  }

  private clearAccountBenefits(): void {
    this.loyalty.set(null);
    this.subscription.set(null);
    this.studentDiscount.set(null);
  }

  private phoneFromProfileContext(profilePhone: string | null | undefined): string | null {
    return this.clientPhone() || profilePhone || null;
  }

  private currentPhoneLookupKey(): string | null {
    return this.phoneLookupKey(this.resolvedClientPhone());
  }

  private phoneLookupKey(phone: string | null | undefined): string | null {
    const normalized = phone?.replace(/\D/g, '') ?? '';
    return normalized.length >= 10 ? normalized.slice(-10) : null;
  }

  private loadChatSessions(params: { contactId?: string; phone?: string; userId?: string }): void {
    const query = new URLSearchParams();
    if (params.contactId) query.set('contactId', params.contactId);
    if (params.phone) query.set('phone', params.phone);
    if (params.userId) query.set('userId', params.userId);
    if (!query.toString()) return;

    this.http.get<{ success: boolean; data: ChatSessionHistory[] }>(
      `/api/crm/clients/chat-sessions?${query}`
    ).subscribe({
      next: (res) => { if (res.success) this.chatSessions.set(res.data); },
      error: () => undefined,
    });
  }

  // ─── Helpers ───

  chatStatusLabel(status: string): string {
    return ({ open: 'Открыт', waiting: 'Ожидание', active: 'Активный', resolved: 'Решён', closed: 'Закрыт' })[status] || status;
  }

  subscriptionStatusLabel(status: string): string {
    return ({ active: 'активна', suspended: 'приостановлена', cancelled: 'отменена', expired: 'истекла' })[status] || status;
  }

  studentStatusLabel(status: string): string {
    return ({ active: 'Образовательный доступ активен', expired: 'Образовательный доступ истёк', revoked: 'Образовательный доступ отключён' })[status] || 'Образовательный доступ';
  }

  studentTierSuffix(sourceToken: string): string {
    if (sourceToken === 'education_subscription') return ' (с подпиской)';
    if (sourceToken === 'education_verified') return ' (без подписки)';
    return '';
  }

  bookingStatus(status: string): string {
    return ({ pending: 'Ожидание', confirmed: 'Записан', completed: 'Готово', cancelled: 'Отмена', 'no-show': 'Не пришёл' })[status] || status;
  }

  approvalStatusLabel(status: string | null): string {
    return ({ pending: 'Ожидание', in_progress: 'В работе', completed: 'Готово', expired: 'Истекла' })[status || ''] || status || 'Новая';
  }

  whatsappLink(): string {
    const phone = this.resolvedClientPhone()?.replace(/\D/g, '') || '';
    return `https://wa.me/${phone}`;
  }

  telegramLink(): string {
    const tgUser = this.channelUsers().find(cu => cu.channel === 'telegram');
    if (tgUser?.username) return `https://t.me/${tgUser.username}`;
    return 'https://t.me/';
  }

  formatCurrency(value: number): string {
    if (value == null) return '0 ₽';
    return value.toLocaleString('ru-RU') + ' ₽';
  }

  pluralize(n: number, one: string, few: string, many: string): string {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  formatShortDate(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
  }

  formatStudentDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  formatCallDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  callClient(): void {
    const phone = this.resolvedClientPhone();
    if (phone) this.telephony.makeCall(phone);
  }

  confirmServiceSurveyCall(): void {
    const phone = this.resolvedClientPhone();
    if (!phone || this.serviceSurveyInProgress()) return;

    const displayPhone = this.auth.isAdmin() ? phone : (maskPhone(phone) ?? phone);
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: 'Запросить пожелания?',
        message: `Бот позвонит клиенту ${displayPhone}, задаст вопрос о пожеланиях и сохранит запись с расшифровкой.`,
        confirmLabel: 'Запустить звонок',
        cancelLabel: 'Отмена',
        icon: 'record_voice_over',
        warn: true,
      },
    }).afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) this.startServiceSurveyCall(phone);
    });
  }

  private startServiceSurveyCall(phone: string): void {
    if (this.serviceSurveyRequesting()) return;

    this.serviceSurveyRequesting.set(true);
    this.telephonyApi.startServiceSurveyCall({ phone }).subscribe({
      next: (res) => {
        this.serviceSurveyRequesting.set(false);
        if (!res.success) {
          this.snackBar.open('Не удалось запустить запрос пожеланий', '', { duration: 3000 });
          return;
        }
        this.serviceSurveyLastCallId.set(res.data.callId);
        this.loadCallHistory(phone);
        const queueSuffix = res.data.queuePosition > 0 ? `, позиция ${res.data.queuePosition}` : '';
        this.snackBar.open(
          res.data.queued ? `Запрос пожеланий поставлен в очередь${queueSuffix}` : 'Запрос пожеланий запущен',
          '',
          { duration: 3000 },
        );
      },
      error: () => {
        this.serviceSurveyRequesting.set(false);
        this.snackBar.open('Не удалось запустить запрос пожеланий', '', { duration: 3000 });
      },
    });
  }

  private isServiceSurveyCall(call: CallLog): boolean {
    return call.voximplant_session_id?.startsWith('service-survey-') === true
      || call.notes?.includes('Service survey') === true;
  }

  private serviceSurveyStatusForCall(call: CallLog): ServiceSurveyStatusView {
    const detailTime = this.formatSurveyCallTime(call);
    if (call.status === 'queued') {
      return {
        tone: 'pending',
        icon: 'schedule',
        label: 'В очереди',
        detail: `Запустится после текущего опроса, ${detailTime}`,
      };
    }

    if (call.status === 'connecting' || call.status === 'ringing') {
      return {
        tone: 'pending',
        icon: 'phone_in_talk',
        label: 'Идёт дозвон',
        detail: `Запущен ${detailTime}`,
      };
    }

    if (call.status === 'active') {
      return {
        tone: 'info',
        icon: 'hearing',
        label: 'Клиент ответил',
        detail: `Слушаем ответ, ${detailTime}`,
      };
    }

    if (call.status === 'completed') {
      const hasTranscript = this.serviceSurveyCallHasTranscript(call);
      return {
        tone: hasTranscript ? 'success' : 'warning',
        icon: hasTranscript ? 'task_alt' : 'record_voice_over',
        label: hasTranscript ? 'Ответ получен' : 'Дозвон прошёл',
        detail: hasTranscript ? `Расшифровка сохранена, ${detailTime}` : `Ответ не распознан, ${detailTime}`,
      };
    }

    if (call.status === 'missed') {
      return {
        tone: 'warning',
        icon: 'phone_missed',
        label: 'Недозвон',
        detail: `Клиент не ответил, ${detailTime}`,
      };
    }

    if (call.status === 'failed') {
      return {
        tone: 'error',
        icon: 'error_outline',
        label: 'Ошибка звонка',
        detail: `Voximplant не завершил запрос, ${detailTime}`,
      };
    }

    return {
      tone: 'muted',
      icon: 'info',
      label: this.callStatusLabel(call.status),
      detail: `Последний запрос ${detailTime}`,
    };
  }

  private serviceSurveyCallHasTranscript(call: CallLog): boolean {
    return /Service survey (completed|transcript):.*transcript="/.test(call.notes ?? '');
  }

  private formatSurveyCallTime(call: CallLog): string {
    return this.formatRelativeTime(call.ended_at || call.answered_at || call.started_at);
  }

  private isRecentSurveyCall(call: CallLog): boolean {
    const startedAt = new Date(call.started_at).getTime();
    if (!Number.isFinite(startedAt)) return false;
    return Date.now() - startedAt < 10 * 60 * 1000;
  }

  private callStatusLabel(status: string): string {
    return ({
      connecting: 'Идёт дозвон',
      ringing: 'Идёт дозвон',
      queued: 'В очереди',
      active: 'Клиент ответил',
      completed: 'Звонок завершён',
      missed: 'Недозвон',
      failed: 'Ошибка звонка',
    })[status] || status;
  }

  copyPhone(): void {
    const phone = this.resolvedClientPhone();
    if (!phone) return;
    const textToCopy = this.auth.isAdmin() ? phone : (maskPhone(phone) ?? phone);
    navigator.clipboard.writeText(textToCopy).then(() => {
      this.phoneCopied.set(true);
      this.snackBar.open('Телефон скопирован', '', { duration: 2000 });
      setTimeout(() => this.phoneCopied.set(false), 2000);
    });
  }

  addNote(): void {
    const text = this.newNoteText.trim();
    const phone = this.resolvedClientPhone();
    if (!text || !phone) return;
    this.clientsApi.addNote(phone, text).subscribe({
      next: (note) => {
        this.notes.update(list => [note, ...list]);
        this.newNoteText = '';
      },
    });
  }

  requestReview(): void {
    const phone = this.resolvedClientPhone();
    if (!phone) return;
    this.http.post<{ success: boolean }>('/api/reviews/send', {
      phone,
      clientName: this.ctx()?.profile?.name || null,
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.reviewRequested.set(true);
          this.snackBar.open('Запрос отзыва отправлен', '', { duration: 3000 });
        }
      },
      error: () => this.snackBar.open('Не удалось отправить запрос', '', { duration: 3000 }),
    });
  }

  deleteNote(noteId: string): void {
    const phone = this.resolvedClientPhone();
    if (!phone) return;
    this.clientsApi.deleteNote(phone, noteId).subscribe({
      next: () => this.notes.update(list => list.filter(n => n.id !== noteId)),
    });
  }

  togglePinNote(note: ClientNote): void {
    const phone = this.resolvedClientPhone();
    if (!phone) return;
    const newPinned = !note.pinned;
    this.clientsApi.pinNote(phone, note.id, newPinned).subscribe({
      next: () => {
        this.notes.update(list => {
          const updated = list.map(n => n.id === note.id ? { ...n, pinned: newPinned } : n);
          return updated.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        });
      },
    });
  }

  markOrderPaid(orderId: string): void {
    this.http.post<{ success: boolean }>(`/api/orders/photo-print/${orderId}/mark-paid`, {
      method: 'transfer',
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.ctx.update(c => c ? {
            ...c,
            orders: c.orders.map(o => o.id === orderId ? { ...o, payment_status: 'paid' } : o),
          } : c);
          this.snackBar.open('Заказ отмечен как оплаченный', '', { duration: 3000 });
        }
      },
      error: () => this.snackBar.open('Не удалось обновить статус', '', { duration: 3000 }),
    });
  }

  cancelOrderPayment(orderId: string): void {
    this.http.post<{ success: boolean }>(`/api/orders/photo-print/${orderId}/cancel-payment`, {}).subscribe({
      next: (res) => {
        if (res.success) {
          this.ctx.update(c => c ? {
            ...c,
            orders: c.orders.map(o => o.id === orderId ? { ...o, payment_status: 'cancelled', status: 'cancelled' } : o),
          } : c);
          this.snackBar.open('Платёж отменён', '', { duration: 3000 });
        }
      },
      error: () => this.snackBar.open('Не удалось отменить платёж', '', { duration: 3000 }),
    });
  }

  openMergeDialog(): void {
    const phone = this.resolvedClientPhone();
    if (!phone) return;
    import('../shared/client-merge-dialog.component').then(m => {
      const ref = this.dialog.open(m.ClientMergeDialogComponent, {
        width: '440px',
        data: { primaryPhone: phone },
      });
      ref.afterClosed().subscribe(result => {
        if (result) {
          this.snackBar.open('Клиенты объединены', '', { duration: 3000 });
          this.loadProfile(phone);
        }
      });
    });
  }

  openPaymentDialog(checkoutRequest?: OperatorCartCheckoutRequest): void {
    const phone = this.resolvedClientPhone() ?? '';
    if (!phone && !checkoutRequest) return;
    const cart = this.cartPanel();
    const cartItems = checkoutRequest?.items ?? cart?.items() ?? [];
    const cartTotal = checkoutRequest?.total ?? cart?.total() ?? 0;
    const cartDetails = cartItems.length > 0
      ? this.buildPaymentCartDetails(cartItems, cartTotal)
      : null;
    const prefillServices = cartItems.length > 0
      ? this.buildPaymentPrefillServices(cartItems)
      : [];
    import('../payment-dialog/payment-dialog.component').then(m => {
      this.dialog.open(m.PaymentDialogComponent, {
        width: 'calc(100vw - 24px)',
        maxWidth: '100vw',
        height: 'calc(100vh - 24px)',
        maxHeight: '100vh',
        panelClass: 'payment-dialog-panel',
        data: {
          mode: 'chat' as const,
          phone,
          clientName: this.ctx()?.profile?.name,
          sessionId: this.sessionId() ?? undefined,
          // Личность для резолва реального телефона в диалоге (телефон в чате маскируется).
          clientUserId: this.clientUserId() ?? undefined,
          clientContactId: this.clientContactId() ?? undefined,
          ...(cartTotal > 0 ? { totalPrice: cartTotal } : {}),
          ...(prefillServices.length > 0 ? { prefillServices } : {}),
          ...(cartDetails ? { prefillCartDetails: cartDetails } : {}),
        },
      }).afterClosed().subscribe((result: PaymentDialogResult | undefined) => {
        this.applyPaymentDialogResultToCart(result);
      });
    });
  }

  private buildPaymentPrefillServices(items: readonly SyncCartItem[]): PaymentDialogPrefillService[] {
    return items.map(item => {
      const pricingGroupKey = this.cartItemMetadataString(item, 'pricingGroupKey');
      return {
        id: item.serviceOptionId ?? null,
        slug: this.cartItemMetadataString(item, 'slug'),
        name: item.name,
        price: item.price,
        quantity: this.cartItemQuantity(item),
        ...(pricingGroupKey ? { pricingGroupKey } : {}),
      };
    });
  }

  private buildPaymentCartDetails(items: readonly SyncCartItem[], total: number): PaymentCartDetails {
    const lines = items.flatMap(item => this.cartItemDisplayLines(item));
    const subtotal = this.roundCartAmount(lines.reduce((sum, line) => sum + line.total, 0));
    const lineSavings = lines.reduce((sum, line) => sum + line.discountAmount, 0);
    const inferredSavings = total > 0 ? Math.max(0, subtotal - total) : 0;
    return {
      lines,
      subtotal,
      savings: this.roundCartAmount(Math.max(lineSavings, inferredSavings)),
    };
  }

  private cartItemDisplayLines(item: SyncCartItem): PaymentCartDetails['lines'] {
    const details = item.displayDetails;
    if (details?.lines.length) {
      return details.lines.map(line => ({
        name: line.name || item.name,
        quantity: this.cartLineQuantity(line.quantity),
        unitPrice: this.roundCartAmount(line.unitPrice),
        total: this.roundCartAmount(line.total),
        priceNote: line.priceNote ?? details.priceNote ?? item.description ?? item.note ?? null,
        discountLabel: line.discountLabel ?? null,
        discountAmount: this.roundCartAmount(Math.max(0, line.discountAmount ?? 0)),
      }));
    }

    const quantity = this.cartItemQuantity(item);
    const total = this.roundCartAmount(this.cartItemTotal(item));
    return [{
      name: item.name,
      quantity,
      unitPrice: this.roundCartAmount(quantity > 0 ? total / quantity : item.price),
      total,
      priceNote: item.description ?? item.note ?? null,
      discountLabel: null,
      discountAmount: 0,
    }];
  }

  private cartItemTotal(item: SyncCartItem): number {
    const metadataTotal = this.cartItemMetadataNumber(item, 'priceTotal');
    if (metadataTotal !== null) return metadataTotal;
    const displaySubtotal = item.displayDetails?.subtotal;
    if (typeof displaySubtotal === 'number' && Number.isFinite(displaySubtotal)) {
      return displaySubtotal;
    }
    if (item.nextPrice != null && item.nextPrice !== item.price && item.quantity > 1) {
      return item.price + item.nextPrice * (item.quantity - 1);
    }
    return item.price * item.quantity;
  }

  private cartItemQuantity(item: SyncCartItem): number {
    return this.cartLineQuantity(item.quantity);
  }

  private cartLineQuantity(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.trunc(value));
  }

  private cartItemMetadataNumber(item: SyncCartItem, key: string): number | null {
    const value = item.metadata?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private cartItemMetadataString(item: SyncCartItem, key: string): string | null {
    const value = item.metadata?.[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private roundCartAmount(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  private applyPaymentDialogResultToCart(result: PaymentDialogResult | null | undefined): void {
    const cart = this.cartPanel();
    if (!cart || cart.isEmpty() || !result) return;

    if ((result.type === 'sent' || result.type === 'updated') && result.orderId && result.amount) {
      cart.registerExternalPaymentLink(result.orderId, result.amount);
      return;
    }

    const title = this.paymentDialogResultTitle(result);
    if (title) {
      cart.markExternalPaymentAccepted(title);
    }
  }

  private paymentDialogResultTitle(result: PaymentDialogResult): string | null {
    switch (result.type) {
      case 'posReceipt':
        return `Чек ${result.receiptNumber}`;
      case 'cash':
        return 'Оплата наличными';
      case 'transfer':
        return 'Оплата переводом';
      case 'card':
        return 'Оплата картой';
      case 'sbp':
        return 'Оплата СБП';
      case 'subscription':
        return 'Оплата подпиской';
      default:
        return null;
    }
  }

  tipsLink(): string {
    const name = encodeURIComponent(this.ctx()?.profile?.name || '');
    return `https://pay.cloudtips.ru/p/fmagnus?name=${name}`;
  }

  // ─── Визиты (Session Replay) ─────────────────────────────────────────────────

  onVisitsTabClick(): void {
    this.activeHistoryTab.set('visits');
    if (!this.visitsLoaded) {
      this.loadVisits();
    }
  }

  private loadVisits(): void {
    const phone  = this.resolvedClientPhone();
    const userId = this.clientUserId();
    if (!phone && !userId) return;

    this.visitsLoading.set(true);
    this.replayApi.getSessions({
      phone: phone || undefined,
      user_id: userId || undefined,
      days: 30,
      limit: 20,
    }).subscribe({
      next: (r) => {
        this.replaySessions.set(r.data);
        this.visitsLoaded = true;
        this.visitsLoading.set(false);
      },
      error: () => {
        this.visitsLoading.set(false);
      },
    });
  }

  openReplayDialog(session: ReplaySession): void {
    import('../session-replay-viewer/session-replay-viewer.component').then(m => {
      this.dialog.open(m.SessionReplayViewerComponent, {
        width: '90vw',
        maxWidth: '1100px',
        height: '80vh',
        data: { session },
        panelClass: 'replay-dialog-panel',
      });
    });
  }

  openHeatmapDialog(): void {
    // Определяем visitor_id из первой сессии (если есть)
    const visitorId = this.replaySessions()[0]?.visitor_id;
    import('../heatmap-viewer/heatmap-viewer.component').then(m => {
      this.dialog.open(m.HeatmapViewerComponent, {
        width: '90vw',
        maxWidth: '1100px',
        height: '80vh',
        data: {
          visitor_id: visitorId,
          title: `Heatmap: ${this.ctx()?.profile?.name || 'Клиент'}`,
        },
        panelClass: 'heatmap-dialog-panel',
      });
    });
  }

  formatVisitDuration(secs: number): string {
    if (secs < 60) return `${secs}с`;
    return `${Math.floor(secs / 60)}м`;
  }

  private loadContactTags(contactId: string | null | undefined): void {
    if (!contactId) {
      this.contactTags.set([]);
      return;
    }
    if (!this.allTags().length) {
      this.tagsApi.getAllTags().subscribe({
        next: (tags) => this.allTags.set(tags),
        error: () => this.allTags.set([]),
      });
    }
    this.tagsApi.getContactTags(contactId).subscribe({
      next: (tags) => this.contactTags.set(tags),
      error: () => this.contactTags.set([]),
    });
  }

  assignTag(tagId: string): void {
    const contactId = this.ctx()?.profile?.contact_id;
    if (!contactId) return;
    this.tagsApi.assignTag(contactId, tagId).subscribe({
      next: () => {
        const tag = this.allTags().find(t => t.id === tagId);
        if (tag) {
          this.contactTags.update(list => [...list, {
            tag_id: tag.id, name: tag.name, color: tag.color,
            icon: tag.icon, assigned_at: new Date().toISOString(),
            assigned_by_name: null,
          }]);
        }
      },
    });
  }

  removeTag(tagId: string): void {
    const contactId = this.ctx()?.profile?.contact_id;
    if (!contactId) return;
    this.tagsApi.removeTag(contactId, tagId).subscribe({
      next: () => this.contactTags.update(list => list.filter(t => t.tag_id !== tagId)),
    });
  }
}
