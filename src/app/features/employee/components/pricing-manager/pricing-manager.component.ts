/**
 * PricingManagerComponent — CRM-интерфейс управления ценообразованием.
 *
 * Экраны:
 * 1. Прайс-лист — дерево: категории → группы → опции + форма редактирования
 * 2. Правила — visual builder зависимостей между опциями
 * 3. Аудит — лог всех изменений из pricing_snapshots
 * 4. Preview — живой конфигуратор как на сайте
 *
 * Phase 5 — CRM Admin UI
 */

import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, PLATFORM_ID,
} from '@angular/core';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { MatBadgeModule } from '@angular/material/badge';

import {
  PricingAdminApiService,
  AdminPricingCategory,
  AdminOptionGroup,
  AdminServiceOption,
  AdminOptionRule,
  PricingSnapshot,
} from '../../services/pricing-admin-api.service';
import { PricingConfiguratorComponent } from '../../../../shared/components/pricing-configurator/pricing-configurator.component';
import { CostManagementComponent } from '../cost-management/cost-management.component';
import { DynamicPricingDashboardComponent } from '../dynamic-pricing-dashboard/dynamic-pricing-dashboard.component';

type EditorType = 'category' | 'group' | 'option' | null;

interface PricingCategorySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly icon: string | null;
  readonly isActive: boolean;
  readonly groups: number;
  readonly options: number;
  readonly activeOptions: number;
  readonly minPrice: number | null;
}

// ── Inline confirm dialog ──────────────────────────────────────────────────

