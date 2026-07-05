import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  untracked,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';

import {
  KnowledgeBaseService,
  KBCategory,
  KBEntitySummary,
  KBDashboard,
  KBEntityType,
  KBStatus,
  KBSearchResult,
  KBFuzzyResult,
  KBEnrichmentTask,
  KBDataSource,
  KBAccessRule,
} from '../../services/knowledge-base.service';
import { formatRelativeTime } from '../../utils/crm-helpers';
import { CrmTickService } from '../../services/crm-tick.service';

type ViewMode = 'dashboard' | 'entities' | 'search' | 'enrichment' | 'sources' | 'access';

const ENTITY_TYPE_LABELS: Record<KBEntityType, string> = {
  service: 'Услуга',
  equipment: 'Оборудование',
  location: 'Локация',
  person: 'Человек',
  competitor: 'Конкурент',
  process: 'Процесс',
  faq: 'FAQ',
  usp: 'УТП',
  content: 'Контент',
  market_insight: 'Инсайт',
  product: 'Товар',
  brand_asset: 'Бренд-актив',
};

const ENTITY_TYPE_ICONS: Record<KBEntityType, string> = {
  service: 'camera_alt',
  equipment: 'build',
  location: 'location_on',
  person: 'person',
  competitor: 'analytics',
  process: 'account_tree',
  faq: 'help',
  usp: 'emoji_events',
  content: 'edit_note',
  market_insight: 'trending_up',
  product: 'inventory_2',
  brand_asset: 'palette',
};

const STATUS_LABELS: Record<KBStatus, string> = {
  draft: 'Черновик',
  active: 'Активно',
  archived: 'Архив',
  deprecated: 'Устарело',
  review: 'На проверке',
};

