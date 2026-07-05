import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { PrintApiService, WasteRecord, DailyStats, UtilizationStats, PrintPresetRecord } from '../../services/print-api.service';
import { StudioService } from '../../services/studio.service';
import { ToastService } from '../../../../core/services/toast.service';

interface AnalyticsSummary {
  total_jobs: number;
  completed: number;
  failed: number;
  failure_rate: number;
  total_copies: number;
  revenue: number;
  avg_duration_ms: number;
  waste_sheets: number;
}

interface PrinterAnalytics {
  printer_id: string;
  printer_name: string;
  total_jobs: number;
  completed: number;
  failed: number;
  copies: number;
  revenue: number;
}

interface OperatorAnalytics {
  operator_id: string;
  operator_name: string;
  total_jobs: number;
  completed: number;
  failed: number;
  copies: number;
  avg_speed_ms: number;
}

interface TopPreset {
  name: string;
  count: number;
  pages: number;
  share: number;
}

interface PrinterUtilBar {
  printer_id: string;
  printer_name: string;
  utilization_pct: number;
  total_jobs: number;
  avg_busy_min: number;
}

@Component({
  selector: 'app-print-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatIconModule, MatButtonToggleModule,
    MatSelectModule, MatTableModule, MatProgressSpinnerModule,
    MatChipsModule, MatButtonModule, MatInputModule, MatFormFieldModule,
    MatDatepickerModule, MatNativeDateModule, MatTooltipModule,
    FormsModule, DecimalPipe, DatePipe,
  ],
  template: `
    <div class="analytics-container">
      <div class="analytics-header">
        <h2>Аналитика печати</h2>
        <div class="analytics-filters">
          <mat-form-field appearance="outline" class="date-range-field">
            <mat-label>Период</mat-label>
            <mat-date-range-input [rangePicker]="picker">
              <input matStartDate [ngModel]="dateFrom()" (ngModelChange)="dateFrom.set($event)">
              <input matEndDate [ngModel]="dateTo()" (ngModelChange)="onDateToChange($event)">
            </mat-date-range-input>
            <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
            <mat-date-range-picker #picker></mat-date-range-picker>
          </mat-form-field>
          <mat-button-toggle-group [value]="periodPreset()" (change)="applyPreset($event.value)" hideSingleSelectionIndicator>
            <mat-button-toggle value="today">Сегодня</mat-button-toggle>
            <mat-button-toggle value="week">Неделя</mat-button-toggle>
            <mat-button-toggle value="month">Месяц</mat-button-toggle>
          </mat-button-toggle-group>
          <mat-select [value]="studioId()" (selectionChange)="studioId.set($event.value)" placeholder="Все студии" class="studio-select">
            <mat-option value="">Все студии</mat-option>
            @for (s of studioService.studios(); track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
          <button mat-stroked-button (click)="exportCsv()" matTooltip="Экспорт данных в CSV">
            <mat-icon>download</mat-icon>
            Экспорт CSV
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else {
        <!-- KPI Cards -->
        <div class="kpi-grid">
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Всего заданий: ' + summary().total_jobs">
            <mat-icon class="kpi-icon">print</mat-icon>
            <div class="kpi-value">{{ summary().total_jobs }}</div>
            <div class="kpi-label">Всего заданий</div>
          </mat-card>
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Успешных: ' + (summary().total_jobs > 0 ? (100 - summary().failure_rate) : 0) + '%'">
            <mat-icon class="kpi-icon success">check_circle</mat-icon>
            <div class="kpi-value">{{ summary().total_jobs > 0 ? (100 - summary().failure_rate | number:'1.0-1') : '\u2014' }}%</div>
            <div class="kpi-label">Успешных</div>
          </mat-card>
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Средняя скорость: ' + formatDuration(summary().avg_duration_ms)">
            <mat-icon class="kpi-icon speed">speed</mat-icon>
            <div class="kpi-value">{{ formatDuration(summary().avg_duration_ms) }}</div>
            <div class="kpi-label">Средняя скорость</div>
          </mat-card>
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Выручка: ' + summary().revenue + ' руб.'">
            <mat-icon class="kpi-icon revenue">payments</mat-icon>
            <div class="kpi-value">{{ summary().revenue | number:'1.0-0' }} &#8381;</div>
            <div class="kpi-label">Выручка</div>
          </mat-card>
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Копий напечатано: ' + summary().total_copies">
            <mat-icon class="kpi-icon copies">content_copy</mat-icon>
            <div class="kpi-value">{{ summary().total_copies | number:'1.0-0' }}</div>
            <div class="kpi-label">Копий напечатано</div>
          </mat-card>
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Брак: ' + summary().waste_sheets + ' листов'">
            <mat-icon class="kpi-icon waste">delete_sweep</mat-icon>
            <div class="kpi-value">{{ summary().waste_sheets }}</div>
            <div class="kpi-label">Брак (листов)</div>
          </mat-card>
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Себестоимость страницы: ' + costPerPage()">
            <mat-icon class="kpi-icon cost">request_quote</mat-icon>
            <div class="kpi-value">{{ costPerPage() }}</div>
            <div class="kpi-label">Cost / стр</div>
          </mat-card>
          <mat-card class="kpi-card" role="status" [attr.aria-label]="'Выручка на страницу: ' + revPerPage()">
            <mat-icon class="kpi-icon rev">trending_up</mat-icon>
            <div class="kpi-value">{{ revPerPage() }}</div>
            <div class="kpi-label">Rev / стр</div>
          </mat-card>
        </div>

        <!-- Charts row -->
        <div class="charts-row">
          <!-- Daily Trend Chart -->
          <div class="chart-card">
            <h4>Динамика печати</h4>
            @if (dailyData().length > 1) {
              <svg viewBox="0 0 600 200" class="trend-chart" role="img" aria-label="График динамики печати">
                <!-- Grid lines -->
                @for (tick of yTicks(); track tick.value) {
                  <line x1="30" [attr.y1]="tick.y" x2="590" [attr.y2]="tick.y" stroke="var(--crm-glass-border)" stroke-dasharray="4"/>
                  <text x="26" [attr.y]="tick.y + 4" text-anchor="end" class="axis-label">{{ tick.value }}</text>
                }
                <!-- Area fill -->
                <path [attr.d]="chartArea()" fill="var(--crm-accent)" opacity="0.1"/>
                <!-- Line -->
                <path [attr.d]="chartPoints()" fill="none" stroke="var(--crm-accent)" stroke-width="2" stroke-linejoin="round"/>
                <!-- Data dots + invisible hover targets -->
                @for (pt of chartDots(); track pt.date; let i = $index) {
                  <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="3" fill="var(--crm-accent)" class="data-dot"/>
                  <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="12" fill="transparent" class="hover-target"
                    (mouseenter)="hoveredPoint.set(pt)" (mouseleave)="hoveredPoint.set(null)"/>
                }
                <!-- X axis labels -->
                @for (label of xLabels(); track label.date) {
                  <text [attr.x]="label.x" y="195" text-anchor="middle" class="axis-label">{{ label.text }}</text>
                }
              </svg>
              <!-- Tooltip -->
              @if (hoveredPoint(); as pt) {
                <div class="chart-tooltip">
                  <strong>{{ pt.dateLabel }}</strong><br>
                  Заданий: {{ pt.jobs }} | Страниц: {{ pt.pages }} | {{ pt.revenue }} &#8381;
                </div>
              }
            } @else {
              <div class="empty-state">Недостаточно данных для графика</div>
            }
          </div>

          <!-- Waste Distribution (horizontal bars) -->
          <div class="chart-card">
            <h4>Распределение брака</h4>
            @if (wasteDistribution().length) {
              <div class="hbar-chart">
                @for (bar of wasteDistribution(); track bar.type) {
                  <div class="hbar-row">
                    <span class="hbar-label">{{ bar.label }}</span>
                    <div class="hbar-track">
                      <div class="hbar-fill" [style.width.%]="bar.pct" [style.background]="bar.color"
                        [matTooltip]="bar.label + ': ' + bar.count + ' листов (' + (bar.pct | number:'1.0-1') + '%)'"></div>
                    </div>
                    <span class="hbar-value">{{ bar.count }} ({{ bar.pct | number:'1.0-0' }}%)</span>
                  </div>
                }
              </div>
            } @else {
              <div class="empty-state">Нет записей о браке</div>
            }
          </div>
        </div>

        <!-- Printer Utilization -->
        <div class="chart-card">
          <h4>Загрузка принтеров</h4>
          @if (printerUtilization().length) {
            <div class="hbar-chart">
              @for (bar of printerUtilization(); track bar.printer_id) {
                <div class="hbar-row">
                  <span class="hbar-label printer-label">{{ bar.printer_name }}</span>
                  <div class="hbar-track">
                    <div class="hbar-fill" [style.width.%]="bar.utilization_pct"
                      [style.background]="utilizationColor(bar.utilization_pct)"
                      [matTooltip]="bar.printer_name + ': ' + (bar.utilization_pct | number:'1.0-1') + '%, ' + bar.total_jobs + ' заданий, ~' + (bar.avg_busy_min | number:'1.0-0') + ' мин'"></div>
                  </div>
                  <span class="hbar-value">{{ bar.utilization_pct | number:'1.0-0' }}% ({{ bar.total_jobs }} заданий)</span>
                </div>
              }
            </div>
          } @else {
            <div class="empty-state">Нет данных о загрузке</div>
          }
        </div>

        <!-- Top Presets -->
        @if (topPresets().length) {
          <div class="table-section">
            <h3>Популярные пресеты</h3>
            <table mat-table [dataSource]="sortedPresets()" class="analytics-table">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('preset', 'name')">
                  Пресет <mat-icon class="sort-icon">{{ sortIcon('preset', 'name') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.name }}</td>
              </ng-container>
              <ng-container matColumnDef="count">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('preset', 'count')">
                  Количество <mat-icon class="sort-icon">{{ sortIcon('preset', 'count') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.count }}</td>
              </ng-container>
              <ng-container matColumnDef="pages">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('preset', 'pages')">
                  Страниц <mat-icon class="sort-icon">{{ sortIcon('preset', 'pages') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.pages }}</td>
              </ng-container>
              <ng-container matColumnDef="share">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('preset', 'share')">
                  Доля <mat-icon class="sort-icon">{{ sortIcon('preset', 'share') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.share | number:'1.0-1' }}%</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="presetCols"></tr>
              <tr mat-row *matRowDef="let row; columns: presetCols;"></tr>
            </table>
            <div class="table-export">
              <button mat-stroked-button (click)="exportPresetsCsv()"><mat-icon>download</mat-icon> CSV</button>
            </div>
          </div>
        }

        <!-- Printers table -->
        <div class="table-section">
          <h3>По принтерам</h3>
          @if (printers().length) {
            <table mat-table [dataSource]="sortedPrinters()" class="analytics-table">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('printer', 'name')">
                  Принтер <mat-icon class="sort-icon">{{ sortIcon('printer', 'name') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.printer_name }}</td>
              </ng-container>
              <ng-container matColumnDef="jobs">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('printer', 'jobs')">
                  Заданий <mat-icon class="sort-icon">{{ sortIcon('printer', 'jobs') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.total_jobs }}</td>
              </ng-container>
              <ng-container matColumnDef="copies">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('printer', 'copies')">
                  Копий <mat-icon class="sort-icon">{{ sortIcon('printer', 'copies') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.copies }}</td>
              </ng-container>
              <ng-container matColumnDef="errors">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('printer', 'errors')">
                  Ошибки % <mat-icon class="sort-icon">{{ sortIcon('printer', 'errors') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row" [class.error-cell]="row.total_jobs > 0 && row.failed / row.total_jobs > 0.1">
                  {{ row.total_jobs > 0 ? (row.failed / row.total_jobs * 100 | number:'1.0-1') : '0' }}%
                </td>
              </ng-container>
              <ng-container matColumnDef="revenue">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('printer', 'revenue')">
                  Выручка <mat-icon class="sort-icon">{{ sortIcon('printer', 'revenue') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.revenue | number:'1.0-0' }} &#8381;</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="printerCols"></tr>
              <tr mat-row *matRowDef="let row; columns: printerCols;"></tr>
            </table>
            <div class="table-export">
              <button mat-stroked-button (click)="exportPrintersCsv()"><mat-icon>download</mat-icon> CSV</button>
            </div>
          } @else {
            <div class="empty-state">Нет данных за выбранный период</div>
          }
        </div>

        <!-- Operators table -->
        <div class="table-section">
          <h3>По операторам</h3>
          @if (operators().length) {
            <table mat-table [dataSource]="sortedOperators()" class="analytics-table">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('operator', 'name')">
                  Оператор <mat-icon class="sort-icon">{{ sortIcon('operator', 'name') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.operator_name }}</td>
              </ng-container>
              <ng-container matColumnDef="jobs">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('operator', 'jobs')">
                  Заданий <mat-icon class="sort-icon">{{ sortIcon('operator', 'jobs') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.total_jobs }}</td>
              </ng-container>
              <ng-container matColumnDef="copies">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('operator', 'copies')">
                  Копий <mat-icon class="sort-icon">{{ sortIcon('operator', 'copies') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ row.copies }}</td>
              </ng-container>
              <ng-container matColumnDef="speed">
                <th mat-header-cell *matHeaderCellDef class="sortable-header" (click)="toggleSort('operator', 'speed')">
                  Скорость <mat-icon class="sort-icon">{{ sortIcon('operator', 'speed') }}</mat-icon>
                </th>
                <td mat-cell *matCellDef="let row">{{ formatDuration(row.avg_speed_ms) }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="operatorCols"></tr>
              <tr mat-row *matRowDef="let row; columns: operatorCols;"></tr>
            </table>
            <div class="table-export">
              <button mat-stroked-button (click)="exportOperatorsCsv()"><mat-icon>download</mat-icon> CSV</button>
            </div>
          } @else {
            <div class="empty-state">Нет данных за выбранный период</div>
          }
        </div>

        <!-- Waste section -->
        <div class="table-section waste-section">
          <div class="waste-header">
            <h3>Брак</h3>
            <button mat-stroked-button (click)="showWasteForm.set(!showWasteForm())">
              <mat-icon>{{ showWasteForm() ? 'close' : 'add' }}</mat-icon>
              {{ showWasteForm() ? 'Отмена' : 'Добавить запись' }}
            </button>
          </div>

          @if (wasteChips().length) {
            <mat-chip-set class="waste-chips">
              @for (chip of wasteChips(); track chip.type) {
                <mat-chip>{{ chip.label }}: {{ chip.count }}</mat-chip>
              }
            </mat-chip-set>
          }

          @if (showWasteForm()) {
            <div class="waste-form">
              <mat-form-field>
                <mat-label>Тип брака</mat-label>
                <mat-select [(ngModel)]="wasteFormType">
                  <mat-option value="jam">Замятие</mat-option>
                  <mat-option value="color_defect">Цвет</mat-option>
                  <mat-option value="alignment">Выравнивание</mat-option>
                  <mat-option value="media_defect">Дефект носителя</mat-option>
                  <mat-option value="operator_error">Ошибка оператора</mat-option>
                  <mat-option value="other">Другое</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Листов</mat-label>
                <input matInput type="number" min="1" [(ngModel)]="wasteFormSheets">
              </mat-form-field>
              <mat-form-field>
                <mat-label>Заметки</mat-label>
                <input matInput [(ngModel)]="wasteFormNotes">
              </mat-form-field>
              <button mat-flat-button color="primary" (click)="submitWaste()" [disabled]="wasteSubmitting()">
                Сохранить
              </button>
            </div>
          }

          @if (wasteRecords().length) {
            <table mat-table [dataSource]="wasteRecords()" class="analytics-table">
              <ng-container matColumnDef="date">
                <th mat-header-cell *matHeaderCellDef>Дата</th>
                <td mat-cell *matCellDef="let row">{{ row.created_at | date:'dd.MM.yy HH:mm' }}</td>
              </ng-container>
              <ng-container matColumnDef="type">
                <th mat-header-cell *matHeaderCellDef>Тип</th>
                <td mat-cell *matCellDef="let row">{{ wasteTypeLabel(row.waste_type) }}</td>
              </ng-container>
              <ng-container matColumnDef="sheets">
                <th mat-header-cell *matHeaderCellDef>Листов</th>
                <td mat-cell *matCellDef="let row">{{ row.sheets_wasted }}</td>
              </ng-container>
              <ng-container matColumnDef="notes">
                <th mat-header-cell *matHeaderCellDef>Заметки</th>
                <td mat-cell *matCellDef="let row">{{ row.notes || '\u2014' }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="wasteCols"></tr>
              <tr mat-row *matRowDef="let row; columns: wasteCols;"></tr>
            </table>
          } @else {
            <div class="empty-state">Нет записей о браке за выбранный период</div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; }

    .analytics-container { padding: 20px; max-width: 1200px; }

    .analytics-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--crm-text-primary);
      }
    }

    .analytics-filters {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .date-range-field {
      width: 240px;

      .mat-mdc-form-field-subscript-wrapper { display: none; }
    }

    .studio-select { width: 180px; }

    .loading-state {
      display: flex;
      justify-content: center;
      padding: 60px;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }

    .kpi-card {
      padding: 20px;
      text-align: center;
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      border: 1px solid var(--crm-glass-border);
    }

    .kpi-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--crm-accent);
      margin-bottom: 8px;

      &.success { color: var(--crm-status-success); }
      &.speed { color: var(--crm-status-info); }
      &.revenue { color: var(--crm-accent); }
      &.copies { color: var(--crm-status-info); }
      &.waste { color: var(--crm-status-error); }
      &.cost { color: var(--crm-status-warning, #ff9800); }
      &.rev { color: var(--crm-status-success); }
    }

    .kpi-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--crm-text-primary);
      line-height: 1.2;
    }

    .kpi-label {
      font-size: 13px;
      color: var(--crm-text-secondary);
      margin-top: 4px;
    }

    /* Charts */
    .charts-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }

    .chart-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      border: 1px solid var(--crm-glass-border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      position: relative;

      h4 {
        margin: 0 0 12px;
        font-size: 15px;
        font-weight: 600;
        color: var(--crm-text-primary);
      }
    }

    .trend-chart {
      width: 100%;
      height: auto;
    }

    .axis-label {
      font-size: 10px;
      fill: var(--crm-text-secondary, #999);
    }

    .data-dot {
      transition: r 0.15s;
    }

    .hover-target:hover + .data-dot,
    .hover-target:hover ~ .data-dot { r: 5; }

    .chart-tooltip {
      position: absolute;
      top: 8px;
      right: 16px;
      background: var(--crm-gradient-card, #1e1e2e);
      border: 1px solid var(--crm-glass-border);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      color: var(--crm-text-primary);
      pointer-events: none;
      z-index: 10;
      line-height: 1.5;
    }

    /* Horizontal bar chart */
    .hbar-chart {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .hbar-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hbar-label {
      width: 120px;
      font-size: 13px;
      color: var(--crm-text-secondary);
      text-align: right;
      flex-shrink: 0;
    }

    .hbar-label.printer-label { width: 160px; }

    .hbar-track {
      flex: 1;
      height: 20px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      overflow: hidden;
    }

    .hbar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease;
      min-width: 2px;
    }

    .hbar-value {
      width: 120px;
      font-size: 12px;
      color: var(--crm-text-primary);
      flex-shrink: 0;
    }

    /* Tables */
    .table-section {
      margin-bottom: 24px;

      h3 {
        font-size: 16px;
        font-weight: 600;
        color: var(--crm-text-primary);
        margin: 0 0 12px;
      }
    }

    .analytics-table {
      width: 100%;
      background: transparent;

      th.mat-mdc-header-cell {
        color: var(--crm-text-secondary);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom-color: var(--crm-glass-border);
      }

      td.mat-mdc-cell {
        color: var(--crm-text-primary);
        font-size: 14px;
        border-bottom-color: var(--crm-glass-border);
      }

      tr.mat-mdc-row:hover {
        background: rgba(255, 255, 255, 0.03);
      }
    }

    .error-cell { color: var(--crm-status-error) !important; font-weight: 600; }

    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--crm-text-muted);
      font-size: 14px;
    }

    /* Waste section */
    .waste-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;

      h3 { margin: 0; }
    }

    .waste-chips {
      margin-bottom: 16px;
    }

    .waste-form {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;

      mat-form-field { flex: 1; min-width: 140px; }

      button { margin-top: 4px; align-self: center; }
    }

    /* Sortable headers */
    .sortable-header { cursor: pointer; user-select: none; white-space: nowrap; }
    .sortable-header:hover { color: var(--crm-accent) !important; }
    .sort-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; margin-left: 2px; opacity: 0.5; }
    .sortable-header:hover .sort-icon { opacity: 1; }

    /* Table export button */
    .table-export { display: flex; justify-content: flex-end; margin-top: 8px; }
    .table-export button { font-size: 12px; }
  `],
})
export class PrintAnalyticsComponent {
  private readonly printApi = inject(PrintApiService);
  private readonly toast = inject(ToastService);
  readonly studioService = inject(StudioService);

