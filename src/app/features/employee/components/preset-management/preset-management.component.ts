import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import {
  PrintApiService, PrintPresetRecord, CreatePrintPresetDto,
} from '../../services/print-api.service';
import { ToastService } from '../../../../core/services/toast.service';

const TYPE_LABELS: Record<string, string> = {
  photo: 'Фото', mfp: 'МФУ', document: 'Документы',
};

const TYPE_ICONS: Record<string, string> = {
  photo: 'photo_camera', mfp: 'print', document: 'description',
};

const PAPER_OPTIONS = [
  { value: '10x15', label: '10x15' },
  { value: '13x18', label: '13x18' },
  { value: 'A5', label: 'A5' },
  { value: 'A4', label: 'A4' },
  { value: 'A3', label: 'A3' },
];

const QUALITY_OPTIONS = [
  { value: 'draft', label: 'Черновик' },
  { value: 'normal', label: 'Стандарт' },
  { value: 'high', label: 'Высокое' },
  { value: 'photo', label: 'Фото' },
  { value: 'standard', label: 'Standard' },
];

const FIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'fit', label: 'Вписать' },
  { value: 'fill', label: 'Заполнить' },
  { value: 'stretch', label: 'Растянуть' },
  { value: 'actual', label: 'Реальный размер' },
];

const ICON_OPTIONS = [
  'photo', 'photo_camera', 'photo_size_select_large', 'photo_library',
  'description', 'filter_b_and_w', 'auto_stories', 'palette',
  'print', 'picture_as_pdf', 'crop_portrait', 'crop_landscape_rounded',
];

