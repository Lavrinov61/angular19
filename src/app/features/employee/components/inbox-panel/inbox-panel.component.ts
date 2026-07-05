import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy, PLATFORM_ID, OnInit, OnDestroy, viewChild, ElementRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { ChatTagsService } from '../../services/chat-tags.service';
import { InboxService } from '../../services/inbox.service';
import { OnlineStaffService } from '../../services/online-staff.service';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { InboxItem, InboxTypeFilter } from '../../models/inbox.model';
import { TasksApiService } from '../../services/tasks-api.service';
import { OrdersApiService } from '../../services/orders-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import {
  channelIcon, channelLabel, typeIcon, statusLabel,
  paymentStatusIcon, formatRelativeTime,
  isBrandChannel, channelSvgIcon,
} from '../../utils/crm-helpers';
import {
  formatRestorationAnalysisConfidence,
  formatRestorationAnalysisModel,
  formatRestorationAnalysisScale,
  formatRestorationAnalysisStatusLabel,
  readRestorationAnalysisMetadata,
  restorationAnalysisScoreChips,
  type RestorationAnalysisMetadata,
} from '../../utils/restoration-analysis-metadata.util';

interface FilterChip {
  type: InboxTypeFilter;
  label: string;
  icon: string;
}

interface WorkdayData {
  shift: { studio_name: string; shift_date: string } | null;
  tasks: unknown[];
  summary: { total: number; urgent: number; overdue: number; completed_today: number };
  ai_briefing: string | null;
}

interface InboxTagView {
  id: string;
  name: string;
  color: string;
}

function isInboxTagView(value: unknown): value is InboxTagView {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && 'name' in value
    && 'color' in value
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.color === 'string';
}