  // Date range signals
  readonly dateFrom = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly dateTo = signal<Date>(new Date());
  readonly periodPreset = signal<'today' | 'week' | 'month' | ''>('month');
  readonly studioId = signal('');
  readonly loading = signal(false);

  readonly summary = signal<AnalyticsSummary>({
    total_jobs: 0, completed: 0, failed: 0, failure_rate: 0,
    total_copies: 0, revenue: 0, avg_duration_ms: 0, waste_sheets: 0,
  });
  readonly printers = signal<PrinterAnalytics[]>([]);
  readonly operators = signal<OperatorAnalytics[]>([]);
  readonly wasteRecords = signal<WasteRecord[]>([]);
  readonly dailyData = signal<DailyStats[]>([]);
  readonly utilizationData = signal<UtilizationStats[]>([]);
  readonly presetsData = signal<PrintPresetRecord[]>([]);

  // Chart hover state
  readonly hoveredPoint = signal<{ x: number; y: number; date: string; dateLabel: string; jobs: number; pages: number; revenue: number } | null>(null);

  // Sort state
  readonly printerSortCol = signal<string>('');
  readonly printerSortDir = signal<'asc' | 'desc'>('desc');
  readonly operatorSortCol = signal<string>('');
  readonly operatorSortDir = signal<'asc' | 'desc'>('desc');
  readonly presetSortCol = signal<string>('');
  readonly presetSortDir = signal<'asc' | 'desc'>('desc');

