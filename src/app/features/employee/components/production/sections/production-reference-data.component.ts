import {
  Component, inject, signal, computed, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { FormsModule } from '@angular/forms';
import { ProductionApiService, ProductReferenceData } from '../../../services/production-api.service';
import { REF_TYPE_LABELS, REF_TYPE_ORDER, CATEGORY_LABELS } from '../production.constants';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

// ─── Dialog: Create / Edit reference data item ────────────────────────────────

@Component({
  selector: 'app-ref-data-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatSlideToggleModule,
    MatProgressSpinnerModule, MatSnackBarModule, FormsModule,
  ],
  template: `
    <div class="dialog-header">
      <span class="dialog-title">{{ isNew ? 'Новая запись' : 'Редактировать запись' }}</span>
      <button mat-icon-button mat-dialog-close aria-label="Закрыть диалог"><mat-icon>close</mat-icon></button>
    </div>

    <mat-dialog-content class="dialog-content">
      <div class="form-grid">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Тип справочника</mat-label>
          <mat-select [(ngModel)]="form.ref_type" name="ref_type" [disabled]="!isNew">
            @for (key of refTypeOrder; track key) {
              <mat-option [value]="key">{{ refTypeLabels[key] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Ключ (ref_key) *</mat-label>
          <input matInput [(ngModel)]="form.ref_key" name="ref_key" required
                 placeholder="glossy" [readOnly]="!isNew" />
          <mat-hint>Латиница, без пробелов</mat-hint>
        </mat-form-field>

        <mat-form-field class="span-2" subscriptSizing="dynamic">
          <mat-label>Отображаемое название *</mat-label>
          <input matInput [(ngModel)]="form.display_name" name="display_name" required />
        </mat-form-field>

        <mat-form-field class="span-2" subscriptSizing="dynamic">
          <mat-label>Категории продуктов</mat-label>
          <mat-select multiple [(ngModel)]="form.category_scope" name="category_scope">
            @for (entry of categoryEntries; track entry[0]) {
              <mat-option [value]="entry[0]">{{ entry[1] }}</mat-option>
            }
          </mat-select>
          <mat-hint>Пусто = применимо ко всем категориям</mat-hint>
        </mat-form-field>

        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Порядок сортировки</mat-label>
          <input matInput type="number" [(ngModel)]="form.sort_order" name="sort_order" min="0" />
        </mat-form-field>

        <div class="toggle-row">
          <mat-slide-toggle [(ngModel)]="form.is_active" name="is_active">
            {{ form.is_active ? 'Активна' : 'Неактивна' }}
          </mat-slide-toggle>
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary"
              [disabled]="!form.ref_type || !form.ref_key || !form.display_name || saving()"
              (click)="save()">
        @if (saving()) { <mat-spinner diameter="18" /> } @else { <mat-icon>save</mat-icon> }
        Сохранить
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host { display: flex; flex-direction: column; }
    .dialog-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .dialog-title { font-size: 14px; font-weight: 600; color: var(--crm-text-primary, #ececec); }
    .dialog-content { padding: 16px 20px; overflow-y: auto; max-height: 60vh; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-grid .span-2 { grid-column: span 2; }
    .toggle-row { display: flex; align-items: center; padding: 8px 0; }
    mat-dialog-actions { padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.06); }
  `,
})
class RefDataDialogComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialogRef = inject(MatDialogRef<RefDataDialogComponent>);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly data = inject<{ item?: ProductReferenceData; defaultRefType?: string }>(MAT_DIALOG_DATA);

  readonly saving = signal(false);
  readonly isNew = !this.data.item;
  readonly refTypeOrder = REF_TYPE_ORDER;
  readonly refTypeLabels = REF_TYPE_LABELS;
  readonly categoryEntries = Object.entries(CATEGORY_LABELS);

  form = {
    ref_type: '',
    ref_key: '',
    display_name: '',
    category_scope: [] as string[],
    sort_order: 0,
    is_active: true,
  };

  ngOnInit() {
    if (this.data.item) {
      const item = this.data.item;
      this.form = {
        ref_type: item.ref_type,
        ref_key: item.ref_key,
        display_name: item.display_name,
        category_scope: [...item.category_scope],
        sort_order: item.sort_order,
        is_active: item.is_active,
      };
    } else {
      this.form.ref_type = this.data.defaultRefType ?? REF_TYPE_ORDER[0];
    }
  }

  save() {
    this.saving.set(true);
    const payload = {
      ...this.form,
      metadata: this.data.item?.metadata ?? {},
    };

    const req$ = this.data.item
      ? this.api.updateReferenceDataItem(this.data.item.id, payload)
      : this.api.createReferenceDataItem(payload as Omit<ProductReferenceData, 'id' | 'created_at'>);

    req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open(this.isNew ? 'Запись добавлена' : 'Изменения сохранены', 'OK', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: err => {
        this.saving.set(false);
        this.snackBar.open(err?.error?.message ?? 'Ошибка при сохранении', 'OK', { duration: 4000 });
      },
    });
  }
}

