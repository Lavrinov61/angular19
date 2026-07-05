import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  KpiApiService, KpiTarget, MetricDefinition, WeightProfile,
} from '../../services/kpi-api.service';

interface TargetForm {
  metricCode: string;
  scope: string;
  scopeValue: string;
  targetValue: number | null;
  stretchValue: number | null;
  minimumValue: number | null;
  effectiveFrom: string;
  effectiveUntil: string;
}

const SCOPE_LABELS: Record<string, string> = {
  global: 'Глобальный',
  role: 'По роли',
  employee: 'Для сотрудника',
};

const CATEGORY_LABELS: Record<string, string> = {
  productivity: 'Продуктивность',
  quality: 'Качество',
  speed: 'Скорость',
  revenue: 'Выручка',
  satisfaction: 'Удовлетворённость',
  attendance: 'Посещаемость',
};

@Component({
  selector: 'app-kpi-target-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatTableModule, MatSelectModule, MatInputModule, MatFormFieldModule,
    MatChipsModule, MatTooltipModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="target-config">
      <!-- Targets Section -->
      <div class="section-header">
        <h3>Целевые показатели</h3>
        <button mat-flat-button (click)="showAddForm.set(!showAddForm())">
          <mat-icon>{{ showAddForm() ? 'close' : 'add' }}</mat-icon>
          {{ showAddForm() ? 'Отмена' : 'Добавить цель' }}
        </button>
      </div>

      <!-- Add/Edit Form -->
      @if (showAddForm()) {
        <mat-card class="target-form" appearance="outlined">
          <div class="form-grid">
            <mat-form-field appearance="outline">
              <mat-label>Метрика</mat-label>
              <mat-select [(ngModel)]="form.metricCode">
                @for (group of metricGroups(); track group.category) {
                  <mat-optgroup [label]="getCategoryLabel(group.category)">
                    @for (m of group.metrics; track m.code) {
                      <mat-option [value]="m.code">{{ m.nameRu }}</mat-option>
                    }
                  </mat-optgroup>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Область</mat-label>
              <mat-select [(ngModel)]="form.scope">
                <mat-option value="global">Глобальный</mat-option>
                <mat-option value="role">По роли</mat-option>
                <mat-option value="employee">Для сотрудника</mat-option>
              </mat-select>
            </mat-form-field>

            @if (form.scope !== 'global') {
              <mat-form-field appearance="outline">
                <mat-label>{{ form.scope === 'role' ? 'Роль' : 'ID сотрудника' }}</mat-label>
                @if (form.scope === 'role') {
                  <mat-select [(ngModel)]="form.scopeValue">
                    <mat-option value="employee">Сотрудник</mat-option>
                    <mat-option value="photographer">Фотограф</mat-option>
                    <mat-option value="manager">Менеджер</mat-option>
                    <mat-option value="admin">Админ</mat-option>
                  </mat-select>
                } @else {
                  <input matInput [(ngModel)]="form.scopeValue" placeholder="UUID">
                }
              </mat-form-field>
            }

            <mat-form-field appearance="outline">
              <mat-label>Цель</mat-label>
              <input matInput type="number" [(ngModel)]="form.targetValue">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Stretch (110%)</mat-label>
              <input matInput type="number" [(ngModel)]="form.stretchValue">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Минимум</mat-label>
              <input matInput type="number" [(ngModel)]="form.minimumValue">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Действует с</mat-label>
              <input matInput type="date" [(ngModel)]="form.effectiveFrom">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Действует до</mat-label>
              <input matInput type="date" [(ngModel)]="form.effectiveUntil">
              <mat-hint>Пусто = бессрочно</mat-hint>
            </mat-form-field>
          </div>

          <div class="form-actions">
            @if (editingId()) {
              <button mat-flat-button color="primary" (click)="updateTarget()" [disabled]="saving()">
                Сохранить
              </button>
              <button mat-button (click)="cancelEdit()">Отмена</button>
            } @else {
              <button mat-flat-button color="primary" (click)="createTarget()" [disabled]="saving() || !form.metricCode || !form.targetValue">
                Создать
              </button>
            }
            @if (saving()) {
              <mat-spinner diameter="20"/>
            }
          </div>
        </mat-card>
      }

      <!-- Targets Table -->
      @if (loading()) {
        <div class="loading-state">Загрузка...</div>
      } @else if (targets().length === 0) {
        <div class="empty-state">Нет целевых показателей</div>
      } @else {
        <table mat-table [dataSource]="targets()" class="targets-table">
          <ng-container matColumnDef="metric">
            <th mat-header-cell *matHeaderCellDef>Метрика</th>
            <td mat-cell *matCellDef="let t">
              <span class="metric-name">{{ getMetricName(t.metric_code) }}</span>
              <span class="metric-code">{{ t.metric_code }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="scope">
            <th mat-header-cell *matHeaderCellDef>Область</th>
            <td mat-cell *matCellDef="let t">
              <mat-chip [highlighted]="false" class="scope-chip">
                {{ getScopeLabel(t.scope) }}
              </mat-chip>
              @if (t.scope_value) {
                <span class="scope-value">{{ t.scope_value }}</span>
              }
            </td>
          </ng-container>

          <ng-container matColumnDef="target">
            <th mat-header-cell *matHeaderCellDef>Цель</th>
            <td mat-cell *matCellDef="let t">
              <span class="val-primary">{{ t.target_value }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="stretch">
            <th mat-header-cell *matHeaderCellDef>Stretch</th>
            <td mat-cell *matCellDef="let t">
              {{ t.stretch_value ?? '—' }}
            </td>
          </ng-container>

          <ng-container matColumnDef="minimum">
            <th mat-header-cell *matHeaderCellDef>Минимум</th>
            <td mat-cell *matCellDef="let t">
              {{ t.minimum_value ?? '—' }}
            </td>
          </ng-container>

          <ng-container matColumnDef="period">
            <th mat-header-cell *matHeaderCellDef>Период</th>
            <td mat-cell *matCellDef="let t">
              {{ t.effective_from }}
              @if (t.effective_until) {
                → {{ t.effective_until }}
              } @else {
                → ...
              }
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let t">
              <button mat-icon-button matTooltip="Редактировать" (click)="editTarget(t)">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button matTooltip="Удалить" (click)="deleteTarget(t)">
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns;"></tr>
        </table>
      }

      <!-- Weight Profiles Section -->
      <div class="section-header" style="margin-top: 32px">
        <h3>Профили весов</h3>
      </div>

      @if (profiles().length === 0) {
        <div class="empty-state">Нет профилей весов</div>
      } @else {
        @for (profile of profiles(); track profile.id) {
          <mat-card class="profile-card" appearance="outlined">
            <div class="profile-header">
              <span class="profile-name">{{ profile.name }}</span>
              <mat-chip [highlighted]="false">{{ getScopeLabel(profile.scope) }}{{ profile.scope_value ? ': ' + profile.scope_value : '' }}</mat-chip>
              @if (profile.is_active) {
                <mat-chip highlighted color="primary">Активен</mat-chip>
              }
            </div>
            <div class="weights-grid">
              @for (entry of getWeightEntries(profile.weights); track entry.code) {
                <div class="weight-entry">
                  <span class="weight-code">{{ entry.code }}</span>
                  <span class="weight-val">{{ entry.weight }}</span>
                </div>
              }
            </div>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [`
    .target-config { padding: 16px 0; }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .section-header h3 { margin: 0; font-size: 16px; font-weight: 600; }

    .loading-state, .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--crm-text-secondary, #666);
      font-size: 14px;
    }

    /* ── Form ── */
    .target-form { padding: 20px; margin-bottom: 16px; }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }
    .form-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
    }

    /* ── Targets Table ── */
    .targets-table { width: 100%; }
    .metric-name { display: block; font-weight: 500; font-size: 13px; }
    .metric-code { display: block; font-size: 11px; color: var(--crm-text-secondary, #999); }
    .scope-chip { font-size: 11px; }
    .scope-value { font-size: 12px; color: var(--crm-text-secondary); margin-left: 4px; }
    .val-primary { font-weight: 600; }

    /* ── Weight Profiles ── */
    .profile-card { padding: 16px; margin-bottom: 12px; }
    .profile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .profile-name { font-weight: 600; font-size: 14px; }
    .weights-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 4px;
    }
    .weight-entry {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 2px 0;
    }
    .weight-code { color: var(--crm-text-secondary); font-family: monospace; }
    .weight-val { font-weight: 500; }

    @media (max-width: 768px) {
      .form-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class KpiTargetConfigComponent implements OnInit {
  private readonly api = inject(KpiApiService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly targets = signal<KpiTarget[]>([]);
  readonly metrics = signal<MetricDefinition[]>([]);
  readonly profiles = signal<WeightProfile[]>([]);
  readonly showAddForm = signal(false);
  readonly editingId = signal<string | null>(null);

  readonly columns = ['metric', 'scope', 'target', 'stretch', 'minimum', 'period', 'actions'];

  form: TargetForm = this.emptyForm();

  readonly metricGroups = computed(() => {
    const groups = new Map<string, MetricDefinition[]>();
    for (const m of this.metrics()) {
      const list = groups.get(m.category) || [];
      list.push(m);
      groups.set(m.category, list);
    }
    return Array.from(groups.entries()).map(([category, metrics]) => ({ category, metrics }));
  });

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.api.getTargets().subscribe({
      next: res => {
        this.targets.set(res.targets);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.getAdminMetrics().subscribe({
      next: res => this.metrics.set(res.metrics),
    });
    this.api.getWeightProfiles().subscribe({
      next: res => this.profiles.set(res.profiles),
    });
  }

  createTarget(): void {
    if (!this.form.metricCode || !this.form.targetValue) return;
    this.saving.set(true);
    this.api.createTarget({
      metricCode: this.form.metricCode,
      scope: this.form.scope,
      scopeValue: this.form.scope !== 'global' ? this.form.scopeValue : undefined,
      targetValue: this.form.targetValue,
      stretchValue: this.form.stretchValue ?? undefined,
      minimumValue: this.form.minimumValue ?? undefined,
      effectiveFrom: this.form.effectiveFrom,
      effectiveUntil: this.form.effectiveUntil || undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showAddForm.set(false);
        this.form = this.emptyForm();
        this.loadAll();
      },
      error: () => this.saving.set(false),
    });
  }

  editTarget(t: KpiTarget): void {
    this.editingId.set(t.id);
    this.showAddForm.set(true);
    this.form = {
      metricCode: t.metric_code,
      scope: t.scope,
      scopeValue: t.scope_value || '',
      targetValue: t.target_value,
      stretchValue: t.stretch_value,
      minimumValue: t.minimum_value,
      effectiveFrom: t.effective_from,
      effectiveUntil: t.effective_until || '',
    };
  }

  updateTarget(): void {
    const id = this.editingId();
    if (!id) return;
    this.saving.set(true);
    this.api.updateTarget(id, {
      targetValue: this.form.targetValue ?? undefined,
      stretchValue: this.form.stretchValue,
      minimumValue: this.form.minimumValue,
      effectiveFrom: this.form.effectiveFrom || undefined,
      effectiveUntil: this.form.effectiveUntil || null,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelEdit();
        this.loadAll();
      },
      error: () => this.saving.set(false),
    });
  }

  deleteTarget(t: KpiTarget): void {
    this.api.deleteTarget(t.id).subscribe({
      next: () => this.loadAll(),
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.showAddForm.set(false);
    this.form = this.emptyForm();
  }

  getMetricName(code: string): string {
    return this.metrics().find(m => m.code === code)?.nameRu || code;
  }

  getScopeLabel(scope: string): string {
    return SCOPE_LABELS[scope] || scope;
  }

  getCategoryLabel(category: string): string {
    return CATEGORY_LABELS[category] || category;
  }

  getWeightEntries(weights: Record<string, number>): { code: string; weight: number }[] {
    return Object.entries(weights).map(([code, weight]) => ({ code, weight }));
  }

  private emptyForm(): TargetForm {
    return {
      metricCode: '',
      scope: 'global',
      scopeValue: '',
      targetValue: null,
      stretchValue: null,
      minimumValue: null,
      effectiveFrom: new Date().toISOString().split('T')[0],
      effectiveUntil: '',
    };
  }
}
