import { Component, inject, input, output, effect, signal, computed, ChangeDetectionStrategy, PLATFORM_ID, DestroyRef, Injector, untracked, ElementRef, afterNextRender } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, concat, filter, of } from 'rxjs';
import { catchError, debounceTime, switchMap, toArray } from 'rxjs/operators';
import { DOCUMENT, DatePipe, isPlatformBrowser } from '@angular/common';
import { DeadlineTimerService } from '../../services/deadline-timer.service';
import { DeadlineTimerPipe } from '../../pipes/deadline-timer.pipe';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OrdersApiService, PhotoPrintOrder, PhotoPrintOrderItem, OrderAttachment } from '../../services/orders-api.service';
import { ProductionApiService, ProductionOrder } from '../../services/production-api.service';
import { Router } from '@angular/router';
import { PrintDialogComponent, PrintDialogData } from '../print-dialog/print-dialog.component';
import { BatchPrintDialogComponent, BatchPrintDialogData } from '../batch-print-dialog/batch-print-dialog.component';
import { PrintApiService, PrintJob } from '../../services/print-api.service';
import { batchPrintDialogConfig, printDialogConfig } from '../../utils/print-dialog-config';
import { TasksApiService } from '../../services/tasks-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { orderStatusLabel, paymentStatusLabel, paymentStatusIcon, formatRelativeTime, channelIcon, channelLabel, channelColor } from '../../utils/crm-helpers';
import { EntityNotesComponent } from '../shared/entity-notes.component';
import { RetouchStatusBadgeComponent } from '../shared/retouch-status-badge.component';
import { ProcessingSubOptionsComponent, type SubOptionInfo } from '../shared';
import { OrderApprovalWidgetComponent } from './order-approval-widget.component';
import { DeliveryIndicatorComponent } from './delivery-indicator.component';
import { ReadyFormsInlinePanelComponent } from '../ready-forms/ready-forms-inline-panel.component';
import { PhotoWorkspaceComponent } from '../photo-workspace/photo-workspace.component';
import { photoWorkspaceCounters } from '../photo-workspace/photo-workspace-state';
import type { PaymentDialogData, PaymentDialogResult } from '../payment-dialog/models/payment-dialog.models';
import type { PhotoWorkspaceEnvelopeDto } from '../../models/photo-workspace.model';
import { PhotoWorkspaceApiService } from '../../services/photo-workspace-api.service';
import { RetouchApiService, RetouchTask } from '../../services/retouch-api.service';
import { QuickPrintService } from '../../services/quick-print.service';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { decodeFileName } from '../../../../shared/utils/file-helpers';
import { groupRetouchOptions } from '../../../../shared/utils/retouch-options.util';
import { applyOrderEditChatSelection, type OrderEditChatSearchResult } from './order-edit-chat-link.util';

interface Employee {
  id: string;
  display_name: string;
  role: string;
}

interface EditData {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  delivery_address: string;
  comments: string;
  tracking_number: string;
  priority: string;
  chat_session_id: string;
  document_template_id: string | null;
  photo_size: string;
  wishes: string;
  medals_required: boolean;
  medals_description: string;
  uniform_description: string;
  /** Per-item disabled features — mutable Map (item.id → Set<label>). */
  itemDisabledFeatures: Map<string, Set<string>>;
}

interface ParsedOrderMeta {
  service?: string;
  tariff?: string;
  document?: string;
  selectedOptions?: Record<string, string[]>;
  deliveryPickup?: string;
  deliveryProduction?: string;
  deliveryMethod?: string;
  printAddon?: boolean;
  deliveryAddress?: string;
  rawComment?: string;
}

interface ClientPhoto {
  id: string;
  attachment_url: string;
  created_at: string;
}

interface CropSourcePhoto {
  url: string;
  name: string;
}