@Component({
  selector: 'app-inbox-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'tabindex': '0',
    '(keydown)': 'onKeydown($event)',
  },
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatBadgeModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatDividerModule,
    MatMenuModule,
  ],
  template: `
    <div class="inbox">
      <!-- Header -->
      <div class="inbox-header">
        <div class="inbox-title-row">
          <h3>Входящие</h3>
          <div class="scope-toggle">
            <button mat-button [class.active]="inboxService.scopeFilter() === 'all'"
                    (click)="inboxService.setScopeFilter('all')">Все</button>
            <button mat-button [class.active]="inboxService.scopeFilter() === 'my'"
                    (click)="inboxService.setScopeFilter('my')">Мои</button>
            <button mat-button [class.active]="inboxService.scopeFilter() === 'unassigned'"
                    (click)="inboxService.setScopeFilter('unassigned')">
              Свободные
              @if (inboxService.counts().unassigned > 0) {
                <span class="unassigned-count">{{ inboxService.counts().unassigned }}</span>
              }
            </button>
          </div>
        </div>

        <!-- Search -->
        <div class="search-wrap">
          <mat-icon class="search-icon">search</mat-icon>
          <input #searchInput class="search-input" placeholder="Поиск по имени, телефону..."
                 [ngModel]="searchText()" (ngModelChange)="onSearch($event)">
          @if (searchText()) {
            <button class="search-clear" (click)="onSearch('')">
              <mat-icon>close</mat-icon>
            </button>
          } @else {
            <span class="kbd">/</span>
          }
        </div>

        <!-- Type filters -->
        <div class="filter-chips-row">
          @for (chip of filterChips; track chip.type) {
            <button class="chip" [class.active]="inboxService.typeFilter() === chip.type"
                    (click)="inboxService.setTypeFilter(chip.type)">
              <span>{{ chip.label }}</span>
              <span class="chip-count">{{ getCount(chip.type) }}</span>
            </button>
          }
          <button class="chip chip-payment"
                  [class.active]="inboxService.paymentFilter() === 'paid_unlinked'"
                  matTooltip="Только чаты с оплатами без заказа"
                  (click)="togglePaymentFilter()">
            <mat-icon>payments</mat-icon>
            <span>Оплаты</span>
            <span class="chip-count">{{ inboxService.counts().paidUnlinked }}</span>
          </button>
          <div class="filter-spacer"></div>
          @if (isAdmin()) {
            <button mat-icon-button class="sort-btn restore-today-btn"
                    matTooltip="Вернуть закрытые чаты за сегодня"
                    [disabled]="restoreClosedTodayLoading()"
                    (click)="reopenClosedToday()">
              <mat-icon>{{ restoreClosedTodayLoading() ? 'hourglass_empty' : 'restore' }}</mat-icon>
            </button>
          }
          <button mat-icon-button class="sort-btn"
                  [matTooltip]="inboxService.sortOption() === 'time' ? 'По времени' : 'По приоритету'"
                  (click)="toggleSort()">
            <mat-icon>{{ inboxService.sortOption() === 'time' ? 'schedule' : 'priority_high' }}</mat-icon>
          </button>
          @if (!selectionMode()) {
            <button mat-icon-button class="sort-btn" matTooltip="Выбрать несколько"
                    (click)="enterSelectionMode()">
              <mat-icon>checklist</mat-icon>
            </button>
          }
        </div>
      </div>

      <!-- Workday card -->
      @if (workday()) {
        <div class="workday-card" [class.collapsed]="workdayCollapsed()">
          <div class="workday-header" (click)="workdayCollapsed.set(!workdayCollapsed())" (keydown.enter)="workdayCollapsed.set(!workdayCollapsed())" tabindex="0">
            <mat-icon class="wd-icon">today</mat-icon>
            <div class="wd-title">
              <span class="wd-label">Рабочий день</span>
              <div class="wd-stats">
                <span class="wd-stat">{{ workday()!.summary.completed_today }}/{{ workday()!.summary.total + workday()!.summary.completed_today }}</span>
                @if (workday()!.summary.overdue > 0) {
                  <span class="wd-overdue">{{ workday()!.summary.overdue }} просрочено</span>
                }
                @if (workday()!.summary.urgent > 0) {
                  <span class="wd-urgent">{{ workday()!.summary.urgent }} срочных</span>
                }
              </div>
            </div>
            <mat-icon class="wd-expand">{{ workdayCollapsed() ? 'expand_more' : 'expand_less' }}</mat-icon>
          </div>

          @if (!workdayCollapsed()) {
            <!-- Progress bar -->
            <div class="wd-progress">
              <div class="wd-progress-bar"
                   [style.width.%]="workdayProgress()"></div>
            </div>

            @if (workday()!.ai_briefing) {
              <div class="wd-briefing">
                <mat-icon>auto_awesome</mat-icon>
                <span>{{ workday()!.ai_briefing }}</span>
              </div>
            }

            @if (workday()!.shift) {
              <div class="wd-shift">
                <mat-icon>store</mat-icon>
                <span>{{ workday()!.shift?.studio_name || 'Студия' }}</span>
              </div>
            }
          }
        </div>
      }

      <!-- Selection bar -->
      @if (selectionMode()) {
        <div class="selection-bar">
          <div class="selection-info">
            <button mat-icon-button (click)="exitSelectionMode()">
              <mat-icon>close</mat-icon>
            </button>
            <span>{{ selectedIds().length }} выбрано</span>
          </div>
          <div class="selection-actions">
            <button mat-icon-button matTooltip="Решить" (click)="bulkResolve()"
                    [disabled]="selectedIds().length === 0">
              <mat-icon>check_circle</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Закрыть" (click)="bulkClose()"
                    [disabled]="selectedIds().length === 0">
              <mat-icon>cancel</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Назначить" [matMenuTriggerFor]="bulkAssignMenu"
                    [disabled]="selectedIds().length === 0">
              <mat-icon>person_add</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Тег" [matMenuTriggerFor]="bulkTagMenu"
                    [disabled]="selectedIds().length === 0">
              <mat-icon>label</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Выбрать все" (click)="selectAll()">
              <mat-icon>select_all</mat-icon>
            </button>
          </div>
        </div>

        <mat-menu #bulkAssignMenu="matMenu">
          <button mat-menu-item (click)="bulkAssign('self')">
            <mat-icon>person</mat-icon>
            <span>Взять себе</span>
          </button>
          @if (onlineStaff.staff().length > 0) {
            <mat-divider></mat-divider>
            @for (op of onlineStaff.staff(); track op.id) {
              <button mat-menu-item (click)="bulkAssign(op.id)">
                <mat-icon>person_outline</mat-icon>
                <span>{{ op.display_name }}</span>
              </button>
            }
          }
        </mat-menu>

        <mat-menu #bulkTagMenu="matMenu">
          @for (tag of tagsService.tags(); track tag.id) {
            <button mat-menu-item (click)="bulkTag(tag.id)">
              <mat-icon [style.color]="tag.color">label</mat-icon>
              <span>{{ tag.name }}</span>
            </button>
          }
        </mat-menu>
      }

      <!-- List -->
      <div class="inbox-list">
        @if (inboxService.loading() && inboxService.items().length === 0) {
          <div class="loading">
            <mat-spinner diameter="24" />
          </div>
        }

        @for (group of inboxService.groupedItems(); track group.label) {
          <div class="date-group-header">{{ group.label }}</div>

          @for (item of group.items; track item.id) {
            <div class="inbox-item"
                 [class.selected]="selectedId() === item.id || selectedIdSet().has(item.id)"
                 [class.unread]="item.unread"
                 [class.needs-attention]="item.unread && !item.assignedTo && item.type === 'chat'"
                 [class.focused]="flatItems()[focusedIndex()]?.id === item.id"
                 [class.urgent-item]="item.priority === 0"
                 [class.high-item]="item.priority === 1"
                 [class.booking-pending-item]="item.type === 'booking' && item.status === 'pending'"
                 (click)="selectionMode() ? toggleSelection(item.id) : selectItem(item)"
                 (keydown.enter)="selectionMode() ? toggleSelection(item.id) : selectItem(item)"
                 tabindex="0"
                 (touchstart)="onTouchStart(item.id)"
                 (touchend)="onTouchEnd()"
                 (touchmove)="onTouchEnd()">
              <!-- Checkbox in selection mode -->
              @if (selectionMode()) {
                <mat-checkbox [checked]="selectedIdSet().has(item.id)"
                              (click)="$event.stopPropagation()"
                              (change)="toggleSelection(item.id)" />
              }
              <!-- Type icon -->
              <div class="item-icon" [class]="'type-' + item.type"
                   [class.hidden-in-selection]="selectionMode()">
                <mat-icon>{{ getItemIcon(item) }}</mat-icon>
              </div>

              <!-- Content -->
              <div class="item-content">
                <div class="item-top">
                  <span class="item-type-label" [class]="'tl-' + item.type">{{ getTypeLabel(item.type) }}</span>
                  <span class="item-name">{{ item.clientName || 'Без имени' }}</span>
                  @if (item.reopened) {
                    <span class="reopened-badge">Вернулся</span>
                  } @else if (item.unread) {
                    <span class="unread-dot"></span>
                  }
                  <span class="item-time">{{ formatRelativeTime(item.sortTime, timeTick()) }}</span>
                </div>
                <div class="item-preview">{{ item.preview }}</div>
                <div class="item-meta">
                  @if (item.type === 'chat' && item.isPrivate) {
                    <span class="meta-badge meta-badge--private" matTooltip="Приватный чат">
                      <mat-icon>lock</mat-icon>
                      Приватный
                    </span>
                  }
                  @if (item.type === 'chat' && item.channel) {
                    <span class="meta-badge" [class]="'ch-' + item.channel">
                      @if (isBrandChannel(item.channel)) {
                        <mat-icon [svgIcon]="channelSvgIcon(item.channel)"></mat-icon>
                      } @else {
                        <mat-icon>{{ channelIcon(item.channel) }}</mat-icon>
                      }
                      {{ channelLabel(item.channel) }}
                    </span>
                  }
                  @if (item.type === 'task') {
                    <span class="meta-badge status">{{ statusLabel(item.status) }}</span>
                  }
                  @if (item.type === 'booking') {
                    <span class="meta-badge booking-time">
                      <mat-icon>schedule</mat-icon>
                      {{ formatBookingTime(item) }}
                    </span>
                  }
                  @if (item.type === 'booking' && item.metadata['studioName']) {
                    <span class="meta-badge studio-badge">
                      <mat-icon>location_on</mat-icon>
                      {{ item.metadata['studioName'] }}
                    </span>
                  }
                  @if (item.type === 'chat' && item.metadata['hasPaidUnlinked']) {
                    <span class="meta-badge pay-paid-unlinked"
                          [matTooltip]="tooltipHasPaidUnlinked(item)">
                      <mat-icon>payments</mat-icon>
                      {{ paidUnlinkedBadgeLabel(item) }}
                    </span>
                  }
                  @if (item.type === 'order' && item.metadata['paymentStatus']) {
                    <span class="meta-badge" [class]="'pay-' + item.metadata['paymentStatus']">
                      <mat-icon>{{ paymentStatusIcon('' + item.metadata['paymentStatus']) }}</mat-icon>
                      {{ '' + item.metadata['totalPrice'] }}₽
                    </span>
                  }
                  @if (item.type === 'approval') {
                    <span class="meta-badge approval-progress">
                      <mat-icon>check_circle</mat-icon>
                      {{ item.metadata['approvedCount'] || 0 }}/{{ item.metadata['totalPhotos'] || 0 }}
                    </span>
                  }
                  @if (getItemTags(item); as tags) {
                    @for (tag of tags; track tag.id) {
                      <span class="meta-badge tag-chip" [style.color]="tag.color"
                            [style.border-color]="tag.color">
                        {{ tag.name }}
                      </span>
                    }
                  }
                  @if (item.assignedToName) {
                    <span class="meta-badge assignee">
                      <mat-icon>person</mat-icon>
                      {{ item.assignedToName }}
                    </span>
                  } @else if (!item.assignedTo && item.type === 'chat') {
                    <span class="meta-badge free">Свободный</span>
                  }
                </div>
                @if (restorationAnalysis(item); as analysis) {
                  @let scoreChips = restorationAnalysisScoreChips(analysis);
                  <div class="restoration-analysis" [class.requires-review]="analysis.humanReviewRequired">
                    <div class="restoration-analysis-top">
                      <span class="restoration-analysis-title">
                        <mat-icon>auto_awesome</mat-icon>
                        AI анализ
                      </span>
                      <span class="restoration-analysis-status">
                        {{ formatRestorationAnalysisStatusLabel(analysis) }}
                      </span>
                      <span class="restoration-analysis-metric">
                        {{ formatRestorationAnalysisConfidence(analysis) }}
                      </span>
                      @if (formatRestorationAnalysisModel(analysis); as model) {
                        <span class="restoration-analysis-model">{{ model }}</span>
                      }
                    </div>
                    @if (formatRestorationAnalysisScale(analysis); as scale) {
                      <div class="restoration-analysis-scale">{{ scale }}</div>
                    }
                    @if (analysis.reviewReason) {
                      <div class="restoration-analysis-review">
                        <mat-icon>priority_high</mat-icon>
                        <span>{{ analysis.reviewReason }}</span>
                      </div>
                    }
                    @if (scoreChips.length > 0) {
                      <div class="restoration-analysis-scores">
                        @for (score of scoreChips; track score) {
                          <span>{{ score }}</span>
                        }
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- Quick actions — CSS-only hover reveal -->
              <div class="quick-actions" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
                @if (item.type === 'chat' && !item.assignedTo && !item.isPrivate) {
                  <button class="ghost-btn" matTooltip="Взять чат" (click)="quickTakeChat(item)">
                    <mat-icon>person_add</mat-icon>
                  </button>
                }
                @if (item.type === 'task' && !item.assignedTo) {
                  <button class="ghost-btn" matTooltip="Взять" (click)="quickTakeTask(item)">
                    <mat-icon>person_add</mat-icon>
                  </button>
                }
                @if (item.type === 'booking' && item.status === 'pending') {
                  <button class="ghost-btn" matTooltip="Подтвердить" (click)="quickConfirmBooking(item)">
                    <mat-icon>check</mat-icon>
                  </button>
                }
                @if (item.type === 'order' && (item.status === 'new' || item.status === 'pending_payment')) {
                  <button class="ghost-btn" matTooltip="В работу" (click)="quickProcessOrder(item)">
                    <mat-icon>build</mat-icon>
                  </button>
                }
                @if (item.type === 'order' && item.metadata['paymentStatus'] !== 'paid') {
                  <button class="ghost-btn ghost-btn--teal" matTooltip="Оплачено" (click)="quickMarkOrderPaid(item)">
                    <mat-icon>price_check</mat-icon>
                  </button>
                }
              </div>
            </div>
          }
        } @empty {
          @if (!inboxService.loading()) {
            <div class="empty-state">
              <mat-icon>{{ emptyIcon() }}</mat-icon>
              <span>{{ emptyMessage() }}</span>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    @keyframes crmSlideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

    .inbox { display: flex; flex-direction: column; height: 100%; font-family: var(--crm-font-sans); }

    .inbox-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--crm-glass-border);
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.015);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .inbox-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;

      h3 { margin: 0; font-size: var(--crm-text-md); font-weight: 600; color: var(--crm-text-primary); letter-spacing: -0.01em; }
    }

    .scope-toggle {
      display: flex;
      gap: 0;
      overflow-x: auto;
      scrollbar-width: none;
      &::-webkit-scrollbar { display: none; }

      button {
        font-size: 12px;
        font-family: var(--crm-font-sans);
        min-width: auto;
        height: 26px;
        line-height: 26px;
        padding: 0 10px;
        border-radius: var(--crm-radius-sm);
        color: var(--crm-text-muted);
        white-space: nowrap;
        font-weight: 400;
        transition: color var(--crm-transition-fast), background var(--crm-transition-fast);

        &.active {
          background: var(--crm-surface-hover);
          color: var(--crm-text-primary);
          font-weight: 600;
        }

        &:hover:not(.active) {
          color: var(--crm-text-secondary);
        }
      }

      .unassigned-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 14px;
        height: 14px;
        padding: 0 4px;
        border-radius: 7px;
        font-size: var(--crm-text-xs);
        font-weight: 600;
        background: var(--crm-status-error);
        color: #fff;
        margin-left: 4px;
      }
    }

    /* Native search input */
    .search-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      height: 34px;
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-md);
      background: rgba(255, 255, 255, 0.02);
      margin-bottom: 6px;
      transition: border-color var(--crm-transition-fast), box-shadow var(--crm-transition-fast);

      &:focus-within {
        border-color: var(--crm-border-focus);
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15), var(--crm-shadow-accent);
      }
    }
    .search-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); flex-shrink: 0; }
    .search-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: var(--crm-text-base);
      font-family: var(--crm-font-sans);
      color: var(--crm-text-primary);
      outline: none;
      min-width: 0;
      &::placeholder { color: var(--crm-text-muted); }
    }
    .kbd {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--crm-kbd-bg);
      border: 1px solid var(--crm-kbd-border);
      font-size: var(--crm-text-xs);
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted);
      line-height: 1.4;
      flex-shrink: 0;
    }

    .search-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: none;
      background: var(--crm-surface-raised);
      border-radius: 50%;
      cursor: pointer;
      flex-shrink: 0;
      padding: 0;
      color: var(--crm-text-muted);
      transition: background var(--crm-transition-fast);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
      &:hover { background: var(--crm-surface-hover); color: var(--crm-text-primary); }
    }

    .filter-chips-row {
      display: flex;
      align-items: center;
      gap: 2px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      &::-webkit-scrollbar { display: none; }
    }

    .filter-spacer { flex: 1; }

    .sort-btn {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .restore-today-btn {
      color: var(--crm-status-warning);

      &:disabled {
        opacity: 0.5;
      }
    }

    .chip {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 3px 8px;
      border-radius: var(--crm-radius-sm);
      border: none;
      background: transparent;
      color: var(--crm-text-muted);
      font-size: var(--crm-text-sm);
      font-family: var(--crm-font-sans);
      white-space: nowrap;
      cursor: pointer;
      transition: color var(--crm-transition-fast), background var(--crm-transition-fast);

      mat-icon { font-size: 13px; width: 13px; height: 13px; }

      &:hover {
        color: var(--crm-text-secondary);
        background: var(--crm-surface-hover);
      }

      &.active {
        background: var(--crm-accent-muted);
        color: var(--crm-accent);
      }

      .chip-count {
        background: var(--crm-surface-raised);
        border-radius: 8px;
        padding: 0 4px;
        font-size: var(--crm-text-xs);
        font-family: var(--crm-font-mono);
        min-width: 14px;
        text-align: center;
      }
    }

    .chip-payment {
      mat-icon { font-size: 13px; width: 13px; height: 13px; }
      &.active {
        background: var(--crm-status-warning-muted, rgba(245, 158, 11, 0.14));
        color: var(--crm-status-warning, #f59e0b);
      }
    }

    .inbox-list {
      flex: 1;
      overflow-y: auto;
    }

    .date-group-header {
      padding: 6px 12px 4px;
      font-size: var(--crm-text-xs);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--crm-text-muted);
      font-family: var(--crm-font-mono);
      background: transparent;
      border-bottom: 1px solid var(--crm-border-subtle);
    }

    .inbox-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      border-left: 3px solid transparent;
      position: relative;
      transition:
        background var(--crm-transition-fast),
        border-color var(--crm-transition-fast);

      &:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      &:hover .quick-actions { opacity: 1; transform: translateX(0); }

      &.selected {
        background: rgba(245, 158, 11, 0.08);
        border-left-color: var(--crm-accent);
      }
      &.unread {
        background: rgba(245, 158, 11, 0.08);
        border-left-color: var(--crm-accent);
        border-left-width: 4px;
        .item-name { font-weight: 700; }
      }
      &.needs-attention {
        background: rgba(245, 158, 11, 0.07);
        border-left-color: var(--crm-accent);
        border-left-width: 4px;
        .item-name { font-weight: 700; color: var(--crm-accent); }
      }
      &.unread.selected {
        background: rgba(245, 158, 11, 0.08);
      }
      &.urgent-item {
        border-left-color: var(--crm-status-error);
        background: color-mix(in srgb, var(--crm-status-error) 4%, transparent);
      }
      &.high-item:not(.urgent-item) {
        border-left-color: var(--crm-status-warning);
      }
      &.sla-breached-item:not(.urgent-item) {
        border-left-color: var(--crm-status-error);
      }
      &.focused { outline: 1px solid var(--crm-accent); outline-offset: -1px; }
      &.booking-pending-item {
        border-left-color: var(--crm-status-success);
        animation: bookingPendingPulse 2.5s ease-in-out infinite;
      }
    }

    @keyframes bookingPendingPulse {
      0%, 100% { border-left-color: var(--crm-status-success); }
      50% { border-left-color: rgba(34, 197, 94, 0.35); }
    }

    .item-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.type-chat {
        background: var(--crm-status-info-container);
        mat-icon { color: var(--crm-status-info); }
      }
      &.type-task {
        background: var(--crm-status-warning-container);
        mat-icon { color: var(--crm-status-warning); }
      }
      &.type-booking {
        background: var(--crm-status-success-container);
        mat-icon { color: var(--crm-status-success); }
      }
      &.type-order {
        background: var(--crm-accent-container);
        mat-icon { color: var(--crm-accent); }
      }
      &.type-approval {
        background: rgba(45, 212, 191, 0.08);
        mat-icon { color: var(--crm-status-approval, #2dd4bf); }
      }
    }

    .item-content { flex: 1; min-width: 0; }

    .item-top {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .item-type-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 1px 5px;
      border-radius: 4px;
      flex-shrink: 0;

      &.tl-chat { color: var(--crm-status-info); background: var(--crm-status-info-container); }
      &.tl-task { color: var(--crm-status-warning); background: var(--crm-status-warning-container); }
      &.tl-booking { color: var(--crm-status-success); background: var(--crm-status-success-container); }
      &.tl-order { color: var(--crm-accent); background: var(--crm-accent-container); }
      &.tl-approval { color: var(--crm-status-approval, #2dd4bf); background: rgba(45, 212, 191, 0.08); }
    }

    .item-name {
      font-size: 14px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-primary);
      flex: 1;
      min-width: 0;
    }

    .unread-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-accent);
      box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
      flex-shrink: 0;
    }

    .reopened-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(34, 197, 94, 0.15);
      color: var(--crm-status-success);
      flex-shrink: 0;
      white-space: nowrap;
    }

    .item-time {
      font-size: 11px;
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .item-preview {
      font-size: 12px;
      color: var(--crm-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: normal;
      margin-top: 3px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      line-height: 1.4;
    }

    .item-meta {
      display: flex;
      gap: 5px;
      margin-top: 5px;
      flex-wrap: wrap;
    }

    .restoration-analysis {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 7px;
      padding: 6px 7px;
      border: 1px solid rgba(45, 212, 191, 0.22);
      border-radius: 6px;
      background: rgba(45, 212, 191, 0.06);
      color: var(--crm-text-secondary);

      &.requires-review {
        border-color: rgba(245, 158, 11, 0.28);
        background: rgba(245, 158, 11, 0.08);
      }
    }

    .restoration-analysis-top,
    .restoration-analysis-review,
    .restoration-analysis-scores {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
    }

    .restoration-analysis-title {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      font-weight: 700;
      color: var(--crm-text-primary);

      mat-icon { font-size: 12px; width: 12px; height: 12px; color: var(--crm-status-approval, #2dd4bf); }
    }

    .restoration-analysis-status,
    .restoration-analysis-metric,
    .restoration-analysis-model,
    .restoration-analysis-scores span {
      display: inline-flex;
      align-items: center;
      min-height: 16px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.06);
      font-size: 10px;
      font-weight: 600;
      line-height: 1.2;
      color: var(--crm-text-secondary);
    }

    .restoration-analysis-scale {
      font-family: var(--crm-font-mono);
      font-size: 10px;
      line-height: 1.35;
      color: var(--crm-text-muted);
      overflow-wrap: anywhere;
    }

    .restoration-analysis-review {
      color: var(--crm-status-warning);
      font-size: 10px;
      line-height: 1.35;

      mat-icon { font-size: 12px; width: 12px; height: 12px; flex-shrink: 0; }
      span { min-width: 0; overflow-wrap: anywhere; }
    }

    .meta-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--crm-surface-raised);
      color: var(--crm-text-muted);

      mat-icon { font-size: 11px; width: 11px; height: 11px; }

      /* Channel badges */
      &.ch-vk { color: #4c75a3; background: rgba(76, 117, 163, 0.12); }
      &.ch-telegram { color: #26a5e4; background: rgba(38, 165, 228, 0.12); }
      &.ch-whatsapp { color: #25d366; background: rgba(37, 211, 102, 0.12); }
      &.ch-max { color: #34d399; background: rgba(52, 211, 153, 0.12); }
      &.ch-website, &.ch-site { color: var(--crm-accent); background: var(--crm-accent-muted); }
      &.ch-instagram { color: #E4405F; background: rgba(228, 64, 95, 0.12); }
      &.ch-online, &.ch-studio { color: var(--crm-accent); background: var(--crm-accent-muted); }

      /* SLA */
      &.sla-ok { color: var(--crm-status-success); background: var(--crm-status-success-muted); }
      &.sla-warning { color: var(--crm-status-warning); background: var(--crm-status-warning-muted); font-weight: 600; }
      &.sla-breached {
        color: var(--crm-status-error);
        background: var(--crm-status-error-muted);
        font-weight: 700;
        animation: slaPulse 1.5s ease-in-out infinite;
      }

      /* Payment */
      &.pay-paid { color: var(--crm-status-success); background: var(--crm-status-success-muted); }
      &.pay-pending { color: var(--crm-status-warning); background: var(--crm-status-warning-muted); }
      &.pay-failed { color: var(--crm-status-error); background: var(--crm-status-error-muted); }
      &.pay-paid-unlinked {
        color: var(--crm-status-warning, #f59e0b);
        background: var(--crm-status-warning-muted, rgba(245, 158, 11, 0.14));
        border: 1px solid var(--crm-status-warning, #f59e0b);
        font-weight: 600;
      }

      /* Tags */
      &.tag-chip {
        border: 1px solid;
        background: transparent;
        font-weight: 500;
        font-size: var(--crm-text-xs);
      }

      /* Assignee */
      &.assignee { color: var(--crm-text-secondary); }

      /* Free / unassigned */
      &.free {
        color: var(--crm-status-info);
        background: var(--crm-status-info-container);
      }

      /* Booking time */
      &.booking-time {
        color: var(--crm-status-success);
        background: var(--crm-status-success-muted);
        font-family: var(--crm-font-mono);
        font-size: 11px;
        font-weight: 600;
      }

      /* Studio name */
      &.studio-badge {
        color: var(--crm-text-secondary);
        background: rgba(255, 255, 255, 0.04);
      }

      /* Approval progress */
      &.approval-progress {
        color: var(--crm-status-approval, #2dd4bf);
        background: rgba(45, 212, 191, 0.08);
      }

      /* Private chat */
      &--private {
        color: var(--crm-accent);
        background: var(--crm-accent-muted);
        font-weight: 600;
      }
    }

    @keyframes slaPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .selection-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: var(--crm-accent-muted);
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;
      animation: crmSlideDown 200ms ease forwards;
    }

    .selection-info {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--crm-text-base);
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .selection-actions {
      display: flex;
      gap: 2px;
    }

    .hidden-in-selection { display: none; }

    .inbox-item mat-checkbox {
      flex-shrink: 0;
    }

    /* CSS-only hover reveal quick actions */
    .quick-actions {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%) translateX(4px);
      display: flex;
      gap: 4px;
      z-index: 1;
      opacity: 0;
      transition: opacity var(--crm-transition-fast), transform var(--crm-transition-fast);
    }

    .ghost-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      background: var(--crm-surface-overlay);
      border-radius: var(--crm-radius-sm);
      cursor: pointer;
      color: var(--crm-text-secondary);
      transition: background var(--crm-transition-fast), color var(--crm-transition-fast);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover {
        background: var(--crm-ghost-active);
        color: var(--crm-accent);
      }

      &--teal {
        color: #0d9488;
        &:hover { background: rgba(20, 184, 166, 0.18); color: #0d9488; }
      }
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px 16px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.2; }
    }

    .workday-card {
      border-bottom: 1px solid var(--crm-glass-border);
      background: linear-gradient(180deg, rgba(245, 158, 11, 0.03) 0%, transparent 100%);
      flex-shrink: 0;
    }

    .workday-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
    }

    .wd-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent); }
    .wd-expand {
      font-size: 18px; width: 18px; height: 18px; color: var(--crm-text-muted);
      transition: transform var(--crm-transition-fast);
    }
    .workday-card.collapsed .wd-expand { transform: rotate(0deg); }

    .wd-title { flex: 1; min-width: 0; }
    .wd-label { font-size: 12px; font-weight: 600; color: var(--crm-text-primary); }
    .wd-stats {
      display: flex; gap: 8px; font-size: var(--crm-text-sm);
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted); margin-top: 2px;
    }
    .wd-overdue { color: var(--crm-status-error); font-weight: 500; }
    .wd-urgent { color: var(--crm-status-warning); font-weight: 500; }

    .wd-progress {
      height: 2px;
      background: var(--crm-surface-raised);
      margin: 0 12px;
    }

    .wd-progress-bar {
      height: 100%;
      background: var(--crm-accent);
      border-radius: 1px;
      transition: width var(--crm-transition-slow);
    }

    .wd-briefing {
      display: flex;
      gap: 6px;
      padding: 6px 12px;
      font-size: 12px;
      color: var(--crm-text-secondary);

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-accent); flex-shrink: 0; margin-top: 1px; }
    }

    .wd-shift {
      display: flex;
      gap: 6px;
      padding: 4px 12px 8px;
      font-size: 12px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; }
    }
  `],
})
export class InboxPanelComponent implements OnInit, OnDestroy {
  protected readonly inboxService = inject(InboxService);
  protected readonly tagsService = inject(ChatTagsService);
  protected readonly onlineStaff = inject(OnlineStaffService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly tasksApi = inject(TasksApiService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly shortcuts = inject(KeyboardShortcutsService);
  private readonly searchInputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private unregisterSlash: (() => void) | null = null;

  selectedId = input<string | null>(null);
  itemSelected = output<InboxItem>();

  searchText = signal('');
  hoveredId = signal<string | null>(null);
  quickActionLoading = signal(false);
  protected readonly restoreClosedTodayLoading = signal(false);
  workday = signal<WorkdayData | null>(null);
  workdayCollapsed = signal(false);
  selectionMode = signal(false);
  selectedIds = signal<readonly string[]>([]);
  protected readonly isAdmin = computed(() => this.auth.isAdmin());
  readonly selectedIdSet = computed(() => new Set(this.selectedIds()));
  focusedIndex = signal(-1);
  readonly timeTick = signal(0);
  private timeTickInterval: ReturnType<typeof setInterval> | null = null;

  readonly flatItems = computed(() => {
    const groups = this.inboxService.groupedItems();
    const items: InboxItem[] = [];
    for (const g of groups) items.push(...g.items);
    return items;
  });
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressItemId: string | null = null;

  workdayProgress = computed(() => {
    const wd = this.workday();
    if (!wd) return 0;
    const total = wd.summary.total + wd.summary.completed_today;
    return total > 0 ? Math.round((wd.summary.completed_today / total) * 100) : 0;
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadWorkday();
    }
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.timeTickInterval = setInterval(() => this.timeTick.update(v => v + 1), 60_000);
      this.unregisterSlash = this.shortcuts.register({
        key: '/',
        scope: 'inbox',
        description: 'Фокус на поиск',
        handler: () => this.searchInputRef()?.nativeElement?.focus(),
      });
    }
  }

  ngOnDestroy(): void {
    if (this.timeTickInterval) {
      clearInterval(this.timeTickInterval);
      this.timeTickInterval = null;
    }
    this.unregisterSlash?.();
  }

  private loadWorkday(): void {
    this.http.get<{ success: boolean; data: WorkdayData }>('/api/tasks/workday').subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.workday.set(res.data);
        }
      },
    });
  }

  readonly filterChips: FilterChip[] = [
    { type: 'chat', label: 'Чаты', icon: 'chat' },
    { type: 'task', label: 'Задачи', icon: 'task_alt' },
    { type: 'booking', label: 'Записи', icon: 'event' },
    { type: 'order', label: 'Заказы', icon: 'receipt_long' },
    { type: 'approval', label: 'Ретушь', icon: 'photo_camera' },
  ];

  // Reuse helpers
  readonly channelIcon = channelIcon;
  readonly channelLabel = channelLabel;
  readonly isBrandChannel = isBrandChannel;
  readonly channelSvgIcon = channelSvgIcon;
  readonly statusLabel = statusLabel;
  readonly paymentStatusIcon = paymentStatusIcon;
  readonly formatRelativeTime = formatRelativeTime;
  readonly formatRestorationAnalysisConfidence = formatRestorationAnalysisConfidence;
  readonly formatRestorationAnalysisModel = formatRestorationAnalysisModel;
  readonly formatRestorationAnalysisScale = formatRestorationAnalysisScale;
  readonly formatRestorationAnalysisStatusLabel = formatRestorationAnalysisStatusLabel;
  readonly restorationAnalysisScoreChips = restorationAnalysisScoreChips;

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = { chat: 'чат', task: 'задача', booking: 'запись', order: 'заказ', approval: 'ретушь' };
    return labels[type] || type;
  }

  selectItem(item: InboxItem): void {
    this.itemSelected.emit(item);
  }

  getCount(type: string): number {
    const c = this.inboxService.counts();
    switch (type) {
      case 'all': return c.total;
      case 'chat': return c.chat;
      case 'task': return c.task;
      case 'booking': return c.booking;
      case 'order': return c.order;
      case 'approval': return c.approval;
      default: return 0;
    }
  }

  getItemIcon(item: InboxItem): string {
    switch (item.type) {
      case 'chat': return item.channel ? channelIcon(item.channel) : 'chat';
      case 'task': return typeIcon(this.metadataString(item, 'taskType'));
      case 'booking': return 'event';
      case 'order': return 'receipt_long';
      case 'approval': return 'photo_camera';
      default: return 'circle';
    }
  }

  formatBookingTime(item: InboxItem): string {
    const startTime = this.metadataString(item, 'startTime');
    if (!startTime) return '';
    const d = new Date(startTime);
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  paidUnlinkedBadgeLabel(item: InboxItem): string {
    const count = this.paidUnlinkedCount(item);
    const amount = this.paidUnlinkedAmount(item);
    const label = count > 1 ? `Оплаты ${count}` : 'Оплата';
    return amount > 0 ? `${label} · ${this.formatRubles(amount)}` : label;
  }

  tooltipHasPaidUnlinked(item: InboxItem): string {
    const count = this.paidUnlinkedCount(item);
    const amount = this.paidUnlinkedAmount(item);
    const orderRef = item.metadata['paidUnlinkedOrderRef'];
    const amountText = amount > 0 ? ` на ${this.formatRubles(amount)}` : '';
    const refText = typeof orderRef === 'string' && orderRef ? `; последняя ссылка ${orderRef}` : '';
    return `${count} ${this.paymentWord(count)} без заказа${amountText}${refText} — создайте заказ или привяжите оплату`;
  }

  private paidUnlinkedCount(item: InboxItem): number {
    const value = item.metadata['paidUnlinkedCount'];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
    return item.metadata['hasPaidUnlinked'] ? 1 : 0;
  }

  private paidUnlinkedAmount(item: InboxItem): number {
    const value = item.metadata['paidUnlinkedAmount'];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }

  private formatRubles(value: number): string {
    return `${Math.round(value).toLocaleString('ru-RU')}₽`;
  }

  private paymentWord(count: number): string {
    const abs = Math.abs(count);
    const lastTwo = abs % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return 'оплат';
    const last = abs % 10;
    if (last === 1) return 'оплата';
    if (last >= 2 && last <= 4) return 'оплаты';
    return 'оплат';
  }

  private chatWord(count: number): string {
    const abs = Math.abs(count);
    const lastTwo = abs % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return 'чатов';
    const last = abs % 10;
    if (last === 1) return 'чат';
    if (last >= 2 && last <= 4) return 'чата';
    return 'чатов';
  }

  private httpErrorMessage(err: unknown): string | null {
    if (typeof err !== 'object' || err === null) return null;
    const body = Reflect.get(err, 'error');
    if (typeof body !== 'object' || body === null) return null;
    const message = Reflect.get(body, 'error');
    return typeof message === 'string' ? message : null;
  }

  private metadataString(item: InboxItem, key: string): string {
    const value = item.metadata[key];
    return typeof value === 'string' ? value : '';
  }

  toggleSort(): void {
    const current = this.inboxService.sortOption();
    this.inboxService.setSortOption(current === 'time' ? 'priority' : 'time');
  }

  togglePaymentFilter(): void {
    const cur = this.inboxService.paymentFilter();
    this.inboxService.setPaymentFilter(cur === 'paid_unlinked' ? 'all' : 'paid_unlinked');
  }

  reopenClosedToday(): void {
    if (this.restoreClosedTodayLoading()) return;

    this.restoreClosedTodayLoading.set(true);
    this.inboxService.reopenClosedToday().subscribe({
      next: (res) => {
        const count = res.affected;
        this.toast.success(
          count > 0
            ? `Вернули ${count} ${this.chatWord(count)} за сегодня`
            : 'Сегодня закрытых чатов не найдено',
        );
        this.inboxService.refresh();
        this.restoreClosedTodayLoading.set(false);
      },
      error: (err: unknown) => {
        this.toast.error(this.httpErrorMessage(err) || 'Не удалось вернуть закрытые чаты');
        this.restoreClosedTodayLoading.set(false);
      },
    });
  }

  onSearch(value: string): void {
    this.searchText.set(value);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.inboxService.setSearch(value);
    }, 300);
  }

  emptyIcon(): string {
    const type = this.inboxService.typeFilter();
    const icons: Record<string, string> = { chat: 'forum', task: 'task_alt', booking: 'event_available', order: 'receipt_long', approval: 'photo_camera' };
    return icons[type] || 'inbox';
  }

  emptyMessage(): string {
    const type = this.inboxService.typeFilter();
    const scope = this.inboxService.scopeFilter();
    const search = this.inboxService.searchQuery() || '';

    if (search) return 'Ничего не найдено по запросу';

    const messages: Record<string, string> = {
      chat: 'Нет открытых чатов',
      task: scope === 'my' ? 'У вас нет активных задач' : 'Все задачи выполнены',
      booking: 'Нет предстоящих записей',
      order: 'Нет активных заказов',
      approval: 'Нет фото на согласование',
    };
    return messages[type] || (scope === 'my' ? 'У вас нет назначенных элементов' : 'Нет элементов');
  }

  getItemTags(item: InboxItem): InboxTagView[] {
    const tags = item.metadata['tags'];
    return Array.isArray(tags) ? tags.filter(isInboxTagView) : [];
  }

  restorationAnalysis(item: InboxItem): RestorationAnalysisMetadata | null {
    if (item.type !== 'order') {
      return null;
    }

    return readRestorationAnalysisMetadata(item.metadata);
  }

  slaLabel(item: InboxItem): string {
    const sla = this.metadataString(item, 'slaStatus');
    if (sla === 'ok') return 'SLA ✓';
    if (sla === 'breached') {
      const created = this.metadataString(item, 'createdAt');
      if (!created) return 'Просрочен';
      const min = Math.floor((Date.now() - new Date(created).getTime()) / 60000);
      const h = Math.floor(min / 60);
      return h > 0 ? `-${h}ч${min % 60}м` : `-${min}м`;
    }
    const created = this.metadataString(item, 'createdAt');
    if (!created) return 'SLA';
    const elapsed = Math.floor((Date.now() - new Date(created).getTime()) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  // --- Keyboard navigation ---

  onKeydown(event: KeyboardEvent): void {
    const items = this.flatItems();
    if (!items.length) return;
    const idx = this.focusedIndex();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusedIndex.set(Math.min(idx + 1, items.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusedIndex.set(Math.max(idx - 1, 0));
        break;
      case 'Enter':
        if (idx >= 0 && idx < items.length) {
          event.preventDefault();
          this.selectItem(items[idx]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.focusedIndex.set(-1);
        if (this.selectionMode()) this.exitSelectionMode();
        break;
    }
  }

  // --- Selection mode ---

  enterSelectionMode(): void {
    this.selectionMode.set(true);
    this.selectedIds.set([]);
    this.tagsService.load();
  }

  exitSelectionMode(): void {
    this.selectionMode.set(false);
    this.selectedIds.set([]);
  }

  toggleSelection(id: string): void {
    this.selectedIds.update(prev => prev.includes(id)
      ? prev.filter(selectedId => selectedId !== id)
      : [...prev, id]);
  }

  selectAll(): void {
    const allIds = this.inboxService.filteredItems().map(i => i.id);
    this.selectedIds.set(allIds);
  }

  // Long-press for mobile
  onTouchStart(itemId: string): void {
    if (this.selectionMode()) return;
    this.longPressItemId = itemId;
    this.longPressTimer = setTimeout(() => {
      this.enterSelectionMode();
      this.toggleSelection(itemId);
      this.longPressItemId = null;
    }, 500);
  }

  onTouchEnd(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressItemId = null;
  }

  // Bulk actions
  bulkResolve(): void {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    this.inboxService.bulkAction('resolve', ids);
    this.exitSelectionMode();
    this.toast.success(`${ids.length} элемент(ов) решено`);
  }

  bulkClose(): void {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    this.inboxService.bulkAction('close', ids);
    this.exitSelectionMode();
    this.toast.success(`${ids.length} элемент(ов) закрыто`);
  }

  bulkAssign(operatorId: string): void {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    this.inboxService.bulkAction('assign', ids, { operatorId });
    this.exitSelectionMode();
    this.toast.success(`${ids.length} чат(ов) назначено`);
  }

  bulkTag(tagId: string): void {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    this.inboxService.bulkAction('tag', ids, { tagId });
    this.exitSelectionMode();
    this.toast.success('Тег применён');
  }

  quickTakeChat(item: InboxItem): void {
    this.quickActionLoading.set(true);
    this.http.post<{ success: boolean }>(`/api/visitor-chat/admin/sessions/${item.id}/assign`, { operator_id: 'self' }).subscribe({
      next: () => {
        this.toast.success('Чат взят в работу');
        this.inboxService.refresh();
        this.quickActionLoading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось взять чат (возможно, уже назначен)');
        this.quickActionLoading.set(false);
      },
    });
  }

  quickTakeTask(item: InboxItem): void {
    this.quickActionLoading.set(true);
    this.tasksApi.assignTask(item.id, 'me').subscribe({
      next: () => {
        this.toast.success('Задача назначена вам');
        this.inboxService.refresh();
        this.quickActionLoading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось взять задачу');
        this.quickActionLoading.set(false);
      },
    });
  }

  quickConfirmBooking(item: InboxItem): void {
    this.quickActionLoading.set(true);
    this.http.put<{ success: boolean }>(`/api/crm-booking/${item.id}/status`, { status: 'confirmed' }).subscribe({
      next: () => {
        this.toast.success('Запись подтверждена');
        this.inboxService.refresh();
        this.quickActionLoading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось подтвердить запись');
        this.quickActionLoading.set(false);
      },
    });
  }

  quickProcessOrder(item: InboxItem): void {
    this.quickActionLoading.set(true);
    const orderId = this.metadataString(item, 'orderId') || item.id;
    this.ordersApi.updateStatus(orderId, 'processing').subscribe({
      next: () => {
        this.toast.success('Заказ взят в работу');
        this.inboxService.refresh();
        this.quickActionLoading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось обновить заказ');
        this.quickActionLoading.set(false);
      },
    });
  }

  quickMarkOrderPaid(item: InboxItem): void {
    this.quickActionLoading.set(true);
    const orderId = this.metadataString(item, 'orderId') || item.id;
    this.ordersApi.markPaid(orderId, { method: 'transfer' }).subscribe({
      next: () => {
        this.toast.success('Заказ отмечен как оплаченный');
        this.inboxService.refresh();
        this.quickActionLoading.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.error || 'Не удалось отметить оплату');
        this.quickActionLoading.set(false);
      },
    });
  }
}