@Component({
  selector: 'app-preset-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSlideToggleModule, MatProgressSpinnerModule, MatDividerModule,
    MatChipsModule,
  ],
  template: `
    <div class="pm-layout">
      <div class="pm-header">
        <h2 class="pm-title">
          <mat-icon>tune</mat-icon>
          Пресеты печати
        </h2>
        <button mat-flat-button color="primary" (click)="startCreate()">
          <mat-icon>add</mat-icon> Добавить пресет
        </button>
      </div>

      @if (loading()) {
        <div class="pm-loading">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else {
        <!-- Group by printer_type -->
        @for (group of groupedPresets(); track group.type) {
          <div class="pm-group">
            <h3 class="pm-group-title">
              <mat-icon>{{ typeIcon(group.type) }}</mat-icon>
              {{ typeLabel(group.type) }}
              <span class="pm-group-count">{{ group.presets.length }}</span>
            </h3>
            <div class="pm-grid">
              @for (preset of group.presets; track preset.id) {
                <mat-card class="pm-card" [class.inactive]="!preset.is_active">
                  <div class="pm-card-header">
                    <mat-icon class="pm-card-icon">{{ preset.icon || 'print' }}</mat-icon>
                    <div class="pm-card-info">
                      <span class="pm-card-name">{{ preset.name }}</span>
                      <span class="pm-card-meta">
                        {{ preset.paper_size }} · {{ preset.quality }}
                        @if (preset.price) { · {{ preset.price }} \u20BD }
                      </span>
                    </div>
                    @if (!preset.is_active) {
                      <span class="pm-badge-inactive">Скрыт</span>
                    }
                  </div>
                  <div class="pm-card-tags">
                    @if (preset.borderless) { <span class="pm-tag">Без полей</span> }
                    @if (preset.duplex) { <span class="pm-tag">Двусторонняя</span> }
                    @if (preset.mirror) { <span class="pm-tag">Зеркало</span> }
                    @if (preset.sublimation) { <span class="pm-tag accent">Сублимация</span> }
                    @if (preset.color_mode === 'bw') { <span class="pm-tag">Ч/Б</span> }
                    <span class="pm-tag subtle">{{ fitLabel(preset.fit_mode) }}</span>
                  </div>
                  <div class="pm-card-actions">
                    <button mat-icon-button (click)="startEdit(preset)" matTooltip="Редактировать">
                      <mat-icon>edit</mat-icon>
                    </button>
                    <button mat-icon-button (click)="confirmDelete(preset)" matTooltip="Удалить"
                            class="pm-delete-btn">
                      <mat-icon>delete_outline</mat-icon>
                    </button>
                  </div>
                </mat-card>
              }
            </div>
          </div>
        }

        @if (!groupedPresets().length && !loading()) {
          <div class="pm-empty">
            <mat-icon>tune</mat-icon>
            <span>Пресеты не найдены. Создайте первый!</span>
          </div>
        }
      }

      <!-- ═══ EDIT / CREATE FORM ═══ -->
      @if (formOpen()) {
        <div class="pm-overlay" role="button" tabindex="0" (click)="closeForm()" (keyup.escape)="closeForm()"></div>
        <div class="pm-form-panel glass-card">
          <h3 class="pm-form-title">
            {{ editingId() ? 'Редактирование пресета' : 'Новый пресет' }}
          </h3>

          <div class="pm-form-body">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Название</mat-label>
              <input matInput [(ngModel)]="form.name" placeholder="Фото 10x15">
            </mat-form-field>

            <div class="pm-form-row">
              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Тип принтера</mat-label>
                <mat-select [(ngModel)]="form.printer_type">
                  <mat-option value="photo">Фото</mat-option>
                  <mat-option value="mfp">МФУ</mat-option>
                  <mat-option value="document">Документы</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Размер бумаги</mat-label>
                <mat-select [(ngModel)]="form.paper_size">
                  @for (opt of paperOptions; track opt.value) {
                    <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="pm-form-row">
              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Качество</mat-label>
                <mat-select [(ngModel)]="form.quality">
                  @for (opt of qualityOptions; track opt.value) {
                    <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Режим вписывания</mat-label>
                <mat-select [(ngModel)]="form.fit_mode">
                  @for (opt of fitOptions; track opt.value) {
                    <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="pm-form-row">
              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Цвет</mat-label>
                <mat-select [(ngModel)]="form.color_mode">
                  <mat-option value="color">Цветная</mat-option>
                  <mat-option value="bw">Ч/Б</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Тип бумаги</mat-label>
                <input matInput [(ngModel)]="form.media_type" placeholder="glossy">
              </mat-form-field>
            </div>

            <div class="pm-form-row">
              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Цена (\u20BD)</mat-label>
                <input matInput type="number" [(ngModel)]="form.price" min="0">
              </mat-form-field>

              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Порядок сортировки</mat-label>
                <input matInput type="number" [(ngModel)]="form.sort_order" min="0">
              </mat-form-field>
            </div>

            <!-- Icon picker -->
            <div class="pm-icon-picker">
              <span class="pm-icon-label">Иконка:</span>
              <div class="pm-icon-grid">
                @for (ic of iconOptions; track ic) {
                  <button mat-icon-button
                          class="pm-icon-btn"
                          [class.active]="form.icon === ic"
                          (click)="form.icon = ic">
                    <mat-icon>{{ ic }}</mat-icon>
                  </button>
                }
              </div>
            </div>

            <!-- Toggles -->
            <div class="pm-toggles">
              <mat-slide-toggle [(ngModel)]="form.borderless">Без полей</mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="form.duplex">Двусторонняя</mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="form.mirror">Зеркало</mat-slide-toggle>
              <mat-slide-toggle [(ngModel)]="form.sublimation">Сублимация</mat-slide-toggle>
            </div>
          </div>

          <div class="pm-form-actions">
            <button mat-stroked-button (click)="closeForm()">Отмена</button>
            <button mat-flat-button color="primary"
                    [disabled]="saving() || !form.name || !form.paper_size"
                    (click)="save()">
              @if (saving()) {
                <mat-spinner diameter="18" class="btn-spinner"></mat-spinner>
              }
              {{ editingId() ? 'Сохранить' : 'Создать' }}
            </button>
          </div>
        </div>
      }

      <!-- DELETE CONFIRM -->
      @if (deletingPreset()) {
        <div class="pm-overlay" role="button" tabindex="0" (click)="deletingPreset.set(null)" (keyup.escape)="deletingPreset.set(null)"></div>
        <div class="pm-confirm-panel glass-card">
          <mat-icon class="pm-confirm-icon">warning</mat-icon>
          <p>Удалить пресет <strong>{{ deletingPreset()!.name }}</strong>?</p>
          <div class="pm-confirm-actions">
            <button mat-stroked-button (click)="deletingPreset.set(null)">Отмена</button>
            <button mat-flat-button color="warn" (click)="doDelete()"
                    [disabled]="saving()">
              Удалить
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .glass-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
    }

    .pm-layout { padding: 16px; height: 100%; overflow-y: auto; }

    .pm-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    }

    .pm-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 20px; font-weight: 600; margin: 0;
      color: var(--crm-text-primary);

      mat-icon { color: var(--crm-accent); }
    }

    .pm-loading {
      display: flex; justify-content: center; padding: 60px 0;
    }

    /* ── Groups ── */
    .pm-group { margin-bottom: 24px; }

    .pm-group-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 15px; font-weight: 600; margin: 0 0 12px;
      color: var(--crm-text-secondary);

      mat-icon {
        font-size: 18px; width: 18px; height: 18px;
        color: var(--crm-accent);
      }
    }

    .pm-group-count {
      font-size: 12px; font-weight: 600;
      padding: 2px 8px; border-radius: 10px;
      background: rgba(245, 158, 11, 0.15);
      color: var(--crm-accent);
    }

    .pm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 12px;
    }

    /* ── Card ── */
    .pm-card {
      padding: 14px 16px;
      transition: transform 0.15s, box-shadow 0.15s;

      &:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      }

      &.inactive { opacity: 0.5; }
    }

    .pm-card-header {
      display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
    }

    .pm-card-icon {
      font-size: 28px; width: 28px; height: 28px;
      color: var(--crm-accent);
    }

    .pm-card-info { flex: 1; display: flex; flex-direction: column; }

    .pm-card-name {
      font-size: 14px; font-weight: 600;
      color: var(--crm-text-primary);
    }

    .pm-card-meta {
      font-size: 12px; color: var(--crm-text-secondary);
    }

    .pm-badge-inactive {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      padding: 2px 8px; border-radius: 4px;
      background: rgba(239, 68, 68, 0.15); color: #ef4444;
    }

    .pm-card-tags {
      display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;
    }

    .pm-tag {
      font-size: 11px; padding: 2px 8px; border-radius: 4px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--crm-text-secondary);

      &.accent {
        background: rgba(245, 158, 11, 0.12);
        color: var(--crm-accent);
      }

      &.subtle { opacity: 0.7; }
    }

    .pm-card-actions {
      display: flex; justify-content: flex-end; gap: 4px;
      margin-top: 4px;

      button { color: var(--crm-text-muted); }
      .pm-delete-btn:hover { color: #ef4444; }
    }

    .pm-empty {
      display: flex; flex-direction: column; align-items: center;
      gap: 12px; padding: 60px 0;
      color: var(--crm-text-muted); font-size: 14px;

      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
    }

    /* ── Overlay ── */
    .pm-overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
    }

    /* ── Form panel ── */
    .pm-form-panel {
      position: fixed;
      top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 560px; max-height: 85vh; overflow-y: auto;
      padding: 24px; z-index: 1001;
    }

    .pm-form-title {
      font-size: 18px; font-weight: 600; margin: 0 0 20px;
      color: var(--crm-text-primary);
    }

    .pm-form-body { display: flex; flex-direction: column; gap: 4px; }

    .pm-form-row { display: flex; gap: 12px; }

    .flex-1 { flex: 1; }
    .full-width { width: 100%; }

    .pm-icon-picker { margin: 8px 0; }

    .pm-icon-label {
      font-size: 12px; font-weight: 500;
      color: var(--crm-text-secondary);
      display: block; margin-bottom: 6px;
    }

    .pm-icon-grid {
      display: flex; flex-wrap: wrap; gap: 4px;
    }

    .pm-icon-btn {
      border: 1px solid transparent;
      border-radius: 8px;
      transition: all 0.15s;

      &.active {
        border-color: var(--crm-accent);
        background: rgba(245, 158, 11, 0.12);
        color: var(--crm-accent);
      }
    }

    .pm-toggles {
      display: flex; flex-wrap: wrap; gap: 16px;
      margin: 8px 0 16px;
    }

    .pm-form-actions {
      display: flex; justify-content: flex-end; gap: 8px;
      margin-top: 16px; padding-top: 16px;
      border-top: 1px solid var(--crm-glass-border);
    }

    .btn-spinner { display: inline-block; margin-right: 8px; }

    /* ── Confirm ── */
    .pm-confirm-panel {
      position: fixed;
      top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 380px; padding: 24px; z-index: 1001;
      text-align: center;
    }

    .pm-confirm-icon {
      font-size: 48px; width: 48px; height: 48px;
      color: #ef4444; margin-bottom: 12px;
    }

    .pm-confirm-panel p {
      font-size: 14px; color: var(--crm-text-primary);
      margin-bottom: 20px;
    }

    .pm-confirm-actions {
      display: flex; justify-content: center; gap: 12px;
    }
  `],
})
export class PresetManagementComponent implements OnInit {
  private readonly printApi = inject(PrintApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly presets = signal<PrintPresetRecord[]>([]);
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly deletingPreset = signal<PrintPresetRecord | null>(null);

  readonly paperOptions = PAPER_OPTIONS;
  readonly qualityOptions = QUALITY_OPTIONS;
  readonly fitOptions = FIT_OPTIONS;
  readonly iconOptions = ICON_OPTIONS;

  form: {
    name: string;
    printer_type: string;
    paper_size: string;
    quality: string;
    fit_mode: string;
    color_mode: string;
    media_type: string;
    icon: string;
    price: number;
    sort_order: number;
    borderless: boolean;
    duplex: boolean;
    mirror: boolean;
    sublimation: boolean;
  } = this.emptyForm();

  readonly groupedPresets = computed(() => {
    const groups = new Map<string, PrintPresetRecord[]>();
    for (const p of this.presets()) {
      const type = p.printer_type;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push(p);
    }
    return Array.from(groups.entries())
      .map(([type, presets]) => ({
        type,
        presets: presets.sort((a, b) => a.sort_order - b.sort_order),
      }))
      .sort((a, b) => {
        const order = ['photo', 'mfp', 'document'];
        return order.indexOf(a.type) - order.indexOf(b.type);
      });
  });

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  typeIcon(type: string): string {
    return TYPE_ICONS[type] ?? 'print';
  }

  fitLabel(mode: string): string {
    return FIT_OPTIONS.find(o => o.value === mode)?.label ?? mode;
  }

  ngOnInit(): void {
    this.loadPresets();
  }

  private loadPresets(): void {
    this.loading.set(true);
    this.printApi.getPresets().subscribe({
      next: presets => {
        this.presets.set(presets);
        this.loading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось загрузить пресеты');
        this.loading.set(false);
      },
    });
  }

  startCreate(): void {
    this.form = this.emptyForm();
    this.editingId.set(null);
    this.formOpen.set(true);
  }

  startEdit(preset: PrintPresetRecord): void {
    this.editingId.set(preset.id);
    this.form = {
      name: preset.name,
      printer_type: preset.printer_type,
      paper_size: preset.paper_size,
      quality: preset.quality,
      fit_mode: preset.fit_mode,
      color_mode: preset.color_mode,
      media_type: preset.media_type ?? '',
      icon: preset.icon || 'print',
      price: preset.price,
      sort_order: preset.sort_order,
      borderless: preset.borderless,
      duplex: preset.duplex,
      mirror: preset.mirror,
      sublimation: preset.sublimation,
    };
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  save(): void {
    const dto: CreatePrintPresetDto = {
      name: this.form.name.trim(),
      printer_type: this.form.printer_type,
      paper_size: this.form.paper_size,
      quality: this.form.quality,
      fit_mode: this.form.fit_mode,
      color_mode: this.form.color_mode,
      media_type: this.form.media_type || undefined,
      icon: this.form.icon,
      price: this.form.price,
      sort_order: this.form.sort_order,
      borderless: this.form.borderless,
      duplex: this.form.duplex,
      mirror: this.form.mirror,
      sublimation: this.form.sublimation,
    };

    this.saving.set(true);
    const id = this.editingId();

    const req$ = id
      ? this.printApi.updatePreset(id, dto)
      : this.printApi.createPreset(dto);

    req$.subscribe({
      next: () => {
        this.toast.success(id ? 'Пресет обновлён' : 'Пресет создан');
        this.closeForm();
        this.saving.set(false);
        this.loadPresets();
      },
      error: () => {
        this.toast.error('Ошибка сохранения пресета');
        this.saving.set(false);
      },
    });
  }

  confirmDelete(preset: PrintPresetRecord): void {
    this.deletingPreset.set(preset);
  }

  doDelete(): void {
    const preset = this.deletingPreset();
    if (!preset) return;

    this.saving.set(true);
    this.printApi.deletePreset(preset.id).subscribe({
      next: () => {
        this.toast.success('Пресет удалён');
        this.deletingPreset.set(null);
        this.saving.set(false);
        this.loadPresets();
      },
      error: () => {
        this.toast.error('Ошибка удаления');
        this.saving.set(false);
      },
    });
  }

  private emptyForm() {
    return {
      name: '',
      printer_type: 'photo',
      paper_size: '10x15',
      quality: 'photo',
      fit_mode: 'fill',
      color_mode: 'color',
      media_type: '',
      icon: 'photo',
      price: 0,
      sort_order: 0,
      borderless: true,
      duplex: false,
      mirror: false,
      sublimation: false,
    };
  }
}