interface WorkspaceIndicator {
  label: string;
  tone: 'neutral' | 'warning' | 'error' | 'success';
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function extractHttpStatus(err: unknown): number | null {
  if (err instanceof HttpErrorResponse) return err.status;
  return null;
}

const FORMAT_LABELS: Record<string, string> = {
  '10x15': '10×15', '10x15_super': '10×15 Супер',
  '15x20': '15×20', '15x20_super': '15×20 Супер',
  '20x30': '20×30', '20x30_super': '20×30 Супер',
  '30x40': '30×40', '40x50': '40×50',
};

@Component({
  selector: 'app-order-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DatePipe,
    MatCardModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatMenuModule, MatDividerModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule,
    MatTooltipModule, MatExpansionModule, MatProgressBarModule,
    EntityNotesComponent,
    RetouchStatusBadgeComponent,
    OrderApprovalWidgetComponent,
    DeliveryIndicatorComponent,
    ReadyFormsInlinePanelComponent,
    PhotoWorkspaceComponent,
    ProcessingSubOptionsComponent,
    DeadlineTimerPipe,
  ],
  template: `
    @if (loading()) {
      <div class="skeleton-panel">
        <div class="sk-row"><div class="sk-bar sk-title"></div></div>
        <div class="sk-row"><div class="sk-bar sk-chip"></div><div class="sk-bar sk-chip"></div></div>
        <div class="sk-row"><div class="sk-bar sk-line"></div></div>
        <div class="sk-row"><div class="sk-bar sk-line short"></div></div>
        <div class="sk-row"><div class="sk-bar sk-block"></div></div>
      </div>
    } @else if (order()) {
      @if (photoWorkspaceOpen()) {
        <app-photo-workspace
          [orderId]="order()!.id"
          [orderNumber]="order()!.order_id"
          [initialSourceUrl]="workspaceInitialSource()?.url ?? null"
          [initialSourceName]="workspaceInitialSource()?.name ?? null"
          [chatSessionId]="order()!.chat_session_id"
          (closed)="closePhotoWorkspace()"
          (approvalChanged)="onWorkspaceApprovalChanged()" />
      } @else {
      <div class="order-detail" [class.od-wide]="panelWide()">

        <!-- Header -->
        <div class="order-header">
          <mat-icon class="order-icon">receipt_long</mat-icon>
          <div class="order-header-info">
            <div class="order-title-row">
              <h2>Заказ {{ extractOrderNum(order()!.order_id) }}</h2>
              <button mat-icon-button class="label-print-btn" matTooltip="Напечатать этикетку" (click)="printLabel()">
                <mat-icon>label</mat-icon>
              </button>
            </div>
            <div class="order-chips">
              <mat-chip [class]="'st-' + order()!.status">{{ orderStatusLabel(order()!.status) }}</mat-chip>
              <mat-chip [class]="'pay-' + order()!.payment_status">
                <mat-icon>{{ paymentStatusIcon(order()!.payment_status) }}</mat-icon>
                {{ paymentStatusLabel(order()!.payment_status) }}
              </mat-chip>
              @if (order()!.priority && order()!.priority !== 'normal') {
                <mat-chip class="priority-chip">{{ order()!.priority === 'vip' ? 'VIP' : 'Срочный' }}</mat-chip>
              }
            </div>
            @if (workspaceIndicators().length) {
              <div class="workspace-indicators" aria-label="Photo workspace">
                @for (indicator of workspaceIndicators(); track indicator.label) {
                  <span [attr.data-tone]="indicator.tone">{{ indicator.label }}</span>
                }
              </div>
            }
          </div>
        </div>

        <!-- Deadline bar -->
        @if (order()!.deadline) {
          <div class="deadline-bar" [class]="timer.deadlineClass(order()!.deadline)">
            <mat-icon>{{ timer.isOverdue(order()!.deadline) ? 'warning' : 'timer' }}</mat-icon>
            <span class="dl-label">{{ deadlineLabel() }}</span>
            <span class="dl-time">{{ order()!.deadline | deadlineTimer:'detailed' }}</span>
            @if (escalationLevel() >= 2) {
              <span class="escalation-badge" [class.critical]="escalationLevel() >= 3">
                <mat-icon>priority_high</mat-icon>
                {{ escalationLevel() >= 3 ? 'Критично' : 'Просрочен' }}
              </span>
            }
          </div>
        }

        <!-- Индикатор курьерской доставки + кнопка вызова курьера (реюз delivery-доски).
             orderId = человекочитаемый order_id: backend dispatch/cancel роутят по order_id, не UUID. -->
        @if (order()!.delivery_method === 'courier') {
          <app-delivery-indicator
            class="delivery-indicator-row"
            [orderId]="order()!.order_id"
            [orderStatus]="order()!.status" />
        }

        @if (!editing()) {

          <!-- Две колонки при широкой панели: слева «что делать» (задание, фото,
               состав), справа «действия и статус» (согласование, оплата, статус,
               контакты, печать). На узкой панели колонки просто стопкой. -->
          <div class="od-cols">
          <div class="od-col od-col--main">

          <!-- Задание для ретушёра (prominent) -->
          @if (retouchTask() || orderMeta().rawComment || order()!.wishes || order()!.medals_required || order()!.uniform_description || order()!.document_template_name || order()!.photo_size || formAttachments().length || excludedFeatures().length) {
            <mat-card appearance="outlined" class="info-card task-card task-card--prominent">
              <mat-card-content>
                <div class="section-header">
                  <mat-icon class="section-icon">assignment</mat-icon>
                  <h3 class="section-title">Задание для ретушёра</h3>
                  @if (retouchTask()) {
                    <app-retouch-status-badge
                      [status]="retouchTask()!.status"
                      [retoucherName]="retouchTask()!.retoucher_name"
                      [revisionCount]="retouchTask()!.revision_count" />
                  }
                </div>

                @if (retouchTask()) {
                  <div class="retouch-info">
                    @if (retouchTask()!.retouch_level) {
                      <div class="info-row">
                        <span class="label">Обработка:</span>
                        <mat-chip>{{ retouchLevelLabel() }}</mat-chip>
                      </div>
                    }
                    @if (retouchTask()!.retoucher_name) {
                      <div class="info-row">
                        <mat-icon>person</mat-icon>
                        <span>{{ retouchTask()!.retoucher_name }}</span>
                        <button mat-icon-button [matMenuTriggerFor]="reassignMenu" matTooltip="Переназначить">
                          <mat-icon>swap_horiz</mat-icon>
                        </button>
                      </div>
                    }
                    @if (retouchTask()!.started_at) {
                      <div class="info-row">
                        <mat-icon>timer</mat-icon>
                        <span>Начата: {{ retouchTask()!.started_at | date:'HH:mm' }}</span>
                      </div>
                    }
                  </div>
                  <mat-menu #reassignMenu="matMenu">
                    @for (emp of employees(); track emp.id) {
                      <button mat-menu-item (click)="reassignRetouch(emp.id)">
                        <mat-icon>person</mat-icon>
                        {{ emp.display_name }}
                      </button>
                    }
                  </mat-menu>

                  @if (retouchTask()!.retouch_level === 'super' && retouchTask()!.retouch_options.length > 0) {
                    <div class="task-instructions task-instructions--super-retouch">
                      <div class="task-label"><mat-icon>auto_fix_high</mat-icon> Лист-задание (Супер обработка)</div>
                      @for (group of groupRetouchOptions(retouchTask()!.retouch_options); track group.key) {
                        <div class="rc-group">
                          @if (group.name) {
                            <div class="rc-group-name">{{ group.name }}</div>
                          }
                          <div class="rc-chips">
                            @for (item of group.items; track item.key) {
                              <span class="rc-chip">{{ item.label }}</span>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }
                }

                @if (order()!.document_template_name || order()!.photo_size) {
                  <div class="task-instructions task-instructions--document">
                    <div class="task-label task-label--with-action">
                      <span><mat-icon>description</mat-icon> Документ</span>
                      <button
                        mat-stroked-button
                        class="document-crop-btn"
                        (click)="openDocumentCrop()">
                        <mat-icon>crop</mat-icon>
                        Кадрировать
                      </button>
                    </div>
                    <p class="comments-text">
                      {{ order()!.document_template_name }}
                      @if (order()!.document_template_name && order()!.photo_size) { · }
                      {{ order()!.photo_size }}
                    </p>
                  </div>
                }

                @if (orderMeta().rawComment) {
                  <div class="task-instructions">
                    <div class="task-label"><mat-icon>chat</mat-icon> Комментарий клиента</div>
                    <p class="comments-text">{{ orderMeta().rawComment }}</p>
                  </div>
                }

                @if (order()!.wishes) {
                  <div class="task-instructions">
                    <div class="task-label"><mat-icon>stars</mat-icon> Пожелания</div>
                    <p class="comments-text">{{ order()!.wishes }}</p>
                  </div>
                }

                @if (order()!.medals_required) {
                  <div class="task-instructions task-instructions--medals">
                    <div class="task-label"><mat-icon>military_tech</mat-icon> Медали и награды</div>
                    <p class="comments-text">{{ order()!.medals_description || 'Требуется подстановка медалей' }}</p>
                  </div>
                }

                @if (order()!.uniform_description || formAttachments().length) {
                  <div class="task-instructions task-instructions--uniform">
                    <div class="task-label"><mat-icon>checkroom</mat-icon> Форма для подстановки</div>
                    @if (order()!.uniform_description) {
                      <p class="comments-text">{{ order()!.uniform_description }}</p>
                    }
                    @if (formAttachments().length) {
                      <div class="form-samples-grid">
                        @for (att of formAttachments(); track att.id) {
                          <a class="form-sample-thumb" [href]="att.s3_url" target="_blank"
                             matTooltip="Открыть образец формы">
                            <img [src]="att.s3_url" [alt]="att.file_name" />
                          </a>
                        }
                      </div>
                    }
                  </div>
                }

                @if (excludedFeatures().length) {
                  <div class="task-instructions task-instructions--excluded">
                    <div class="task-label"><mat-icon>block</mat-icon> Исключено клиентом</div>
                    <ul class="excluded-list">
                      @for (ef of excludedFeatures(); track ef.name + ef.itemName) {
                        <li><strong>{{ ef.name }}</strong> @if (ef.itemName) { <span class="excluded-item">— {{ ef.itemName }}</span> }</li>
                      }
                    </ul>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          }

          @if (canManageReadyForms()) {
            <mat-expansion-panel class="ready-form-panel">
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <mat-icon>checkroom</mat-icon>
                  Форма
                </mat-panel-title>
              </mat-expansion-panel-header>
              <app-ready-forms-inline-panel />
            </mat-expansion-panel>
          }

          <!-- Исходные фото: ТОЛЬКО прикреплённые к заказу. Фото из чата клиента
               вынесены в свёрнутый блок ниже (а не валятся в основную сетку). -->
          @if (orderSourcePhotos().length || (clientPhotos().length && order()!.chat_session_id)) {
            <mat-card appearance="outlined" class="info-card">
              <mat-card-content>
                @if (orderSourcePhotos().length) {
                  <div class="section-header">
                    <h3 class="section-title">Исходные фото ({{ orderSourcePhotos().length }})</h3>
                  </div>
                  <div class="photos-grid">
                    @for (p of orderSourcePhotos(); track p.url) {
                      <div class="photo-thumb-wrap">
                        <img [src]="p.url" class="photo-thumb" [alt]="p.name" />
                        <div class="photo-overlay">
                          <a [href]="p.url" [download]="p.name" target="_blank" matTooltip="Скачать">
                            <mat-icon>download</mat-icon>
                          </a>
                        </div>
                      </div>
                    }
                  </div>
                }

                @if (clientPhotos().length && order()!.chat_session_id) {
                  <mat-expansion-panel class="chat-photos-panel">
                    <mat-expansion-panel-header>
                      <mat-panel-title>Фото из чата ({{ clientPhotos().length }})</mat-panel-title>
                    </mat-expansion-panel-header>
                    <div class="chat-photos-actions">
                      <a class="download-all-btn"
                         [href]="'/api/visitor-chat/sessions/' + order()!.chat_session_id + '/download?type=received'"
                         target="_blank" matTooltip="Скачать все из чата">
                        <mat-icon>download</mat-icon> ZIP
                      </a>
                    </div>
                    <div class="photos-grid">
                      @for (photo of clientPhotos(); track photo.id) {
                        <div class="photo-thumb-wrap">
                          <img [src]="photo.attachment_url" class="photo-thumb" alt="Фото" />
                          <div class="photo-overlay">
                            <a [href]="photo.attachment_url" [download]="'photo-' + photo.id + '.jpg'"
                               target="_blank" matTooltip="Скачать">
                              <mat-icon>download</mat-icon>
                            </a>
                          </div>
                        </div>
                      }
                    </div>
                  </mat-expansion-panel>
                }
              </mat-card-content>
            </mat-card>
          }

          <!-- Состав заказа -->
          @if (printableItems().length || otherItems().length) {
            <mat-card appearance="outlined" class="info-card">
              <mat-card-content>
                <div class="section-header">
                  <h3 class="section-title">Состав заказа</h3>
                </div>

                @if (printableItems().length) {
                  <div class="print-files-summary-row">
                    <span class="print-files-icon" aria-hidden="true">
                      <mat-icon>photo_library</mat-icon>
                    </span>
                    <div class="item-info">
                      <span class="item-format">{{ fileCountLabel(printableItems().length) }}</span>
                      <span class="item-paper">{{ printableFilesSummary() }}</span>
                    </div>
                    <span class="item-qty">{{ copyCountLabel(printablePrintCount()) }}</span>
                    <div class="print-files-actions">
                      <button mat-stroked-button class="print-all-btn" (click)="printAll()">
                        <mat-icon>print</mat-icon> Печать
                      </button>
                      <button
                        mat-stroked-button
                        class="download-all-btn"
                        [disabled]="downloadingPrintArchive()"
                        (click)="downloadAllPrintPhotos()">
                        <mat-icon>download</mat-icon> Скачать всё
                      </button>
                    </div>
                  </div>
                }

                @for (item of otherItems(); track $index) {
                  <div class="service-item-row">
                    <div class="item-info">
                      <span class="item-format">{{ getItemName(item) }}</span>
                      @if (item.document) {
                        <span class="item-paper">{{ item.document }}</span>
                      }
                    </div>
                    @if (item.price) { <span class="item-price">{{ item.price }}₽</span> }
                    <span class="item-qty">×{{ item.quantity || 1 }}</span>
                  </div>
                  @if (editing() && canEditItemFeatures(item)) {
                    <div class="item-edit-features">
                      <app-processing-sub-options
                        [subs]="itemSubs(item)"
                        [isDisabled]="itemIsDisabledFn(item.id!)"
                        [canDisableMore]="canDisableMoreForItem(item)"
                        (subToggle)="toggleItemFeature(item.id!, $event)" />
                      <div class="item-edit-preview">
                        Предварительная цена: {{ previewItemPrice(item) }}\u20BD
                      </div>
                    </div>
                  }
                }
                @if (editing()) {
                  <div class="order-edit-preview">
                    Итого (предварительно): {{ previewOrderTotal() }}\u20BD
                  </div>
                }
                @if (hasDeliveryMeta()) {
                  <div class="order-meta-extra">
                    @if (orderMeta().deliveryPickup) {
                      <div class="info-row"><mat-icon>place</mat-icon> Самовывоз: {{ orderMeta().deliveryPickup }}</div>
                    }
                    @if (orderMeta().deliveryProduction) {
                      <div class="info-row"><mat-icon>factory</mat-icon> Производство: {{ orderMeta().deliveryProduction }}</div>
                    }
                    @if (orderMeta().deliveryMethod && orderMeta().deliveryMethod !== 'pickup') {
                      <div class="info-row"><mat-icon>local_shipping</mat-icon>
                        {{ orderMeta().deliveryMethod === 'electronic' ? 'Электронная доставка' :
                           orderMeta().deliveryMethod === 'postal' ? 'Почта России' : orderMeta().deliveryMethod }}
                      </div>
                    }
                    @if (orderMeta().printAddon) {
                      <div class="info-row"><mat-icon>print</mat-icon> Печатный вид включён (+200₽)</div>
                    }
                    @if (orderMeta().selectedOptions) {
                      @for (entry of optionEntries(); track entry.key) {
                        <div class="info-row"><mat-icon>tune</mat-icon>
                          <span class="option-key">{{ entry.label }}:</span>
                          <span>{{ entry.values.join(', ') }}</span>
                        </div>
                      }
                    }
                  </div>
                }
              </mat-card-content>
            </mat-card>
          }

          <!-- Contact info -->
          <mat-card appearance="outlined" class="info-card">
            <mat-card-content>
              @if (order()!.contact_name) {
                <div class="info-row"><mat-icon>person</mat-icon> {{ order()!.contact_name }}</div>
              }
              @if (order()!.contact_phone) {
                <div class="info-row"><mat-icon>phone</mat-icon>
                  <a [href]="'tel:' + order()!.contact_phone">{{ order()!.contact_phone }}</a>
                </div>
              }
              @if (order()!.contact_email) {
                <div class="info-row"><mat-icon>email</mat-icon> {{ order()!.contact_email }}</div>
              }
              @if (order()!.delivery_address) {
                <div class="info-row"><mat-icon>local_shipping</mat-icon>
                  {{ order()!.delivery_address }}
                  @if (order()!.delivery_cost) { (+{{ order()!.delivery_cost }}₽) }
                </div>
              }
              @if (order()!.tracking_number) {
                <div class="info-row"><mat-icon>qr_code</mat-icon> Трекинг: {{ order()!.tracking_number }}</div>
              }
              <div class="info-row chat-link-row">
                <mat-icon>forum</mat-icon>
                @if (chatLinkEditing()) {
                  <div class="chat-link-form">
                    <mat-form-field appearance="outline" class="chat-link-field">
                      <mat-label>ID чата</mat-label>
                      <input matInput [(ngModel)]="chatLinkInput" placeholder="UUID чата" />
                    </mat-form-field>
                    <button mat-icon-button matTooltip="Сохранить" [disabled]="chatLinkSaving()" (click)="saveChatLink()">
                      <mat-icon>check</mat-icon>
                    </button>
                    <button mat-icon-button matTooltip="Отмена" [disabled]="chatLinkSaving()" (click)="cancelChatLinkEdit()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                } @else {
                  <div class="chat-link-main">
                    <span class="option-key">Чат:</span>
                    <button type="button" class="chat-link-button" [disabled]="!order()!.chat_session_id" (click)="openLinkedChat()">
                      {{ linkedChatLabel() }}
                    </button>
                  </div>
                  <div class="chat-link-actions">
                    <button mat-icon-button matTooltip="Изменить чат" (click)="startChatLinkEdit()">
                      <mat-icon>edit</mat-icon>
                    </button>
                    @if (order()!.chat_session_id) {
                      <button mat-icon-button matTooltip="Отвязать чат" (click)="confirmUnlinkChat()">
                        <mat-icon>link_off</mat-icon>
                      </button>
                    }
                  </div>
                }
              </div>
              <div class="info-row">
                <mat-icon>engineering</mat-icon>
                @if (order()!.assigned_employee_id) {
                  <span>{{ assignedName() }}</span>
                } @else {
                  <span class="unassigned">Не назначен</span>
                }
                <button mat-stroked-button class="assign-btn" [matMenuTriggerFor]="assignMenu">
                  <mat-icon>group_add</mat-icon>
                </button>
                <mat-menu #assignMenu="matMenu">
                  @for (emp of employees(); track emp.id) {
                    <button mat-menu-item (click)="assignTo(emp.id)"
                            [disabled]="emp.id === order()!.assigned_employee_id">
                      <mat-icon>{{ emp.role === 'photographer' ? 'camera_alt' : 'person' }}</mat-icon>
                      {{ emp.display_name }}
                    </button>
                  }
                  @if (!order()!.assigned_employee_id) {
                    <button mat-menu-item (click)="assignToMe()">
                      <mat-icon>person_pin</mat-icon> Взять себе
                    </button>
                  }
                  @if (order()!.assigned_employee_id) {
                    <mat-divider />
                    <button mat-menu-item (click)="unassign()">
                      <mat-icon>person_remove</mat-icon> Снять назначение
                    </button>
                  }
                </mat-menu>
              </div>
            </mat-card-content>
          </mat-card>

          </div>
          <div class="od-col od-col--side">

          <!-- Согласование результатов (как в чате: исходник + варианты ретуши) -->
          <mat-card appearance="outlined" class="info-card approval-card">
            <mat-card-content>
              <app-order-approval-widget
                [orderId]="order()!.id"
                [chatSessionId]="order()!.chat_session_id"
                [clientName]="order()!.contact_name"
                [clientPhone]="order()!.contact_phone"
                [refreshKey]="approvalRefreshKey()"
                [superRetouch]="retouchTask()?.retouch_level === 'super'"
                (approvalUpdated)="onApprovalUpdated($event)" />
            </mat-card-content>
          </mat-card>

          <!-- Промокод (сумма не дублируется отдельной строкой: она в кнопке оплаты / в бейдже «Оплачено») -->
          @if (order()!.promo_code) {
            <div class="promo-line"><mat-icon>sell</mat-icon> Промокод {{ order()!.promo_code }} (-{{ order()!.promo_discount }}₽)</div>
          }

          <!-- Payment -->
          @if (order()!.payment_status === 'paid') {
            <div class="paid-badge">
              <mat-icon>check_circle</mat-icon>
              <span class="paid-label">Оплачено</span>
              <span class="paid-amount">{{ order()!.total_price }}₽</span>
              @if (order()!.paid_at) {
                <span class="paid-date">{{ formatRelativeTime(order()!.paid_at!) }}</span>
              }
              @if (order()!.payment_card_info) {
                <span class="paid-card">{{ order()!.payment_card_info }}</span>
              }
              @if (order()!.receipt_url) {
                <a [href]="order()!.receipt_url!" target="_blank" class="receipt-link" matTooltip="Открыть чек">
                  <mat-icon>receipt</mat-icon>
                </a>
              }
            </div>
          } @else {
            <button class="pay-order-btn" (click)="openPaymentDialog()">
              <mat-icon>credit_card</mat-icon>
              Принять оплату {{ order()!.total_price }}₽
            </button>
            <div class="payment-secondary-actions">
              <button mat-stroked-button class="remind-btn"
                      (click)="sendReminder()"
                      [disabled]="reminderSending() || reminderCooldown() > 0 || !order()!.chat_session_id">
                <mat-icon>notifications_active</mat-icon>
                @if (reminderSending()) {
                  Отправка...
                } @else if (reminderCooldown() > 0) {
                  Повторить через {{ reminderCooldown() }}м
                } @else {
                  Напомнить
                }
              </button>
              <button mat-stroked-button class="mark-paid-btn" [matMenuTriggerFor]="markPaidMenu"
                      [disabled]="markPaidSending()">
                <mat-icon>price_check</mat-icon>
                @if (markPaidSending()) {
                  Сохранение...
                } @else {
                  Оплачено
                }
              </button>
              <mat-menu #markPaidMenu="matMenu">
                <button mat-menu-item (click)="markPaid('cash')">
                  <mat-icon>payments</mat-icon> Наличными
                </button>
                <button mat-menu-item (click)="markPaid('transfer')">
                  <mat-icon>account_balance</mat-icon> Переводом
                </button>
                <button mat-menu-item (click)="markPaid('other')">
                  <mat-icon>more_horiz</mat-icon> Другое
                </button>
              </mat-menu>
            </div>
          }

          <!-- Статус работы: наглядный степпер + одна кнопка «дальше» -->
          <div class="work-status">
            <div class="ws-header">
              <span class="ws-title">Статус работы</span>
              <button mat-icon-button class="ws-more" [matMenuTriggerFor]="orderMoreMenu" matTooltip="Ещё действия">
                <mat-icon>more_vert</mat-icon>
              </button>
            </div>

            @if (order()!.status === 'cancelled') {
              <div class="ws-cancelled">
                <mat-icon>cancel</mat-icon>
                <span>Заказ отменён</span>
              </div>
            } @else {
              <div class="ws-stepper">
                @for (st of workSteps; track st.idx) {
                  <div class="ws-step" [class.done]="workStep() > st.idx" [class.current]="workStep() === st.idx">
                    <span class="ws-dot">
                      @if (workStep() > st.idx) { <mat-icon>check</mat-icon> }
                      @else { {{ st.idx + 1 }} }
                    </span>
                    <span class="ws-label">{{ st.label }}</span>
                  </div>
                  @if (st.idx < 3) {
                    <span class="ws-bar" [class.done]="workStep() > st.idx"></span>
                  }
                }
              </div>

              @if (revisionRequested()) {
                <div class="ws-revision">
                  <mat-icon>edit_note</mat-icon>
                  <span>На доработке: клиент просит правки. Загрузите исправленный вариант и отправьте снова.</span>
                </div>
              }

              @if (nextAction(); as na) {
                <button mat-flat-button class="ws-next" (click)="doNextAction(na.status)">
                  <mat-icon>{{ na.icon }}</mat-icon> {{ na.label }}
                </button>
                @if (order()!.status === 'processing' && !revisionRequested()) {
                  <div class="ws-hint">
                    <mat-icon>info</mat-icon>
                    <span>Отправьте фото клиенту на согласование выше — заказ сам станет «Готов», а после одобрения — «Завершён».</span>
                  </div>
                }
              } @else {
                <div class="ws-done">
                  <mat-icon>verified</mat-icon>
                  <span>Заказ завершён</span>
                </div>
              }

              @if (showPaymentConfirm()) {
                <div class="payment-confirm-bar">
                  <span>Заказ не оплачен. Отметить оплату?</span>
                  <button mat-flat-button color="primary" [disabled]="markPaidSending()" (click)="markPaidAndComplete('cash')">
                    <mat-icon>payments</mat-icon> Наличными
                  </button>
                  <button mat-flat-button [disabled]="markPaidSending()" (click)="markPaidAndComplete('transfer')">
                    <mat-icon>account_balance</mat-icon> Переводом
                  </button>
                  <button mat-button (click)="forceComplete()">Завершить без оплаты</button>
                </div>
              }
            }

            <mat-menu #orderMoreMenu="matMenu">
              @if (order()!.status === 'ready') {
                <button mat-menu-item (click)="changeStatus('processing')">
                  <mat-icon>undo</mat-icon> Вернуть в работу
                </button>
              }
              @if (order()!.items.length) {
                <button mat-menu-item (click)="repeatOrder()"><mat-icon>replay</mat-icon> Повторить заказ</button>
              }
              @if (!isFinished()) {
                <button mat-menu-item (click)="openDelayDialog()"><mat-icon>schedule_send</mat-icon> Задерживается</button>
                <button mat-menu-item (click)="confirmCancel()"><mat-icon>cancel</mat-icon> Отменить заказ</button>
              }
              @if (order()!.receipt_url) {
                <a mat-menu-item [href]="order()!.receipt_url" target="_blank"><mat-icon>receipt</mat-icon> Чек</a>
              }
              @if (canDeleteOrder()) {
                <mat-divider />
                <button mat-menu-item class="danger-menu-item" (click)="confirmDeleteOrder()" [disabled]="deleting()">
                  <mat-icon>delete_forever</mat-icon> Удалить заказ
                </button>
              }
            </mat-menu>
          </div>

          <!-- История печати -->
          <mat-expansion-panel class="print-history-panel">
            <mat-expansion-panel-header>
              <mat-panel-title>
                <mat-icon>print</mat-icon>
                Печать
                @if (printJobs().length) {
                  <span class="pj-count">{{ printJobs().length }}</span>
                }
              </mat-panel-title>
            </mat-expansion-panel-header>
            @if (printJobsLoading()) {
              <mat-progress-bar mode="indeterminate"></mat-progress-bar>
            } @else if (!printJobs().length) {
              <div class="pj-empty">Заказ не печатался</div>
            } @else {
              @for (job of printJobs(); track job.id) {
                <div class="pj-row">
                  <div class="pj-info">
                    <span class="pj-file">{{ job.file_name || shortenPrintUrl(job.file_url) }}</span>
                    <span class="pj-meta">
                      {{ job.printer_name }} · {{ job.paper_size }}
                      @if (job.copies > 1) { · x{{ job.copies }} }
                    </span>
                  </div>
                  <span class="pj-status" [class]="'pjs-' + job.status">{{ printJobStatusLabel(job.status) }}</span>
                  <span class="pj-date">{{ job.created_at | date:'dd.MM HH:mm' }}</span>
                  @if (job.status === 'completed') {
                    <button mat-icon-button matTooltip="Перепечатать" (click)="reprintJob(job)">
                      <mat-icon>refresh</mat-icon>
                    </button>
                  }
                  @if (job.status === 'failed') {
                    <button mat-icon-button matTooltip="Повторить" (click)="retryPrintJob(job)">
                      <mat-icon>replay</mat-icon>
                    </button>
                  }
                </div>
              }
            }
          </mat-expansion-panel>

          </div>
          </div>

        } @else {
          <!-- Edit mode -->
          <div class="order-edit-layout">
            <div class="order-edit-main">
              <section class="edit-section-panel">
                <div class="edit-section-header">
                  <mat-icon>description</mat-icon>
                  <div>
                    <h3>Документ</h3>
                    <span>Шаблон и размер для задания ретушёра</span>
                  </div>
                </div>

                <div class="edit-field">
                  <label class="edit-field-label" for="edit-document-template">Шаблон документа</label>
                  <select
                    id="edit-document-template"
                    class="edit-input edit-select"
                    [ngModel]="editData.document_template_id"
                    (ngModelChange)="setDocumentTemplate($event)">
                    <option [ngValue]="null">Не выбран</option>
                    <optgroup label="Документы РФ">
                      @for (t of dashboardData.documentTemplates(); track t.id) {
                        @if (t.category === 'identity') { <option [ngValue]="t.id">{{ t.name }}</option> }
                      }
                    </optgroup>
                    <optgroup label="Визы">
                      @for (t of dashboardData.documentTemplates(); track t.id) {
                        @if (t.category === 'visa') { <option [ngValue]="t.id">{{ t.name }}</option> }
                      }
                    </optgroup>
                    <optgroup label="Медицина">
                      @for (t of dashboardData.documentTemplates(); track t.id) {
                        @if (t.category === 'medical') { <option [ngValue]="t.id">{{ t.name }}</option> }
                      }
                    </optgroup>
                  </select>
                </div>

                <div class="edit-field">
                  <label class="edit-field-label" for="edit-photo-size">Размер фото</label>
                  <input
                    id="edit-photo-size"
                    class="edit-input"
                    [(ngModel)]="editData.photo_size"
                    placeholder="например, 3,5x4,5" />
                  <span class="edit-field-hint">Автозаполняется при выборе шаблона, если поле пустое</span>
                </div>
              </section>

              <section class="edit-section-panel">
                <div class="edit-section-header">
                  <mat-icon>auto_fix_high</mat-icon>
                  <div>
                    <h3>Задание ретушёра</h3>
                    <span>Комментарий, пожелания и подстановка формы</span>
                  </div>
                </div>

                <div class="edit-field edit-field--textarea">
                  <label class="edit-field-label" for="edit-comments">Комментарий</label>
                  <textarea id="edit-comments" class="edit-textarea" [(ngModel)]="editData.comments" rows="4"></textarea>
                </div>

                <div class="edit-field edit-field--textarea">
                  <label class="edit-field-label" for="edit-wishes">Пожелания</label>
                  <textarea id="edit-wishes" class="edit-textarea" [(ngModel)]="editData.wishes" rows="4"></textarea>
                </div>

                <label class="edit-check">
                  <input type="checkbox" [(ngModel)]="editData.medals_required">
                  <span>Требуется подстановка медалей/наград</span>
                </label>

                @if (editData.medals_required) {
                  <div class="edit-field edit-field--textarea">
                    <label class="edit-field-label" for="edit-medals">Описание медалей</label>
                    <textarea id="edit-medals" class="edit-textarea edit-textarea--sm" [(ngModel)]="editData.medals_description" rows="3"></textarea>
                  </div>
                }

                <div class="edit-field edit-field--textarea">
                  <label class="edit-field-label" for="edit-uniform">Форма для подстановки</label>
                  <textarea
                    id="edit-uniform"
                    class="edit-textarea edit-textarea--sm"
                    [(ngModel)]="editData.uniform_description"
                    rows="3"
                    placeholder="парадная ВМФ, МВД, МЧС"></textarea>
                </div>
              </section>
            </div>

            <aside class="order-edit-side">
              <div class="ocf-panel">
                <div class="ocf-panel-title">Клиент</div>
                <div class="ocf-field">
                  <label class="ocf-field-label" for="edit-phone">Телефон</label>
                  <input id="edit-phone" class="ocf-input" type="tel" [(ngModel)]="editData.contact_phone" />
                </div>
                <div class="ocf-field">
                  <label class="ocf-field-label" for="edit-client-name">Имя</label>
                  <input id="edit-client-name" class="ocf-input" [(ngModel)]="editData.contact_name" />
                </div>
                <div class="ocf-field">
                  <label class="ocf-field-label" for="edit-email">Email</label>
                  <input id="edit-email" class="ocf-input" type="email" [(ngModel)]="editData.contact_email" />
                </div>
                <div class="ocf-field">
                  <label class="ocf-field-label" for="edit-delivery">Адрес доставки</label>
                  <input id="edit-delivery" class="ocf-input" [(ngModel)]="editData.delivery_address" />
                </div>
                <div class="ocf-field">
                  <label class="ocf-field-label" for="edit-tracking">Трекинг-номер</label>
                  <input id="edit-tracking" class="ocf-input" [(ngModel)]="editData.tracking_number" />
                </div>
              </div>

              <div class="ocf-panel">
                <div class="ocf-panel-title">Чат</div>
                @if (editData.chat_session_id) {
                  <div class="ocf-chat-linked">
                    <mat-icon>chat_bubble</mat-icon>
                    <div class="ocf-chat-linked-info">
                      <span class="ocf-chat-linked-name">{{ editLinkedChatLabel() }}</span>
                      <span class="ocf-chat-linked-hint">ID {{ shortEditChatId() }}</span>
                    </div>
                    <button class="edit-chat-icon-btn" matTooltip="Изменить чат" (click)="openEditChatPicker()">
                      <mat-icon>swap_horiz</mat-icon>
                    </button>
                    <button class="ocf-chat-unlink" matTooltip="Отвязать чат" (click)="unlinkEditChat()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                } @else {
                  <button class="ocf-link-chat-btn" (click)="openEditChatPicker()">
                    <mat-icon>link</mat-icon>
                    Привязать чат
                  </button>
                }
              </div>

              <div class="ocf-panel">
                <div class="ocf-panel-title">Приоритет</div>
                <div class="ocf-priority-options">
                  <label class="ocf-priority" [class.ocf-priority--active]="editData.priority === 'normal'">
                    <input type="radio" name="edit-priority" value="normal" [(ngModel)]="editData.priority">
                    <div>
                      <div class="ocf-priority-name">Обычный</div>
                      <div class="ocf-priority-desc">Стандартная очередь</div>
                    </div>
                  </label>
                  <label class="ocf-priority" [class.ocf-priority--active]="editData.priority === 'urgent'">
                    <input type="radio" name="edit-priority" value="urgent" [(ngModel)]="editData.priority">
                    <div>
                      <div class="ocf-priority-name">Срочный</div>
                      <div class="ocf-priority-desc">Без очереди</div>
                    </div>
                  </label>
                  <label class="ocf-priority" [class.ocf-priority--active]="editData.priority === 'vip'">
                    <input type="radio" name="edit-priority" value="vip" [(ngModel)]="editData.priority">
                    <div>
                      <div class="ocf-priority-name">VIP</div>
                      <div class="ocf-priority-desc">Повышенный приоритет</div>
                    </div>
                  </label>
                </div>
              </div>

              <div class="ocf-panel ocf-panel--last">
                <div class="ocf-panel-title">Сохранение</div>
                <div class="edit-save-grid">
                  <button class="edit-save edit-save--primary" [disabled]="saving()" (click)="saveEdit()">
                    <mat-icon>save</mat-icon>
                    {{ saving() ? 'Сохраняем' : 'Сохранить' }}
                  </button>
                  <button class="edit-save" [disabled]="saving()" (click)="cancelEdit()">
                    <mat-icon>close</mat-icon>
                    Отмена
                  </button>
                </div>
              </div>
            </aside>
          </div>

          @if (showEditChatPickerPopup()) {
            <div class="ocf-popup-backdrop" (click)="closeEditChatPicker()" role="presentation"></div>
            <div class="ocf-popup">
              <div class="ocf-popup-header">
                <h3 class="ocf-popup-title">Привязать чат</h3>
                <button class="ocf-popup-close" (click)="closeEditChatPicker()"><mat-icon>close</mat-icon></button>
              </div>
              <div class="ocf-popup-search">
                <mat-icon>search</mat-icon>
                <input class="ocf-popup-search-input" placeholder="Поиск по имени или телефону..." (input)="searchEditChats(inputValue($event))">
              </div>
              <div class="ocf-popup-list">
                @for (chat of editChatSearchResults(); track chat.id) {
                  <button class="ocf-popup-item" (click)="selectEditChatFromSearch(chat)">
                    <mat-icon class="ocf-popup-item-icon"
                              [style.color]="channelColor(chat.channel || '')">{{ channelIcon(chat.channel || '') }}</mat-icon>
                    <div class="ocf-popup-item-info">
                      <div class="ocf-popup-item-top">
                        <span class="ocf-popup-item-name">{{ chat.clientName || chat.clientPhone || 'Без имени' }}</span>
                        @if (chat.sortTime) {
                          <span class="ocf-popup-item-time">{{ chat.sortTime | date:'dd.MM HH:mm' }}</span>
                        }
                      </div>
                      <div class="ocf-popup-item-sub">
                        @if (chat.channel) {
                          <span class="ocf-popup-item-badge"
                                [style.color]="channelColor(chat.channel)"
                                [style.border-color]="channelColor(chat.channel)">{{ channelLabel(chat.channel) }}</span>
                        }
                        @if (chat.clientPhone) {
                          <span class="ocf-popup-item-phone">{{ chat.clientPhone }}</span>
                        }
                      </div>
                      @if (chat.preview) {
                        <span class="ocf-popup-item-preview">{{ chat.preview }}</span>
                      }
                    </div>
                  </button>
                }
                @if (editChatSearchResults().length === 0) {
                  <div class="ocf-popup-empty"><mat-icon>forum</mat-icon><span>Загрузка...</span></div>
                }
              </div>
            </div>
          }
        }

        <!-- Secondary actions -->
        <div class="secondary-actions">
          @if (!editing() && !isFinished()) {
            <button mat-stroked-button (click)="startEdit()">
              <mat-icon>edit</mat-icon> Редактировать
            </button>
          }
          @if (!editing() && canDeleteOrder()) {
            <button mat-stroked-button class="danger-action" (click)="confirmDeleteOrder()" [disabled]="deleting()">
              <mat-icon>delete_forever</mat-icon> Удалить заказ
            </button>
          }
        </div>

        @if (productionOrders().length > 0) {
          <div class="production-section">
            <div class="section-label">Производственные заказы</div>
            @for (po of productionOrders(); track po.id) {
              <button class="production-chip" (click)="openProductionOrder(po.id)">
                <mat-icon>factory</mat-icon>
                {{ po.order_number }} · {{ po.printing_house_name }}
              </button>
            }
          </div>
        }

        <app-entity-notes entityType="order" [entityId]="orderId()" />

        <div class="meta-footer">
          <span>Создан {{ formatRelativeTime(order()!.created_at) }}</span>
          @if (order()!.paid_at) {
            <span> · Оплачен {{ formatRelativeTime(order()!.paid_at!) }}</span>
          }
        </div>
      </div>
      }
    }
  `,
  styles: [`
    :host { display: block; padding: 10px 12px; overflow-y: auto; height: 100%; box-sizing: border-box; }

    /* Skeleton */
    .skeleton-panel { padding: 4px; display: flex; flex-direction: column; gap: 12px; }
    .sk-row { display: flex; gap: 8px; }
    .sk-bar {
      height: 14px; border-radius: var(--crm-radius-sm);
      background: linear-gradient(90deg, var(--crm-skeleton-base) 25%, var(--crm-skeleton-shine) 50%, var(--crm-skeleton-base) 75%);
      background-size: 400px 100%;
      animation: crmShimmer 1.5s infinite linear;
    }
    @keyframes crmShimmer { from { background-position: -200px 0; } to { background-position: 200px 0; } }
    .sk-title { width: 60%; height: 20px; }
    .sk-chip { width: 64px; height: 22px; border-radius: 11px; }
    .sk-line { width: 100%; }
    .sk-line.short { width: 40%; }
    .sk-block { width: 100%; height: 80px; border-radius: var(--crm-radius-md); }

    /* Header */
    .order-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 8px;
    }

    .order-header-info { flex: 1; min-width: 0; }

    .order-title-row {
      display: flex; align-items: center; gap: 4px;
    }
    .label-print-btn {
      width: 28px; height: 28px; padding: 0;
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-text-muted); }
      &:hover mat-icon { color: var(--crm-accent); }
    }

    .order-icon { font-size: 28px; width: 28px; height: 28px; color: var(--crm-accent); margin-top: 2px; }

    h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; font-family: var(--crm-font-mono); }

    .order-chips { display: flex; gap: 5px; flex-wrap: wrap; }

    .workspace-indicators {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
      margin-top: 5px;

      span {
        padding: 3px 7px;
        border-radius: var(--crm-radius-sm);
        background: var(--crm-surface-raised);
        color: var(--crm-text-secondary);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }

      span[data-tone="warning"] {
        color: var(--crm-status-warning);
        background: var(--crm-status-warning-muted);
      }

      span[data-tone="error"] {
        color: var(--crm-status-error);
        background: var(--crm-status-error-muted);
      }

      span[data-tone="success"] {
        color: var(--crm-status-success);
        background: var(--crm-status-success-muted);
      }
    }

    mat-chip[class*="st-"], mat-chip[class*="pay-"], mat-chip.priority-chip {
      font-size: var(--crm-text-sm); font-weight: 500; border-radius: var(--crm-radius-sm);
    }

    .st-new { background: var(--crm-status-info-muted); color: var(--crm-status-info); }
    .st-paid { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .st-pending_payment { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .st-processing { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .st-ready { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .st-completed { background: var(--crm-surface-raised); color: var(--crm-text-secondary); }
    .st-cancelled { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    .pay-paid { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .pay-pending { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .pay-failed { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    .priority-chip { background: var(--crm-status-error); color: var(--crm-on-accent); }

    /* Deadline bar */
    .delivery-indicator-row { display: block; margin: 10px 0; }
    .deadline-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: var(--crm-radius-md);
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      background: var(--crm-status-success-muted);
      color: var(--crm-status-success);

      mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
      .dl-label { flex: 1; }
      .dl-time { font-family: var(--crm-font-mono); font-size: 14px; }

      &.warning { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
      &.overdue { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    }

    .escalation-badge {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--crm-status-error);
      color: #fff;
      flex-shrink: 0;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.critical { animation: pulse 1.5s infinite; }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Payment badge (paid state) */
    .paid-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-status-success-muted, rgba(52, 211, 153, 0.1));
      color: var(--crm-status-success, #34d399);
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .paid-date, .paid-card {
      font-weight: 400;
      color: var(--crm-text-secondary);
      font-size: 12px;
    }

    .receipt-link {
      margin-left: auto;
      color: var(--crm-accent, #f59e0b);
      display: flex;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    /* Payment button (unpaid state) */
    .pay-order-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 10px 16px;
      margin-bottom: 8px;
      border-radius: var(--crm-radius-md, 8px);
      background: rgba(245, 158, 11, 0.10);
      border: 1px solid rgba(245, 158, 11, 0.25);
      color: #f59e0b;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 150ms ease;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover {
        background: rgba(245, 158, 11, 0.18);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(245, 158, 11, 0.15);
      }
    }

    /* Payment secondary actions (remind + mark paid) */
    .payment-secondary-actions {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;

      button {
        font-size: 12px;
        height: 32px;
        line-height: 32px;
        mat-icon { font-size: 15px; width: 15px; height: 15px; margin-right: 3px; }
      }

      .remind-btn {
        flex: 1;
      }

      .mark-paid-btn {
        flex: 1;
      }
    }

    /* Repeat order button */
    .repeat-order-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      margin-bottom: 8px;
      border-radius: var(--crm-radius-sm, 6px);
      background: none;
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--crm-text-secondary, #a0a0a0);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      transition: all 150ms ease;

      mat-icon { font-size: 15px; width: 15px; height: 15px; }

      &:hover {
        border-color: rgba(245, 158, 11, 0.3);
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.06);
      }
    }

    /* Status actions */
    .status-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 10px;
      align-items: center;

      button {
        font-size: 12px;
        height: 32px;
        line-height: 32px;
        mat-icon { font-size: 15px; width: 15px; height: 15px; margin-right: 3px; }
      }
    }

    .payment-confirm-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      width: 100%;
      background: #fff3e0;
      border-radius: 8px;
      padding: 12px;
      margin-top: 4px;

      span { font-size: 13px; font-weight: 500; color: #e65100; margin-right: auto; }
      button { font-size: 12px; height: 32px; line-height: 32px; }
    }

    /* Статус работы: степпер */
    .work-status {
      padding: 10px;
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,.06));
      border-radius: var(--crm-radius-lg, 12px);
      background: var(--crm-glass-bg, rgba(255,255,255,.02));
    }
    .ws-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .ws-title { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--crm-text-muted, #7a7a7a); }
    .ws-more { width: 28px; height: 28px; line-height: 28px; color: var(--crm-text-muted, #7a7a7a);
      mat-icon { font-size: 18px; width: 18px; height: 18px; } }

    .ws-stepper { display: flex; align-items: center; margin-bottom: 8px; }
    .ws-step { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
    .ws-dot {
      width: 26px; height: 26px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700;
      background: var(--crm-surface-overlay, #272520);
      border: 2px solid var(--crm-border, rgba(255,255,255,.1));
      color: var(--crm-text-muted, #7a7a7a);
      transition: all .2s;
      mat-icon { font-size: 15px; width: 15px; height: 15px; }
    }
    .ws-label { font-size: 10.5px; color: var(--crm-text-muted, #7a7a7a); white-space: nowrap; }
    .ws-step.current .ws-dot {
      border-color: var(--crm-accent, #f59e0b);
      background: var(--crm-accent-muted, rgba(245,158,11,.14));
      color: var(--crm-accent, #f59e0b);
      box-shadow: 0 0 0 3px rgba(245,158,11,.12);
    }
    .ws-step.current .ws-label { color: var(--crm-accent, #f59e0b); font-weight: 600; }
    .ws-step.done .ws-dot {
      border-color: var(--crm-status-success, #34d399);
      background: var(--crm-status-success, #34d399);
      color: #07210f;
    }
    .ws-step.done .ws-label { color: var(--crm-text-secondary, #a0a0a0); }
    .ws-bar { flex: 1; height: 2px; margin: 0 4px; margin-bottom: 18px;
      background: var(--crm-border, rgba(255,255,255,.1)); transition: background .2s;
      &.done { background: var(--crm-status-success, #34d399); } }

    .ws-next {
      width: 100%; height: 40px;
      background: var(--crm-accent, #f59e0b) !important; color: var(--crm-on-accent, #1a1407) !important;
      font-weight: 600;
      mat-icon { margin-right: 4px; }
    }
    .ws-hint {
      display: flex; align-items: center; gap: 6px; margin-top: 8px;
      font-size: 11.5px; color: var(--crm-text-muted, #7a7a7a);
      mat-icon { font-size: 15px; width: 15px; height: 15px; opacity: .7; }
    }
    .ws-revision {
      display: flex; align-items: center; gap: 8px; margin: 10px 0 4px;
      padding: 8px 10px; border-radius: 8px;
      background: var(--crm-status-error-bg, rgba(239, 68, 68, .12));
      border: 1px solid var(--crm-status-error, #ef4444);
      color: var(--crm-status-error, #ef4444);
      font-size: 12.5px; font-weight: 600; line-height: 1.35;
      mat-icon { flex: 0 0 auto; font-size: 18px; width: 18px; height: 18px; }
    }
    .ws-done, .ws-cancelled {
      display: flex; align-items: center; gap: 8px; padding: 8px 4px;
      font-size: 13px; font-weight: 500;
    }
    .ws-done { color: var(--crm-status-success, #34d399);
      mat-icon { font-size: 18px; width: 18px; height: 18px; } }
    .ws-cancelled { color: var(--crm-text-muted, #7a7a7a);
      mat-icon { font-size: 18px; width: 18px; height: 18px; } }

    /* Info card */
    .info-card { margin-bottom: 8px; }
    .section-title { font-size: var(--crm-text-md); font-weight: 600; margin: 0 0 6px; }

    .info-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      font-size: var(--crm-text-md);

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); flex-shrink: 0; }
      a { color: var(--crm-accent); text-decoration: none; }
      .option-key { color: var(--crm-text-muted); }
    }

    .chat-link-row { align-items: flex-start; }
    .chat-link-main { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; }
    .chat-link-button {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--crm-accent);
      font: inherit;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      text-align: left;

      &:disabled {
        color: var(--crm-text-muted);
        cursor: default;
      }
    }
    .chat-link-actions { display: flex; gap: 2px; margin-left: auto; }
    .chat-link-actions button, .chat-link-form button {
      width: 26px;
      height: 26px;
      line-height: 26px;
      padding: 0;
      mat-icon { font-size: 15px; width: 15px; height: 15px; }
    }
    .chat-link-form { display: flex; align-items: flex-start; gap: 4px; flex: 1; min-width: 0; }
    .chat-link-field { flex: 1; min-width: 0; margin-bottom: 0; }

    .danger-menu-item mat-icon { color: var(--crm-status-error); }

    .assign-btn {
      width: 24px;
      height: 24px;
      line-height: 24px;
      font-size: 11px;
      padding: 0 6px;
      margin-left: auto;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .unassigned { color: var(--crm-status-error); font-style: italic; }

    /* Section header */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      gap: 8px;
    }

    .print-all-btn {
      font-size: 11px;
      height: 26px;
      line-height: 26px;
      padding: 0 8px;
      mat-icon { font-size: 13px; width: 13px; height: 13px; margin-right: 3px; }
    }

    /* Items */
    .print-files-summary-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid var(--crm-border);
      &:last-child { border-bottom: none; }
    }

    .print-files-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--crm-radius-sm);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: var(--crm-accent);
      background: rgba(255, 171, 0, 0.12);
      border: 1px solid rgba(255, 171, 0, 0.22);

      mat-icon { font-size: 22px; width: 22px; height: 22px; }
    }

    .print-files-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;

      .download-all-btn { margin-left: 0; }
    }

    .item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .item-format { font-size: var(--crm-text-md); font-weight: 500; }
    .item-paper { font-size: var(--crm-text-sm); color: var(--crm-text-muted); }
    .item-qty { color: var(--crm-text-muted); font-size: var(--crm-text-md); flex-shrink: 0; }
    .item-price { font-family: var(--crm-font-mono); font-weight: 500; flex-shrink: 0; }

    .service-item-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 5px 0;
      border-bottom: 1px solid var(--crm-border);
      &:last-child { border-bottom: none; }
    }

    .item-edit-features {
      padding: 4px 0 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-bottom: 1px solid var(--crm-border);
    }
    .item-edit-preview {
      font-size: 12px;
      color: var(--crm-text-secondary);
      padding: 4px 12px 4px 36px;
      font-family: var(--crm-font-mono, monospace);
    }
    .order-edit-preview {
      margin-top: 8px;
      padding: 6px 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary);
      background: rgba(255,255,255,0.03);
      border-radius: var(--crm-radius-sm, 4px);
      font-family: var(--crm-font-mono, monospace);
    }

    /* Client photos */
    .download-all-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--crm-accent);
      text-decoration: none;
      padding: 3px 8px;
      border-radius: var(--crm-radius-sm);
      border: 1px solid var(--crm-accent);
      transition: background 0.15s;
      margin-left: auto;

      mat-icon { font-size: 13px; width: 13px; height: 13px; }
      &:hover { background: var(--crm-accent-muted); }
    }

    /* Миниатюры фиксированного размера, иначе одно фото раздувалось до 1/4 ширины
       панели (≈270px на широком экране). Теперь thumbnail всегда ~84px. */
    .photos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, 84px);
      gap: 6px;
      justify-content: start;
    }

    .photo-thumb-wrap {
      position: relative;
      aspect-ratio: 1;
      border-radius: var(--crm-radius-sm);
      overflow: hidden;
      background: var(--crm-surface-raised);

      &:hover .photo-overlay { opacity: 1; }
    }

    .photo-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .photo-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s;

      a {
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(0,0,0,0.3);
        text-decoration: none;
        transition: background 0.15s;
        &:hover { background: rgba(0,0,0,0.6); }
        mat-icon { font-size: 18px; width: 18px; height: 18px; }
      }
    }

    /* Edit order form */
    .order-edit-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      min-height: 0;
      margin-bottom: 10px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--crm-surface-base, #0c0b09);
    }

    .order-edit-main {
      min-width: 0;
      padding: 14px 18px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .order-edit-side {
      border-left: 1px solid var(--crm-border);
      background: var(--crm-surface, #131210);
    }

    .edit-section-panel {
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      padding: 12px;
      background: var(--crm-surface, #131210);
    }

    .edit-section-header {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      margin-bottom: 12px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-accent, #f59e0b);
        flex-shrink: 0;
        margin-top: 1px;
      }

      h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      span {
        display: block;
        margin-top: 2px;
        color: var(--crm-text-muted);
        font-size: 11px;
        line-height: 1.35;
      }
    }

    .edit-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-bottom: 10px;

      &:last-child {
        margin-bottom: 0;
      }
    }

    .edit-field-label {
      font-size: 10.5px;
      color: var(--crm-text-muted);
      font-weight: 500;
    }

    .edit-field-hint {
      color: var(--crm-text-muted);
      font-size: 10.5px;
    }

    .edit-input,
    .edit-textarea {
      width: 100%;
      border: 1px solid var(--crm-border);
      border-radius: 6px;
      background: var(--crm-surface-base);
      color: var(--crm-text-primary);
      font: inherit;
      font-size: 13px;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: var(--crm-accent);
        box-shadow: 0 0 0 2px rgba(245,158,11,0.12);
      }

      &::placeholder {
        color: var(--crm-text-muted);
      }
    }

    .edit-input {
      min-height: 34px;
      padding: 7px 10px;
    }

    .edit-select {
      appearance: none;
      cursor: pointer;
    }

    .edit-textarea {
      padding: 8px 10px;
      resize: vertical;
      min-height: 72px;
      line-height: 1.4;
    }

    .edit-textarea--sm {
      min-height: 54px;
    }

    .edit-check {
      display: flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      margin: 4px 0 10px;
      color: var(--crm-text-secondary);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;

      input[type="checkbox"] {
        appearance: none;
        width: 16px;
        height: 16px;
        border: 1.5px solid var(--crm-text-muted);
        border-radius: 3px;
        background: transparent;
        cursor: pointer;
        flex-shrink: 0;
        display: grid;
        place-items: center;

        &:checked {
          background: var(--crm-accent);
          border-color: var(--crm-accent);

          &::after {
            content: '\\2713';
            color: #0a0a0a;
            font-size: 11px;
            font-weight: 700;
          }
        }
      }
    }

    .ocf-panel { padding: 12px 14px; border-bottom: 1px solid var(--crm-border); }
    .ocf-panel--last { border-bottom: none; }
    .ocf-panel-title {
      margin-bottom: 8px;
      color: var(--crm-text-muted);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .ocf-field { margin-bottom: 8px; &:last-child { margin-bottom: 0; } }
    .ocf-field-label {
      display: block;
      margin-bottom: 3px;
      color: var(--crm-text-muted);
      font-size: 10.5px;
      font-weight: 500;
    }
    .ocf-input {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--crm-border);
      border-radius: 6px;
      background: var(--crm-surface-base);
      color: var(--crm-text-primary);
      font: inherit;
      font-size: 13px;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: var(--crm-accent);
        box-shadow: 0 0 0 2px rgba(245,158,11,0.12);
      }

      &::placeholder { color: var(--crm-text-muted); }
    }

    .ocf-priority-options { display: flex; flex-direction: column; gap: 4px; }
    .ocf-priority {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--crm-border);
      border-radius: 6px;
      cursor: pointer;
      transition: all 120ms ease;

      input[type="radio"] {
        appearance: none;
        width: 14px;
        height: 14px;
        border: 1.5px solid var(--crm-text-muted);
        border-radius: 50%;
        flex-shrink: 0;
        display: grid;
        place-items: center;

        &:checked {
          border-color: var(--crm-accent);

          &::after {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--crm-accent);
          }
        }
      }
    }
    .ocf-priority--active { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.06); }
    .ocf-priority-name { font-size: 12.5px; font-weight: 500; }
    .ocf-priority-desc { color: var(--crm-text-muted); font-size: 11px; }

    .ocf-chat-linked {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid rgba(245,158,11,0.2);
      border-radius: 6px;
      background: rgba(245,158,11,0.06);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-accent);
      }
    }
    .ocf-chat-linked-info { flex: 1; min-width: 0; }
    .ocf-chat-linked-name {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 500;
    }
    .ocf-chat-linked-hint { color: var(--crm-text-muted); font-size: 10.5px; }
    .ocf-chat-unlink,
    .edit-chat-icon-btn {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--crm-text-muted);
      cursor: pointer;
      display: grid;
      place-items: center;
      flex-shrink: 0;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:hover { color: var(--crm-accent); }
    }
    .ocf-chat-unlink:hover { color: #ef4444; }
    .ocf-link-chat-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 8px 10px;
      border: 1px dashed var(--crm-border);
      border-radius: 6px;
      background: transparent;
      color: var(--crm-text-secondary);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 120ms ease;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:hover {
        border-color: var(--crm-accent);
        background: rgba(245,158,11,0.04);
        color: var(--crm-accent);
      }
    }

    .edit-save-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }
    .edit-save {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-width: 0;
      padding: 9px;
      border: 1px solid var(--crm-border);
      border-radius: 6px;
      background: var(--crm-surface-base);
      color: var(--crm-text-secondary);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 120ms ease;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      &:hover:not(:disabled) {
        border-color: var(--crm-accent);
        color: var(--crm-accent);
      }

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
    }
    .edit-save--primary {
      grid-column: 1 / -1;
      padding: 11px;
      border-color: var(--crm-accent);
      background: var(--crm-accent, #f59e0b);
      color: #0a0a0a;
      font-size: 13px;
      font-weight: 600;

      &:hover:not(:disabled) {
        background: #fbbf24;
        color: #0a0a0a;
      }
    }

    .ocf-popup-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.5);
    }
    .ocf-popup {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 1001;
      width: min(440px, calc(100vw - 32px));
      max-height: min(520px, calc(100vh - 32px));
      border: 1px solid var(--crm-border);
      border-radius: 12px;
      background: var(--crm-surface, #131210);
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
    }
    .ocf-popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--crm-border);
    }
    .ocf-popup-title {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .ocf-popup-close {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--crm-text-muted);
      cursor: pointer;
      display: grid;
      place-items: center;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        background: rgba(255,255,255,0.06);
        color: var(--crm-text-primary);
      }
    }
    .ocf-popup-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--crm-border);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-muted);
        flex-shrink: 0;
      }
    }
    .ocf-popup-search-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      color: var(--crm-text-primary);
      font: inherit;
      font-size: 13px;

      &::placeholder { color: var(--crm-text-muted); }
    }
    .ocf-popup-list {
      flex: 1;
      overflow-y: auto;
      scrollbar-width: thin;
    }
    .ocf-popup-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: 100%;
      padding: 10px 16px;
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      background: transparent;
      color: var(--crm-text-secondary);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: background 80ms ease;

      &:hover {
        background: rgba(245,158,11,0.06);
        color: var(--crm-text-primary);
      }

      &:last-child { border-bottom: none; }
    }
    .ocf-popup-item-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .ocf-popup-item-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .ocf-popup-item-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .ocf-popup-item-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary);
    }
    .ocf-popup-item-time {
      font-size: 10px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }
    .ocf-popup-item-sub {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .ocf-popup-item-badge {
      font-size: 10px;
      font-weight: 600;
      line-height: 1;
      padding: 2px 6px;
      border: 1px solid;
      border-radius: 4px;
      opacity: 0.9;
      white-space: nowrap;
    }
    .ocf-popup-item-phone {
      font-size: 11px;
      color: var(--crm-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .ocf-popup-item-preview {
      font-size: 11px;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.8;
    }
    .ocf-popup-item-meta { color: var(--crm-text-muted); font-size: 11px; }
    .ocf-popup-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 32px 16px;
      color: var(--crm-text-muted);
      font-size: 13px;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    @media (max-width: 900px) {
      .order-edit-layout {
        grid-template-columns: 1fr;
      }

      .order-edit-side {
        border-left: none;
        border-top: 1px solid var(--crm-border);
      }
    }

    /* Secondary actions */
    .secondary-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 10px; }
    .danger-action {
      color: var(--crm-status-error) !important;
      border-color: color-mix(in srgb, var(--crm-status-error) 42%, transparent) !important;
      mat-icon { color: var(--crm-status-error); }
    }

    /* Comments */
    .comments-text { margin: 0; font-size: var(--crm-text-md); white-space: pre-wrap; }

    /* Retouch */
    .section-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-text-muted); flex-shrink: 0; }
    .retouch-info { display: flex; flex-direction: column; gap: 4px; }
    .retouch-info .label { color: var(--crm-text-muted); font-size: var(--crm-text-sm); }

    /* Task card */
    .task-card { border-left: 3px solid var(--crm-primary); }
    .task-card--prominent {
      border-left-width: 4px;
      background: color-mix(in srgb, var(--crm-primary) 4%, var(--crm-surface));
    }
    .task-instructions { margin-top: 8px; padding: 8px 0; border-top: 1px solid var(--crm-border-subtle); }
    .task-instructions:first-of-type { border-top: none; padding-top: 4px; }
    .task-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--crm-text-secondary); margin-bottom: 4px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
    .task-label mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .task-label--with-action {
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .task-label--with-action span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .document-crop-btn {
      min-height: 28px;
      padding: 0 9px;
      font-size: 11px;
      line-height: 26px;
      text-transform: none;
      letter-spacing: 0;
    }
    .document-crop-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-right: 4px;
    }
    .task-instructions--document .task-label { color: var(--crm-accent, #4a90e2); }
    .task-instructions--medals .task-label { color: var(--crm-status-warning, #e0a030); }
    .task-instructions--uniform .task-label { color: var(--crm-primary); }
    .task-instructions--excluded {
      background: var(--crm-status-error-muted, rgba(220, 53, 69, .08));
      border-radius: 6px;
      padding: 8px 10px;
      margin-top: 8px;
    }
    .task-instructions--excluded .task-label { color: var(--crm-status-error, #dc3545); }
    .task-instructions--super-retouch .task-label { color: var(--crm-primary); }
    .rc-group { margin-top: 6px; }
    .rc-group:first-of-type { margin-top: 2px; }
    .rc-group-name { font-size: 12px; font-weight: 600; color: var(--crm-text-secondary); margin-bottom: 3px; }
    .rc-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .rc-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      background: color-mix(in srgb, var(--crm-primary) 10%, var(--crm-surface));
      color: var(--crm-text-primary);
      border: 1px solid var(--crm-border-subtle);
    }
    .excluded-list { margin: 4px 0 0; padding-left: 18px; font-size: 13px; color: var(--crm-text-primary); }
    .excluded-list li { margin: 2px 0; }
    .excluded-item { color: var(--crm-text-secondary); font-size: 12px; }
    .form-samples-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 6px;
      margin-top: 6px;
    }
    .form-sample-thumb {
      display: block;
      aspect-ratio: 1;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--crm-border-subtle);
      transition: transform .12s ease;
    }
    .form-sample-thumb:hover { transform: scale(1.04); }
    .form-sample-thumb img { width: 100%; height: 100%; object-fit: cover; }

    /* Ready forms */
    .ready-form-panel {
      margin-bottom: 8px;
      border-left: 3px solid var(--crm-primary);
    }

    .ready-form-panel mat-panel-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-primary);
      }
    }

    /* Production */
    .production-section { margin: 10px 0; display: flex; flex-direction: column; gap: 5px; }
    .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--crm-text-secondary); font-weight: 600; margin-bottom: 2px; }
    .production-chip {
      display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
      border-radius: 14px; background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
      color: var(--crm-accent); font-size: 12px; font-weight: 500;
      border: 1px solid color-mix(in srgb, var(--crm-accent) 30%, transparent);
      cursor: pointer; width: fit-content; transition: background 0.15s;
      mat-icon { font-size: 13px; width: 13px; height: 13px; }
      &:hover { background: color-mix(in srgb, var(--crm-accent) 22%, transparent); }
    }

    /* Print history */
    .print-history-panel { margin-bottom: 8px; }
    .print-history-panel mat-panel-title {
      display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }
    .pj-count {
      font-size: 11px; background: var(--crm-accent); color: #fff;
      border-radius: 10px; padding: 0 6px; line-height: 18px;
    }
    .pj-empty { font-size: 13px; color: var(--crm-text-muted); padding: 8px 0; }
    .pj-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 0;
      border-bottom: 1px solid var(--crm-border);
      &:last-child { border-bottom: none; }
    }
    .pj-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pj-file {
      font-size: 13px; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pj-meta { font-size: 11px; color: var(--crm-text-muted); }
    .pj-status {
      font-size: 11px; padding: 1px 8px; border-radius: 10px; font-weight: 500; white-space: nowrap;
    }
    .pjs-queued { background: var(--crm-surface-raised); color: var(--crm-text-secondary); }
    .pjs-sending, .pjs-printing { background: var(--crm-status-info-muted); color: var(--crm-status-info); }
    .pjs-completed { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .pjs-failed { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    .pjs-cancelled { background: var(--crm-surface-raised); color: var(--crm-text-muted); }
    .pj-date { font-size: 11px; color: var(--crm-text-muted); white-space: nowrap; }

    /* Meta footer */
    .meta-footer { font-size: 11px; color: var(--crm-text-muted); margin-top: 8px; }

    .info-card ::ng-deep app-approval-upload-panel .panel-content { padding: 0; }

    /* ── Компактная раскладка панели заказа ──────────────────────────────────
       Корень «пустоты»: дефолтный паддинг mat-card-content (~16px со всех сторон)
       на каждой карточке + разнобой margin-bottom у прямых детей. Единый ритм
       через gap у контейнера + ужатый паддинг карточек. Правила идут ПОСЛЕ
       конфликтующих (.info-card и т.п.), чтобы выигрывать при равной специфичности. */
    .order-detail { display: flex; flex-direction: column; gap: 8px; }
    /* Зануляем И верх, И низ: единственный источник вертикального ритма это gap.
       (иначе margin-top у delivery/production/meta-footer протекал бы поверх gap.) */
    .order-detail > * { margin-top: 0; margin-bottom: 0; }
    .info-card ::ng-deep .mat-mdc-card-content { padding: 10px 12px; }
    .info-card ::ng-deep .mat-mdc-card-content:last-child { padding-bottom: 10px; }
    /* Виджет согласования несёт свой внутренний паддинг — снимаем двойной (включая
       низ: хелпер :last-child выше иначе вернул бы 10px из-за большей специфичности). */
    .approval-card ::ng-deep .mat-mdc-card-content,
    .approval-card ::ng-deep .mat-mdc-card-content:last-child { padding: 0; }

    /* Доставка/опции, влитые в конец «Состава заказа» (из бывшей карточки «Детали»). */
    .order-meta-extra { border-top: 1px solid var(--crm-border, rgba(255,255,255,.08)); margin-top: 6px; padding-top: 6px; }

    /* Свёрнутый блок «Фото из чата» внутри карточки исходных фото. */
    .chat-photos-panel { box-shadow: none; background: transparent; margin-top: 6px; }
    .chat-photos-panel ::ng-deep .mat-expansion-panel-header { padding: 0 8px; height: 36px; }
    .chat-photos-panel ::ng-deep .mat-expansion-panel-body { padding: 0 8px 8px; }
    .chat-photos-actions { display: flex; justify-content: flex-end; margin-bottom: 6px; }

    /* Промокод компактной строкой (сумма заказа не дублируется отдельным блоком). */
    .promo-line { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--crm-text-muted);
      mat-icon { font-size: 15px; width: 15px; height: 15px; } }
    .paid-amount { font-weight: 700; font-family: var(--crm-font-mono, monospace); margin-left: 4px; }

    /* ── Двухколоночная раскладка при широкой панели ───────────────────────────
       Цель: заказ помещается в один экран без вертикальной простыни. Слева —
       «что делать» (задание, исходники, состав), справа — «действия и статус»
       (согласование, оплата, статус работы, контакты, печать). Класс .od-wide
       выставляет ResizeObserver по фактической ширине панели (контейнерный
       CSS-запрос нельзя — contain:layout сломал бы position:fixed лайтбокс). */
    .od-cols { display: flex; flex-direction: column; gap: 8px; }
    .od-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    /* Внутри колонок единственный источник ритма — gap, поэтому снимаем
       margin-bottom карточек (иначе двойной зазор). Идёт после .info-card и т.п. */
    .od-col > * { margin-bottom: 0; }
    .od-wide .od-cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: start;
      column-gap: 12px;
      row-gap: 8px;
    }
  `],
})
export class OrderDetailPanelComponent {
  private readonly ordersApi = inject(OrdersApiService);
  private readonly tasksApi = inject(TasksApiService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly http = inject(HttpClient);
  private readonly printApi = inject(PrintApiService);
  private readonly productionApi = inject(ProductionApiService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly snackBar = inject(MatSnackBar);
  private readonly wsService = inject(WebSocketService);
  private readonly photoWorkspaceApi = inject(PhotoWorkspaceApiService);
  private readonly retouchApi = inject(RetouchApiService);
  private readonly quickPrintService = inject(QuickPrintService);
  readonly dashboardData = inject(DashboardDataService);
  protected readonly canManageReadyForms = this.authService.isAdmin;

  orderId = input.required<string>();
  clientPhoneResolved = output<string>();
  clientUserIdResolved = output<string>();
  chatSessionResolved = output<string | null>();
  photoWorkspaceFocusChange = output<boolean>();

  order = signal<PhotoPrintOrder | null>(null);
  /** Панель достаточно широкая для двухколоночной раскладки (≥ 720px). */
  panelWide = signal(false);
  loading = signal(false);
  editing = signal(false);
  downloadingPrintArchive = signal(false);
  photoWorkspaceOpen = signal(false);
  workspaceInitialSource = signal<CropSourcePhoto | null>(null);
  saving = signal(false);
  deleting = signal(false);
  chatLinkEditing = signal(false);
  chatLinkSaving = signal(false);
  showEditChatPickerPopup = signal(false);
  editChatSearchResults = signal<OrderEditChatSearchResult[]>([]);
  editLinkedSessionName = signal<string | null>(null);
  chatLinkInput = '';
  private readonly editChatSearch$ = new Subject<string>();
  employees = signal<Employee[]>([]);
  editData: EditData = {
    contact_name: '', contact_phone: '', contact_email: '',
    delivery_address: '', comments: '', tracking_number: '', priority: 'normal', chat_session_id: '',
    document_template_id: null, photo_size: '',
    wishes: '', medals_required: false, medals_description: '', uniform_description: '',
    itemDisabledFeatures: new Map(),
  };

  /** Revision counter — bumps when itemDisabledFeatures mutated (для computed). */
  private readonly editDisabledRev = signal(0);

  productionOrders = signal<ProductionOrder[]>([]);
  clientPhotos = signal<ClientPhoto[]>([]);
  orderAttachments = signal<OrderAttachment[]>([]);
  formAttachments = computed(() =>
    this.orderAttachments().filter(a => a.attachment_type === 'form_sample'),
  );

  // Print history
  printJobs = signal<PrintJob[]>([]);
  printJobsLoading = signal(false);

  // F109: Reminder state
  reminderSending = signal(false);
  reminderCooldown = signal(0); // minutes remaining

  // F110: Mark-paid state
  markPaidSending = signal(false);

  // UX: Inline payment confirmation when completing unpaid order
  showPaymentConfirm = signal(false);

  // Retouch task for this order
  retouchTask = signal<RetouchTask | null>(null);
  photoWorkspace = signal<PhotoWorkspaceEnvelopeDto[]>([]);
  approvalRefreshKey = signal(0);

  readonly excludedFeatures = computed((): { name: string; itemName: string }[] => {
    const items = this.order()?.items;
    if (!Array.isArray(items)) return [];
    const out: { name: string; itemName: string }[] = [];
    for (const it of items) {
      const disabled = it.disabled_features ?? [];
      if (!disabled.length) continue;
      const label = it.name || it.service || it.tariff || '';
      for (const name of disabled) out.push({ name, itemName: label });
    }
    return out;
  });

  readonly retouchLevelLabel = computed(() => {
    switch (this.retouchTask()?.retouch_level) {
      case 'basic': return 'Базовая';
      case 'extended': return 'Расширенная';
      case 'maximum': return 'Максимальная';
      case 'super': return 'Супер обработка';
      default: return '';
    }
  });

  readonly workspaceCounters = computed(() => photoWorkspaceCounters(
    this.photoWorkspace().map(envelope => ({
      id: envelope.item.id,
      variants: envelope.variants,
    })),
  ));

  readonly workspaceIndicators = computed<WorkspaceIndicator[]>(() => {
    if (!this.photoWorkspace().length) return [];
    const counters = this.workspaceCounters();
    const indicators: WorkspaceIndicator[] = [];
    if (counters.aiTotal > 0) {
      indicators.push({ label: `AI: ${counters.aiDone}/${counters.aiTotal} вариантов`, tone: 'neutral' });
    }
    if (counters.aiErrors > 0) {
      indicators.push({ label: `AI: ошибка в ${counters.aiErrors} варианте`, tone: 'error' });
    }
    if (counters.photoshopWaiting > 0) {
      indicators.push({ label: 'Photoshop: ждет проверки', tone: 'warning' });
    }
    if (counters.readyToSend > 0) {
      indicators.push({ label: `Готово к отправке: ${counters.readyToSend}`, tone: 'success' });
    }
    return indicators;
  });

  readonly timer = inject(DeadlineTimerService);
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  readonly orderStatusLabel = orderStatusLabel;
  readonly paymentStatusLabel = paymentStatusLabel;
  readonly paymentStatusIcon = paymentStatusIcon;
  readonly formatRelativeTime = formatRelativeTime;
  readonly channelIcon = channelIcon;
  readonly channelLabel = channelLabel;
  readonly channelColor = channelColor;

  assignedName = computed(() => {
    const o = this.order();
    if (!o?.assigned_employee_id) return '';
    const emp = this.employees().find(e => e.id === o.assigned_employee_id);
    return emp?.display_name || o.assigned_employee_name || 'Сотрудник';
  });

  printableItems = computed(() =>
    (this.order()?.items ?? []).filter(i => !!i.uploadedUrl)
  );

  /**
   * Исходные фото, реально ПРИКРЕПЛЁННЫЕ К ЗАКАЗУ (а не присланные клиентом в чат):
   * вложения заказа (кроме form_sample, они в «Задании»), загруженные файлы позиций
   * и исходник задачи ретуши. Дедуп по url обязателен (uploadedUrl и source ретуши
   * часто совпадают). Чат-фото сюда НЕ входят (они в свёрнутом блоке «Из чата»).
   */
  orderSourcePhotos = computed<{ url: string; name: string }[]>(() => {
    const out: { url: string; name: string }[] = [];
    const seen = new Set<string>();
    const push = (url: string | null | undefined, name: string): void => {
      if (url && !seen.has(url)) { seen.add(url); out.push({ url, name }); }
    };
    for (const a of this.orderAttachments()) {
      if (a.attachment_type !== 'form_sample') push(a.s3_url, a.file_name || 'Фото');
    }
    for (const it of this.printableItems()) {
      push(it.uploadedUrl, it.name || it.service || 'Файл заказа');
    }
    push(this.retouchTask()?.source_photo_url, 'Исходник ретуши');
    return out;
  });

  printablePrintCount = computed(() =>
    this.printableItems().reduce((sum, item) => sum + this.itemQuantity(item), 0)
  );

  printableFilesSummary = computed(() => {
    const items = this.printableItems();
    if (!items.length) return 'Нет загруженных файлов';

    const formats = [...new Set(items
      .map(item => [this.getFormatLabel(item.format), this.paperTypeLabel(item.paperType)]
        .filter(Boolean)
        .join(' · '))
      .filter(label => label.length > 0))];
    const parts: string[] = [];

    if (formats.length === 1) {
      parts.push(formats[0]!);
    } else if (formats.length > 1) {
      parts.push(`${formats.length} формата`);
    } else {
      parts.push('Фото для печати');
    }

    return parts.join(' · ');
  });

  otherItems = computed(() =>
    (this.order()?.items ?? []).filter(i => !i.uploadedUrl)
  );

  orderMeta = computed<ParsedOrderMeta>(() => {
    const c = this.order()?.comments;
    if (!c) return {};
    try {
      const parsed = JSON.parse(c);
      if (typeof parsed === 'object' && parsed !== null &&
          (parsed['tariff'] || parsed['document'] || parsed['sessionId'] || parsed['service'])) {
        const meta: ParsedOrderMeta = {
          service: parsed['service'] || undefined,
          tariff: parsed['tariff'] || undefined,
          document: parsed['document'] || undefined,
          deliveryPickup: parsed['delivery']?.['pickup'] || undefined,
          deliveryProduction: parsed['delivery']?.['production'] || undefined,
          deliveryMethod: parsed['delivery_method'] || undefined,
          printAddon: parsed['printAddon'] || undefined,
          deliveryAddress: parsed['deliveryAddress'] || undefined,
          selectedOptions: parsed['selectedOptions'] || undefined,
        };
        return meta;
      }
    } catch { /* не JSON */ }
    return { rawComment: c };
  });

  // Уникальные поля доставки/опций (показываются в конце «Состава заказа»).
  // service/tariff/document намеренно НЕ включены: они уже есть в «Задании» и «Составе».
  hasDeliveryMeta = computed(() => {
    const m = this.orderMeta();
    return !!(m.deliveryPickup || m.deliveryProduction || (m.deliveryMethod && m.deliveryMethod !== 'pickup') || m.printAddon || m.selectedOptions);
  });

  optionEntries = computed(() => {
    const opts = this.orderMeta().selectedOptions;
    if (!opts) return [];
    const labels: Record<string, string> = {
      speed: 'Срочность', retouch: 'Ретушь', size: 'Размер',
      quantity: 'Количество', format: 'Формат', copies: 'Копии',
    };
    return Object.entries(opts)
      .filter(([, values]) => Array.isArray(values) && values.length > 0)
      .map(([key, values]) => ({ key, label: labels[key] || key, values: values as string[] }));
  });

  // Deadline helpers (delegated to shared DeadlineTimerService)
  deadlineLabel = computed(() => {
    const d = this.order()?.deadline;
    if (this.timer.isOverdue(d)) return 'Просрочен на';
    if (this.timer.isWarning(d)) return 'Осталось';
    return 'До готовности';
  });

  escalationLevel = computed(() => this.order()?.escalation_level ?? 0);

  private readonly loadEffect = effect(() => {
    const id = this.orderId();
    if (id) this.loadOrder(id);
  });

  private readonly orderUpdatedEffect = effect(() => {
    const evt = this.wsService.orderEvent();
    if (!evt || (evt.event !== 'order:updated' && evt.event !== 'order:status-changed')) return;

    untracked(() => {
      const currentId = this.orderId();
      if (!currentId) return;

      const updatedOrderId = evt.data?.['orderId'];
      if (typeof updatedOrderId !== 'string' || updatedOrderId !== currentId) return;

      if (this.editing()) return;

      this.loadOrder(currentId);
    });
  });

  private readonly photoWorkspaceEventEffect = effect(() => {
    const evt = this.wsService.photoWorkspaceEvent();
    if (!evt) return;

    untracked(() => {
      const currentOrder = this.order();
      if (!currentOrder || evt.orderId !== currentOrder.id) return;
      this.loadPhotoWorkspace(currentOrder.id);
      if (evt.event === 'photo-workspace:approval-updated') {
        this.approvalRefreshKey.update(value => value + 1);
      }
    });
  });

  constructor() {
    this.tasksApi.getEmployees().subscribe({
      next: (res) => {
        if (res.success && res.data) this.employees.set(res.data);
      },
    });

    this.editChatSearch$.pipe(
      debounceTime(300),
      switchMap(query => {
        const trimmed = query.trim();
        const params: Record<string, string> = { types: 'chat', limit: '20' };
        if (trimmed.length >= 2) params['search'] = trimmed;
        return this.http.get<{ success: boolean; data: OrderEditChatSearchResult[] }>(
          '/api/crm/inbox',
          { params },
        ).pipe(catchError(() => {
          const emptyResponse: { success: boolean; data: OrderEditChatSearchResult[] } = {
            success: false,
            data: [],
          };
          return of(emptyResponse);
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(res => this.editChatSearchResults.set(res.data ?? []));

    if (isPlatformBrowser(this.platformId)) {
      this.destroyRef.onDestroy(() => {
        if (this.cooldownTimer) clearInterval(this.cooldownTimer);
      });

      // Двухколоночная раскладка зависит от фактической ширины ПАНЕЛИ, а не вьюпорта
      // (панель бывает узкой центральной колонкой или раскрытой на всю ширину).
      // Контейнерный CSS-запрос не годится: container-type ⇒ contain:layout ломает
      // position:fixed лайтбокс согласования. Поэтому меряем ширину наблюдателем.
      afterNextRender(() => {
        const el = this.host.nativeElement as HTMLElement;
        const apply = (w: number) => this.panelWide.set(w >= 720);
        apply(el.clientWidth);
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(entries => {
          const w = entries[0]?.contentRect.width ?? el.clientWidth;
          apply(w);
        });
        ro.observe(el);
        this.destroyRef.onDestroy(() => ro.disconnect());
      });
    }
  }

  extractOrderNum(orderId: string): string {
    const last = orderId.split('-').pop() || '';
    return /^\d+$/.test(last) ? `#${last}` : `#${orderId.slice(-8)}`;
  }

  isFinished(): boolean {
    const s = this.order()?.status;
    return s === 'completed' || s === 'cancelled';
  }

  // ─── Степпер статусов работы ──────────────────────────────────────────────
  readonly workSteps = [
    { idx: 0, label: 'Новый' },
    { idx: 1, label: 'В работе' },
    { idx: 2, label: 'Готов' },
    { idx: 3, label: 'Завершён' },
  ] as const;

  /** Статус последней сессии согласования — источник плашки «На доработке». */
  readonly lastApprovalStatus = signal<string | null>(null);

  /** Клиент запросил правки: показываем красную плашку, прячем подсказку. */
  readonly revisionRequested = computed<boolean>(() => {
    const s = this.lastApprovalStatus();
    return s === 'changes_requested' || s === 'partially_approved';
  });

  /** Индекс активного шага по статусу заказа (cancelled = -1, не на шкале). */
  readonly workStep = computed<number>(() => {
    switch (this.order()?.status) {
      case 'processing': return 1;
      case 'ready': return 2;
      case 'completed': return 3;
      case 'cancelled': return -1;
      default: return 0; // new / paid / pending / pending_payment
    }
  });

  /** Следующее действие по шкале (одна кнопка). null — двигаться некуда. */
  readonly nextAction = computed<{ status: string; label: string; icon: string } | null>(() => {
    switch (this.workStep()) {
      case 0: return { status: 'processing', label: 'Принять в работу', icon: 'play_arrow' };
      case 1: return { status: 'ready', label: 'Отметить «Готов»', icon: 'done' };
      case 2: return { status: 'completed', label: 'Завершить заказ', icon: 'check_circle' };
      default: return null; // completed / cancelled
    }
  });

  doNextAction(status: string): void {
    this.changeStatus(status);
  }

  /**
   * Виджет согласования сообщил об изменении (загрузка / переотправка / ответ клиента).
   * Статус заказа мог автоматически перейти на бэке (Готов / Завершён / На доработке) —
   * перечитываем заказ, чтобы степпер и плашка отразили актуальное состояние.
   */
  onApprovalUpdated(status: string | null): void {
    const changed = status !== this.lastApprovalStatus();
    this.lastApprovalStatus.set(status);
    if (this.editing()) return;
    // Перечитываем заказ ТОЛЬКО когда статус согласования реально изменился.
    // Виджет эмитит approvalUpdated и при первичной (пассивной) загрузке —
    // без этой проверки получался бы цикл emit → loadOrder → ремаунт виджета → emit.
    if (!changed) return;
    const id = this.orderId();
    if (id) this.loadOrder(id);
  }

  openDocumentCrop(): void {
    const source = this.findDocumentCropSource();
    if (!source) {
      this.toast.error('Нет исходного фото для кадрирования');
      return;
    }
    this.workspaceInitialSource.set(source);
    this.photoWorkspaceOpen.set(true);
    this.photoWorkspaceFocusChange.emit(true);
  }

  closePhotoWorkspace(): void {
    this.photoWorkspaceOpen.set(false);
    this.photoWorkspaceFocusChange.emit(false);
  }

  onWorkspaceApprovalChanged(): void {
    this.approvalRefreshKey.update((value) => value + 1);
  }

  private findDocumentCropSource(): CropSourcePhoto | null {
    const source = this.orderSourcePhotos()[0];
    if (source) return source;

    const orderPhoto = this.order()?.photo_url;
    if (orderPhoto) {
      return { url: orderPhoto, name: 'Фото заказа' };
    }

    const chatPhoto = this.clientPhotos()[0];
    if (chatPhoto) {
      return { url: chatPhoto.attachment_url, name: 'Фото из чата' };
    }

    return null;
  }
  openPaymentDialog(): void {
    const o = this.order();
    if (!o) return;

    import('../payment-dialog/payment-dialog.component').then(m => {
      const data: PaymentDialogData = {
        mode: 'order',
        phone: o.contact_phone || '',
        clientName: o.contact_name || '',
        orderId: o.order_id,
        printOrderId: o.id,
        totalPrice: o.total_price,
      };

      this.dialog.open(m.PaymentDialogComponent, {
        width: 'calc(100vw - 24px)',
        maxWidth: '100vw',
        height: 'calc(100vh - 24px)',
        maxHeight: '100vh',
        panelClass: 'payment-dialog-panel',
        data,
      }).afterClosed().subscribe((result: PaymentDialogResult | undefined) => {
        if (!result || result.type === 'cancelled') return;

        if (result.type === 'cash' || result.type === 'card' || result.type === 'sbp') {
          this.toast.success('Оплата принята');
          this.refreshOrder();
        } else if (result.type === 'sent' || result.type === 'copied') {
          this.toast.success('Ссылка на оплату создана');
        }
      });
    });
  }

  repeatOrder(): void {
    const o = this.order();
    if (!o?.items?.length) return;

    const prefillSlugs = o.items
      .filter(item => !!item.slug)
      .map(item => ({
        slug: item.slug!,
        quantity: item.quantity ?? 1,
      }));

    import('../payment-dialog/payment-dialog.component').then(m => {
      const data: PaymentDialogData = {
        mode: 'chat',
        phone: o.contact_phone || '',
        clientName: o.contact_name || '',
        sessionId: o.chat_session_id || undefined,
        ...(prefillSlugs.length > 0 ? { prefillSlugs } : { totalPrice: o.total_price }),
      };

      this.dialog.open(m.PaymentDialogComponent, {
        width: 'calc(100vw - 24px)',
        maxWidth: '100vw',
        height: 'calc(100vh - 24px)',
        maxHeight: '100vh',
        panelClass: 'payment-dialog-panel',
        data,
      }).afterClosed().subscribe((result: PaymentDialogResult | undefined) => {
        if (result && result.type !== 'cancelled') {
          this.toast.success('Повторный заказ создан');
        }
      });
    });
  }

  refreshOrder(): void {
    this.loadOrder(this.orderId());
  }

  /** id заказа, для которого уже отрисованы данные (чтобы скелет не мигал при тихих обновлениях). */
  private loadedOrderKey: string | null = null;

  private loadOrder(id: string): void {
    // Скелет показываем ТОЛЬКО при первичной загрузке заказа (или смене заказа).
    // При тихих обновлениях (WS order:updated, согласование) переключение
    // loading=true уничтожало бы ветку @else if (order()) вместе с виджетом
    // согласования, тот при ремаунте снова эмитил approvalUpdated → loadOrder →
    // бесконечный цикл и мерцание. Тихое обновление просто заменяет данные.
    if (this.loadedOrderKey !== id || !this.order()) {
      this.loading.set(true);
    }
    this.editing.set(false);
    this.chatLinkEditing.set(false);
    this.showEditChatPickerPopup.set(false);
    this.editChatSearchResults.set([]);
    this.editLinkedSessionName.set(null);
    this.chatLinkInput = '';
    this.ordersApi.getOrders({ search: id, limit: 1 }).subscribe({
      next: (res) => {
        if (res.success && res.data?.length) {
          const o = res.data[0];
          this.order.set(o);

          // Restore reminder cooldown from server-side timestamp (survives page reload)
          if (o.reminder_sent_at && o.payment_status !== 'paid') {
            const elapsed = Date.now() - new Date(o.reminder_sent_at).getTime();
            const remainingMs = 60 * 60 * 1000 - elapsed;
            if (remainingMs > 0) this.startCooldown(Math.ceil(remainingMs / 60_000));
          }

          if (o.resolved_user_id) {
            this.clientUserIdResolved.emit(o.resolved_user_id);
          } else {
            const phone = o.contact_phone || o.resolved_phone;
            if (phone) this.clientPhoneResolved.emit(phone);
          }

          // Emit chat session ID for workspace to switch left panel
          this.chatSessionResolved.emit(o.chat_session_id || null);

          // Load client photos if chat is linked
          if (o.chat_session_id) {
            this.loadClientPhotos(o.chat_session_id);
          } else {
            this.clientPhotos.set([]);
          }

          this.productionApi.getOrdersByPhotoOrder(o.id).subscribe({
            next: orders => this.productionOrders.set(orders),
            error: () => this.productionOrders.set([]),
          });
          this.loadPhotoWorkspace(o.id);
        } else {
          this.productionOrders.set([]);
          this.photoWorkspace.set([]);
        }
        this.loadedOrderKey = id;
        this.loading.set(false);
        this.loadPrintJobs(id);
        this.loadRetouchTask(id);
        this.loadOrderAttachments(id);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить заказ');
      },
    });
  }

  private loadClientPhotos(sessionId: string): void {
    this.http.get<{ success: boolean; data: { id: string; attachment_url: string; created_at: string; sender_type: string; message_type: string }[] }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages`
    ).subscribe({
      next: res => {
        if (res.success) {
          const photos = (res.data ?? [])
            .filter(m => m.message_type === 'image' && m.sender_type === 'visitor' && m.attachment_url)
            .map(m => ({ id: m.id, attachment_url: m.attachment_url, created_at: m.created_at }));
          this.clientPhotos.set(photos);
        }
      },
      error: () => this.clientPhotos.set([]),
    });
  }

  private loadOrderAttachments(orderId: string): void {
    this.ordersApi.getOrderAttachments(orderId).subscribe({
      next: res => {
        if (res.success) this.orderAttachments.set(res.data ?? []);
      },
      error: () => this.orderAttachments.set([]),
    });
  }

  openProductionOrder(orderId: string): void {
    void this.router.navigate(['/employee/production'], { queryParams: { orderId } });
  }

  startEdit(): void {
    const o = this.order();
    if (!o) return;
    const itemDisabled = new Map<string, Set<string>>();
    for (const item of o.items || []) {
      if (!item.id) continue;
      const disabled = new Set<string>(item.disabled_features ?? []);
      if (disabled.size > 0) itemDisabled.set(item.id, disabled);
    }
    this.editData = {
      contact_name: o.contact_name || '',
      contact_phone: o.contact_phone || '',
      contact_email: o.contact_email || '',
      delivery_address: o.delivery_address || '',
      comments: o.comments || '',
      tracking_number: o.tracking_number || '',
      priority: o.priority || 'normal',
      chat_session_id: o.chat_session_id || '',
      document_template_id: o.document_template_id ?? null,
      photo_size: o.photo_size || '',
      wishes: o.wishes || '',
      medals_required: !!o.medals_required,
      medals_description: o.medals_description || '',
      uniform_description: o.uniform_description || '',
      itemDisabledFeatures: itemDisabled,
    };
    this.editDisabledRev.set(0);
    this.editLinkedSessionName.set(o.chat_session_id ? (o.contact_name || o.contact_phone || 'Чат клиента') : null);
    this.showEditChatPickerPopup.set(false);
    this.editChatSearchResults.set([]);
    this.dashboardData.loadDocumentTemplates();
    this.editing.set(true);
  }

  setDocumentTemplate(templateId: string | null): void {
    this.editData.document_template_id = templateId;
    this.onTemplateChange(templateId);
  }

  onTemplateChange(templateId: string | null): void {
    const map = this.dashboardData.documentTemplatesById();
    const t = templateId ? map.get(templateId) : null;
    if (t && t.default_media_size && !this.editData.photo_size.trim()) {
      this.editData.photo_size = t.default_media_size;
    }
  }

  cancelEdit(): void {
    this.closeEditChatPicker();
    this.editLinkedSessionName.set(null);
    this.editing.set(false);
  }

  inputValue(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement ? target.value : '';
  }

  openEditChatPicker(): void {
    this.showEditChatPickerPopup.set(true);
    this.editChatSearch$.next('');
  }

  closeEditChatPicker(): void {
    this.showEditChatPickerPopup.set(false);
    this.editChatSearchResults.set([]);
  }

  searchEditChats(query: string): void {
    this.editChatSearch$.next(query);
  }

  selectEditChatFromSearch(chat: OrderEditChatSearchResult): void {
    this.editData = applyOrderEditChatSelection(this.editData, chat);
    this.editLinkedSessionName.set(this.chatSearchResultLabel(chat));
    this.closeEditChatPicker();
  }

  unlinkEditChat(): void {
    this.editData = { ...this.editData, chat_session_id: '' };
    this.editLinkedSessionName.set(null);
  }

  editLinkedChatLabel(): string {
    const linkedName = this.editLinkedSessionName();
    if (linkedName) return linkedName;
    const name = this.editData.contact_name.trim();
    if (name) return name;
    const phone = this.editData.contact_phone.trim();
    if (phone) return phone;
    return 'Чат клиента';
  }

  shortEditChatId(): string {
    const id = this.editData.chat_session_id.trim();
    if (!id) return '';
    return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
  }

  private chatSearchResultLabel(chat: OrderEditChatSearchResult): string {
    return chat.clientName || chat.clientPhone || 'Чат клиента';
  }

  linkedChatLabel(): string {
    return this.order()?.chat_session_id || 'Не привязан';
  }

  openLinkedChat(): void {
    const sessionId = this.order()?.chat_session_id;
    if (sessionId) this.chatSessionResolved.emit(sessionId);
  }

  startChatLinkEdit(): void {
    this.chatLinkInput = this.order()?.chat_session_id || '';
    this.chatLinkEditing.set(true);
  }

  cancelChatLinkEdit(): void {
    this.chatLinkInput = '';
    this.chatLinkEditing.set(false);
  }

  saveChatLink(): void {
    const o = this.order();
    if (!o || this.chatLinkSaving()) return;

    const nextSessionId = this.chatLinkInput.trim() || null;
    if ((o.chat_session_id || null) === nextSessionId) {
      this.chatLinkEditing.set(false);
      return;
    }

    this.updateChatLink(nextSessionId);
  }

  confirmUnlinkChat(): void {
    const o = this.order();
    if (!o?.chat_session_id) return;

    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Отвязать чат?',
        message: `Заказ ${o.order_id} больше не будет привязан к текущему чату.`,
        confirmLabel: 'Отвязать',
        icon: 'link_off',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) this.updateChatLink(null);
    });
  }

  private updateChatLink(chatSessionId: string | null): void {
    const o = this.order();
    if (!o || this.chatLinkSaving()) return;

    this.chatLinkSaving.set(true);
    this.ordersApi.linkChatSession(o.order_id, chatSessionId).subscribe({
      next: (res) => {
        this.chatLinkSaving.set(false);
        if (!res.success || !res.data) {
          this.toast.error('Не удалось изменить чат');
          return;
        }

        this.order.set(res.data);
        this.chatLinkInput = res.data.chat_session_id || '';
        this.chatLinkEditing.set(false);
        this.chatSessionResolved.emit(res.data.chat_session_id || null);
        if (res.data.chat_session_id) {
          this.loadClientPhotos(res.data.chat_session_id);
        } else {
          this.clientPhotos.set([]);
        }
        this.toast.success(res.data.chat_session_id ? 'Чат привязан' : 'Чат отвязан');
      },
      error: (err: unknown) => {
        this.chatLinkSaving.set(false);
        const message = err instanceof HttpErrorResponse && typeof err.error?.error === 'string'
          ? err.error.error
          : 'Не удалось изменить чат';
        this.toast.error(message);
      },
    });
  }

  saveEdit(): void {
    const o = this.order();
    if (!o) return;
    const current: Record<string, unknown> = { ...o };
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.editData)) {
      if (k === 'itemDisabledFeatures') continue;
      const cur = current[k];
      if (typeof v === 'boolean') {
        if (v !== !!cur) patch[k] = v;
      } else if (v === null) {
        if (cur !== null && cur !== undefined) patch[k] = null;
      } else {
        const curStr = cur === null || cur === undefined ? '' : String(cur);
        if (v !== curStr) patch[k] = v;
      }
    }

    const itemPatches = this.collectItemPatches();
    const hasOrderPatch = Object.keys(patch).length > 0;
    const hasItemPatches = itemPatches.length > 0;

    if (!hasOrderPatch && !hasItemPatches) {
      this.editing.set(false);
      return;
    }

    this.saving.set(true);
    let failed = false;
    const tasks = [
      hasOrderPatch
        ? this.ordersApi.editOrder(o.order_id, patch).pipe(
            catchError(() => { failed = true; this.toast.error('Не удалось сохранить изменения'); return EMPTY; }),
          )
        : of(null),
      ...itemPatches.map(p =>
        this.ordersApi.updateOrderItem(o.order_id, p.itemId, { disabled_features: p.disabled }).pipe(
          catchError((err: unknown) => {
            failed = true;
            const status = extractHttpStatus(err);
            if (status === 409) {
              this.toast.error('Заказ оплачен, редактирование позиций недоступно');
            } else if (status === 400) {
              this.toast.error('Некорректные изменения позиции');
            } else {
              this.toast.error('Не удалось обновить позицию');
            }
            return EMPTY;
          }),
        ),
      ),
    ];

    concat(...tasks).pipe(toArray()).subscribe({
      next: () => {
        this.saving.set(false);
        if (failed) return;
        this.editing.set(false);
        this.loadOrder(this.orderId());
        this.toast.success('Заказ обновлён');
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Не удалось сохранить изменения');
      },
    });
  }

  private collectItemPatches(): { itemId: string; disabled: string[] }[] {
    const o = this.order();
    if (!o) return [];
    const result: { itemId: string; disabled: string[] }[] = [];
    for (const item of o.items || []) {
      if (!item.id) continue;
      const original = new Set(item.disabled_features ?? []);
      const edited = this.editData.itemDisabledFeatures.get(item.id) ?? new Set<string>();
      if (setsEqual(original, edited)) continue;
      result.push({ itemId: item.id, disabled: Array.from(edited) });
    }
    return result;
  }

  itemSubs(item: PhotoPrintOrderItem): readonly SubOptionInfo[] {
    const fb = item.features_breakdown;
    if (!Array.isArray(fb) || fb.length === 0) return [];
    return fb.map(f => ({
      label: f.name,
      inherited: f.is_inherited,
      pricePerFeature: f.is_inherited ? 0 : (f.price ?? 0),
    }));
  }

  canEditItemFeatures(item: PhotoPrintOrderItem): boolean {
    if (!item.id || !item.service_option_id) return false;
    if (!Array.isArray(item.features_breakdown) || item.features_breakdown.length === 0) return false;
    return this.order()?.payment_status !== 'paid';
  }

  itemIsDisabledFn(itemId: string): (label: string) => boolean {
    return (label: string) => {
      this.editDisabledRev();
      return this.editData.itemDisabledFeatures.get(itemId)?.has(label) ?? false;
    };
  }

  canDisableMoreForItem(item: PhotoPrintOrderItem): boolean {
    this.editDisabledRev();
    if (!item.id) return true;
    const disabled = this.editData.itemDisabledFeatures.get(item.id) ?? new Set<string>();
    let activeNonInherited = 0;
    for (const sub of this.itemSubs(item)) {
      if (sub.inherited) continue;
      if (!disabled.has(sub.label)) activeNonInherited++;
    }
    return activeNonInherited > 1;
  }

  toggleItemFeature(itemId: string, label: string): void {
    const existing = this.editData.itemDisabledFeatures.get(itemId) ?? new Set<string>();
    if (existing.has(label)) existing.delete(label); else existing.add(label);
    this.editData.itemDisabledFeatures.set(itemId, existing);
    this.editDisabledRev.update(v => v + 1);
  }

  previewItemPrice(item: PhotoPrintOrderItem): number {
    this.editDisabledRev();
    const fb = item.features_breakdown;
    if (!Array.isArray(fb) || fb.length === 0) return item.price ?? 0;
    const disabled = item.id ? (this.editData.itemDisabledFeatures.get(item.id) ?? new Set<string>()) : new Set<string>();
    let sum = 0;
    for (const f of fb) {
      if (f.is_inherited) continue;
      if (disabled.has(f.name)) continue;
      sum += f.price ?? 0;
    }
    const qty = item.quantity ?? 1;
    return sum * qty;
  }

  previewOrderTotal(): number {
    this.editDisabledRev();
    const items = this.order()?.items ?? [];
    let sum = 0;
    for (const item of items) {
      if (this.canEditItemFeatures(item)) {
        sum += this.previewItemPrice(item);
      } else {
        sum += (item.price ?? 0) * (item.quantity ?? 1);
      }
    }
    return sum;
  }

  changeStatus(status: string, force = false): void {
    const o = this.order();
    if (!o) return;
    if (status === 'completed' && !force && o.payment_status !== 'paid') {
      this.showPaymentConfirm.set(true);
      return;
    }
    this.showPaymentConfirm.set(false);
    this.ordersApi.updateStatus(o.order_id, status).subscribe({
      next: () => {
        this.loadOrder(this.orderId());
        this.toast.success('Статус обновлён');
      },
      error: () => this.toast.error('Не удалось обновить статус'),
    });
  }

  confirmCancel(): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Отменить заказ?',
        message: `Заказ ${this.order()?.order_id || ''} будет зафиксирован как отменённый. Это не возврат средств: оплата и подписочные скидки не пересчитываются автоматически. Это действие нельзя отменить.`,
        confirmLabel: 'Отменить заказ',
        cancelLabel: 'Не отменять',
        icon: 'cancel',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) this.changeStatus('cancelled');
    });
  }

  canDeleteOrder(): boolean {
    const o = this.order();
    return !!o && o.status !== 'completed' && o.payment_status !== 'paid';
  }

  confirmDeleteOrder(): void {
    const o = this.order();
    if (!o || !this.canDeleteOrder()) return;

    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Удалить заказ?',
        message: `Заказ ${o.order_id} будет удалён из пульта. Сообщения клиенту удаляются отдельно в чате.`,
        confirmLabel: 'Удалить заказ',
        icon: 'delete_forever',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) this.deleteOrder();
    });
  }

  private deleteOrder(): void {
    const o = this.order();
    if (!o || this.deleting()) return;

    this.deleting.set(true);
    this.ordersApi.deleteOrder(o.order_id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.order.set(null);
        this.chatSessionResolved.emit(o.chat_session_id || null);
        this.toast.success('Заказ удалён');
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        const message = err instanceof HttpErrorResponse && typeof err.error?.error === 'string'
          ? err.error.error
          : 'Не удалось удалить заказ';
        this.toast.error(message);
      },
    });
  }

  openDelayDialog(): void {
    const o = this.order();
    if (!o) return;
    import('../order-delay-dialog/order-delay-dialog.component').then(m => {
      this.dialog.open(m.OrderDelayDialogComponent, {
        width: '480px',
        data: {
          orderId: o.order_id,
          contactName: o.contact_name,
        } satisfies import('../order-delay-dialog/order-delay-dialog.component').OrderDelayDialogData,
      }).afterClosed().subscribe(result => {
        if (result?.success) this.loadOrder(this.orderId());
      });
    });
  }

  assignToMe(): void {
    const o = this.order();
    if (!o) return;
    const userId = this.authService.currentUser()?.id;
    if (!userId) return;
    this.ordersApi.assignOrder(o.order_id, userId).subscribe({
      next: () => { this.loadOrder(this.orderId()); this.toast.success('Заказ назначен вам'); },
      error: () => this.toast.error('Не удалось назначить заказ'),
    });
  }

  assignTo(employeeId: string): void {
    const o = this.order();
    if (!o) return;
    this.ordersApi.assignOrder(o.order_id, employeeId).subscribe({
      next: () => {
        this.loadOrder(this.orderId());
        const emp = this.employees().find(e => e.id === employeeId);
        this.toast.success(`Назначен: ${emp?.display_name || 'сотрудник'}`);
      },
      error: () => this.toast.error('Не удалось назначить заказ'),
    });
  }

  unassign(): void {
    const o = this.order();
    if (!o) return;
    this.ordersApi.assignOrder(o.order_id, null).subscribe({
      next: () => { this.loadOrder(this.orderId()); this.toast.success('Назначение снято'); },
      error: () => this.toast.error('Не удалось снять назначение'),
    });
  }

  // F109: Send payment reminder
  sendReminder(): void {
    const o = this.order();
    if (!o || this.reminderSending() || this.reminderCooldown() > 0) return;
    this.reminderSending.set(true);
    this.ordersApi.sendReminder(o.order_id).subscribe({
      next: () => {
        this.reminderSending.set(false);
        this.toast.success('Напоминание отправлено');
        this.startCooldown(60);
      },
      error: (err) => {
        this.reminderSending.set(false);
        const cooldownMinutes = err?.error?.cooldownMinutes;
        if (err.status === 429 && cooldownMinutes) {
          this.startCooldown(cooldownMinutes);
          this.toast.error(err.error.error || 'Напоминание уже отправлено');
        } else {
          this.toast.error(err?.error?.error || 'Не удалось отправить напоминание');
        }
      },
    });
  }

  private startCooldown(minutes: number): void {
    this.reminderCooldown.set(minutes);
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => {
      const current = this.reminderCooldown();
      if (current <= 1) {
        this.reminderCooldown.set(0);
        if (this.cooldownTimer) { clearInterval(this.cooldownTimer); this.cooldownTimer = null; }
      } else {
        this.reminderCooldown.set(current - 1);
      }
    }, 60_000);
  }

  // F110: Mark order as paid externally
  markPaid(method: 'cash' | 'transfer' | 'other'): void {
    const o = this.order();
    if (!o || this.markPaidSending()) return;
    this.markPaidSending.set(true);
    this.ordersApi.markPaid(o.order_id, { method }).subscribe({
      next: () => {
        this.markPaidSending.set(false);
        this.toast.success('Заказ отмечен как оплаченный');
        this.refreshOrder();
      },
      error: (err) => {
        this.markPaidSending.set(false);
        this.toast.error(err?.error?.error || 'Не удалось отметить оплату');
      },
    });
  }

  markPaidAndComplete(method: 'cash' | 'transfer'): void {
    const o = this.order();
    if (!o || this.markPaidSending()) return;
    this.markPaidSending.set(true);
    this.ordersApi.markPaid(o.order_id, { method }).subscribe({
      next: () => {
        this.markPaidSending.set(false);
        this.showPaymentConfirm.set(false);
        this.changeStatus('completed', true);
      },
      error: (err) => {
        this.markPaidSending.set(false);
        this.toast.error(err?.error?.error || 'Не удалось отметить оплату');
      },
    });
  }

  forceComplete(): void {
    this.showPaymentConfirm.set(false);
    this.changeStatus('completed', true);
  }

  getFormatLabel(format?: string): string {
    if (!format) return 'Фото';
    return FORMAT_LABELS[format] ?? format;
  }

  paperTypeLabel(paperType?: string): string {
    if (!paperType) return '';
    return paperType === 'super' ? 'Супер' : 'Премиум';
  }

  fileCountLabel(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const word = mod10 === 1 && mod100 !== 11
      ? 'файл'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'файла'
        : 'файлов';
    return `${count} ${word}`;
  }

  copyCountLabel(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const word = mod10 === 1 && mod100 !== 11
      ? 'копия'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'копии'
        : 'копий';
    return `${count} ${word}`;
  }

  private itemQuantity(item: PhotoPrintOrderItem): number {
    const quantity = Number(item.quantity ?? 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  getItemName(item: PhotoPrintOrderItem): string {
    if (item.name) return item.name;
    if (item.service) return item.service;
    if (item.tariff) return item.tariff;
    if (item.description) return item.description;
    if (item.document) return item.document;
    if (item.format) return `Фото ${this.getFormatLabel(item.format)}`;
    return 'Позиция';
  }

  quickPrint(url: string): void {
    this.quickPrintService.quickPrint(url, this.quickPrintService.lastPresetSlug(), 1);
  }

  printItem(item: PhotoPrintOrderItem): void {
    if (!item.uploadedUrl) return;
    const o = this.order()!;
    this.dialog.open(
      PrintDialogComponent,
      printDialogConfig({
        file_url: item.uploadedUrl,
        file_name: `${this.getFormatLabel(item.format)} — ${o.order_id}`,
        order_id: o.order_id,
        order_type: 'print',
        preferred_printer_type: 'photo',
      } satisfies PrintDialogData),
    ).afterClosed().subscribe(result => {
      if (!result?.printed || !result?.job) return;
      if (result.statusHandled) return;
      const jobId = result.job.id;
      const printerName = result.job.printer_name || 'принтер';
      const snackRef = this.snackBar.open(`Печать (${printerName}): отправка...`, '', { duration: 30000 });
      const sub = toObservable(this.wsService.printJobUpdate, { injector: this.injector }).pipe(
        filter(u => u?.job_id === jobId),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe(update => {
        if (!update) return;
        if (update.status === 'printing') {
          snackRef.instance.data.message = `Печать (${printerName}): печатаем...`;
        }
        if (update.status === 'completed') {
          snackRef.dismiss();
          this.toast.success('Напечатано');
          sub.unsubscribe();
        }
        if (update.status === 'failed') {
          snackRef.dismiss();
          this.toast.error('Ошибка печати');
          sub.unsubscribe();
        }
      });
    });
  }

  printAll(): void {
    const o = this.order()!;
    const files = this.printableItems().map((item, i) => ({
      msgId: `order-${i}`,
      url: item.uploadedUrl!,
      name: this.getFormatLabel(item.format),
      type: 'image' as const,
    }));
    this.dialog.open(BatchPrintDialogComponent, batchPrintDialogConfig(
      {
        files,
        sessionId: o.order_id,
        action: 'print',
        orderType: 'photo-order',
      } satisfies BatchPrintDialogData,
    ));
  }

  downloadAllPrintPhotos(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const order = this.order();
    if (!order) return;

    const items = this.printableItems().filter(item => item.uploadedUrl);
    if (!items.length) {
      this.toast.warning('В заказе нет загруженных файлов');
      return;
    }

    this.downloadingPrintArchive.set(true);
    this.ordersApi.downloadPrintPhotosArchive(order.order_id).subscribe({
      next: response => {
        this.downloadingPrintArchive.set(false);
        const blob = response.body;
        if (!blob || blob.size === 0) {
          this.toast.error('Архив пустой');
          return;
        }
        this.saveArchiveBlob(
          blob,
          response.headers.get('Content-Disposition'),
          `${order.order_id}-photos.zip`,
        );
      },
      error: () => {
        this.downloadingPrintArchive.set(false);
        this.toast.error('Не удалось скачать архив');
      },
    });
  }

  private saveArchiveBlob(blob: Blob, contentDisposition: string | null, fallbackName: string): void {
    const view = this.document.defaultView;
    const body = this.document.body;
    if (!view || !body) return;

    const url = view.URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = this.filenameFromContentDisposition(contentDisposition, fallbackName);
    body.appendChild(link);
    link.click();
    body.removeChild(link);
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  }

  private filenameFromContentDisposition(contentDisposition: string | null, fallbackName: string): string {
    if (!contentDisposition) return fallbackName;

    const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      return decodeFileName(encoded.replace(/^"|"$/g, ''));
    }

    const plain = contentDisposition.match(/filename="([^"]+)"/i)?.[1]
      ?? contentDisposition.match(/filename=([^;]+)/i)?.[1];
    return plain ? decodeFileName(plain.trim()) : fallbackName;
  }

  // ─── Print history ──────────────────────────────────────

  private loadPrintJobs(orderId: string): void {
    this.printJobsLoading.set(true);
    this.printApi.getJobsByOrderId(orderId).subscribe({
      next: jobs => { this.printJobs.set(jobs); this.printJobsLoading.set(false); },
      error: () => { this.printJobs.set([]); this.printJobsLoading.set(false); },
    });
  }

  printJobStatusLabel(status: string): string {
    switch (status) {
      case 'queued':    return 'Ожидание';
      case 'sending':   return 'Отправка';
      case 'printing':  return 'Печать';
      case 'completed': return 'Готово';
      case 'failed':    return 'Ошибка';
      case 'cancelled': return 'Отменено';
      default:          return status;
    }
  }

  shortenPrintUrl(url: string): string {
    try {
      return decodeURIComponent(url).split('/').pop() ?? url;
    } catch {
      return url.split('/').pop() ?? url;
    }
  }

  reprintJob(job: PrintJob): void {
    this.printApi.reprintJob(job.id).subscribe({
      next: () => {
        this.toast.success('Задание создано');
        this.loadPrintJobs(this.orderId());
      },
      error: () => this.toast.error('Не удалось создать задание'),
    });
  }

  retryPrintJob(job: PrintJob): void {
    this.printApi.retryJob(job.id).subscribe({
      next: () => {
        this.toast.success('Задание повторено');
        this.loadPrintJobs(this.orderId());
      },
      error: () => this.toast.error('Не удалось повторить задание'),
    });
  }

  // ─── Retouch ────────────────────────────────────────────

  private loadRetouchTask(orderId: string): void {
    this.retouchApi.getQueue({ order_id: orderId }).subscribe({
      next: res => this.retouchTask.set(res.data?.[0] ?? null),
      error: () => this.retouchTask.set(null),
    });
  }

  private loadPhotoWorkspace(orderId: string): void {
    this.photoWorkspaceApi.getOrderWorkspace(orderId).subscribe({
      next: response => this.photoWorkspace.set(response.data),
      error: () => this.photoWorkspace.set([]),
    });
  }

  /** Группировка опций ретуши для read-only показа в шаблоне (см. retouch-options.util). */
  groupRetouchOptions = groupRetouchOptions;

  reassignRetouch(employeeId: string): void {
    const task = this.retouchTask();
    if (!task) return;
    this.http.post<{ success: boolean }>(`/api/retouch/${task.id}/assign`, { employee_id: employeeId }).subscribe({
      next: () => {
        this.toast.success('Ретушёр переназначен');
        this.loadRetouchTask(this.order()!.order_id);
      },
      error: () => this.toast.error('Не удалось переназначить'),
    });
  }

  printLabel(): void {
    const o = this.order()!;
    this.dialog.open(
      PrintDialogComponent,
      printDialogConfig({
        file_url: '',
        file_name: `Этикетка ${this.extractOrderNum(o.order_id)}`,
        order_id: o.order_id,
        order_type: 'label',
        preferred_printer_type: 'mfp',
      } satisfies PrintDialogData),
    );
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
  }
}