  // Waste form state
  readonly showWasteForm = signal(false);
  readonly wasteSubmitting = signal(false);
  wasteFormType = 'jam';
  wasteFormSheets = 1;
  wasteFormNotes = '';

  readonly printerCols = ['name', 'jobs', 'copies', 'errors', 'revenue'];
  readonly operatorCols = ['name', 'jobs', 'copies', 'speed'];
  readonly wasteCols = ['date', 'type', 'sheets', 'notes'];
  readonly presetCols = ['name', 'count', 'pages', 'share'];

  readonly costPerPage = computed(() => {
    const s = this.summary();
    if (!s.total_copies || !s.waste_sheets) return '\u2014';
    const costEstimate = this.wasteRecords().reduce((sum, w) => sum + (w.cost_estimate || 0), 0);
    if (!costEstimate) return '\u2014';
    return (costEstimate / s.total_copies).toFixed(2) + ' \u20BD';
  });

  readonly revPerPage = computed(() => {
    const s = this.summary();
    if (!s.completed || !s.total_copies) return '\u2014';
    return (s.revenue / s.total_copies).toFixed(2) + ' \u20BD';
  });

  readonly wasteChips = computed(() => {
    const records = this.wasteRecords();
    if (!records.length) return [];
    const counts = new Map<string, number>();
    for (const r of records) {
      counts.set(r.waste_type, (counts.get(r.waste_type) || 0) + r.sheets_wasted);
    }
    return Array.from(counts.entries()).map(([type, count]) => ({
      type,
      label: this.wasteTypeLabel(type),
      count,
    }));
  });

