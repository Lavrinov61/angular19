import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import {
  PrintApiService, DocumentTemplate, CreateDocumentTemplateDto,
} from '../../services/print-api.service';

const CATEGORIES = [
  { id: 'passport', name: 'Паспорт' },
  { id: 'visa', name: 'Виза' },
  { id: 'id_card', name: 'Удостоверение' },
  { id: 'license', name: 'Лицензия / ВУ' },
  { id: 'medical', name: 'Медицинское' },
  { id: 'military', name: 'Военный билет' },
  { id: 'other', name: 'Прочее' },
];

const COUNTRY_CODES = [
  { id: 'RU', name: 'Россия' },
  { id: 'US', name: 'США' },
  { id: 'CN', name: 'Китай' },
  { id: 'EU', name: 'Шенген (ЕС)' },
  { id: 'INT', name: 'Международный' },
];

@Component({
  selector: 'app-document-template-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSlideToggleModule, MatProgressSpinnerModule,
    MatTooltipModule, MatDividerModule, MatChipsModule,
  ],
  template: `
    <div class="dt-page">
      <div class="dt-header">
        <div>
          <h2 class="dt-title">Шаблоны документов</h2>
          <p class="dt-subtitle">{{ templates().length }} шаблон(ов) для фото на документы</p>
        </div>
        <button mat-flat-button class="add-btn" (click)="startAdd()" [disabled]="adding()">
          <mat-icon>add</mat-icon> Добавить
        </button>
      </div>

      <!-- Category filter -->
      <div class="dt-filters">
        <mat-chip-set>
          <mat-chip [highlighted]="!filterCategory()" (click)="filterCategory.set(null)">Все</mat-chip>
          @for (cat of categories; track cat.id) {
            <mat-chip [highlighted]="filterCategory() === cat.id" (click)="filterCategory.set(cat.id)">
              {{ cat.name }}
            </mat-chip>
          }
        </mat-chip-set>
      </div>

      @if (adding() || editingId()) {
        <mat-card class="dt-form-card">
          <div class="form-title">
            {{ editingId() ? 'Редактировать шаблон' : 'Новый шаблон документа' }}
          </div>
          <form [formGroup]="form" (ngSubmit)="save()" class="dt-form">
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-lg">
                <mat-label>Название</mat-label>
                <input matInput formControlName="name" placeholder="Паспорт РФ" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Slug</mat-label>
                <input matInput formControlName="slug" placeholder="passport-rf" />
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Категория</mat-label>
                <mat-select formControlName="category">
                  @for (cat of categories; track cat.id) {
                    <mat-option [value]="cat.id">{{ cat.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Страна</mat-label>
                <mat-select formControlName="country_code">
                  @for (cc of countryCodes; track cc.id) {
                    <mat-option [value]="cc.id">{{ cc.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="form-section-label">Размеры фото (мм)</div>
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Ширина</mat-label>
                <input matInput type="number" formControlName="photo_width_mm" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Высота</mat-label>
                <input matInput type="number" formControlName="photo_height_mm" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Мин. высота головы</mat-label>
                <input matInput type="number" formControlName="head_height_min_mm" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Макс. высота головы</mat-label>
                <input matInput type="number" formControlName="head_height_max_mm" />
              </mat-form-field>
            </div>

            <div class="form-section-label">Раскладка на листе</div>
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Фото на лист</mat-label>
                <input matInput type="number" formControlName="photos_per_sheet" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Строк</mat-label>
                <input matInput type="number" formControlName="layout_rows" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Столбцов</mat-label>
                <input matInput type="number" formControlName="layout_cols" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Рез-метки (мм)</mat-label>
                <input matInput type="number" formControlName="cut_margin_mm" />
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Формат печати</mat-label>
                <mat-select formControlName="default_media_size">
                  <mat-option value="10x15">10x15</mat-option>
                  <mat-option value="13x18">13x18</mat-option>
                  <mat-option value="15x20">15x20</mat-option>
                  <mat-option value="a4">A4</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Цвет фона</mat-label>
                <input matInput formControlName="background_color" placeholder="#FFFFFF" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Порядок</mat-label>
                <input matInput type="number" formControlName="sort_order" />
              </mat-form-field>
            </div>

            <div class="form-actions">
              <button mat-flat-button type="submit" [disabled]="form.invalid || saving()" class="save-btn">
                @if (saving()) { <mat-spinner diameter="16" /> }
                @else { <mat-icon>save</mat-icon> }
                {{ editingId() ? 'Сохранить' : 'Создать' }}
              </button>
              <button mat-button type="button" (click)="cancelEdit()">Отмена</button>
            </div>
          </form>
        </mat-card>
      }

      @if (loading()) {
        <div class="dt-loading"><mat-spinner diameter="32" /></div>
      } @else if (filteredTemplates().length === 0) {
        <div class="dt-empty">
          <mat-icon>badge</mat-icon>
          <span>Шаблоны не найдены</span>
        </div>
      } @else {
        <div class="dt-list">
          @for (t of filteredTemplates(); track t.id) {
            <mat-card class="dt-card">
              @if (confirmDeleteId() === t.id) {
                <div class="delete-confirm">
                  <mat-icon class="delete-icon">warning</mat-icon>
                  <span>Удалить «{{ t.name }}»?</span>
                  <div class="delete-actions">
                    <button mat-flat-button color="warn" (click)="confirmDelete(t.id)">Удалить</button>
                    <button mat-button (click)="confirmDeleteId.set(null)">Отмена</button>
                  </div>
                </div>
              }

              <div class="dt-card__header">
                <div class="dt-card__name-row">
                  <span class="template-name">{{ t.name }}</span>
                  <span class="cat-badge">{{ categoryLabel(t.category) }}</span>
                  <span class="country-badge">{{ t.country_code }}</span>
                </div>
                <div class="dt-card__actions">
                  <button mat-icon-button matTooltip="Редактировать" (click)="startEdit(t)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Удалить" class="delete-btn" (click)="requestDelete(t.id)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>

              <!-- Visual size preview -->
              <div class="dt-card__preview">
                <div class="photo-preview"
                     [style.width.px]="previewScale(t.photo_width_mm)"
                     [style.height.px]="previewScale(t.photo_height_mm)"
                     [style.background]="t.background_color">
                  <span class="preview-size">{{ t.photo_width_mm }}x{{ t.photo_height_mm }}</span>
                </div>
                <div class="preview-layout">
                  {{ t.layout_rows }}x{{ t.layout_cols }} = {{ t.photos_per_sheet }} шт.
                  <br>
                  <span class="preview-media">{{ t.default_media_size }}</span>
                </div>
              </div>

              <mat-divider />

              <div class="dt-card__specs">
                @if (t.head_height_min_mm !== null && t.head_height_min_mm !== undefined && t.head_height_max_mm !== null && t.head_height_max_mm !== undefined) {
                  <span class="spec-chip">Голова: {{ t.head_height_min_mm }}–{{ t.head_height_max_mm }} мм</span>
                }
                @if (t.cut_margin_mm > 0) {
                  <span class="spec-chip">Рез: {{ t.cut_margin_mm }} мм</span>
                }
                <span class="spec-chip spec-chip--slug">{{ t.slug }}</span>
              </div>
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .dt-page { max-width: 900px; margin: 0 auto; padding: 20px 16px; }

    .dt-header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px;
    }

    .dt-title { font-size: 18px; font-weight: 600; color: var(--crm-text-primary); margin: 0 0 2px; }
    .dt-subtitle { font-size: 12px; color: var(--crm-text-secondary); margin: 0; }

    .dt-filters { margin-bottom: 16px; }

    .add-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }

    .dt-form-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.07);
      padding: 20px; margin-bottom: 20px; border-radius: 8px;
    }

    .form-title { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); margin-bottom: 16px; }
    .form-section-label {
      font-size: 11px; font-weight: 600; color: var(--crm-text-secondary);
      text-transform: uppercase; letter-spacing: 0.05em; margin: 8px 0 4px;
    }
    .dt-form { display: flex; flex-direction: column; gap: 4px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .field-lg { flex: 2; min-width: 200px; }
    .field-md { flex: 1; min-width: 140px; }
    .field-sm { flex: 1; min-width: 90px; }

    .form-actions {
      display: flex; gap: 8px; align-items: center; padding-top: 8px;
    }

    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      mat-spinner { display: inline-block; }
    }

    .dt-loading, .dt-empty {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 48px; color: var(--crm-text-secondary); font-size: 14px;
      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    }

    .dt-list {
      display: grid; grid-template-columns: 1fr; gap: 12px;
      @media (min-width: 700px) { grid-template-columns: repeat(2, 1fr); }
    }

    .dt-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; padding: 14px 16px; position: relative; transition: border-color 150ms;
      &:hover { border-color: rgba(139,92,246,0.3); }
    }

    .dt-card__header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px;
    }

    .dt-card__name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .template-name { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }

    .cat-badge {
      font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;
      background: rgba(96,165,250,0.12); color: #60a5fa;
    }

    .country-badge {
      font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;
      background: rgba(251,191,36,0.12); color: #fbbf24;
    }

    .dt-card__actions {
      display: flex; gap: 0; margin: -6px -8px 0 0;
      button mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-secondary); }
      .delete-btn mat-icon { color: rgba(248,113,113,0.6); }
      .delete-btn:hover mat-icon { color: #f87171; }
    }

    .dt-card__preview {
      display: flex; align-items: center; gap: 16px; padding: 8px 0;
    }

    .photo-preview {
      border: 2px solid rgba(139,92,246,0.4); border-radius: 2px;
      display: flex; align-items: center; justify-content: center;
      min-width: 40px; min-height: 40px;
    }

    .preview-size {
      font-size: 10px; font-weight: 600; color: rgba(139,92,246,0.8);
    }

    .preview-layout {
      font-size: 12px; color: var(--crm-text-secondary); line-height: 1.4;
    }

    .preview-media {
      font-size: 11px; font-weight: 600; color: var(--crm-text-primary);
    }

    mat-divider { margin: 10px 0 8px; border-color: rgba(255,255,255,0.05); }

    .dt-card__specs { display: flex; flex-wrap: wrap; gap: 4px; }

    .spec-chip {
      font-size: 10px; padding: 2px 8px; border-radius: 4px;
      background: rgba(139,92,246,0.1); color: var(--crm-accent);
      border: 1px solid rgba(139,92,246,0.2);
    }

    .spec-chip--slug {
      background: rgba(156,163,175,0.08); color: #6b7280;
      border-color: rgba(156,163,175,0.15);
      font-family: var(--crm-font-mono, monospace);
    }

    .delete-confirm {
      position: absolute; inset: 0; background: rgba(13,13,13,0.95); border-radius: 8px;
      z-index: 10; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 10px; padding: 16px; text-align: center;
    }
    .delete-icon { font-size: 28px; width: 28px; height: 28px; color: #f87171; }
    .delete-confirm span { font-size: 13px; color: var(--crm-text-primary); }
    .delete-actions { display: flex; gap: 8px; }
  `],
})
export class DocumentTemplateEditorComponent implements OnInit {
  private readonly api = inject(PrintApiService);
  private readonly fb = inject(FormBuilder);

