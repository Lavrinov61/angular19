/**
 * RetouchConfiguratorComponent, переиспользуемый конфигуратор «Супер обработки».
 *
 * Чистый standalone-компонент: показывает 15 групп чек-листа ретуши (макияж/кожа/
 * волосы/брови/ресницы/одежда/фон/цветокоррекция/заметки) с крупными чекбоксами,
 * переключателем пола (Ж/М/Любой) и свободными заметками ретушёру. Эмитит снимок
 * выбора {gender, groups, notes} наружу при каждом изменении.
 *
 * Это извлечённая КОПИЯ rc-логики из pricing-configurator (POS), тот компонент
 * НЕ трогается (изоляция задеплоенной кассы). Каталог, backend (resolveRetouchConfig)
 * и контракт RetouchConfigEvent, общие, поэтому структурный дрейф невозможен.
 *
 * Контракт:
 *   input  active, управляет видимостью/загрузкой/сбросом блока
 *   input  initial, гидрация при первом active (для черновика заказа)
 *   output configChange, снимок {gender, groups, notes} при изменении; null при active→false
 *
 * Используется в order-creation-form (экран «Новый заказ», CRM-тема).
 */

import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  RetouchChecklistApiService,
  RetouchChecklistGroup,
  RetouchGender,
} from '../../../features/employee/services/retouch-checklist-api.service';

// ── Публичный контракт ──────────────────────────────────────────────────────

export type { RetouchGender };

/** Снимок выбора оператора в конфигураторе «Супер обработки». */
export interface RetouchConfigEvent {
  gender: RetouchGender;
  /** group_slug → [item_slug] (только непустые группы) */
  groups: Record<string, string[]>;
  notes?: string;
}