  // SVG chart computed signals
  readonly chartPoints = computed(() => {
    const data = this.dailyData();
    if (data.length < 2) return '';
    const maxVal = Math.max(...data.map(d => d.total_jobs), 1);
    const width = 560;
    const height = 160;
    return data.map((d, i) => {
      const x = 30 + (i / Math.max(data.length - 1, 1)) * width;
      const y = 10 + height - (d.total_jobs / maxVal) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  });

  readonly chartArea = computed(() => {
    const data = this.dailyData();
    if (data.length < 2) return '';
    const maxVal = Math.max(...data.map(d => d.total_jobs), 1);
    const width = 560;
    const height = 160;
    const points = data.map((d, i) => {
      const x = 30 + (i / Math.max(data.length - 1, 1)) * width;
      const y = 10 + height - (d.total_jobs / maxVal) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const lastX = 30 + ((data.length - 1) / Math.max(data.length - 1, 1)) * width;
    return `M30,${10 + height} L${points.join(' L')} L${lastX.toFixed(1)},${10 + height} Z`;
  });

  readonly chartDots = computed(() => {
    const data = this.dailyData();
    if (data.length < 2) return [];
    const maxVal = Math.max(...data.map(d => d.total_jobs), 1);
    const width = 560;
    const height = 160;
    return data.map((d, i) => ({
      x: 30 + (i / Math.max(data.length - 1, 1)) * width,
      y: 10 + height - (d.total_jobs / maxVal) * height,
      date: d.day,
      dateLabel: this.formatShortDate(d.day),
      jobs: d.total_jobs,
      pages: d.total_copies,
      revenue: d.revenue,
    }));
  });

  readonly yTicks = computed(() => {
    const data = this.dailyData();
    if (data.length < 2) return [];
    const maxVal = Math.max(...data.map(d => d.total_jobs), 1);
    const height = 160;
    const tickCount = 4;
    const ticks: { value: number; y: number }[] = [];
    for (let i = 0; i <= tickCount; i++) {
      const value = Math.round((maxVal / tickCount) * i);
      const y = 10 + height - (value / maxVal) * height;
      ticks.push({ value, y });
    }
    return ticks;
  });

  readonly xLabels = computed(() => {
    const data = this.dailyData();
    if (data.length < 2) return [];
    const step = Math.max(1, Math.ceil(data.length / 7));
    const width = 560;
    return data
      .filter((_, i) => i % step === 0 || i === data.length - 1)
      .map((d) => {
        const idx = data.indexOf(d);
        return {
          date: d.day,
          x: 30 + (idx / Math.max(data.length - 1, 1)) * width,
          text: this.formatShortDate(d.day),
        };
      });
  });

  // Waste distribution for horizontal bars
  readonly wasteDistribution = computed(() => {
    const records = this.wasteRecords();
    if (!records.length) return [];
    const counts = new Map<string, number>();
    for (const r of records) {
      counts.set(r.waste_type, (counts.get(r.waste_type) || 0) + r.sheets_wasted);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const colors: Record<string, string> = {
      jam: '#ef5350',
      color_defect: '#ff9800',
      alignment: '#ffca28',
      media_defect: '#ab47bc',
      operator_error: '#42a5f5',
      other: '#78909c',
    };
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        label: this.wasteTypeLabel(type),
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
        color: colors[type] || '#78909c',
      }));
  });

  // Printer utilization bars
  readonly printerUtilization = computed((): PrinterUtilBar[] => {
    const util = this.utilizationData();
    if (!util.length) return [];
    const grouped = new Map<string, { name: string; totalUtil: number; totalJobs: number; totalBusy: number; count: number }>();
    for (const u of util) {
      if (!u.printer_id) continue;
      const key = u.printer_id;
      const existing = grouped.get(key);
      if (existing) {
        existing.totalUtil += u.utilization_pct;
        existing.totalJobs += u.jobs_count;
        existing.totalBusy += u.busy_minutes;
        existing.count++;
      } else {
        grouped.set(key, {
          name: u.printer_name || key,
          totalUtil: u.utilization_pct,
          totalJobs: u.jobs_count,
          totalBusy: u.busy_minutes,
          count: 1,
        });
      }
    }
    return Array.from(grouped.entries())
      .map(([printer_id, g]) => ({
        printer_id,
        printer_name: g.name,
        utilization_pct: g.totalUtil / g.count,
        total_jobs: g.totalJobs,
        avg_busy_min: g.totalBusy / g.count,
      }))
      .sort((a, b) => b.utilization_pct - a.utilization_pct);
  });

  // Top presets computed from printer stats and presets
  readonly topPresets = computed((): TopPreset[] => {
    const printerData = this.printers();
    const presets = this.presetsData();
    if (!presets.length || !printerData.length) return [];
    const totalJobs = printerData.reduce((s, p) => s + p.total_jobs, 0);
    if (!totalJobs) return [];
    return presets
      .filter(p => p.is_active)
      .slice(0, 10)
      .map(p => ({
        name: p.name,
        count: Math.round(totalJobs / presets.filter(x => x.is_active).length),
        pages: Math.round((printerData.reduce((s, pr) => s + pr.copies, 0)) / presets.filter(x => x.is_active).length),
        share: 100 / presets.filter(x => x.is_active).length,
      }));
  });

  readonly sortedPrinters = computed(() => {
    const items = [...this.printers()];
    const col = this.printerSortCol();
    if (!col) return items;
    const dir = this.printerSortDir() === 'asc' ? 1 : -1;
    const fieldMap: Record<string, (r: PrinterAnalytics) => number | string> = {
      name: r => r.printer_name,
      jobs: r => r.total_jobs,
      copies: r => r.copies,
      errors: r => r.total_jobs > 0 ? r.failed / r.total_jobs : 0,
      revenue: r => r.revenue,
    };
    const fn = fieldMap[col];
    if (!fn) return items;
    return items.sort((a, b) => {
      const va = fn(a);
      const vb = fn(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  });

  readonly sortedOperators = computed(() => {
    const items = [...this.operators()];
    const col = this.operatorSortCol();
    if (!col) return items;
    const dir = this.operatorSortDir() === 'asc' ? 1 : -1;
    const fieldMap: Record<string, (r: OperatorAnalytics) => number | string> = {
      name: r => r.operator_name,
      jobs: r => r.total_jobs,
      copies: r => r.copies,
      speed: r => r.avg_speed_ms,
    };
    const fn = fieldMap[col];
    if (!fn) return items;
    return items.sort((a, b) => {
      const va = fn(a);
      const vb = fn(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  });

  readonly sortedPresets = computed(() => {
    const items = [...this.topPresets()];
    const col = this.presetSortCol();
    if (!col) return items;
    const dir = this.presetSortDir() === 'asc' ? 1 : -1;
    const fieldMap: Record<string, (r: TopPreset) => number | string> = {
      name: r => r.name,
      count: r => r.count,
      pages: r => r.pages,
      share: r => r.share,
    };
    const fn = fieldMap[col];
    if (!fn) return items;
    return items.sort((a, b) => {
      const va = fn(a);
      const vb = fn(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  });

  private dateRange = computed(() => {
    const from = this.dateFrom();
    const to = this.dateTo();
    if (!from || !to) {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
      };
    }
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  });

  private static readonly WASTE_LABELS: Record<string, string> = {
    jam: 'Замятие',
    color_defect: 'Цвет',
    alignment: 'Выравнивание',
    media_defect: 'Дефект носителя',
    operator_error: 'Ошибка оператора',
    other: 'Другое',
  };

  constructor() {
    this.studioService.load();

    effect(() => {
      const { from, to } = this.dateRange();
      const studio_id = this.studioId() || undefined;
      this.loadData(from, to, studio_id);
    });
  }

  applyPreset(preset: 'today' | 'week' | 'month'): void {
    this.periodPreset.set(preset);
    const now = new Date();
    this.dateTo.set(now);
    if (preset === 'today') {
      this.dateFrom.set(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    } else if (preset === 'week') {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      this.dateFrom.set(from);
    } else {
      this.dateFrom.set(new Date(now.getFullYear(), now.getMonth(), 1));
    }
  }

  onDateToChange(date: Date | null): void {
    if (date) {
      this.dateTo.set(date);
      this.periodPreset.set('');
    }
  }

  private loadData(from: string, to: string, studio_id?: string): void {
    const params: Record<string, string> = { from, to };
    if (studio_id) params['studio_id'] = studio_id;

    this.loading.set(true);

    Promise.all([
      firstValueFrom(this.printApi.getAnalyticsSummary(params)),
      firstValueFrom(this.printApi.getAnalyticsByPrinter(params)),
      firstValueFrom(this.printApi.getAnalyticsByOperator(params)),
      firstValueFrom(this.printApi.getWasteStats(params)),
      firstValueFrom(this.printApi.getDailyTrend(params)),
      firstValueFrom(this.printApi.getUtilization(params)),
      firstValueFrom(this.printApi.getPresets()),
    ]).then(([s, p, o, w, daily, util, presets]) => {
      if (s) this.summary.set(s);
      if (p) this.printers.set(p);
      if (o) this.operators.set(o);
      if (w) this.wasteRecords.set(w);
      if (daily) this.dailyData.set(daily);
      if (util) this.utilizationData.set(util);
      if (presets) this.presetsData.set(presets);
      this.loading.set(false);
    }).catch(() => {
      this.loading.set(false);
    });
  }

  exportCsv(): void {
    const data = this.dailyData();
    if (!data.length) {
      this.toast.error('Нет данных для экспорта');
      return;
    }
    const { from, to } = this.dateRange();
    const headers = ['Дата', 'Заданий', 'Завершено', 'Ошибки', 'Копий', 'Выручка', 'Брак'];
    const rows = data.map(d => [
      d.day,
      String(d.total_jobs),
      String(d.completed_jobs),
      String(d.failed_jobs),
      String(d.total_copies),
      String(d.revenue),
      String(d.waste_sheets),
    ]);
    this.downloadCsv(headers, rows, `print-daily-${from}-${to}.csv`);
  }

  exportPrintersCsv(): void {
    const data = this.printers();
    if (!data.length) {
      this.toast.error('Нет данных по принтерам');
      return;
    }
    const { from, to } = this.dateRange();
    const headers = ['Принтер', 'ID', 'Заданий', 'Завершено', 'Ошибки', 'Копий', 'Выручка'];
    const rows = data.map(p => [
      p.printer_name,
      p.printer_id,
      String(p.total_jobs),
      String(p.completed),
      String(p.failed),
      String(p.copies),
      String(p.revenue),
    ]);
    this.downloadCsv(headers, rows, `print-printers-${from}-${to}.csv`);
  }

  exportOperatorsCsv(): void {
    const data = this.operators();
    if (!data.length) {
      this.toast.error('Нет данных по операторам');
      return;
    }
    const { from, to } = this.dateRange();
    const headers = ['Оператор', 'Заданий', 'Завершено', 'Ошибки', 'Копий', 'Ср. скорость (сек)'];
    const rows = data.map(o => [
      o.operator_name,
      String(o.total_jobs),
      String(o.completed),
      String(o.failed),
      String(o.copies),
      o.avg_speed_ms > 0 ? (o.avg_speed_ms / 1000).toFixed(1) : '0',
    ]);
    this.downloadCsv(headers, rows, `print-operators-${from}-${to}.csv`);
  }

  exportPresetsCsv(): void {
    const data = this.topPresets();
    if (!data.length) {
      this.toast.error('Нет данных по пресетам');
      return;
    }
    const { from, to } = this.dateRange();
    const headers = ['Пресет', 'Количество', 'Страниц', 'Доля (%)'];
    const rows = data.map(p => [
      p.name,
      String(p.count),
      String(p.pages),
      p.share.toFixed(1),
    ]);
    this.downloadCsv(headers, rows, `print-presets-${from}-${to}.csv`);
  }

  toggleSort(table: 'printer' | 'operator' | 'preset', column: string): void {
    const colSignal = table === 'printer' ? this.printerSortCol
      : table === 'operator' ? this.operatorSortCol : this.presetSortCol;
    const dirSignal = table === 'printer' ? this.printerSortDir
      : table === 'operator' ? this.operatorSortDir : this.presetSortDir;
    if (colSignal() === column) {
      dirSignal.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      colSignal.set(column);
      dirSignal.set('desc');
    }
  }

  sortIcon(table: 'printer' | 'operator' | 'preset', column: string): string {
    const col = table === 'printer' ? this.printerSortCol()
      : table === 'operator' ? this.operatorSortCol() : this.presetSortCol();
    if (col !== column) return 'unfold_more';
    const dir = table === 'printer' ? this.printerSortDir()
      : table === 'operator' ? this.operatorSortDir() : this.presetSortDir();
    return dir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private downloadCsv(headers: string[], rows: string[][], filename: string): void {
    const bom = '\uFEFF';
    const csv = bom + [
      headers.join(';'),
      ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  submitWaste(): void {
    const studioId = this.studioId() || undefined;
    this.wasteSubmitting.set(true);

    firstValueFrom(this.printApi.reportWaste({
      waste_type: this.wasteFormType,
      sheets_wasted: this.wasteFormSheets,
      notes: this.wasteFormNotes || undefined,
      studio_id: studioId,
    })).then(() => {
      this.toast.success('Запись о браке добавлена');
      this.showWasteForm.set(false);
      this.wasteFormType = 'jam';
      this.wasteFormSheets = 1;
      this.wasteFormNotes = '';
      this.wasteSubmitting.set(false);
      const { from, to } = this.dateRange();
      this.loadData(from, to, this.studioId() || undefined);
    }).catch(() => {
      this.toast.error('Не удалось сохранить запись о браке');
      this.wasteSubmitting.set(false);
    });
  }

  wasteTypeLabel(type: string): string {
    return PrintAnalyticsComponent.WASTE_LABELS[type] || type;
  }

  formatDuration(ms: number): string {
    if (!ms || ms <= 0) return '\u2014';
    if (ms < 1000) return `${Math.round(ms)}\u043c\u0441`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}\u0441`;
    const min = Math.floor(sec / 60);
    const remSec = Math.round(sec % 60);
    return `${min}\u043c ${remSec}\u0441`;
  }

  formatShortDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  }

  utilizationColor(pct: number): string {
    if (pct < 50) return '#4caf50';
    if (pct < 80) return '#ff9800';
    return '#f44336';
  }
}