// ─── Main component ────────────────────────────────────────────────────────────

@Component({
  selector: 'app-production-reference-data',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
    MatExpansionModule, MatSnackBarModule,
  ],
  template: `
    <div class="ref-page">
      <div class="page-toolbar">
        <h2>Справочник параметров</h2>
        <button mat-flat-button color="primary" (click)="openForm()">
          <mat-icon>add</mat-icon> Добавить
        </button>
      </div>
      <p class="page-hint">
        Размеры, типы бумаги, переплёты и другие параметры продуктов типографий. Используются при создании продуктов и заказов.
      </p>

      @if (loading()) {
        <div class="loading-state"><mat-spinner diameter="40" /></div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button (click)="load()">Повторить</button>
        </div>
      } @else {
        <mat-accordion multi>
          @for (group of groupedData(); track group.ref_type) {
            <mat-expansion-panel [expanded]="true">
              <mat-expansion-panel-header>
                <mat-panel-title class="group-title">
                  <span class="group-badge">{{ group.items.length }}</span>
                  {{ refTypeLabel(group.ref_type) }}
                </mat-panel-title>
                <mat-panel-description class="group-desc">{{ group.ref_type }}</mat-panel-description>
              </mat-expansion-panel-header>

              <div class="items-header">
                <span>Название</span>
                <span>Ключ</span>
                <span>Категории</span>
                <span>Сорт.</span>
                <span></span>
              </div>

              @for (item of group.items; track item.id) {
                <div class="item-row" [class.item-inactive]="!item.is_active">
                  <span class="item-name">{{ item.display_name }}</span>
                  <code class="item-key">{{ item.ref_key }}</code>
                  <span class="item-scope">
                    @if (item.category_scope.length === 0) {
                      <span class="scope-all">Все</span>
                    } @else {
                      @for (s of item.category_scope.slice(0, 2); track s) {
                        <span class="scope-chip">{{ catLabel(s) }}</span>
                      }
                      @if (item.category_scope.length > 2) {
                        <span class="scope-more" [matTooltip]="item.category_scope.slice(2).map(catLabel).join(', ')">
                          +{{ item.category_scope.length - 2 }}
                        </span>
                      }
                    }
                  </span>
                  <span class="item-sort">{{ item.sort_order }}</span>
                  <span class="item-actions">
                    <button mat-icon-button (click)="openForm(item)"
                            [attr.aria-label]="'Редактировать ' + item.display_name">
                      <mat-icon>edit</mat-icon>
                    </button>
                    <button mat-icon-button color="warn" (click)="deleteItem(item)"
                            [attr.aria-label]="'Удалить ' + item.display_name">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </span>
                </div>
              }

              <div class="add-row">
                <button mat-button (click)="openForm(undefined, group.ref_type)">
                  <mat-icon>add</mat-icon> Добавить в «{{ refTypeLabel(group.ref_type) }}»
                </button>
              </div>
            </mat-expansion-panel>
          }

          @if (groupedData().length === 0) {
            <div class="empty-state">
              <mat-icon>library_books</mat-icon>
              <p>Справочник пуст. Добавьте первую запись.</p>
            </div>
          }
        </mat-accordion>
      }
    </div>
  `,
  styles: `
    .ref-page { padding: 16px; max-width: 900px; margin: 0 auto; }

    .page-toolbar {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
      h2 { margin: 0; font-size: 18px; font-weight: 600; color: var(--crm-text-primary); }
    }
    .page-hint { font-size: 13px; color: var(--crm-text-secondary); margin: 0 0 16px; }

    .group-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
    .group-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 50%;
      background: var(--crm-accent); color: #fff;
      font-size: 10px; font-weight: 700;
    }
    .group-desc { font-size: 11px; font-family: monospace; color: var(--crm-text-secondary); }

    .items-header {
      display: grid;
      grid-template-columns: 1fr 110px 180px 50px 80px;
      padding: 4px 8px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      color: var(--crm-text-secondary); text-transform: uppercase;
      border-bottom: 1px solid var(--crm-border);
    }
    .item-row {
      display: grid;
      grid-template-columns: 1fr 110px 180px 50px 80px;
      padding: 6px 8px; align-items: center;
      border-bottom: 1px solid var(--crm-border);
      font-size: 13px; transition: background 120ms;
      &:hover { background: var(--crm-surface-hover); }
      &:last-of-type { border-bottom: none; }
    }
    .item-inactive { opacity: .45; }
    .item-name { font-weight: 500; }
    .item-key {
      font-size: 11px; color: var(--crm-text-secondary);
      font-family: var(--crm-font-mono, monospace);
    }
    .item-scope { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
    .scope-all { font-size: 10px; color: var(--crm-text-secondary); font-style: italic; }
    .scope-chip {
      font-size: 10px; padding: 1px 5px; border-radius: 6px;
      background: var(--crm-surface-hover); color: var(--crm-text-secondary);
      white-space: nowrap;
    }
    .scope-more {
      font-size: 10px; color: var(--crm-text-secondary); cursor: default;
    }
    .item-sort { text-align: center; font-size: 12px; color: var(--crm-text-secondary); }
    .item-actions { display: flex; gap: 2px; justify-content: flex-end; }

    .add-row { padding: 6px 0; }

    .loading-state, .empty-state, .error-state {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
      p { margin: 12px 0; font-size: 16px; }
    }
    .error-state mat-icon { color: var(--crm-danger, #f87171); }
  `,
})
export class ProductionReferenceDataComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly allData = signal<ProductReferenceData[]>([]);

  readonly groupedData = computed(() => {
    const byType = new Map<string, ProductReferenceData[]>();
    for (const item of this.allData()) {
      if (!byType.has(item.ref_type)) byType.set(item.ref_type, []);
      byType.get(item.ref_type)!.push(item);
    }
    for (const [, items] of byType) {
      items.sort((a, b) => a.sort_order - b.sort_order);
    }
    // Groups in REF_TYPE_ORDER first, then any extra
    const result: { ref_type: string; items: ProductReferenceData[] }[] = [];
    for (const rt of REF_TYPE_ORDER) {
      if (byType.has(rt)) result.push({ ref_type: rt, items: byType.get(rt)! });
    }
    for (const [rt, items] of byType) {
      if (!REF_TYPE_ORDER.includes(rt)) result.push({ ref_type: rt, items });
    }
    return result;
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.getReferenceData().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => { this.allData.set(data); this.loading.set(false); },
      error: () => { this.error.set('Не удалось загрузить справочник'); this.loading.set(false); },
    });
  }

  openForm(item?: ProductReferenceData, defaultRefType?: string) {
    this.dialog.open(RefDataDialogComponent, {
      width: '520px',
      maxWidth: '98vw',
      data: { item, defaultRefType },
    }).afterClosed().subscribe(saved => { if (saved) this.load(); });
  }

  deleteItem(item: ProductReferenceData) {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Удалить запись',
        message: `Удалить "${item.display_name}" (${item.ref_key})?`,
        icon: 'delete', warn: true, confirmLabel: 'Удалить',
      } as ConfirmDialogData,
    }).afterClosed().subscribe(ok => {
      if (!ok) return;
      this.api.deleteReferenceDataItem(item.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.snackBar.open('Запись удалена', 'OK', { duration: 3000 });
          this.allData.update(d => d.filter(x => x.id !== item.id));
        },
        error: err => this.snackBar.open(err?.error?.message ?? 'Не удалось удалить', 'OK', { duration: 4000 }),
      });
    });
  }

  refTypeLabel(rt: string): string { return REF_TYPE_LABELS[rt] ?? rt; }
  catLabel(cat: string): string { return CATEGORY_LABELS[cat] ?? cat; }
}