@Component({
  selector: 'app-retouch-configurator',
  standalone: true,
  imports: [DecimalPipe, MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active()) {
      <div class="rc-block">
        <div class="rc-head">
          <div class="rc-head-title">
            <mat-icon>auto_fix_high</mat-icon>
            <span>Лист-задание ретушёру</span>
          </div>
          <div class="rc-gender" role="group" aria-label="Пол клиента">
            <button type="button" class="rc-gender-btn"
                    [class.rc-gender-btn--active]="_retouchGender() === 'female'"
                    (click)="setRetouchGender('female')">Ж</button>
            <button type="button" class="rc-gender-btn"
                    [class.rc-gender-btn--active]="_retouchGender() === 'male'"
                    (click)="setRetouchGender('male')">М</button>
            <button type="button" class="rc-gender-btn"
                    [class.rc-gender-btn--active]="_retouchGender() === 'any'"
                    (click)="setRetouchGender('any')">Любой</button>
          </div>
        </div>

        @if (retouchLoading()) {
          <div class="rc-loading">
            <mat-spinner diameter="28" />
            <span>Загружаем чек-лист…</span>
          </div>
        } @else {
          @for (rcGroup of visibleRetouchGroups(); track rcGroup.group_slug) {
            <div class="rc-section">
              <button type="button" class="rc-section-head"
                      (click)="toggleRetouchSection(rcGroup.group_slug)"
                      [attr.aria-expanded]="!isRetouchSectionCollapsed(rcGroup.group_slug)">
                <mat-icon class="rc-section-chevron"
                          [class.rc-section-chevron--collapsed]="isRetouchSectionCollapsed(rcGroup.group_slug)">
                  expand_more
                </mat-icon>
                <span class="rc-section-name">{{ rcGroup.group_name }}</span>
                @if (retouchGroupSelectedCount(rcGroup.group_slug) > 0) {
                  <span class="rc-section-badge">{{ retouchGroupSelectedCount(rcGroup.group_slug) }}</span>
                }
              </button>

              @if (!isRetouchSectionCollapsed(rcGroup.group_slug)) {
                <!-- notes-группа → textarea (НЕ чекбоксы) -->
                @if (rcGroup.selection_type === 'notes') {
                  <textarea
                    class="rc-notes"
                    rows="3"
                    maxlength="2000"
                    placeholder="Дополнительные пожелания ретушёру…"
                    [value]="_retouchNotes()"
                    (input)="onRetouchNotesInput($any($event.target).value)"
                  ></textarea>
                } @else {
                  <div class="rc-items">
                    @for (item of rcGroup.items; track item.slug) {
                      <div
                        class="rc-item"
                        [class.rc-item--selected]="isRetouchItemSelected(rcGroup.group_slug, item.slug)"
                        [class.rc-item--radio]="rcGroup.selection_type === 'single'"
                        (click)="toggleRetouchItem(rcGroup, item.slug)"
                        (keydown.enter)="toggleRetouchItem(rcGroup, item.slug)"
                        tabindex="0"
                        role="button"
                        [attr.aria-pressed]="isRetouchItemSelected(rcGroup.group_slug, item.slug)"
                      >
                        <div class="pc-checkbox rc-checkbox"
                             [class.rc-checkbox--radio]="rcGroup.selection_type === 'single'"
                             [class.pc-checkbox--on]="isRetouchItemSelected(rcGroup.group_slug, item.slug)">
                          @if (isRetouchItemSelected(rcGroup.group_slug, item.slug)) {
                            <mat-icon>check</mat-icon>
                          }
                        </div>
                        <div class="rc-item-body">
                          <span class="rc-item-name">{{ item.name }}</span>
                          @if (item.hint) {
                            <span class="rc-item-hint">{{ item.hint }}</span>
                          }
                        </div>
                        @if (item.addon_price > 0) {
                          <span class="rc-item-addon">+{{ item.addon_price | number }} ₽</span>
                        }
                      </div>
                    }
                  </div>
                }
              }
            </div>
          }
        }
      </div>
    }
  `,
  styles: [`
    /* ── Конфигуратор «Супер обработки» ──────────────────────────────
       Маппинг палитры: rc-стили написаны на var(--ed-*, fallback). Здесь, на
       корне .rc-block, переопределяем --ed-* через CRM-переменные (с сохранением
       исходного fallback), чтобы компонент вписался в тему order-creation-form.
       --ed-on-accent в CRM-палитре нет, на акценте текст всегда #0a0a0a. */
    .rc-block {
      --ed-accent: var(--crm-accent, #f59e0b);
      --ed-on-accent: #0a0a0a;
      --ed-surface: var(--crm-surface-base, #0a0a0a);
      --ed-surface-container: var(--crm-surface, #1a1a1a);
      --ed-on-surface: var(--crm-text-primary, #f5f5f5);
      --ed-on-surface-variant: var(--crm-text-secondary, #a0a0a0);
      --ed-outline-variant: var(--crm-border, #2a2a2a);

      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      border-radius: 14px;
      border: 2px solid color-mix(in srgb, var(--ed-accent, #f59e0b) 35%, transparent);
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 5%, var(--ed-surface, #0a0a0a));
    }

    .rc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .rc-head-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
      font-weight: 800;
      color: var(--ed-on-surface, #f5f5f5);

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
        color: var(--ed-accent, #f59e0b);
      }
    }

    .rc-gender {
      display: flex;
      border-radius: 10px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      overflow: hidden;
    }

    .rc-gender-btn {
      padding: 6px 14px;
      border: none;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.85rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;

      &:not(:last-child) { border-right: 1px solid var(--ed-outline-variant, #2a2a2a); }

      &--active {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
      }

      &:not(.rc-gender-btn--active):hover {
        color: var(--ed-on-surface, #f5f5f5);
      }
    }

    .rc-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 4px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.9rem;
    }

    .rc-section {
      border-radius: 10px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
      overflow: hidden;
    }

    .rc-section-head {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 12px 14px;
      border: none;
      background: transparent;
      color: var(--ed-on-surface, #f5f5f5);
      font-family: inherit;
      font-size: 0.92rem;
      font-weight: 700;
      cursor: pointer;
      text-align: left;

      &:hover { background: color-mix(in srgb, var(--ed-accent, #f59e0b) 6%, transparent); }
    }

    .rc-section-chevron {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition: transform 0.2s;

      &--collapsed { transform: rotate(-90deg); }
    }

    .rc-section-name { flex: 1; }

    .rc-section-badge {
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 100px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 0.78rem;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .rc-items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 12px 14px;
    }

    .rc-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface, #0a0a0a);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      user-select: none;

      &:hover { border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 45%, transparent); }

      &--selected {
        border-color: var(--ed-accent, #f59e0b);
        background: color-mix(in srgb, var(--ed-accent, #f59e0b) 8%, var(--ed-surface, #0a0a0a));
      }
    }

    /* Базовый чекбокс/радио (перенесён из pricing-configurator .pc-checkbox) */
    .pc-checkbox {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      transition: border-color 0.2s, background 0.2s;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;

      &--on {
        border-color: var(--ed-accent, #f59e0b);
        background: var(--ed-accent, #f59e0b);

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
          color: var(--ed-on-accent, #0a0a0a);
        }
      }
    }

    /* Крупный чекбокс конфигуратора, заметно больше базового .pc-checkbox */
    .rc-checkbox {
      width: 28px;
      height: 28px;

      &--radio { border-radius: 50%; }

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .rc-item-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .rc-item-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .rc-item-hint {
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.3;
    }

    .rc-item-addon {
      flex-shrink: 0;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
    }

    .rc-notes {
      width: 100%;
      box-sizing: border-box;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: inherit;
      font-size: 0.9rem;
      resize: vertical;
      outline: none;
      transition: border-color 0.2s;

      &:focus { border-color: var(--ed-accent, #f59e0b); }
      &::placeholder { color: var(--ed-on-surface-variant, #a0a0a0); }
    }
  `],
})
export class RetouchConfiguratorComponent {
  private readonly retouchChecklistApi = inject(RetouchChecklistApiService);

  // ── Inputs / Outputs ────────────────────────────────────────────────────────

  /** Управляет видимостью/загрузкой/сбросом блока. */
  readonly active = input<boolean>(false);
  /** Гидрация при первом active (восстановление из черновика). */
  readonly initial = input<RetouchConfigEvent | null>(null);
  /** Снимок выбора при каждом изменении; null при active→false. */
  readonly configChange = output<RetouchConfigEvent | null>();

  // ── Сигналы конфигуратора (иммутабельные) ────────────────────────────────────

  /** Каталог чек-листа (lazy-load при первом раскрытии блока) */
  protected readonly retouchChecklist = signal<RetouchChecklistGroup[]>([]);
  protected readonly retouchLoading = signal(false);
  protected readonly retouchLoaded = signal(false);

  /** group_slug → [item_slug], выбор оператора */
  protected readonly _retouchSelections = signal<Record<string, string[]>>({});
  /** Выбранный пол клиента (фильтр опций) */
  protected readonly _retouchGender = signal<RetouchGender>('any');
  /** Свободные заметки ретушёру */
  protected readonly _retouchNotes = signal('');
  /** Свёрнутые секции (group_slug, развёрнутые по умолчанию) */
  protected readonly _retouchCollapsed = signal<Record<string, boolean>>({});
  /** Дефолты/гидрация применены (флаг разовости на цикл active) */
  private readonly _retouchDefaultsApplied = signal(false);

  // ── Computed ──────────────────────────────────────────────────────────────

  /**
   * Каталог, отфильтрованный по выбранному полу. «Любой» (any) показывает ВСЕ опции
   * (нейтральные + женские + мужские); «Ж»/«М» — нейтральные + опции своего пола.
   */
  readonly visibleRetouchGroups = computed((): RetouchChecklistGroup[] => {
    const gender = this._retouchGender();
    return this.retouchChecklist()
      .map(group => {
        if (group.selection_type === 'notes') return group;
        const items = gender === 'any'
          ? group.items
          : group.items.filter(i => i.gender === 'any' || i.gender === gender);
        return { ...group, items };
      })
      .filter(group => group.selection_type === 'notes' || group.items.length > 0);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  constructor() {
    // Реакция на active: false→true, загрузка/гидрация/emit; true→false, сброс + emit(null).
    effect(() => {
      const active = this.active();
      untracked(() => {
        if (active) {
          if (this.retouchLoaded()) {
            // Каталог уже загружен (повторный заход), применить дефолты/гидрацию сразу
            this.applyRetouchDefaults();
            this.emitConfig();
          } else if (!this.retouchLoading()) {
            // Первая загрузка, дефолты/гидрация и emit в колбэке после получения каталога
            this.loadRetouchChecklist();
          }
        } else {
          // Сброс при сворачивании блока
          this._retouchSelections.set({});
          this._retouchNotes.set('');
          this._retouchDefaultsApplied.set(false);
          this._retouchCollapsed.set({});
          this.configChange.emit(null);
        }
      });
    });
  }

  // ── Конфигуратор: загрузка / выбор / пол ──────────────────────────────────

  private loadRetouchChecklist(): void {
    this.retouchLoading.set(true);
    this.retouchChecklistApi.getRetouchChecklist().subscribe({
      next: groups => {
        this.retouchChecklist.set(groups);
        this.retouchLoaded.set(true);
        this.retouchLoading.set(false);
        this.applyRetouchDefaults();
        this.emitConfig();
      },
      error: () => {
        this.retouchLoading.set(false);
      },
    });
  }

  /**
   * Однократно на цикл active: гидрировать из initial (черновик), иначе предзаполнить
   * дефолты (is_default) при первом построении блока.
   */
  private applyRetouchDefaults(): void {
    if (this._retouchDefaultsApplied()) return;

    const hydration = this.initial();
    if (hydration) {
      this._retouchGender.set(hydration.gender);
      // Копируем только непустые группы (иммутабельно)
      const restored: Record<string, string[]> = {};
      for (const [groupSlug, slugs] of Object.entries(hydration.groups ?? {})) {
        restored[groupSlug] = [...slugs];
      }
      this._retouchSelections.set(restored);
      this._retouchNotes.set(hydration.notes ?? '');
      this._retouchDefaultsApplied.set(true);
      return;
    }

    const gender = this._retouchGender();
    const init: Record<string, string[]> = {};
    for (const group of this.retouchChecklist()) {
      if (group.selection_type === 'notes') continue;
      const defaults = group.items
        .filter(i => i.is_default && (gender === 'any' || i.gender === 'any' || i.gender === gender))
        .map(i => i.slug);
      // single-группа: максимум 1 дефолт
      init[group.group_slug] = group.selection_type === 'single' ? defaults.slice(0, 1) : defaults;
    }
    this._retouchSelections.set(init);
    this._retouchDefaultsApplied.set(true);
  }

  isRetouchItemSelected(groupSlug: string, itemSlug: string): boolean {
    return (this._retouchSelections()[groupSlug] ?? []).includes(itemSlug);
  }

  toggleRetouchItem(group: RetouchChecklistGroup, itemSlug: string): void {
    if (group.selection_type === 'notes') return;
    const sel = { ...this._retouchSelections() };
    const current = sel[group.group_slug] ?? [];
    if (group.selection_type === 'single') {
      // Радио-поведение: максимум 1 в группе; повторный клик снимает
      sel[group.group_slug] = current.includes(itemSlug) ? [] : [itemSlug];
    } else {
      sel[group.group_slug] = current.includes(itemSlug)
        ? current.filter(s => s !== itemSlug)
        : [...current, itemSlug];
    }
    this._retouchSelections.set(sel);
    this.emitConfig();
  }

  /** Сменить пол: вычистить из выбора варианты противоположного пола («Любой» ничего не вычищает). */
  setRetouchGender(gender: RetouchGender): void {
    if (this._retouchGender() === gender) return;
    this._retouchGender.set(gender);
    // Построить множество допустимых slug при новом поле («Любой» допускает все)
    const allowed = new Set<string>();
    for (const g of this.retouchChecklist()) {
      for (const item of g.items) {
        if (gender === 'any' || item.gender === 'any' || item.gender === gender) allowed.add(item.slug);
      }
    }
    const sel = this._retouchSelections();
    const cleaned: Record<string, string[]> = {};
    for (const [groupSlug, slugs] of Object.entries(sel)) {
      cleaned[groupSlug] = slugs.filter(s => allowed.has(s));
    }
    this._retouchSelections.set(cleaned);
    this.emitConfig();
  }

  isRetouchSectionCollapsed(groupSlug: string): boolean {
    return this._retouchCollapsed()[groupSlug] === true;
  }

  toggleRetouchSection(groupSlug: string): void {
    this._retouchCollapsed.update(c => ({ ...c, [groupSlug]: !c[groupSlug] }));
  }

  /** Кол-во выбранных в группе (для бейджа на свёрнутой секции) */
  retouchGroupSelectedCount(groupSlug: string): number {
    return (this._retouchSelections()[groupSlug] ?? []).length;
  }

  onRetouchNotesInput(value: string): void {
    this._retouchNotes.set(value);
    this.emitConfig();
  }

  // ── Эмиссия снимка наружу ────────────────────────────────────────────────────

  /** Собрать снимок {gender, groups (только непустые), notes} и эмитнуть. */
  private emitConfig(): void {
    const groups: Record<string, string[]> = {};
    for (const [groupSlug, slugs] of Object.entries(this._retouchSelections())) {
      if (slugs.length > 0) groups[groupSlug] = [...slugs];
    }
    const notes = this._retouchNotes().trim();
    this.configChange.emit({
      gender: this._retouchGender(),
      groups,
      notes: notes || undefined,
    });
  }
}