@Component({
  selector: 'app-knowledge-base',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatChipsModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatBadgeModule,
    MatTabsModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="kb-container">
      <!-- Header -->
      <header class="kb-header">
        <div class="kb-header__left">
          <h1 class="kb-title">БАЗА ЗНАНИЙ</h1>
          <div class="kb-subtitle">
            @if (dashboard()) {
              <span class="kb-stat">{{ dashboard()!.total_entities }} записей</span>
              <span class="kb-stat-sep">•</span>
              <span class="kb-stat">{{ dashboard()!.relation_count }} связей</span>
              @if (dashboard()!.unverified_count > 0) {
                <span class="kb-stat-sep">•</span>
                <span class="kb-stat kb-stat--warn">{{ dashboard()!.unverified_count }} на проверке</span>
              }
            }
          </div>
        </div>
        <div class="kb-header__right">
          <div class="kb-search-box">
            <mat-icon class="kb-search-icon">search</mat-icon>
            <input
              type="text"
              class="kb-search-input"
              placeholder="Поиск по базе знаний..."
              [ngModel]="searchQuery()"
              (ngModelChange)="onSearchInput($event)"
              (focus)="showSuggestions.set(true)"
            />
            @if (searchQuery()) {
              <button class="kb-search-clear" (click)="clearSearch()">
                <mat-icon>close</mat-icon>
              </button>
            }
            <!-- Suggestions dropdown -->
            @if (showSuggestions() && suggestions().length > 0) {
              <div class="kb-suggestions">
                @for (s of suggestions(); track s.id) {
                  <div class="kb-suggestion" tabindex="0" role="button" (click)="navigateToEntity(s.slug)" (keydown.enter)="navigateToEntity(s.slug)">
                    <mat-icon class="kb-suggestion__icon">{{ getTypeIcon(s.entity_type) }}</mat-icon>
                    <div class="kb-suggestion__text">
                      <span class="kb-suggestion__name">{{ s.name }}</span>
                      <span class="kb-suggestion__type">{{ getTypeLabel(s.entity_type) }}</span>
                    </div>
                    <span class="kb-suggestion__score">{{ (s.similarity * 100).toFixed(0) }}%</span>
                  </div>
                }
              </div>
            }
          </div>
          <button mat-icon-button [matMenuTriggerFor]="actionsMenu" matTooltip="Действия">
            <mat-icon>more_vert</mat-icon>
          </button>
          <mat-menu #actionsMenu="matMenu">
            <button mat-menu-item (click)="batchEmbed()">
              <mat-icon>auto_fix_high</mat-icon>
              <span>Генерировать embeddings</span>
            </button>
            <button mat-menu-item (click)="exportEntities()">
              <mat-icon>download</mat-icon>
              <span>Экспорт JSON</span>
            </button>
          </mat-menu>
        </div>
      </header>

      <!-- Navigation tabs -->
      <nav class="kb-tabs">
        @for (tab of tabs; track tab.id) {
          <button
            class="kb-tab"
            [class.kb-tab--active]="viewMode() === tab.id"
            (click)="viewMode.set(tab.id)"
            [matBadge]="tab.badge?.()"
            [matBadgeHidden]="!tab.badge || !tab.badge()"
            matBadgeColor="warn"
            matBadgeSize="small"
          >
            <mat-icon>{{ tab.icon }}</mat-icon>
            <span>{{ tab.label }}</span>
          </button>
        }
      </nav>

      <!-- Content -->
      <main class="kb-content">
        @switch (viewMode()) {
          @case ('dashboard') {
            @if (dashboardLoading()) {
              <div class="kb-loading"><mat-spinner diameter="40"></mat-spinner></div>
            } @else if (error()) {
              <div class="kb-error-state">
                <mat-icon>cloud_off</mat-icon>
                <p>{{ error() }}</p>
                <button mat-flat-button color="primary" (click)="retry()">Повторить</button>
              </div>
            } @else if (dashboard()) {
              <div class="kb-dashboard">
                <!-- Stats cards -->
                <div class="kb-stats-grid">
                  @for (stat of dashboardStats(); track stat.label) {
                    <div class="kb-stat-card">
                      <mat-icon class="kb-stat-card__icon">{{ stat.icon }}</mat-icon>
                      <div class="kb-stat-card__value">{{ stat.value }}</div>
                      <div class="kb-stat-card__label">{{ stat.label }}</div>
                    </div>
                  }
                </div>

                <!-- Entity types distribution -->
                <div class="kb-section">
                  <h2 class="kb-section__title">ПО ТИПАМ</h2>
                  <div class="kb-type-grid">
                    @for (t of dashboard()!.entities_by_type; track t.type_name) {
                      <button
                        class="kb-type-card"
                        (click)="filterByType(t.type_name)"
                      >
                        <mat-icon>{{ getTypeIcon(t.type_name) }}</mat-icon>
                        <span class="kb-type-card__count">{{ t.count }}</span>
                        <span class="kb-type-card__label">{{ getTypeLabel(t.type_name) }}</span>
                      </button>
                    }
                  </div>
                </div>

                <!-- Category coverage -->
                <div class="kb-section">
                  <h2 class="kb-section__title">ПОКРЫТИЕ КАТЕГОРИЙ</h2>
                  <div class="kb-category-bars">
                    @for (cat of dashboard()!.category_coverage; track cat.slug) {
                      <div class="kb-category-bar">
                        <div class="kb-category-bar__header">
                          <span class="kb-category-bar__name">{{ cat.name }}</span>
                          <span class="kb-category-bar__count">{{ cat.entity_count }}</span>
                        </div>
                        <div class="kb-category-bar__track">
                          <div
                            class="kb-category-bar__fill"
                            [style.width.%]="getCategoryPercent(cat.entity_count)"
                          ></div>
                        </div>
                      </div>
                    }
                  </div>
                </div>

                <!-- Recent changes -->
                <div class="kb-section">
                  <h2 class="kb-section__title">ПОСЛЕДНИЕ ИЗМЕНЕНИЯ</h2>
                  <div class="kb-changes">
                    @for (change of dashboard()!.recent_changes.slice(0, 10); track change.entity_id + change.changed_at) {
                      <div class="kb-change" tabindex="0" role="button" (click)="navigateToEntityById(change.entity_id)" (keydown.enter)="navigateToEntityById(change.entity_id)">
                        <div class="kb-change__type" [attr.data-type]="change.change_type">
                          {{ change.change_type }}
                        </div>
                        <div class="kb-change__info">
                          <span class="kb-change__name">{{ change.entity_name }}</span>
                          <span class="kb-change__meta">
                            {{ getTypeLabel(change.entity_type) }}
                            @if (change.changed_by_name) {
                              • {{ change.changed_by_name }}
                            }
                          </span>
                        </div>
                        <div class="kb-change__time">{{ formatRelativeTime(change.changed_at) }}</div>
                      </div>
                    }
                  </div>
                </div>
              </div>
            }
          }

          @case ('entities') {
            <div class="kb-entities">
              <!-- Filters -->
              <div class="kb-filters">
                <div class="kb-filter-row">
                  <!-- Category tree (collapsed) -->
                  <div class="kb-filter-group">
                    <button
                      class="kb-filter-btn"
                      [matMenuTriggerFor]="categoryMenu"
                    >
                      <mat-icon>folder</mat-icon>
                      {{ selectedCategory() ? getCategoryName(selectedCategory()!) : 'Все категории' }}
                      <mat-icon>arrow_drop_down</mat-icon>
                    </button>
                    <mat-menu #categoryMenu="matMenu">
                      <button mat-menu-item (click)="selectedCategory.set(null)">
                        <mat-icon>folder_open</mat-icon>
                        Все категории
                      </button>
                      @for (cat of rootCategories(); track cat.slug) {
                        <button mat-menu-item (click)="selectedCategory.set(cat.slug)">
                          <mat-icon>{{ cat.icon || 'folder' }}</mat-icon>
                          {{ cat.name }} ({{ cat.entity_count }})
                        </button>
                      }
                    </mat-menu>
                  </div>

                  <!-- Entity type filter -->
                  <div class="kb-filter-group">
                    <button
                      class="kb-filter-btn"
                      [matMenuTriggerFor]="typeMenu"
                    >
                      <mat-icon>{{ selectedType() ? getTypeIcon(selectedType()!) : 'category' }}</mat-icon>
                      {{ selectedType() ? getTypeLabel(selectedType()!) : 'Все типы' }}
                      <mat-icon>arrow_drop_down</mat-icon>
                    </button>
                    <mat-menu #typeMenu="matMenu">
                      <button mat-menu-item (click)="selectedType.set(null)">
                        <mat-icon>category</mat-icon>
                        Все типы
                      </button>
                      @for (type of entityTypes; track type) {
                        <button mat-menu-item (click)="selectedType.set(type)">
                          <mat-icon>{{ getTypeIcon(type) }}</mat-icon>
                          {{ getTypeLabel(type) }}
                        </button>
                      }
                    </mat-menu>
                  </div>

                  <!-- Status filter -->
                  <div class="kb-filter-group">
                    <button
                      class="kb-filter-btn"
                      [matMenuTriggerFor]="statusMenu"
                    >
                      {{ selectedStatus() ? getStatusLabel(selectedStatus()!) : 'Все статусы' }}
                      <mat-icon>arrow_drop_down</mat-icon>
                    </button>
                    <mat-menu #statusMenu="matMenu">
                      <button mat-menu-item (click)="selectedStatus.set(null)">Все статусы</button>
                      @for (s of statuses; track s) {
                        <button mat-menu-item (click)="selectedStatus.set(s)">{{ getStatusLabel(s) }}</button>
                      }
                    </mat-menu>
                  </div>

                  <!-- Verified filter -->
                  <button
                    class="kb-filter-btn"
                    [class.kb-filter-btn--active]="onlyUnverified()"
                    (click)="onlyUnverified.set(!onlyUnverified())"
                  >
                    <mat-icon>{{ onlyUnverified() ? 'verified' : 'check_circle_outline' }}</mat-icon>
                    Не верифицированы
                  </button>
                </div>
              </div>

              <!-- Entity list -->
              @if (entitiesLoading()) {
                <div class="kb-loading"><mat-spinner diameter="32"></mat-spinner></div>
              } @else if (error()) {
                <div class="kb-error-state">
                  <mat-icon>cloud_off</mat-icon>
                  <p>{{ error() }}</p>
                  <button mat-flat-button color="primary" (click)="retry()">Повторить</button>
                </div>
              } @else {
                <div class="kb-entity-list">
                  @for (entity of entities(); track entity.id) {
                    <div class="kb-entity-row" tabindex="0" role="button" (click)="navigateToEntity(entity.slug)" (keydown.enter)="navigateToEntity(entity.slug)">
                      <div class="kb-entity-row__icon">
                        <mat-icon>{{ getTypeIcon(entity.entity_type) }}</mat-icon>
                      </div>
                      <div class="kb-entity-row__main">
                        <div class="kb-entity-row__name">
                          {{ entity.name }}
                          @if (entity.is_verified) {
                            <mat-icon class="kb-verified-badge" matTooltip="Верифицировано">verified</mat-icon>
                          }
                        </div>
                        <div class="kb-entity-row__meta">
                          <span class="kb-entity-row__type">{{ getTypeLabel(entity.entity_type) }}</span>
                          @if (entity.category_path) {
                            <span class="kb-meta-sep">›</span>
                            <span>{{ entity.category_path }}</span>
                          }
                          @if (entity.tags.length) {
                            @for (tag of entity.tags.slice(0, 3); track tag) {
                              <span class="kb-tag">{{ tag }}</span>
                            }
                          }
                        </div>
                      </div>
                      <div class="kb-entity-row__status" [attr.data-status]="entity.status">
                        {{ getStatusLabel(entity.status) }}
                      </div>
                      <div class="kb-entity-row__confidence">
                        {{ (entity.confidence * 100).toFixed(0) }}%
                      </div>
                      <div class="kb-entity-row__date">
                        {{ formatRelativeTime(entity.updated_at) }}
                      </div>
                    </div>
                  } @empty {
                    <div class="kb-empty">
                      <mat-icon>inventory_2</mat-icon>
                      <span>Нет записей по заданным фильтрам</span>
                    </div>
                  }
                </div>
              }
            </div>
          }

          @case ('search') {
            <div class="kb-search-results">
              @if (searchLoading()) {
                <div class="kb-loading"><mat-spinner diameter="32"></mat-spinner></div>
              } @else if (searchResults().length > 0) {
                <div class="kb-search-meta">
                  {{ searchTotal() }} результатов для «{{ lastSearchQuery() }}»
                </div>
                @for (r of searchResults(); track r.id) {
                  <div class="kb-search-result" tabindex="0" role="button" (click)="navigateToEntity(r.slug)" (keydown.enter)="navigateToEntity(r.slug)">
                    <div class="kb-search-result__header">
                      <mat-icon>{{ getTypeIcon(r.entity_type) }}</mat-icon>
                      <span class="kb-search-result__name">{{ r.name }}</span>
                      <span class="kb-search-result__path">{{ r.category_path }}</span>
                    </div>
                    <div class="kb-search-result__headline" [innerHTML]="r.headline"></div>
                    @if (r.tags.length) {
                      <div class="kb-search-result__tags">
                        @for (tag of r.tags; track tag) {
                          <span class="kb-tag">{{ tag }}</span>
                        }
                      </div>
                    }
                  </div>
                }
              } @else if (lastSearchQuery()) {
                <div class="kb-empty">
                  <mat-icon>search_off</mat-icon>
                  <span>Ничего не найдено для «{{ lastSearchQuery() }}»</span>
                </div>
              }
            </div>
          }

          @case ('enrichment') {
            <div class="kb-enrichment">
              <div class="kb-section__title-row">
                <h2 class="kb-section__title">ОЧЕРЕДЬ ОБОГАЩЕНИЯ</h2>
                <button mat-stroked-button (click)="loadEnrichment()">
                  <mat-icon>refresh</mat-icon> Обновить
                </button>
              </div>
              @if (enrichmentLoading()) {
                <div class="kb-loading"><mat-spinner diameter="32"></mat-spinner></div>
              } @else if (error()) {
                <div class="kb-error-state">
                  <mat-icon>cloud_off</mat-icon>
                  <p>{{ error() }}</p>
                  <button mat-flat-button color="primary" (click)="retry()">Повторить</button>
                </div>
              } @else {
                @for (task of enrichmentTasks(); track task.id) {
                  <div class="kb-enrichment-row" [attr.data-status]="task.status">
                    <div class="kb-enrichment-row__status">{{ task.status }}</div>
                    <div class="kb-enrichment-row__type">{{ task.task_type }}</div>
                    <div class="kb-enrichment-row__entity">
                      {{ task.entity_name || '—' }}
                    </div>
                    <div class="kb-enrichment-row__attempts">{{ task.attempts }}/{{ task.max_attempts }}</div>
                    <div class="kb-enrichment-row__time">{{ formatRelativeTime(task.scheduled_at) }}</div>
                    <div class="kb-enrichment-row__actions">
                      @if (task.status === 'failed') {
                        <button mat-icon-button matTooltip="Повторить" (click)="retryTask(task.id); $event.stopPropagation()">
                          <mat-icon>replay</mat-icon>
                        </button>
                      }
                      @if (task.status === 'pending') {
                        <button mat-icon-button matTooltip="Отменить" (click)="cancelTask(task.id); $event.stopPropagation()">
                          <mat-icon>cancel</mat-icon>
                        </button>
                      }
                    </div>
                  </div>
                } @empty {
                  <div class="kb-empty">
                    <mat-icon>check_circle</mat-icon>
                    <span>Нет задач в очереди</span>
                  </div>
                }
              }
            </div>
          }

          @case ('sources') {
            <div class="kb-sources">
              <h2 class="kb-section__title">ИСТОЧНИКИ ДАННЫХ</h2>
              @if (sourcesLoading()) {
                <div class="kb-loading"><mat-spinner diameter="32"></mat-spinner></div>
              } @else if (error()) {
                <div class="kb-error-state">
                  <mat-icon>cloud_off</mat-icon>
                  <p>{{ error() }}</p>
                  <button mat-flat-button color="primary" (click)="retry()">Повторить</button>
                </div>
              }
              @for (source of dataSources(); track source.id) {
                <div class="kb-source-row" [class.kb-source-row--inactive]="!source.is_active">
                  <mat-icon>{{ getSourceIcon(source.source_type) }}</mat-icon>
                  <div class="kb-source-row__info">
                    <span class="kb-source-row__name">{{ source.name }}</span>
                    <span class="kb-source-row__meta">
                      {{ source.source_type }} • {{ source.entity_count }} записей
                      @if (source.last_synced_at) {
                        • синхр. {{ formatRelativeTime(source.last_synced_at) }}
                      }
                    </span>
                  </div>
                  <div class="kb-source-row__status" [attr.data-status]="source.sync_status">
                    {{ source.sync_status || 'idle' }}
                  </div>
                  <button
                    mat-icon-button
                    matTooltip="Синхронизировать"
                    (click)="syncSource(source.slug)"
                    [disabled]="source.sync_status === 'syncing'"
                  >
                    <mat-icon>sync</mat-icon>
                  </button>
                </div>
              }
            </div>
          }

          @case ('access') {
            <div class="kb-access">
              <h2 class="kb-section__title">ПРАВИЛА ДОСТУПА (RBAC)</h2>
              @if (accessLoading()) {
                <div class="kb-loading"><mat-spinner diameter="32"></mat-spinner></div>
              } @else if (error()) {
                <div class="kb-error-state">
                  <mat-icon>cloud_off</mat-icon>
                  <p>{{ error() }}</p>
                  <button mat-flat-button color="primary" (click)="retry()">Повторить</button>
                </div>
              }
              @for (rule of accessRules(); track rule.id) {
                <div class="kb-access-row">
                  <span class="kb-access-row__role">{{ rule.role }}</span>
                  <span class="kb-access-row__scope">
                    {{ rule.category_slug || '*' }} / {{ rule.entity_type || '*' }}
                  </span>
                  <div class="kb-access-row__perms">
                    @for (perm of ['read','create','update','delete','verify','export']; track perm) {
                      <span
                        class="kb-perm"
                        [class.kb-perm--yes]="$any(rule)['can_' + perm]"
                        [matTooltip]="perm"
                      >{{ perm.charAt(0).toUpperCase() }}</span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .kb-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #0c0b09;
      color: #e8e4dc;
    }

    /* Header */
    .kb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid rgba(245,158,11,0.15);
    }

    .kb-title {
      font-family: 'Oswald', sans-serif;
      font-weight: 600;
      font-size: 22px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #f59e0b;
      margin: 0;
    }

    .kb-subtitle {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
      font-size: 12px;
      color: rgba(232,228,220,0.5);
    }

    .kb-stat--warn { color: #f59e0b; }
    .kb-stat-sep { opacity: 0.3; }

    .kb-header__right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Search box */
    .kb-search-box {
      position: relative;
      display: flex;
      align-items: center;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 0 12px;
      width: 320px;
      backdrop-filter: blur(16px);
    }

    .kb-search-icon { color: rgba(232,228,220,0.4); font-size: 20px; }

    .kb-search-input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: #e8e4dc;
      font-size: 13px;
      padding: 10px 8px;
      font-family: inherit;
    }

    .kb-search-input::placeholder { color: rgba(232,228,220,0.3); }

    .kb-search-clear {
      background: none;
      border: none;
      color: rgba(232,228,220,0.4);
      cursor: pointer;
      padding: 0;
      display: flex;
    }
    .kb-search-clear mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Suggestions */
    .kb-suggestions {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      background: rgba(27,26,23,0.95);
      border: 1px solid rgba(245,158,11,0.2);
      border-radius: 12px;
      backdrop-filter: blur(16px);
      overflow: hidden;
      z-index: 100;
    }

    .kb-suggestion {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .kb-suggestion:hover { background: rgba(245,158,11,0.1); }
    .kb-suggestion__icon { color: rgba(232,228,220,0.4); font-size: 18px; }
    .kb-suggestion__text { flex: 1; min-width: 0; }
    .kb-suggestion__name { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kb-suggestion__type { font-size: 11px; color: rgba(232,228,220,0.4); }
    .kb-suggestion__score { font-size: 11px; color: #f59e0b; font-weight: 600; }

    /* Tabs */
    .kb-tabs {
      display: flex;
      gap: 2px;
      padding: 0 24px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      background: rgba(19,18,16,0.6);
    }

    .kb-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 16px;
      border: none;
      background: none;
      color: rgba(232,228,220,0.5);
      font-size: 12px;
      font-family: 'Oswald', sans-serif;
      font-weight: 500;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .kb-tab mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .kb-tab:hover { color: rgba(232,228,220,0.8); }
    .kb-tab--active {
      color: #f59e0b;
      border-bottom-color: #f59e0b;
    }

    /* Content */
    .kb-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
    }

    .kb-loading {
      display: flex;
      justify-content: center;
      padding: 60px 0;
    }

    .kb-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 60px 0;
      color: rgba(232,228,220,0.3);
      font-size: 14px;
    }
    .kb-empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }

    .kb-error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 60px 0;
      color: rgba(239,68,68,0.7);
      font-size: 14px;
    }
    .kb-error-state mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.5; }
    .kb-error-state p { margin: 0; max-width: 400px; text-align: center; }

    /* Dashboard */
    .kb-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }

    .kb-stat-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      padding: 16px;
      backdrop-filter: blur(16px);
    }
    .kb-stat-card__icon { color: #f59e0b; font-size: 20px; margin-bottom: 8px; }
    .kb-stat-card__value { font-size: 28px; font-weight: 700; color: #e8e4dc; font-family: 'Oswald', sans-serif; }
    .kb-stat-card__label { font-size: 11px; color: rgba(232,228,220,0.4); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.04em; }

    .kb-section { margin-bottom: 28px; }
    .kb-section__title {
      font-family: 'Oswald', sans-serif;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: rgba(232,228,220,0.5);
      margin: 0 0 14px;
    }
    .kb-section__title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }

    .kb-type-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 8px;
    }

    .kb-type-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 14px 8px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
      color: #e8e4dc;
    }
    .kb-type-card:hover { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.05); }
    .kb-type-card mat-icon { color: rgba(232,228,220,0.4); font-size: 20px; }
    .kb-type-card__count { font-size: 20px; font-weight: 700; font-family: 'Oswald', sans-serif; }
    .kb-type-card__label { font-size: 10px; text-transform: uppercase; color: rgba(232,228,220,0.4); letter-spacing: 0.03em; }

    /* Category bars */
    .kb-category-bar { margin-bottom: 10px; }
    .kb-category-bar__header { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .kb-category-bar__name { font-size: 12px; }
    .kb-category-bar__count { font-size: 12px; color: rgba(232,228,220,0.4); }
    .kb-category-bar__track { height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
    .kb-category-bar__fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #d97706); border-radius: 2px; transition: width 0.5s ease; }

    /* Recent changes */
    .kb-change {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      cursor: pointer;
      transition: background 0.15s;
    }
    .kb-change:hover { background: rgba(245,158,11,0.03); }
    .kb-change__type {
      font-size: 10px;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(255,255,255,0.06);
      font-weight: 600;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .kb-change__type[data-type="create"] { background: rgba(34,197,94,0.15); color: #22c55e; }
    .kb-change__type[data-type="update"] { background: rgba(59,130,246,0.15); color: #3b82f6; }
    .kb-change__type[data-type="verify"] { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .kb-change__type[data-type="archive"] { background: rgba(239,68,68,0.15); color: #ef4444; }
    .kb-change__info { flex: 1; min-width: 0; }
    .kb-change__name { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kb-change__meta { font-size: 11px; color: rgba(232,228,220,0.4); }
    .kb-change__time { font-size: 11px; color: rgba(232,228,220,0.3); white-space: nowrap; }

    /* Filters */
    .kb-filters { margin-bottom: 16px; }
    .kb-filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .kb-filter-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      background: rgba(255,255,255,0.03);
      color: rgba(232,228,220,0.7);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .kb-filter-btn:hover { border-color: rgba(245,158,11,0.3); }
    .kb-filter-btn--active { border-color: #f59e0b; color: #f59e0b; background: rgba(245,158,11,0.1); }
    .kb-filter-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* Entity list */
    .kb-entity-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      cursor: pointer;
      transition: background 0.15s;
      border-radius: 8px;
    }
    .kb-entity-row:hover { background: rgba(245,158,11,0.04); }
    .kb-entity-row__icon { color: rgba(232,228,220,0.3); }
    .kb-entity-row__icon mat-icon { font-size: 20px; }
    .kb-entity-row__main { flex: 1; min-width: 0; }
    .kb-entity-row__name {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .kb-verified-badge { color: #22c55e; font-size: 14px !important; width: 14px !important; height: 14px !important; }
    .kb-entity-row__meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: rgba(232,228,220,0.4);
      margin-top: 2px;
    }
    .kb-entity-row__type { font-weight: 500; }
    .kb-meta-sep { opacity: 0.3; }
    .kb-tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 6px;
      background: rgba(245,158,11,0.1);
      color: #f59e0b;
      font-size: 10px;
    }
    .kb-entity-row__status {
      font-size: 10px;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .kb-entity-row__status[data-status="active"] { background: rgba(34,197,94,0.12); color: #22c55e; }
    .kb-entity-row__status[data-status="draft"] { background: rgba(148,163,184,0.12); color: #94a3b8; }
    .kb-entity-row__status[data-status="review"] { background: rgba(245,158,11,0.12); color: #f59e0b; }
    .kb-entity-row__status[data-status="archived"] { background: rgba(239,68,68,0.12); color: #ef4444; }
    .kb-entity-row__confidence { font-size: 12px; color: rgba(232,228,220,0.4); min-width: 36px; text-align: right; }
    .kb-entity-row__date { font-size: 11px; color: rgba(232,228,220,0.3); min-width: 60px; text-align: right; }

    /* Search results */
    .kb-search-meta { font-size: 12px; color: rgba(232,228,220,0.4); margin-bottom: 16px; }
    .kb-search-result {
      padding: 14px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      cursor: pointer;
      transition: background 0.15s;
    }
    .kb-search-result:hover { background: rgba(245,158,11,0.04); }
    .kb-search-result__header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .kb-search-result__header mat-icon { font-size: 18px; color: rgba(232,228,220,0.4); }
    .kb-search-result__name { font-weight: 500; font-size: 14px; }
    .kb-search-result__path { font-size: 11px; color: rgba(232,228,220,0.3); margin-left: auto; }
    .kb-search-result__headline { font-size: 13px; color: rgba(232,228,220,0.6); line-height: 1.5; }
    .kb-search-result__headline :deep(b), .kb-search-result__headline :deep(strong) { color: #f59e0b; font-weight: 600; }
    .kb-search-result__tags { display: flex; gap: 4px; margin-top: 6px; }

    /* Enrichment */
    .kb-enrichment-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .kb-enrichment-row__status {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      min-width: 80px;
      text-align: center;
    }
    .kb-enrichment-row[data-status="pending"] .kb-enrichment-row__status { background: rgba(245,158,11,0.12); color: #f59e0b; }
    .kb-enrichment-row[data-status="processing"] .kb-enrichment-row__status { background: rgba(59,130,246,0.12); color: #3b82f6; }
    .kb-enrichment-row[data-status="completed"] .kb-enrichment-row__status { background: rgba(34,197,94,0.12); color: #22c55e; }
    .kb-enrichment-row[data-status="failed"] .kb-enrichment-row__status { background: rgba(239,68,68,0.12); color: #ef4444; }
    .kb-enrichment-row__type { font-size: 12px; font-weight: 500; min-width: 120px; }
    .kb-enrichment-row__entity { flex: 1; font-size: 13px; color: rgba(232,228,220,0.6); }
    .kb-enrichment-row__attempts { font-size: 11px; color: rgba(232,228,220,0.3); }
    .kb-enrichment-row__time { font-size: 11px; color: rgba(232,228,220,0.3); min-width: 60px; }

    /* Sources */
    .kb-source-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .kb-source-row--inactive { opacity: 0.5; }
    .kb-source-row mat-icon { color: rgba(232,228,220,0.4); }
    .kb-source-row__info { flex: 1; }
    .kb-source-row__name { display: block; font-size: 13px; font-weight: 500; }
    .kb-source-row__meta { font-size: 11px; color: rgba(232,228,220,0.4); }
    .kb-source-row__status { font-size: 10px; text-transform: uppercase; }
    .kb-source-row__status[data-status="syncing"] { color: #3b82f6; }
    .kb-source-row__status[data-status="error"] { color: #ef4444; }

    /* Access rules */
    .kb-access-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .kb-access-row__role { font-weight: 600; font-size: 13px; min-width: 100px; }
    .kb-access-row__scope { font-size: 12px; color: rgba(232,228,220,0.4); flex: 1; font-family: monospace; }
    .kb-access-row__perms { display: flex; gap: 4px; }
    .kb-perm {
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      background: rgba(239,68,68,0.12);
      color: #ef4444;
    }
    .kb-perm--yes { background: rgba(34,197,94,0.12); color: #22c55e; }
  `],
})
export class KnowledgeBaseComponent implements OnInit {
  private readonly kb = inject(KnowledgeBaseService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  readonly tickService = inject(CrmTickService);

  // State
  readonly viewMode = signal<ViewMode>('dashboard');
  readonly searchQuery = signal('');
  readonly showSuggestions = signal(false);
  readonly suggestions = signal<KBFuzzyResult[]>([]);

  // Dashboard
  readonly dashboard = signal<KBDashboard | null>(null);
  readonly dashboardLoading = signal(false);

  // Entities
  readonly entities = signal<KBEntitySummary[]>([]);
  readonly entitiesLoading = signal(false);
  readonly categories = signal<KBCategory[]>([]);
  readonly selectedCategory = signal<string | null>(null);
  readonly selectedType = signal<KBEntityType | null>(null);
  readonly selectedStatus = signal<KBStatus | null>(null);
  readonly onlyUnverified = signal(false);

  // Search
  readonly searchResults = signal<KBSearchResult[]>([]);
  readonly searchTotal = signal(0);
  readonly lastSearchQuery = signal('');
  readonly searchLoading = signal(false);

  // Enrichment
  readonly enrichmentTasks = signal<KBEnrichmentTask[]>([]);
  readonly enrichmentLoading = signal(false);

  // Sources
  readonly dataSources = signal<KBDataSource[]>([]);
  readonly sourcesLoading = signal(false);

  // Access
  readonly accessRules = signal<KBAccessRule[]>([]);
  readonly accessLoading = signal(false);

  // Error state
  readonly error = signal<string | null>(null);

  // Derived
  readonly rootCategories = computed(() =>
    this.categories().filter(c => c.depth === 0 && c.is_active)
  );

  readonly dashboardStats = computed(() => {
    const d = this.dashboard();
    if (!d) return [];
    return [
      { icon: 'inventory_2', value: d.total_entities, label: 'Записей' },
      { icon: 'link', value: d.relation_count, label: 'Связей' },
      { icon: 'pending', value: d.unverified_count, label: 'На проверке' },
      { icon: 'auto_fix_high', value: d.enrichment_pending, label: 'В очереди' },
      { icon: 'error_outline', value: d.enrichment_failed, label: 'Ошибки' },
    ];
  });

  // Search debounce
  private readonly searchSubject = new Subject<string>();

  // Tabs
  readonly entityTypes = Object.keys(ENTITY_TYPE_LABELS) as KBEntityType[];
  readonly statuses: KBStatus[] = ['draft', 'active', 'review', 'archived', 'deprecated'];

  readonly tabs = [
    { id: 'dashboard' as ViewMode, label: 'Обзор', icon: 'dashboard', badge: undefined },
    { id: 'entities' as ViewMode, label: 'Записи', icon: 'inventory_2', badge: () => this.dashboard()?.total_entities },
    { id: 'search' as ViewMode, label: 'Поиск', icon: 'search', badge: undefined },
    { id: 'enrichment' as ViewMode, label: 'Обогащение', icon: 'auto_fix_high', badge: () => this.dashboard()?.enrichment_pending || 0 },
    { id: 'sources' as ViewMode, label: 'Источники', icon: 'storage', badge: undefined },
    { id: 'access' as ViewMode, label: 'Доступ', icon: 'admin_panel_settings', badge: undefined },
  ];

  // Import types for template
  private readonly enrichmentType = signal<KBEnrichmentTask[]>([]);
  private readonly sourceType = signal<KBDataSource[]>([]);
  private readonly accessType = signal<KBAccessRule[]>([]);

  private readonly tabEffect = effect(() => {
    this.viewMode();
    untracked(() => this.onTabChange());
  });

  ngOnInit(): void {
    this.loadDashboard();
    this.loadCategories();

    // Search suggest with debounce
    this.searchSubject.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap(q => {
        if (!q || q.length < 2) return of([]);
        return this.kb.suggest({ q, limit: 8 }).pipe(catchError(() => of([])));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => {
      this.suggestions.set(results);
    });
  }

  // ── Data Loading ──

  loadDashboard(): void {
    this.dashboardLoading.set(true);
    this.error.set(null);
    this.kb.getDashboard().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: d => { this.dashboard.set(d); this.dashboardLoading.set(false); },
      error: () => {
        this.dashboardLoading.set(false);
        this.error.set('Не удалось загрузить данные. Убедитесь, что KB API запущен.');
      },
    });
  }

  loadCategories(): void {
    this.kb.listCategories().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(cats => this.categories.set(cats));
  }

  loadEntities(): void {
    this.entitiesLoading.set(true);
    this.error.set(null);
    this.kb.listEntities({
      category: this.selectedCategory() ?? undefined,
      entity_type: this.selectedType() ?? undefined,
      status: this.selectedStatus() ?? undefined,
      verified: this.onlyUnverified() ? false : undefined,
      limit: 100,
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: e => { this.entities.set(e); this.entitiesLoading.set(false); },
      error: () => {
        this.entitiesLoading.set(false);
        this.error.set('Не удалось загрузить записи');
      },
    });
  }

  loadEnrichment(): void {
    this.enrichmentLoading.set(true);
    this.error.set(null);
    this.kb.listEnrichmentTasks({ limit: 50 }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: t => { this.enrichmentTasks.set(t); this.enrichmentLoading.set(false); },
      error: () => {
        this.enrichmentLoading.set(false);
        this.error.set('Не удалось загрузить задачи обогащения');
      },
    });
  }

  loadSources(): void {
    this.sourcesLoading.set(true);
    this.error.set(null);
    this.kb.listSources().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: s => { this.dataSources.set(s); this.sourcesLoading.set(false); },
      error: () => {
        this.sourcesLoading.set(false);
        this.error.set('Не удалось загрузить источники');
      },
    });
  }

  loadAccess(): void {
    this.accessLoading.set(true);
    this.error.set(null);
    this.kb.listAccessRules().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: r => { this.accessRules.set(r); this.accessLoading.set(false); },
      error: () => {
        this.accessLoading.set(false);
        this.error.set('Не удалось загрузить правила доступа');
      },
    });
  }

  // ── Search ──

  onSearchInput(q: string): void {
    this.searchQuery.set(q);
    this.searchSubject.next(q);

    if (q.length >= 3) {
      // Full search after 500ms debounce
      this.performSearch(q);
    }
  }

  private performSearch(q: string): void {
    this.searchLoading.set(true);
    this.viewMode.set('search');
    this.showSuggestions.set(false);
    this.lastSearchQuery.set(q);

    this.kb.search({ q, limit: 50 }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: r => {
        this.searchResults.set(r.results);
        this.searchTotal.set(r.total);
        this.searchLoading.set(false);
      },
      error: () => this.searchLoading.set(false),
    });
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.suggestions.set([]);
    this.showSuggestions.set(false);
  }

  // ── Actions ──

  navigateToEntity(slug: string): void {
    this.showSuggestions.set(false);
    this.router.navigate(['/employee/knowledge', slug]);
  }

  navigateToEntityById(id: string): void {
    this.router.navigate(['/employee/knowledge', id]);
  }

  filterByType(type: string): void {
    this.selectedType.set(type as KBEntityType);
    this.viewMode.set('entities');
    this.loadEntities();
  }

  retryTask(id: string): void {
    this.kb.retryEnrichmentTask(id).subscribe(() => {
      this.snack.open('Задача перезапущена', '', { duration: 2000 });
      this.loadEnrichment();
    });
  }

  cancelTask(id: string): void {
    this.kb.cancelEnrichmentTask(id).subscribe(() => {
      this.snack.open('Задача отменена', '', { duration: 2000 });
      this.loadEnrichment();
    });
  }

  syncSource(slug: string): void {
    this.kb.triggerSync(slug).subscribe({
      next: r => this.snack.open(`Синхронизация запущена: ${r.source}`, '', { duration: 2000 }),
      error: () => this.snack.open('Ошибка запуска синхронизации', '', { duration: 2000 }),
    });
  }

  batchEmbed(): void {
    this.kb.batchEnqueueEnrichment({ task_type: 'embed' }).subscribe({
      next: r => this.snack.open(`Добавлено ${r.enqueued} задач embedding`, '', { duration: 3000 }),
      error: () => this.snack.open('Ошибка', '', { duration: 2000 }),
    });
  }

  exportEntities(): void {
    this.kb.exportEntities().subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kb-export.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ── Retry ──

  retry(): void {
    this.error.set(null);
    switch (this.viewMode()) {
      case 'dashboard': this.loadDashboard(); break;
      case 'entities': this.loadEntities(); break;
      case 'enrichment': this.loadEnrichment(); break;
      case 'sources': this.loadSources(); break;
      case 'access': this.loadAccess(); break;
    }
  }

  // ── Helpers ──

  getTypeLabel(type: string): string { return ENTITY_TYPE_LABELS[type as KBEntityType] ?? type; }
  getTypeIcon(type: string): string { return ENTITY_TYPE_ICONS[type as KBEntityType] ?? 'article'; }
  getStatusLabel(status: string): string { return STATUS_LABELS[status as KBStatus] ?? status; }

  getCategoryName(slug: string): string {
    return this.categories().find(c => c.slug === slug)?.name ?? slug;
  }

  getCategoryPercent(count: number): number {
    const max = Math.max(...this.dashboard()!.category_coverage.map(c => c.entity_count), 1);
    return (count / max) * 100;
  }

  getSourceIcon(type: string): string {
    const icons: Record<string, string> = {
      file: 'description',
      url: 'link',
      api: 'api',
      database: 'storage',
      manual: 'edit',
      conversation: 'chat',
      scraper: 'language',
    };
    return icons[type] ?? 'source';
  }

  formatRelativeTime(dateStr: string): string {
    return formatRelativeTime(dateStr, this.tickService.tick());
  }

  // Lazy-load data when switching tabs
  protected onTabChange(): void {
    switch (this.viewMode()) {
      case 'entities':
        if (!this.entities().length) this.loadEntities();
        break;
      case 'enrichment':
        if (!this.enrichmentTasks().length) this.loadEnrichment();
        break;
      case 'sources':
        if (!this.dataSources().length) this.loadSources();
        break;
      case 'access':
        if (!this.accessRules().length) this.loadAccess();
        break;
    }
  }

  // Template helper for $any()
  protected readonly $any = (val: unknown): Record<string, boolean> => val as Record<string, boolean>;
}