  readonly templates = signal<DocumentTemplate[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly adding = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly filterCategory = signal<string | null>(null);
  readonly categories = CATEGORIES;
  readonly countryCodes = COUNTRY_CODES;

  readonly filteredTemplates = computed(() => {
    const cat = this.filterCategory();
    const all = this.templates();
    return cat ? all.filter(t => t.category === cat) : all;
  });

  readonly form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    slug: ['', Validators.required],
    category: ['passport', Validators.required],
    country_code: ['RU'],
    photo_width_mm: [35, [Validators.required, Validators.min(1)]],
    photo_height_mm: [45, [Validators.required, Validators.min(1)]],
    head_height_min_mm: [null as number | null],
    head_height_max_mm: [null as number | null],
    photos_per_sheet: [4],
    layout_rows: [2],
    layout_cols: [2],
    cut_margin_mm: [2],
    default_media_size: ['10x15'],
    background_color: ['#FFFFFF'],
    sort_order: [0],
  });

  ngOnInit(): void {
    this.loadTemplates();
  }

  private loadTemplates(): void {
    this.loading.set(true);
    this.api.getDocumentTemplates().subscribe({
      next: templates => { this.templates.set(templates); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  categoryLabel(id: string): string {
    return CATEGORIES.find(c => c.id === id)?.name ?? id;
  }

  previewScale(mm: number): number {
    return Math.max(30, Math.round(mm * 1.2));
  }

  startAdd(): void {
    this.editingId.set(null);
    this.form.reset({
      name: '', slug: '', category: 'passport', country_code: 'RU',
      photo_width_mm: 35, photo_height_mm: 45,
      head_height_min_mm: null, head_height_max_mm: null,
      photos_per_sheet: 4, layout_rows: 2, layout_cols: 2,
      cut_margin_mm: 2, default_media_size: '10x15',
      background_color: '#FFFFFF', sort_order: 0,
    });
    this.adding.set(true);
  }

  startEdit(t: DocumentTemplate): void {
    this.adding.set(false);
    this.confirmDeleteId.set(null);
    this.editingId.set(t.id);
    this.form.patchValue({
      name: t.name, slug: t.slug, category: t.category, country_code: t.country_code,
      photo_width_mm: t.photo_width_mm, photo_height_mm: t.photo_height_mm,
      head_height_min_mm: t.head_height_min_mm, head_height_max_mm: t.head_height_max_mm,
      photos_per_sheet: t.photos_per_sheet, layout_rows: t.layout_rows, layout_cols: t.layout_cols,
      cut_margin_mm: t.cut_margin_mm, default_media_size: t.default_media_size,
      background_color: t.background_color, sort_order: t.sort_order,
    });
  }

  cancelEdit(): void {
    this.adding.set(false);
    this.editingId.set(null);
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;

    const v = this.form.value;
    this.saving.set(true);
    const id = this.editingId();

    if (id) {
      this.api.updateDocumentTemplate(id, {
        name: v.name, category: v.category, country_code: v.country_code,
        photo_width_mm: v.photo_width_mm, photo_height_mm: v.photo_height_mm,
        head_height_min_mm: v.head_height_min_mm, head_height_max_mm: v.head_height_max_mm,
        photos_per_sheet: v.photos_per_sheet, layout_rows: v.layout_rows, layout_cols: v.layout_cols,
        cut_margin_mm: v.cut_margin_mm, default_media_size: v.default_media_size,
        background_color: v.background_color, sort_order: v.sort_order,
      }).subscribe({
        next: template => {
          this.templates.update(list => list.map(t => t.id === id ? template : t));
          this.saving.set(false);
          this.editingId.set(null);
        },
        error: () => this.saving.set(false),
      });
    } else {
      const dto: CreateDocumentTemplateDto = {
        slug: v.slug, name: v.name, category: v.category, country_code: v.country_code,
        photo_width_mm: v.photo_width_mm, photo_height_mm: v.photo_height_mm,
        head_height_min_mm: v.head_height_min_mm, head_height_max_mm: v.head_height_max_mm,
        photos_per_sheet: v.photos_per_sheet, layout_rows: v.layout_rows, layout_cols: v.layout_cols,
        cut_margin_mm: v.cut_margin_mm, default_media_size: v.default_media_size,
        background_color: v.background_color, sort_order: v.sort_order,
      };
      this.api.createDocumentTemplate(dto).subscribe({
        next: template => {
          this.templates.update(list => [...list, template]);
          this.saving.set(false);
          this.adding.set(false);
        },
        error: () => this.saving.set(false),
      });
    }
  }

  requestDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  confirmDelete(id: string): void {
    this.api.deleteDocumentTemplate(id).subscribe({
      next: () => {
        this.templates.update(list => list.filter(t => t.id !== id));
        this.confirmDeleteId.set(null);
      },
    });
  }
}