@Component({
  selector: 'app-pm-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Подтверждение</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-button color="warn" [mat-dialog-close]="true">Деактивировать</button>
    </mat-dialog-actions>
  `,
})
class ConfirmDialogComponent {
  readonly data = inject<{ message: string }>(MAT_DIALOG_DATA);
}

const RULE_TYPE_LABELS: Record<string, string> = {
  requires: 'требует',
  excludes: 'исключает',
  includes: 'включает',
  price_override: 'переопределяет цену',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  service_category: 'Категория',
  option_group: 'Группа',
  service_option: 'Опция',
  option_rule: 'Правило',
};

@Component({
  selector: 'app-pricing-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, DatePipe, DecimalPipe,
    MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule,
    MatSlideToggleModule, MatTabsModule, MatTooltipModule,
    MatExpansionModule, MatChipsModule, MatTableModule, MatBadgeModule,
    MatDialogModule,
    PricingConfiguratorComponent,
    CostManagementComponent,
    DynamicPricingDashboardComponent,
  ],
  template: `
<div class="pm-page">

  <header class="pm-hero">
    <div class="pm-hero-main">
      <span class="pm-kicker">ФотоПульт · CRM</span>
      <h1>Управление ценами</h1>
    </div>

    <div class="pm-hero-stats">
      <div class="pm-stat-card">
        <span>Категории</span>
        <strong>{{ activeCategoryCount() }}/{{ categories().length }}</strong>
        <small>{{ inactiveCategoryCount() }} неактивных</small>
      </div>
      <div class="pm-stat-card">
        <span>Группы</span>
        <strong>{{ totalGroupCount() }}</strong>
        <small>в дереве прайса</small>
      </div>
      <div class="pm-stat-card">
        <span>Опции</span>
        <strong>{{ activeOptionCount() }}/{{ totalOptionCount() }}</strong>
        <small>активных</small>
      </div>
      <div class="pm-stat-card">
        <span>Средняя база</span>
        <strong>{{ averageBasePrice() | number:'1.0-0' }} ₽</strong>
        <small>по всем опциям</small>
      </div>
    </div>

    <button mat-icon-button class="pm-refresh" [matTooltip]="'Обновить'" (click)="loadCategories()">
      <mat-icon>refresh</mat-icon>
    </button>
  </header>

  <mat-tab-group class="pm-tabs" animationDuration="150ms" (selectedIndexChange)="onTabChange($event)">

    <!-- ══ ТАБ 1: ПРАЙС-ЛИСТ ═══════════════════════════════════════════════ -->
    <mat-tab label="Прайс-лист">
      <div class="pm-split">

        <!-- Левая: дерево -->
        <div class="pm-tree">
          <div class="pm-tree-toolbar">
            <div class="pm-tree-heading">
              <span class="pm-kicker">Каталог</span>
              <strong>{{ visibleCategories().length }} категорий</strong>
            </div>
            <div class="pm-search">
              <mat-icon>search</mat-icon>
              <input
                type="text"
                [value]="priceListQuery()"
                (input)="onPriceListSearch($event)"
                placeholder="Название, slug, цена">
              @if (priceListQuery()) {
                <button mat-icon-button type="button" [matTooltip]="'Очистить'" (click)="clearPriceListSearch()">
                  <mat-icon>close</mat-icon>
                </button>
              }
            </div>
          </div>

          @if (loading()) {
            <div class="pm-loading"><mat-spinner diameter="32" /></div>
          } @else if (visibleCategories().length === 0) {
            <div class="pm-no-results">
              <mat-icon>search_off</mat-icon>
              <strong>Ничего не найдено</strong>
              <span>{{ hiddenCategoryCount() }} категорий скрыто фильтром</span>
              <button mat-stroked-button type="button" (click)="clearPriceListSearch()">Сбросить поиск</button>
            </div>
          } @else {
            <mat-accordion multi class="pm-accordion">
              @for (cat of visibleCategories(); track cat.id) {
                <mat-expansion-panel class="pm-cat-panel"
                  [class.pm-inactive]="!cat.is_active">
                  <mat-expansion-panel-header>
                    <mat-panel-title class="pm-cat-title">
                      @if (cat.icon) {
                        <mat-icon class="pm-cat-icon">{{ cat.icon }}</mat-icon>
                      }
                      <span class="pm-cat-title-text">{{ cat.name }}</span>
                      @if (!cat.is_active) {
                        <span class="pm-badge pm-badge--off">неакт.</span>
                      }
                    </mat-panel-title>
                    <mat-panel-description class="pm-cat-desc">
                      <span class="pm-slug">{{ cat.slug }}</span>
                      <span class="pm-count">{{ cat.option_groups.length || 0 }} гр.</span>
                    </mat-panel-description>
                  </mat-expansion-panel-header>

                  <!-- Действия категории -->
                  <div class="pm-cat-actions">
                    <button mat-button class="pm-btn-sm"
                      (click)="selectCategory(cat); $event.stopPropagation()">
                      <mat-icon>edit</mat-icon> Редактировать
                    </button>
                    <button mat-button class="pm-btn-sm"
                      (click)="selectCategory(cat); startNewGroup(); $event.stopPropagation()">
                      <mat-icon>add</mat-icon> Группа
                    </button>
                    <button mat-icon-button class="pm-btn-sm pm-btn-danger"
                      [matTooltip]="'Деактивировать категорию'"
                      (click)="deleteCategory(cat.id); $event.stopPropagation()">
                      <mat-icon>delete_outline</mat-icon>
                    </button>
                  </div>

                  <!-- Группы -->
                  @if (cat.option_groups.length) {
                    <mat-accordion multi class="pm-group-accordion">
                      @for (group of cat.option_groups; track group.id) {
                        <mat-expansion-panel class="pm-group-panel"
                          [class.pm-inactive]="!group.is_active">
                          <mat-expansion-panel-header>
                            <mat-panel-title class="pm-group-title">
                              {{ group.name }}
                              @if (group.is_required) {
                                <span class="pm-badge pm-badge--req">обяз.</span>
                              }
                              @if (!group.is_active) {
                                <span class="pm-badge pm-badge--off">неакт.</span>
                              }
                            </mat-panel-title>
                            <mat-panel-description>
                              {{ group.selection_type }}
                              · {{ group.options.length || 0 }} оп.
                            </mat-panel-description>
                          </mat-expansion-panel-header>

                          <div class="pm-group-actions">
                            <button mat-button class="pm-btn-sm"
                              (click)="selectCategory(cat); selectGroup(group); $event.stopPropagation()">
                              <mat-icon>edit</mat-icon>
                            </button>
                            <button mat-button class="pm-btn-sm"
                              (click)="selectCategory(cat); selectGroup(group); startNewOption(); $event.stopPropagation()">
                              <mat-icon>add</mat-icon> Опция
                            </button>
                            <button mat-icon-button class="pm-btn-sm pm-btn-danger"
                              [matTooltip]="'Деактивировать группу'"
                              (click)="deleteGroup(group.id); $event.stopPropagation()">
                              <mat-icon>delete_outline</mat-icon>
                            </button>
                          </div>

                          <!-- Опции -->
                          @for (opt of group.options; track opt.id) {
                            <div class="pm-opt-row"
                              [class.pm-opt-selected]="selectedOptionId() === opt.id"
                              [class.pm-inactive]="!opt.is_active"
                              (click)="selectCategory(cat); selectGroup(group); selectOption(opt)"
                              (keydown.enter)="selectCategory(cat); selectGroup(group); selectOption(opt)"
                              tabindex="0">
                              <div class="pm-opt-info">
                                @if (opt.icon) {
                                  <mat-icon class="pm-opt-icon">{{ opt.icon }}</mat-icon>
                                }
                                <span class="pm-opt-name">{{ opt.name }}</span>
                                @if (opt.popular) {
                                  <mat-icon class="pm-opt-star" [matTooltip]="'Популярная'">star</mat-icon>
                                }
                                @if (!opt.is_active) {
                                  <span class="pm-badge pm-badge--off">неакт.</span>
                                }
                              </div>
                              <div class="pm-opt-prices">
                                <span class="pm-price-base">{{ opt.base_price }} ₽</span>
                                @if (opt.price_online !== null && opt.price_online !== opt.base_price) {
                                  <span class="pm-price-online" [matTooltip]="'онлайн'">
                                    {{ opt.price_online }} ₽
                                  </span>
                                }
                                @if (opt.price_studio !== null && opt.price_studio !== opt.base_price) {
                                  <span class="pm-price-studio" [matTooltip]="'студия'">
                                    {{ opt.price_studio }} ₽
                                  </span>
                                }
                              </div>
                            </div>
                          }
                        </mat-expansion-panel>
                      }
                    </mat-accordion>
                  }
                </mat-expansion-panel>
              }
            </mat-accordion>

            <button mat-stroked-button class="pm-add-cat" (click)="startNewCategory()">
              <mat-icon>add</mat-icon> Добавить категорию
            </button>
          }
        </div>

        <!-- Правая: редактор -->
        <div class="pm-editor">
          @switch (editorType()) {

            <!-- Редактор категории -->
            @case ('category') {
              <mat-card class="pm-form-card">
                <mat-card-header>
                  <mat-card-title>
                    {{ isNew() ? 'Новая категория' : 'Категория: ' + (selectedCategory()?.name || '') }}
                  </mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  <form [formGroup]="categoryForm" class="pm-form">
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Slug</mat-label>
                        <input matInput formControlName="slug" placeholder="photo-docs">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Название</mat-label>
                        <input matInput formControlName="name" placeholder="Фото на документы">
                      </mat-form-field>
                    </div>
                    <mat-form-field class="pm-field-full">
                      <mat-label>Описание</mat-label>
                      <textarea matInput formControlName="description" rows="2"></textarea>
                    </mat-form-field>
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Иконка (material)</mat-label>
                        <input matInput formControlName="icon" placeholder="camera_alt">
                        @if (categoryForm.get('icon')?.value) {
                          <mat-icon matSuffix>{{ categoryForm.get('icon')?.value }}</mat-icon>
                        }
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Диапазон цен</mat-label>
                        <input matInput formControlName="price_range" placeholder="от 350 ₽">
                      </mat-form-field>
                    </div>
                    <mat-form-field class="pm-field-full">
                      <mat-label>Градиент (CSS)</mat-label>
                      <input matInput formControlName="gradient" placeholder="linear-gradient(135deg, #667eea, #764ba2)">
                    </mat-form-field>
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Порядок сортировки</mat-label>
                        <input matInput type="number" formControlName="sort_order">
                      </mat-form-field>
                      <div class="pm-toggle-field">
                        <mat-slide-toggle formControlName="is_active">Активна</mat-slide-toggle>
                      </div>
                    </div>
                    <div class="pm-checkboxes-row">
                      <div class="pm-checkboxes-group">
                        <div class="pm-checkboxes-label">Каналы отображения</div>
                        <mat-chip-listbox formControlName="display_channels" multiple>
                          <mat-chip-option value="website">Сайт</mat-chip-option>
                          <mat-chip-option value="chatbot">Чат-бот</mat-chip-option>
                          <mat-chip-option value="pos">POS</mat-chip-option>
                          <mat-chip-option value="online">Online</mat-chip-option>
                        </mat-chip-listbox>
                      </div>
                      <div class="pm-checkboxes-group">
                        <div class="pm-checkboxes-label">Способы получения</div>
                        <mat-chip-listbox formControlName="valid_delivery_methods" multiple>
                          <mat-chip-option value="electronic">Электронный</mat-chip-option>
                          <mat-chip-option value="pickup">Самовывоз</mat-chip-option>
                          <mat-chip-option value="postal">Почта</mat-chip-option>
                        </mat-chip-listbox>
                      </div>
                    </div>
                  </form>
                </mat-card-content>
                <mat-card-actions>
                  <button mat-flat-button [disabled]="saving() || categoryForm.invalid" (click)="saveCategory()">
                    @if (saving()) { <mat-spinner diameter="18" /> } @else { Сохранить }
                  </button>
                  @if (!isNew()) {
                    <button mat-button color="warn" (click)="deleteCategory(selectedCategoryId()!)">
                      Деактивировать
                    </button>
                  }
                </mat-card-actions>
              </mat-card>
            }

            <!-- Редактор группы -->
            @case ('group') {
              <mat-card class="pm-form-card">
                <mat-card-header>
                  <mat-card-title>
                    {{ isNew() ? 'Новая группа' : 'Группа: ' + (selectedGroup()?.name || '') }}
                  </mat-card-title>
                  <mat-card-subtitle>{{ selectedCategory()?.name }}</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                  <form [formGroup]="groupForm" class="pm-form">
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Slug</mat-label>
                        <input matInput formControlName="slug" placeholder="processing-level">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Название</mat-label>
                        <input matInput formControlName="name" placeholder="Уровень обработки">
                      </mat-form-field>
                    </div>
                    <mat-form-field class="pm-field-full">
                      <mat-label>Описание</mat-label>
                      <textarea matInput formControlName="description" rows="2"></textarea>
                    </mat-form-field>
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Тип выбора</mat-label>
                        <mat-select formControlName="selection_type">
                          <mat-option value="single">Один (single)</mat-option>
                          <mat-option value="multi">Несколько (multi)</mat-option>
                          <mat-option value="quantity">Количество (quantity)</mat-option>
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Порядок</mat-label>
                        <input matInput type="number" formControlName="sort_order">
                      </mat-form-field>
                    </div>
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Мин. выборов</mat-label>
                        <input matInput type="number" formControlName="min_selections">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Макс. выборов</mat-label>
                        <input matInput type="number" formControlName="max_selections">
                      </mat-form-field>
                    </div>
                    <div class="pm-form-row">
                      <div class="pm-toggle-field">
                        <mat-slide-toggle formControlName="is_required">Обязательная</mat-slide-toggle>
                      </div>
                      <div class="pm-toggle-field">
                        <mat-slide-toggle formControlName="is_active">Активна</mat-slide-toggle>
                      </div>
                    </div>
                  </form>
                </mat-card-content>
                <mat-card-actions>
                  <button mat-flat-button [disabled]="saving() || groupForm.invalid" (click)="saveGroup()">
                    @if (saving()) { <mat-spinner diameter="18" /> } @else { Сохранить }
                  </button>
                  @if (!isNew()) {
                    <button mat-button color="warn" (click)="deleteGroup(selectedGroupId()!)">
                      Деактивировать
                    </button>
                  }
                </mat-card-actions>
              </mat-card>
            }

            <!-- Редактор опции -->
            @case ('option') {
              <mat-card class="pm-form-card">
                <mat-card-header>
                  <mat-card-title>
                    {{ isNew() ? 'Новая опция' : 'Опция: ' + (selectedOption()?.name || '') }}
                  </mat-card-title>
                  <mat-card-subtitle>
                    {{ selectedCategory()?.name }} / {{ selectedGroup()?.name }}
                  </mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                  <form [formGroup]="optionForm" class="pm-form">
                    <!-- Основное -->
                    <div class="pm-section-label">Основное</div>
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Slug</mat-label>
                        <input matInput formControlName="slug" placeholder="retouch">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Название</mat-label>
                        <input matInput formControlName="name" placeholder="С художественной обработкой">
                      </mat-form-field>
                    </div>
                    <mat-form-field class="pm-field-full">
                      <mat-label>Описание</mat-label>
                      <textarea matInput formControlName="description" rows="2"></textarea>
                    </mat-form-field>
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Иконка (material)</mat-label>
                        <input matInput formControlName="icon" placeholder="auto_fix_high">
                        @if (optionForm.get('icon')?.value) {
                          <mat-icon matSuffix>{{ optionForm.get('icon')?.value }}</mat-icon>
                        }
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Цвет (CSS)</mat-label>
                        <input matInput formControlName="color" placeholder="#7c3aed">
                      </mat-form-field>
                    </div>

                    <!-- Цены -->
                    <mat-divider class="pm-divider" />
                    <div class="pm-section-label">Цены</div>
                    <div class="pm-prices-grid">
                      <mat-form-field>
                        <mat-label>Базовая цена (₽)</mat-label>
                        <input matInput type="number" formControlName="base_price" min="0">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Онлайн цена (₽)</mat-label>
                        <input matInput type="number" formControlName="price_online" min="0">
                        <mat-hint>Пусто = базовая</mat-hint>
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Студия цена (₽)</mat-label>
                        <input matInput type="number" formControlName="price_studio" min="0">
                        <mat-hint>Пусто = базовая</mat-hint>
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Следующая ед. (₽)</mat-label>
                        <input matInput type="number" formControlName="price_next_unit" min="0">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Максимум (₽)</mat-label>
                        <input matInput type="number" formControlName="price_max" min="0">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Промо (первый заказ) (₽)</mat-label>
                        <input matInput type="number" formControlName="promo_first_price" min="0">
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Оригинальная цена (₽)</mat-label>
                        <input matInput type="number" formControlName="original_price" min="0">
                        <mat-hint>Для отображения зачёркнутой</mat-hint>
                      </mat-form-field>
                      <mat-form-field>
                        <mat-label>Скидка (%)</mat-label>
                        <input matInput type="number" formControlName="discount_percent" min="0" max="100">
                      </mat-form-field>
                    </div>
                    <mat-form-field class="pm-field-full">
                      <mat-label>Описание промо</mat-label>
                      <input matInput formControlName="promo_description" placeholder="Скидка 50% на первый заказ">
                    </mat-form-field>

                    <!-- Метаданные -->
                    <mat-divider class="pm-divider" />
                    <div class="pm-section-label">Метаданные</div>
                    <div class="pm-form-row">
                      <mat-form-field>
                        <mat-label>Порядок</mat-label>
                        <input matInput type="number" formControlName="sort_order">
                      </mat-form-field>
                    </div>
                    <div class="pm-toggles-row">
                      <mat-slide-toggle formControlName="popular">Популярная</mat-slide-toggle>
                      <mat-slide-toggle formControlName="satisfies_requires">Удовлетворяет requires</mat-slide-toggle>
                      <mat-slide-toggle formControlName="is_active">Активна</mat-slide-toggle>
                    </div>
                  </form>
                </mat-card-content>
                <mat-card-actions>
                  <button mat-flat-button [disabled]="saving() || optionForm.invalid" (click)="saveOption()">
                    @if (saving()) { <mat-spinner diameter="18" /> } @else { Сохранить }
                  </button>
                  @if (!isNew()) {
                    <button mat-button color="warn" (click)="deleteOption(selectedOptionId()!)">
                      Деактивировать
                    </button>
                  }
                </mat-card-actions>
              </mat-card>
            }

            <!-- Пустое состояние -->
            @default {
              <div class="pm-overview">
                <section class="pm-overview-head">
                  <div>
                    <span class="pm-kicker">Прайс-лист</span>
                    <h2>{{ totalOptionCount() }} опций в {{ categories().length }} категориях</h2>
                    <p>{{ activeOptionCount() }} активных опций, {{ totalGroupCount() }} групп, средняя базовая цена {{ averageBasePrice() | number:'1.0-0' }} ₽.</p>
                  </div>
                  <div class="pm-overview-actions">
                    <button mat-flat-button type="button" (click)="startNewCategory()">
                      <mat-icon>add</mat-icon>
                      Категория
                    </button>
                    @if (firstCategorySummary(); as firstCategory) {
                      <button mat-stroked-button type="button" (click)="selectCategoryById(firstCategory.id)">
                        <mat-icon>open_in_new</mat-icon>
                        Открыть первую
                      </button>
                    }
                  </div>
                </section>

                <section class="pm-overview-grid">
                  <div class="pm-metric-card">
                    <span>Активность каталога</span>
                    <strong>{{ activeCategoryCount() }}/{{ categories().length }}</strong>
                    <small>категорий включено</small>
                  </div>
                  <div class="pm-metric-card">
                    <span>Рабочие опции</span>
                    <strong>{{ activeOptionCount() }}</strong>
                    <small>видны клиентам</small>
                  </div>
                  <div class="pm-metric-card">
                    <span>Скрытые позиции</span>
                    <strong>{{ totalOptionCount() - activeOptionCount() }}</strong>
                    <small>неактивные опции</small>
                  </div>
                </section>

                <section class="pm-category-board">
                  <div class="pm-board-head">
                    <div>
                      <span class="pm-kicker">Категории</span>
                      <h3>Самые заполненные разделы</h3>
                    </div>
                  </div>
                  @for (row of categorySummaryRows(); track row.id) {
                    <button
                      type="button"
                      class="pm-category-row"
                      [class.pm-inactive]="!row.isActive"
                      (click)="selectCategoryById(row.id)">
                      <span class="pm-category-icon">
                        @if (row.icon) {
                          <mat-icon>{{ row.icon }}</mat-icon>
                        } @else {
                          <mat-icon>category</mat-icon>
                        }
                      </span>
                      <span class="pm-category-main">
                        <strong>{{ row.name }}</strong>
                        <small>{{ row.slug }}</small>
                      </span>
                      <span class="pm-category-meta">{{ row.groups }} гр.</span>
                      <span class="pm-category-meta">{{ row.activeOptions }}/{{ row.options }} оп.</span>
                      <span class="pm-category-price">
                        @if (row.minPrice != null) {
                          от {{ row.minPrice | number:'1.0-0' }} ₽
                        } @else {
                          —
                        }
                      </span>
                    </button>
                  } @empty {
                    <div class="pm-no-results pm-no-results-inline">
                      <mat-icon>inventory_2</mat-icon>
                      <strong>Категорий пока нет</strong>
                    </div>
                  }
                </section>
              </div>
            }
          }
        </div>
      </div>
    </mat-tab>

    <!-- ══ ТАБ 2: ПРАВИЛА ═══════════════════════════════════════════════════ -->
    <mat-tab label="Правила">
      <div class="pm-rules-page">
        @if (!selectedCategoryId()) {
          <div class="pm-empty">
            <mat-icon>rule</mat-icon>
            <p>Выберите категорию в «Прайс-листе», затем перейдите сюда</p>
          </div>
        } @else {
          <div class="pm-rules-layout">

            <!-- Список правил -->
            <mat-card class="pm-rules-list">
              <mat-card-header>
                <mat-card-title>
                  Правила: {{ selectedCategory()?.name }}
                </mat-card-title>
              </mat-card-header>
              <mat-card-content>
                @if (rules().length === 0) {
                  <p class="pm-empty-hint">Нет активных правил</p>
                } @else {
                  <table mat-table [dataSource]="rules()" class="pm-rules-table">
                    <ng-container matColumnDef="source">
                      <th mat-header-cell *matHeaderCellDef>Если выбрано</th>
                      <td mat-cell *matCellDef="let r">
                        <strong>{{ r.source_option_name }}</strong>
                        <span class="pm-opt-slug">{{ r.source_option_slug }}</span>
                      </td>
                    </ng-container>
                    <ng-container matColumnDef="rule_type">
                      <th mat-header-cell *matHeaderCellDef>Действие</th>
                      <td mat-cell *matCellDef="let r">
                        <span class="pm-rule-type" [class]="'pm-rule-' + r.rule_type">
                          {{ ruleTypeLabel(r.rule_type) }}
                        </span>
                      </td>
                    </ng-container>
                    <ng-container matColumnDef="target">
                      <th mat-header-cell *matHeaderCellDef>Цель</th>
                      <td mat-cell *matCellDef="let r">
                        <strong>{{ r.target_option_name }}</strong>
                        <span class="pm-opt-slug">{{ r.target_option_slug }}</span>
                        @if (r.override_price !== null) {
                          <span class="pm-override-price">→ {{ r.override_price }} ₽</span>
                        }
                      </td>
                    </ng-container>
                    <ng-container matColumnDef="description">
                      <th mat-header-cell *matHeaderCellDef>Описание</th>
                      <td mat-cell *matCellDef="let r">{{ r.description || '—' }}</td>
                    </ng-container>
                    <ng-container matColumnDef="actions">
                      <th mat-header-cell *matHeaderCellDef></th>
                      <td mat-cell *matCellDef="let r">
                        <button mat-icon-button color="warn"
                          [matTooltip]="'Удалить правило (soft)'"
                          (click)="deleteRule(r.id)">
                          <mat-icon>delete_outline</mat-icon>
                        </button>
                      </td>
                    </ng-container>
                    <tr mat-header-row *matHeaderRowDef="rulesColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: rulesColumns;"></tr>
                  </table>
                }
              </mat-card-content>
            </mat-card>

            <!-- Форма создания правила -->
            <mat-card class="pm-rule-form">
              <mat-card-header>
                <mat-card-title>Создать правило</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <form [formGroup]="ruleForm" class="pm-form">
                  <mat-form-field class="pm-field-full">
                    <mat-label>Если выбрана опция (source)</mat-label>
                    <mat-select formControlName="source_option_id">
                      @for (opt of allOptionsInCategory(); track opt.id) {
                        <mat-option [value]="opt.id">{{ opt.name }} ({{ opt.slug }})</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field class="pm-field-full">
                    <mat-label>Действие</mat-label>
                    <mat-select formControlName="rule_type">
                      <mat-option value="requires">требует (requires)</mat-option>
                      <mat-option value="excludes">исключает (excludes)</mat-option>
                      <mat-option value="includes">включает (includes)</mat-option>
                      <mat-option value="price_override">переопределяет цену (price_override)</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field class="pm-field-full">
                    <mat-label>Целевая опция (target)</mat-label>
                    <mat-select formControlName="target_option_id">
                      @for (opt of allOptionsInCategory(); track opt.id) {
                        <mat-option [value]="opt.id">{{ opt.name }} ({{ opt.slug }})</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  @if (ruleForm.get('rule_type')?.value === 'price_override') {
                    <mat-form-field class="pm-field-full">
                      <mat-label>Новая цена (₽)</mat-label>
                      <input matInput type="number" formControlName="override_price" min="0">
                    </mat-form-field>
                  }

                  <mat-form-field class="pm-field-full">
                    <mat-label>Описание (опционально)</mat-label>
                    <input matInput formControlName="description">
                  </mat-form-field>

                  <!-- Превью правила -->
                  @if (ruleForm.get('source_option_id')?.value && ruleForm.get('target_option_id')?.value) {
                    <div class="pm-rule-preview">
                      <mat-icon>arrow_forward</mat-icon>
                      <strong>{{ getOptionName(ruleForm.get('source_option_id')?.value) }}</strong>
                      <span class="pm-rule-type" [class]="'pm-rule-' + ruleForm.get('rule_type')?.value">
                        {{ ruleTypeLabel(ruleForm.get('rule_type')?.value) }}
                      </span>
                      <strong>{{ getOptionName(ruleForm.get('target_option_id')?.value) }}</strong>
                    </div>
                  }
                </form>
              </mat-card-content>
              <mat-card-actions>
                <button mat-flat-button [disabled]="saving() || ruleForm.invalid" (click)="createRule()">
                  @if (saving()) { <mat-spinner diameter="18" /> } @else { Создать правило }
                </button>
              </mat-card-actions>
            </mat-card>
          </div>
        }
      </div>
    </mat-tab>

    <!-- ══ ТАБ 3: АУДИТ ═════════════════════════════════════════════════════ -->
    <mat-tab label="Аудит">
      <div class="pm-audit-page">
        <div class="pm-audit-filters">
          <mat-form-field>
            <mat-label>Тип сущности</mat-label>
            <mat-select [value]="auditFilterValue()" (selectionChange)="onAuditFilterChange($event.value)">
              <mat-option value="">Все</mat-option>
              <mat-option value="service_category">Категории</mat-option>
              <mat-option value="option_group">Группы</mat-option>
              <mat-option value="service_option">Опции</mat-option>
              <mat-option value="option_rule">Правила</mat-option>
            </mat-select>
          </mat-form-field>
          <button mat-stroked-button (click)="loadAudit()">
            <mat-icon>refresh</mat-icon> Обновить
          </button>
        </div>

        @if (auditLoading()) {
          <div class="pm-loading"><mat-spinner diameter="32" /></div>
        } @else {
          <table mat-table [dataSource]="filteredAudit()" class="pm-audit-table">
            <ng-container matColumnDef="when">
              <th mat-header-cell *matHeaderCellDef>Когда</th>
              <td mat-cell *matCellDef="let s">
                {{ s.created_at | date:'dd.MM HH:mm' }}
              </td>
            </ng-container>
            <ng-container matColumnDef="entity">
              <th mat-header-cell *matHeaderCellDef>Сущность</th>
              <td mat-cell *matCellDef="let s">
                <span class="pm-entity-type">{{ entityTypeLabel(s.entity_type) }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="who">
              <th mat-header-cell *matHeaderCellDef>Кто</th>
              <td mat-cell *matCellDef="let s">{{ s.changed_by_email || '—' }}</td>
            </ng-container>
            <ng-container matColumnDef="reason">
              <th mat-header-cell *matHeaderCellDef>Действие</th>
              <td mat-cell *matCellDef="let s">{{ s.reason || '—' }}</td>
            </ng-container>
            <ng-container matColumnDef="diff">
              <th mat-header-cell *matHeaderCellDef>Изменения</th>
              <td mat-cell *matCellDef="let s">
                <div class="pm-diff">
                  @for (key of getChangedKeys(s); track key) {
                    <div class="pm-diff-row">
                      <span class="pm-diff-key">{{ key }}:</span>
                      <span class="pm-diff-old">{{ formatDiffValue(s.old_values[key]) }}</span>
                      <mat-icon class="pm-diff-arrow">arrow_forward</mat-icon>
                      <span class="pm-diff-new">{{ formatDiffValue(s.new_values[key]) }}</span>
                    </div>
                  }
                </div>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="auditColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: auditColumns;"></tr>
          </table>

          @if (filteredAudit().length === 0) {
            <div class="pm-empty">
              <mat-icon>history</mat-icon>
              <p>Нет записей аудита</p>
            </div>
          }
        }
      </div>
    </mat-tab>

    <!-- ══ ТАБ 4: PREVIEW ══════════════════════════════════════════════════ -->
    <mat-tab label="Preview">
      <div class="pm-preview-page">
        @if (!selectedCategory()) {
          <div class="pm-empty">
            <mat-icon>visibility</mat-icon>
            <p>Выберите категорию в «Прайс-листе», чтобы увидеть preview конфигуратора</p>
          </div>
        } @else {
          <div class="pm-preview-header">
            <span>Preview: <strong>{{ selectedCategory()!.name }}</strong></span>
            <span class="pm-preview-hint">Отображается как на сайте</span>
          </div>
          <app-pricing-configurator
            [categorySlug]="selectedCategory()!.slug"
            [showHeader]="true" />
        }
      </div>
    </mat-tab>

    <!-- ══ ТАБ 5: СЕБЕСТОИМОСТЬ ═══════════════════════════════════════════ -->
    <mat-tab label="Себестоимость">
      <app-cost-management />
    </mat-tab>

    <!-- ══ ТАБ 6: ДИНАМИКА ════════════════════════════════════════════════ -->
    <mat-tab label="Динамика">
      <app-dynamic-pricing-dashboard />
    </mat-tab>

  </mat-tab-group>
</div>
  `,
  styles: [`
    .pm-page {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: min(1680px, calc(100vw - 48px));
      box-sizing: border-box;
      padding: 12px 0 24px;
      margin: 0 auto;
    }

    .pm-hero {
      display: grid;
      grid-template-columns: minmax(220px, 0.75fr) minmax(560px, 1.7fr) auto;
      align-items: center;
      gap: 14px;
      padding: 10px 12px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: var(--crm-surface-2, var(--mat-sys-surface-container));
    }

    .pm-hero-main {
      min-width: 0;

      h1 {
        margin: 2px 0 0;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 22px;
        font-weight: 800;
        line-height: 1.1;
        letter-spacing: 0;
      }
    }

    .pm-kicker {
      color: var(--crm-accent, var(--mat-sys-primary));
      font-size: 11px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .pm-hero-stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      min-width: 0;
    }

    .pm-stat-card,
    .pm-metric-card {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: rgba(255,255,255,0.035);

      span,
      small {
        overflow: hidden;
        color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
        font-size: 11px;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      strong {
        overflow: hidden;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 18px;
        font-weight: 800;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .pm-refresh {
      align-self: start;
    }

    .pm-tabs {
      min-width: 0;
    }

    .pm-tabs ::ng-deep .mat-mdc-tab-header {
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }

    .pm-tabs ::ng-deep .mat-mdc-tab-body-content {
      overflow: visible;
    }

    /* ── Split layout ── */
    .pm-split {
      display: grid;
      grid-template-columns: minmax(360px, 430px) minmax(0, 1fr);
      gap: 16px;
      margin-top: 10px;
      min-height: min(720px, calc(100vh - 220px));

      @media (max-width: 900px) {
        grid-template-columns: 1fr;
        min-height: auto;
      }
    }

    /* ── Tree panel ── */
    .pm-tree {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      max-height: calc(100vh - 218px);
      padding: 10px;
      overflow: hidden auto;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      scrollbar-gutter: stable;
    }

    .pm-tree-toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: minmax(120px, 0.55fr) minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      padding-bottom: 6px;
      background: var(--mat-sys-surface-container);
    }

    .pm-tree-heading {
      min-width: 0;

      strong {
        display: block;
        overflow: hidden;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 15px;
        font-weight: 800;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .pm-search {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      min-width: 0;
      height: 38px;
      padding: 0 6px 0 10px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      background: rgba(255,255,255,0.035);

      mat-icon {
        width: 18px;
        height: 18px;
        color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
        font-size: 18px;
      }

      input {
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font: inherit;
        font-size: 13px;
      }

      button {
        width: 28px;
        height: 28px;
        padding: 0;
      }
    }

    .pm-loading {
      display: flex;
      justify-content: center;
      padding: 32px;
    }

    .pm-no-results {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 220px;
      padding: 22px;
      border: 1px dashed rgba(255,255,255,0.16);
      border-radius: 8px;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      text-align: center;

      mat-icon {
        width: 36px;
        height: 36px;
        color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
        font-size: 36px;
      }

      strong {
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 14px;
      }

      span {
        font-size: 12px;
      }
    }

    .pm-no-results-inline {
      min-height: 150px;
    }

    .pm-accordion {
      background: transparent;
    }

    .pm-cat-panel {
      margin-bottom: 6px;
      border-radius: 8px !important;
      box-shadow: none !important;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.025) !important;

      &.pm-inactive { opacity: 0.55; }
    }

    .pm-cat-panel ::ng-deep .mat-expansion-panel-header,
    .pm-group-panel ::ng-deep .mat-expansion-panel-header {
      min-height: 46px;
      padding: 0 10px;
    }

    .pm-cat-panel ::ng-deep .mat-content,
    .pm-group-panel ::ng-deep .mat-content {
      min-width: 0;
      align-items: center;
    }

    .pm-cat-panel ::ng-deep .mat-expansion-panel-header-description {
      flex: 0 0 auto;
      margin-left: 8px;
    }

    .pm-cat-panel ::ng-deep .mat-expansion-panel-body,
    .pm-group-panel ::ng-deep .mat-expansion-panel-body {
      padding: 0 10px 10px;
    }

    .pm-cat-title {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      font-weight: 700;
      font-size: 13px;
    }

    .pm-cat-icon { font-size: 18px; width: 18px; height: 18px; }

    .pm-cat-title-text,
    .pm-opt-name,
    .pm-slug {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pm-cat-title-text {
      min-width: 0;
    }

    .pm-cat-desc {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-size: 12px;
    }

    .pm-slug {
      max-width: 110px;
      color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
    }

    .pm-count {
      flex: 0 0 auto;
      border-radius: 10px;
      padding: 0 6px;
      background: rgba(255,255,255,0.08);
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
      font-size: 11px;
    }

    .pm-badge {
      font-size: 10px;
      border-radius: 8px;
      padding: 1px 5px;
      font-weight: 500;
    }

    .pm-badge--off {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .pm-badge--req {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    .pm-cat-actions, .pm-group-actions {
      display: flex;
      gap: 4px;
      margin: 2px 0 8px;
      flex-wrap: wrap;
    }

    .pm-btn-sm { font-size: 12px; height: 28px; padding: 0 8px; }
    .pm-btn-danger { color: var(--mat-sys-error) !important; }

    .pm-group-accordion {
      background: transparent;
      margin: 4px 0;
    }

    .pm-group-panel {
      background: rgba(0,0,0,0.18) !important;
      margin-bottom: 4px;
      border-radius: 8px !important;
      box-shadow: none !important;
      border: 1px solid rgba(255,255,255,0.07);

      &.pm-inactive { opacity: 0.55; }
    }

    .pm-group-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
    }

    /* Опции */
    .pm-opt-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 36px;
      padding: 7px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.1s;
      margin: 2px 0;

      &:hover { background: var(--mat-sys-surface-variant); }
      &.pm-opt-selected { background: var(--mat-sys-primary-container); }
      &.pm-inactive { opacity: 0.5; }
    }

    .pm-opt-info {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .pm-opt-icon { font-size: 16px; width: 16px; height: 16px; }
    .pm-opt-star { font-size: 14px; width: 14px; height: 14px; color: var(--mat-sys-tertiary); }

    .pm-opt-name { font-size: 13px; }

    .pm-opt-prices {
      display: flex;
      gap: 4px;
      align-items: center;
      flex: 0 0 auto;
      font-size: 12px;
    }

    .pm-price-base { font-weight: 600; color: var(--mat-sys-on-surface); }
    .pm-price-online { color: var(--mat-sys-primary); }
    .pm-price-studio { color: var(--mat-sys-secondary); }

    .pm-add-cat {
      width: 100%;
      margin-top: 8px;
    }

    /* ── Editor panel ── */
    .pm-editor {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .pm-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 300px;
      color: var(--mat-sys-on-surface-variant);

      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }
      p { margin: 0; font-size: 14px; }
    }

    .pm-empty-hint { font-size: 12px; color: var(--mat-sys-on-surface-variant); }

    .pm-overview {
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-width: 0;
    }

    .pm-overview-head,
    .pm-category-board {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: var(--crm-surface-2, var(--mat-sys-surface-container));
    }

    .pm-overview-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 16px;

      h2 {
        margin: 2px 0 4px;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 22px;
        font-weight: 800;
        line-height: 1.15;
        letter-spacing: 0;
      }

      p {
        margin: 0;
        color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
        font-size: 13px;
        line-height: 1.35;
      }
    }

    .pm-overview-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .pm-overview-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .pm-category-board {
      padding: 12px;
    }

    .pm-board-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;

      h3 {
        margin: 2px 0 0;
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 16px;
        font-weight: 800;
      }
    }

    .pm-category-row {
      display: grid;
      grid-template-columns: 36px minmax(180px, 1fr) 72px 86px 92px;
      gap: 10px;
      align-items: center;
      width: 100%;
      min-height: 48px;
      margin: 0;
      padding: 7px 8px;
      border: 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;

      &:hover {
        background: rgba(255,255,255,0.035);
      }

      &:last-child {
        border-bottom: 0;
      }

      &.pm-inactive {
        opacity: 0.55;
      }
    }

    .pm-category-icon {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(255,255,255,0.06);

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
    }

    .pm-category-main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;

      strong,
      small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      strong {
        color: var(--crm-text-primary, var(--mat-sys-on-surface));
        font-size: 13px;
        font-weight: 800;
      }

      small {
        color: var(--crm-text-muted, var(--mat-sys-on-surface-variant));
        font-size: 12px;
      }
    }

    .pm-category-meta,
    .pm-category-price {
      justify-self: end;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 12px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .pm-category-price {
      color: var(--crm-text-primary, var(--mat-sys-on-surface));
      font-weight: 800;
    }

    .pm-form-card {
      flex: 1;
      border-radius: 8px;
    }

    .pm-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px;
    }

    .pm-form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;

      @media (max-width: 600px) { grid-template-columns: 1fr; }
    }

    .pm-field-full { width: 100%; }

    .pm-section-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0;
      margin-top: 4px;
    }

    .pm-prices-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;

      @media (min-width: 1200px) { grid-template-columns: repeat(4, 1fr); }
    }

    .pm-divider { margin: 12px 0; }

    .pm-toggle-field {
      display: flex;
      align-items: center;
      height: 56px;
    }

    .pm-checkboxes-row {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .pm-checkboxes-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .pm-checkboxes-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .pm-toggles-row {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      padding: 4px 0;
    }

    @media (max-width: 1240px) {
      .pm-hero {
        grid-template-columns: 1fr auto;
      }

      .pm-hero-stats {
        grid-column: 1 / -1;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .pm-tree-toolbar {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .pm-page {
        width: min(calc(100% - 16px), 1680px);
        padding-top: 8px;
      }

      .pm-hero {
        grid-template-columns: 1fr;
      }

      .pm-refresh {
        justify-self: start;
      }

      .pm-hero-stats,
      .pm-overview-grid {
        grid-template-columns: 1fr;
      }

      .pm-tree {
        max-height: none;
      }

      .pm-overview-head {
        grid-template-columns: 1fr;
      }

      .pm-overview-actions {
        justify-content: flex-start;
      }

      .pm-category-row {
        grid-template-columns: 36px minmax(0, 1fr) auto;
      }

      .pm-category-meta {
        display: none;
      }

      .pm-category-price {
        justify-self: end;
      }
    }

    /* ── Rules ── */
    .pm-rules-page, .pm-audit-page, .pm-preview-page {
      padding: 16px 0;
    }

    .pm-rules-layout {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 16px;

      @media (max-width: 1024px) { grid-template-columns: 1fr; }
    }

    .pm-rules-table, .pm-audit-table {
      width: 100%;
    }

    .pm-rule-type {
      font-size: 12px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;

      &.pm-rule-requires { background: #dbeafe; color: #1d4ed8; }
      &.pm-rule-excludes { background: #fee2e2; color: #dc2626; }
      &.pm-rule-includes { background: #dcfce7; color: #16a34a; }
      &.pm-rule-price_override { background: #fef9c3; color: #ca8a04; }
    }

    .pm-opt-slug {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      margin-left: 4px;
    }

    .pm-override-price {
      font-size: 12px;
      font-weight: 600;
      color: var(--mat-sys-primary);
      margin-left: 4px;
    }

    .pm-rule-preview {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      background: var(--mat-sys-surface-variant);
      border-radius: 8px;
      font-size: 13px;
      flex-wrap: wrap;
    }

    /* ── Audit ── */
    .pm-audit-filters {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }

    .pm-entity-type {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 8px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .pm-diff {
      font-size: 12px;
      max-width: 400px;
    }

    .pm-diff-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 1px 0;
    }

    .pm-diff-key { color: var(--mat-sys-on-surface-variant); font-weight: 500; }
    .pm-diff-old { color: var(--mat-sys-error); text-decoration: line-through; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pm-diff-new { color: var(--mat-sys-primary); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pm-diff-arrow { font-size: 14px; width: 14px; height: 14px; color: var(--mat-sys-on-surface-variant); }

    /* ── Preview ── */
    .pm-preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      font-size: 14px;
    }

    .pm-preview-hint {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }
  `],
})
export class PricingManagerComponent implements OnInit {
  private readonly api = inject(PricingAdminApiService);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);

  // ── Данные ────────────────────────────────────────────────────────────────
  readonly categories = signal<AdminPricingCategory[]>([]);
  readonly rules = signal<AdminOptionRule[]>([]);
  readonly auditLog = signal<PricingSnapshot[]>([]);

  // ── Состояние ─────────────────────────────────────────────────────────────
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly auditLoading = signal(false);

  // ── Выбор ─────────────────────────────────────────────────────────────────
  readonly selectedCategoryId = signal<string | null>(null);
  readonly selectedGroupId = signal<string | null>(null);
  readonly selectedOptionId = signal<string | null>(null);
  readonly editorType = signal<EditorType>(null);
  readonly isNew = signal(false);

  // ── Табы ──────────────────────────────────────────────────────────────────
  readonly auditFilterValue = signal('');
  readonly priceListQuery = signal('');

  // ── Computed ──────────────────────────────────────────────────────────────
  readonly selectedCategory = computed(() =>
    this.categories().find(c => c.id === this.selectedCategoryId()) ?? null
  );

  readonly selectedGroup = computed(() =>
    this.selectedCategory()?.option_groups.find(g => g.id === this.selectedGroupId()) ?? null
  );

  readonly selectedOption = computed(() =>
    this.selectedGroup()?.options.find(o => o.id === this.selectedOptionId()) ?? null
  );

  readonly allOptionsInCategory = computed((): AdminServiceOption[] => {
    const cat = this.selectedCategory();
    if (!cat) return [];
    return cat.option_groups.flatMap(g => g.options ?? []);
  });

  readonly activeCategoryCount = computed(() => this.categories().filter(c => c.is_active).length);
  readonly inactiveCategoryCount = computed(() => this.categories().length - this.activeCategoryCount());
  readonly totalGroupCount = computed(() => this.categories()
    .reduce((total, cat) => total + cat.option_groups.length, 0));
  readonly totalOptionCount = computed(() => this.categories()
    .reduce((total, cat) => total + this.categoryOptions(cat).length, 0));
  readonly activeOptionCount = computed(() => this.categories()
    .reduce((total, cat) => total + this.categoryOptions(cat).filter(opt => opt.is_active).length, 0));
  readonly averageBasePrice = computed(() => {
    const prices = this.categories()
      .flatMap(cat => this.categoryOptions(cat))
      .map(opt => opt.base_price)
      .filter(price => Number.isFinite(price));
    if (prices.length === 0) return 0;
    return prices.reduce((sum, price) => sum + price, 0) / prices.length;
  });

  readonly visibleCategories = computed(() => {
    const query = this.priceListQuery().trim().toLowerCase();
    const cats = this.categories();
    if (!query) return cats;
    return cats.filter(cat => this.categoryMatchesQuery(cat, query));
  });

  readonly hiddenCategoryCount = computed(() => this.categories().length - this.visibleCategories().length);

  readonly categorySummaryRows = computed((): PricingCategorySummary[] => this.categories()
    .map(cat => this.toCategorySummary(cat))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.activeOptions - a.activeOptions;
    })
    .slice(0, 8));

  readonly firstCategorySummary = computed(() => this.categorySummaryRows()[0] ?? null);

  readonly filteredAudit = computed(() => {
    const filter = this.auditFilterValue();
    const log = this.auditLog();
    if (!filter) return log;
    return log.filter(s => s.entity_type === filter);
  });

  // ── Таблицы ──────────────────────────────────────────────────────────────
  readonly rulesColumns = ['source', 'rule_type', 'target', 'description', 'actions'];
  readonly auditColumns = ['when', 'entity', 'who', 'reason', 'diff'];

  // ── Формы ─────────────────────────────────────────────────────────────────
  readonly categoryForm: FormGroup = this.fb.group({
    slug: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
    icon: [''],
    gradient: [''],
    price_range: [''],
    sort_order: [0],
    is_active: [true],
    display_channels: [['website', 'chatbot', 'pos']],
    valid_delivery_methods: [['electronic', 'pickup', 'postal']],
  });

  readonly groupForm: FormGroup = this.fb.group({
    slug: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
    selection_type: ['single'],
    is_required: [false],
    min_selections: [0],
    max_selections: [1],
    sort_order: [0],
    is_active: [true],
  });

  readonly optionForm: FormGroup = this.fb.group({
    slug: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
    icon: [''],
    color: [''],
    base_price: [0, [Validators.required, Validators.min(0)]],
    price_online: [null],
    price_studio: [null],
    price_next_unit: [null],
    price_max: [null],
    promo_first_price: [null],
    promo_description: [''],
    popular: [false],
    original_price: [null],
    discount_percent: [null],
    satisfies_requires: [false],
    sort_order: [0],
    is_active: [true],
  });

  readonly ruleForm: FormGroup = this.fb.group({
    rule_type: ['requires', Validators.required],
    source_option_id: ['', Validators.required],
    target_option_id: ['', Validators.required],
    override_price: [null],
    description: [''],
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadCategories();
  }

  // ── Загрузка данных ───────────────────────────────────────────────────────

  loadCategories(): void {
    this.loading.set(true);
    this.api.getCategoriesFull().subscribe({
      next: cats => {
        this.categories.set(cats);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Ошибка загрузки категорий', 'OK', { duration: 3000 });
      },
    });
  }

  loadRules(categoryId: string): void {
    this.api.getRules(categoryId).subscribe({
      next: rules => this.rules.set(rules),
      error: () => this.snackBar.open('Ошибка загрузки правил', 'OK', { duration: 3000 }),
    });
  }

  loadAudit(): void {
    this.auditLoading.set(true);
    const params: { entity_type?: string; limit: number } = { limit: 100 };
    if (this.auditFilterValue()) params.entity_type = this.auditFilterValue();
    this.api.getAudit(params).subscribe({
      next: snaps => { this.auditLog.set(snaps); this.auditLoading.set(false); },
      error: () => { this.auditLoading.set(false); },
    });
  }

  // ── Выбор элементов ───────────────────────────────────────────────────────

  selectCategory(cat: AdminPricingCategory): void {
    this.selectedCategoryId.set(cat.id);
    this.selectedGroupId.set(null);
    this.selectedOptionId.set(null);
    this.editorType.set('category');
    this.isNew.set(false);
    this.categoryForm.patchValue({
      slug: cat.slug,
      name: cat.name,
      description: cat.description ?? '',
      icon: cat.icon ?? '',
      gradient: cat.gradient ?? '',
      price_range: cat.price_range ?? '',
      sort_order: cat.sort_order,
      is_active: cat.is_active,
      display_channels: cat.display_channels ?? ['website', 'chatbot', 'pos'],
      valid_delivery_methods: cat.valid_delivery_methods ?? ['electronic', 'pickup', 'postal'],
    });
  }

  selectGroup(group: AdminOptionGroup): void {
    this.selectedGroupId.set(group.id);
    this.selectedOptionId.set(null);
    this.editorType.set('group');
    this.isNew.set(false);
    this.groupForm.patchValue({
      slug: group.slug,
      name: group.name,
      description: group.description ?? '',
      selection_type: group.selection_type,
      is_required: group.is_required,
      min_selections: group.min_selections,
      max_selections: group.max_selections,
      sort_order: group.sort_order,
      is_active: group.is_active,
    });
  }

  selectOption(opt: AdminServiceOption): void {
    this.selectedOptionId.set(opt.id);
    this.editorType.set('option');
    this.isNew.set(false);
    this.optionForm.patchValue({
      slug: opt.slug,
      name: opt.name,
      description: opt.description ?? '',
      icon: opt.icon ?? '',
      color: opt.color ?? '',
      base_price: opt.base_price,
      price_online: opt.price_online,
      price_studio: opt.price_studio,
      price_next_unit: opt.price_next_unit,
      price_max: opt.price_max,
      promo_first_price: opt.promo_first_price,
      promo_description: opt.promo_description ?? '',
      popular: opt.popular,
      original_price: opt.original_price,
      discount_percent: opt.discount_percent,
      satisfies_requires: opt.satisfies_requires,
      sort_order: opt.sort_order,
      is_active: opt.is_active,
    });
  }

  // ── Создание новых элементов ──────────────────────────────────────────────

  startNewCategory(): void {
    this.selectedCategoryId.set(null);
    this.selectedGroupId.set(null);
    this.selectedOptionId.set(null);
    this.editorType.set('category');
    this.isNew.set(true);
    this.categoryForm.reset({ sort_order: 0, is_active: true });
  }

  startNewGroup(): void {
    if (!this.selectedCategoryId()) return;
    this.editorType.set('group');
    this.isNew.set(true);
    this.groupForm.reset({
      selection_type: 'single', is_required: false,
      min_selections: 0, max_selections: 1, sort_order: 0, is_active: true,
    });
  }

  startNewOption(): void {
    if (!this.selectedGroupId()) return;
    this.editorType.set('option');
    this.isNew.set(true);
    this.optionForm.reset({ base_price: 0, popular: false, satisfies_requires: false, sort_order: 0, is_active: true });
  }

  // ── Сохранение ────────────────────────────────────────────────────────────

  saveCategory(): void {
    if (this.categoryForm.invalid) return;
    this.saving.set(true);
    const obs = this.isNew()
      ? this.api.createCategory(this.categoryForm.value)
      : this.api.updateCategory(this.selectedCategoryId()!, this.categoryForm.value);
    obs.subscribe({
      next: () => {
        this.snackBar.open('Категория сохранена', '', { duration: 2000 });
        this.saving.set(false);
        this.loadCategories();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Ошибка сохранения', 'OK', { duration: 3000 });
      },
    });
  }

  saveGroup(): void {
    if (this.groupForm.invalid) return;
    this.saving.set(true);
    const data = { ...this.groupForm.value, service_category_id: this.selectedCategoryId() };
    const obs = this.isNew()
      ? this.api.createOptionGroup(data)
      : this.api.updateOptionGroup(this.selectedGroupId()!, this.groupForm.value);
    obs.subscribe({
      next: () => {
        this.snackBar.open('Группа сохранена', '', { duration: 2000 });
        this.saving.set(false);
        this.loadCategories();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Ошибка сохранения', 'OK', { duration: 3000 });
      },
    });
  }

  saveOption(): void {
    if (this.optionForm.invalid) return;
    this.saving.set(true);
    const data = { ...this.optionForm.value, option_group_id: this.selectedGroupId() };
    const obs = this.isNew()
      ? this.api.createOption(data)
      : this.api.updateOption(this.selectedOptionId()!, this.optionForm.value);
    obs.subscribe({
      next: () => {
        this.snackBar.open('Опция сохранена', '', { duration: 2000 });
        this.saving.set(false);
        this.loadCategories();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Ошибка сохранения', 'OK', { duration: 3000 });
      },
    });
  }

  // ── Правила ───────────────────────────────────────────────────────────────

  createRule(): void {
    if (this.ruleForm.invalid) return;
    this.saving.set(true);
    const data = { ...this.ruleForm.value, service_category_id: this.selectedCategoryId() };
    this.api.createRule(data).subscribe({
      next: () => {
        this.snackBar.open('Правило создано', '', { duration: 2000 });
        this.saving.set(false);
        this.ruleForm.reset({ rule_type: 'requires' });
        this.loadRules(this.selectedCategoryId()!);
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Ошибка создания правила', 'OK', { duration: 3000 });
      },
    });
  }

  deleteRule(id: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.dialog.open(ConfirmDialogComponent, { data: { message: 'Деактивировать правило?' } })
      .afterClosed().subscribe(confirmed => {
        if (!confirmed) return;
        this.api.deleteRule(id).subscribe({
          next: () => {
            this.snackBar.open('Правило деактивировано', '', { duration: 2000 });
            this.loadRules(this.selectedCategoryId()!);
          },
          error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
        });
      });
  }

  // ── Удаление ──────────────────────────────────────────────────────────────

  deleteCategory(id: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.dialog.open(ConfirmDialogComponent, { data: { message: 'Деактивировать категорию?' } })
      .afterClosed().subscribe(confirmed => {
        if (!confirmed) return;
        this.api.deleteCategory(id).subscribe({
          next: () => {
            this.snackBar.open('Категория деактивирована', '', { duration: 2000 });
            this.selectedCategoryId.set(null);
            this.editorType.set(null);
            this.loadCategories();
          },
          error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
        });
      });
  }

  deleteGroup(id: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.dialog.open(ConfirmDialogComponent, { data: { message: 'Деактивировать группу опций?' } })
      .afterClosed().subscribe(confirmed => {
        if (!confirmed) return;
        this.api.deleteOptionGroup(id).subscribe({
          next: () => {
            this.snackBar.open('Группа деактивирована', '', { duration: 2000 });
            this.selectedGroupId.set(null);
            this.editorType.set('category');
            this.loadCategories();
          },
          error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
        });
      });
  }

  deleteOption(id: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.dialog.open(ConfirmDialogComponent, { data: { message: 'Деактивировать опцию?' } })
      .afterClosed().subscribe(confirmed => {
        if (!confirmed) return;
        this.api.deleteOption(id).subscribe({
          next: () => {
            this.snackBar.open('Опция деактивирована', '', { duration: 2000 });
            this.selectedOptionId.set(null);
            this.editorType.set('group');
            this.loadCategories();
          },
          error: () => this.snackBar.open('Ошибка', 'OK', { duration: 3000 }),
        });
      });
  }

  // ── Tab handlers ──────────────────────────────────────────────────────────

  onTabChange(index: number): void {
    if (index === 1 && this.selectedCategoryId()) {
      this.loadRules(this.selectedCategoryId()!);
    }
    if (index === 2) {
      this.loadAudit();
    }
  }

  onAuditFilterChange(value: string): void {
    this.auditFilterValue.set(value);
    this.loadAudit();
  }

  onPriceListSearch(event: Event): void {
    const target = event.target;
    this.priceListQuery.set(target instanceof HTMLInputElement ? target.value : '');
  }

  clearPriceListSearch(): void {
    this.priceListQuery.set('');
  }

  selectCategoryById(categoryId: string): void {
    const category = this.categories().find(cat => cat.id === categoryId);
    if (!category) return;
    this.selectCategory(category);
  }

  // ── Вспомогательные методы ────────────────────────────────────────────────

  private categoryOptions(category: AdminPricingCategory): AdminServiceOption[] {
    return category.option_groups.flatMap(group => group.options ?? []);
  }

  private categoryMatchesQuery(category: AdminPricingCategory, query: string): boolean {
    if (
      category.name.toLowerCase().includes(query)
      || category.slug.toLowerCase().includes(query)
      || (category.price_range ?? '').toLowerCase().includes(query)
    ) {
      return true;
    }

    return category.option_groups.some(group =>
      group.name.toLowerCase().includes(query)
      || group.slug.toLowerCase().includes(query)
      || group.options.some(option =>
        option.name.toLowerCase().includes(query)
        || option.slug.toLowerCase().includes(query)
        || String(option.base_price).includes(query)
      )
    );
  }

  private toCategorySummary(category: AdminPricingCategory): PricingCategorySummary {
    const options = this.categoryOptions(category);
    const prices = options.map(option => option.base_price).filter(price => Number.isFinite(price));
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      icon: category.icon,
      isActive: category.is_active,
      groups: category.option_groups.length,
      options: options.length,
      activeOptions: options.filter(option => option.is_active).length,
      minPrice: prices.length ? Math.min(...prices) : null,
    };
  }

  ruleTypeLabel(type: string): string {
    return RULE_TYPE_LABELS[type] ?? type;
  }

  entityTypeLabel(type: string): string {
    return ENTITY_TYPE_LABELS[type] ?? type;
  }

  getOptionName(optionId: string): string {
    return this.allOptionsInCategory().find(o => o.id === optionId)?.name ?? optionId;
  }

  getChangedKeys(snapshot: PricingSnapshot): string[] {
    const newVals = snapshot.new_values ?? {};
    const oldVals = snapshot.old_values ?? {};
    const keys = new Set([...Object.keys(newVals), ...Object.keys(oldVals)]);
    keys.delete('updated_at');
    return [...keys].filter(k => {
      const oldV = JSON.stringify(oldVals[k]);
      const newV = JSON.stringify(newVals[k]);
      return oldV !== newV;
    });
  }

  formatDiffValue(val: unknown): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'да' : 'нет';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'string') return val.length > 30 ? val.slice(0, 30) + '…' : val;
    return JSON.stringify(val).slice(0, 40);
  }
}
