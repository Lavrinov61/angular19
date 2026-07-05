import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { DecimalPipe } from '@angular/common';
import {
  ProductionApiService, ProductionAiInsights,
} from '../../../services/production-api.service';
import { catLabel, formatProductionCost } from '../production.constants';

@Component({
  selector: 'app-production-ai',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatChipsModule, DecimalPipe],
  template: `
    <div class="ai-page">
      <div class="page-header">
        <h2><mat-icon>auto_awesome</mat-icon> AI-анализ производства</h2>
        <button mat-flat-button (click)="load()" [disabled]="loading()" aria-label="Обновить AI-анализ">
          @if (loading()) { <mat-spinner diameter="18" /> } @else { <mat-icon>refresh</mat-icon> }
          Обновить
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="40" />
          <p>AI анализирует производство...</p>
        </div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button (click)="load()">Повторить</button>
        </div>
      } @else {
        @let data = insights();
        @if (data) {

        <!-- Quality Alerts -->
        @if (data.quality_alerts.length > 0) {
          <section class="section">
            <h3><mat-icon class="warn-icon">warning</mat-icon> Предупреждения о качестве</h3>
            <div class="alerts-list">
              @for (alert of data.quality_alerts; track alert.house_id + alert.alert_type) {
                <mat-card class="alert-card" appearance="outlined"
                          [class.severity-critical]="alert.severity === 'critical'"
                          [class.severity-warning]="alert.severity === 'warning'"
                          [class.severity-info]="alert.severity === 'info'">
                  <div class="alert-content">
                    <mat-icon class="alert-icon">{{ severityIcon(alert.severity) }}</mat-icon>
                    <div>
                      <div class="alert-house">{{ alert.house_name }}</div>
                      <div class="alert-issue">{{ alert.message }}</div>
                      @if (alert.metric_value !== null) {
                        <div class="alert-metric">
                          {{ alert.metric_value | number:'1.1-1' }} (порог: {{ alert.threshold | number:'1.1-1' }})
                        </div>
                      }
                    </div>
                    <span class="severity-badge" [class]="'sev-' + alert.severity">
                      {{ severityLabel(alert.severity) }}
                    </span>
                  </div>
                </mat-card>
              }
            </div>
          </section>
        }

        <!-- Recommendations -->
        @if (data.recommendations.length > 0) {
          <section class="section">
            <h3><mat-icon>business</mat-icon> Рекомендации по типографиям</h3>
            <div class="recs-grid">
              @for (rec of data.recommendations; track rec.house_id + rec.category) {
                <mat-card class="rec-card" appearance="outlined">
                  <div class="rec-header">
                    <mat-icon class="rec-star">star</mat-icon>
                    <span class="rec-house">{{ rec.house_name }}</span>
                    <span class="rec-score">{{ rec.confidence | number:'1.0-0' }}%</span>
                  </div>
                  <div class="rec-category">для категории: {{ catLabel(rec.category) }}</div>
                  <p class="rec-reason">{{ rec.reason }}</p>
                  @if (rec.avg_price > 0) {
                    <div class="rec-meta">
                      <span>Ср. цена: {{ formatCost(rec.avg_price) }}</span>
                      <span>Срок: {{ rec.avg_lead_days }} дн.</span>
                      <span>Качество: {{ rec.quality_score | number:'1.1-1' }}/5</span>
                    </div>
                  }
                </mat-card>
              }
            </div>
          </section>
        }

        <!-- Cost Optimizations -->
        @if (data.cost_optimizations.length > 0) {
          <section class="section">
            <h3><mat-icon>savings</mat-icon> Оптимизация затрат</h3>
            <div class="opts-list">
              @for (opt of data.cost_optimizations; track opt.title) {
                <mat-card class="opt-card" appearance="outlined" [class.priority-high]="opt.priority === 'high'">
                  <div class="opt-header">
                    <mat-icon>trending_down</mat-icon>
                    <span class="opt-title">{{ opt.title }}</span>
                    @if (opt.potential_savings > 0) {
                      <span class="opt-savings">−{{ formatCost(opt.potential_savings) }}</span>
                    }
                    <span class="priority-badge" [class]="'prio-' + opt.priority">
                      {{ priorityLabel(opt.priority) }}
                    </span>
                  </div>
                  <p class="opt-desc">{{ opt.description }}</p>
                </mat-card>
              }
            </div>
          </section>
        }

        <!-- Demand Forecast -->
        @if (data.demand_forecast.length > 0) {
          <section class="section">
            <h3><mat-icon>trending_up</mat-icon> Прогноз спроса</h3>
            <div class="forecast-table">
              <div class="forecast-header">
                <span>Период</span>
                <span>Категория</span>
                <span>Прогноз</span>
                <span>Уверенность</span>
              </div>
              @for (f of data.demand_forecast; track f.week_label + f.category) {
                <div class="forecast-row">
                  <span>{{ f.week_label }}</span>
                  <span>{{ catLabel(f.category) }}</span>
                  <span class="fc-qty">{{ f.predicted_orders }} зак.</span>
                  <div class="conf-bar">
                    <div class="conf-bar-track">
                      <div class="conf-fill" [style.width]="f.confidence + '%'"></div>
                    </div>
                    <span>{{ f.confidence }}%</span>
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <div class="generated-at">
          Обновлено: {{ formatDate(data.generated_at) }}
        </div>

      } @else {
        <div class="empty-state">
          <mat-icon>auto_awesome</mat-icon>
          <p>Нажмите «Обновить» для запуска AI-анализа</p>
          <button mat-flat-button color="primary" (click)="load()">Запустить анализ</button>
        </div>
        }
      }
    </div>
  `,
  styles: `
    .ai-page { padding: 16px; max-width: 1000px; margin: 0 auto; }

    .page-header {
      display: flex; align-items: center; margin-bottom: 20px;
      h2 { margin: 0; flex: 1; font-size: 18px; font-weight: 600;
            display: flex; align-items: center; gap: 8px;
            mat-icon { color: var(--crm-accent); }
      }
    }

    .section { margin-bottom: 24px; }
    .section h3 {
      font-size: 15px; font-weight: 600; margin: 0 0 12px;
      display: flex; align-items: center; gap: 8px; color: var(--crm-text-primary);
      mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--crm-accent); }
    }
    .warn-icon { color: var(--crm-danger, #f87171) !important; }

    /* Alerts */
    .alerts-list { display: flex; flex-direction: column; gap: 8px; }
    .alert-card { border-left: 4px solid #9ca3af; }
    .alert-card.severity-critical { border-color: var(--crm-danger, #f87171); }
    .alert-card.severity-warning { border-color: var(--crm-warning, #fbbf24); }
    .alert-card.severity-info { border-color: #60a5fa; }
    .alert-content { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; }
    .alert-icon { flex-shrink: 0; margin-top: 2px; }
    .alert-house { font-size: 13px; font-weight: 600; color: var(--crm-text-primary); }
    .alert-issue { font-size: 13px; color: var(--crm-text-secondary); margin-top: 2px; }
    .alert-metric { font-size: 11px; color: var(--crm-text-secondary); margin-top: 4px; font-style: italic; }
    .severity-badge {
      margin-left: auto; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
      flex-shrink: 0;
    }
    .sev-critical { background: color-mix(in srgb, #f87171 13%, transparent); color: #f87171; }
    .sev-warning { background: color-mix(in srgb, #fbbf24 13%, transparent); color: #fbbf24; }
    .sev-info { background: color-mix(in srgb, #60a5fa 13%, transparent); color: #60a5fa; }

    /* Recommendations */
    .recs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .rec-card { padding: 16px; }
    .rec-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .rec-star { color: var(--crm-warning, #fbbf24); font-size: 20px; width: 20px; height: 20px; }
    .rec-house { font-size: 15px; font-weight: 600; flex: 1; color: var(--crm-text-primary); }
    .rec-score { font-size: 13px; color: var(--crm-accent); font-weight: 600; }
    .rec-category { font-size: 12px; color: var(--crm-text-secondary); margin-bottom: 8px; }
    .rec-reason { font-size: 13px; color: var(--crm-text-secondary); margin: 0 0 8px; line-height: 1.5; }
    .rec-meta { display: flex; gap: 12px; font-size: 11px; color: var(--crm-text-secondary); flex-wrap: wrap; }

    /* Optimizations */
    .opts-list { display: flex; flex-direction: column; gap: 10px; }
    .opt-card { border-left: 4px solid #34d399; }
    .opt-card.priority-high { border-color: var(--crm-danger, #f87171); }
    .opt-header {
      display: flex; align-items: center; gap: 8px; padding: 12px 16px 4px;
      mat-icon { color: #34d399; }
    }
    .opt-title { font-size: 14px; font-weight: 600; flex: 1; color: var(--crm-text-primary); }
    .opt-savings { color: #34d399; font-weight: 700; font-size: 15px; }
    .priority-badge {
      font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; flex-shrink: 0;
    }
    .prio-high { background: color-mix(in srgb, #f87171 13%, transparent); color: #f87171; }
    .prio-medium { background: color-mix(in srgb, #fbbf24 13%, transparent); color: #fbbf24; }
    .prio-low { background: color-mix(in srgb, #34d399 13%, transparent); color: #34d399; }
    .opt-desc { font-size: 13px; color: var(--crm-text-secondary); margin: 0 0 12px 16px; line-height: 1.5; padding-left: 32px; }

    /* Forecast */
    .forecast-table { border: 1px solid var(--crm-border); border-radius: 8px; overflow: hidden; }
    .forecast-header {
      display: grid; grid-template-columns: 120px 1fr 100px 160px;
      padding: 8px 12px; background: var(--crm-surface-hover);
      font-size: 12px; font-weight: 600; color: var(--crm-text-secondary);
    }
    .forecast-row {
      display: grid; grid-template-columns: 120px 1fr 100px 160px;
      padding: 10px 12px; border-top: 1px solid var(--crm-border); font-size: 13px; align-items: center;
    }
    .fc-qty { font-weight: 700; color: var(--crm-accent); }
    .conf-bar {
      display: flex; align-items: center; gap: 8px;
      span { font-size: 12px; color: var(--crm-text-secondary); flex-shrink: 0; }
    }
    .conf-bar-track {
      flex: 1; height: 8px; background: var(--crm-surface-hover); border-radius: 4px; overflow: hidden;
    }
    .conf-fill {
      height: 8px; background: var(--crm-accent); border-radius: 4px;
      transition: width 0.4s ease;
    }

    .generated-at { font-size: 12px; color: var(--crm-text-secondary); text-align: right; margin-top: 16px; }

    .loading-state, .empty-state, .error-state {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--crm-accent); }
      p { margin: 12px 0 16px; font-size: 16px; }
    }
    .error-state mat-icon { color: var(--crm-danger, #f87171); }
  `,
})
export class ProductionAiComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly insights = signal<ProductionAiInsights | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.getAiInsights().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => { this.insights.set(data); this.loading.set(false); },
      error: () => {
        this.error.set('Не удалось запустить AI-анализ. Попробуйте позже.');
        this.loading.set(false);
      },
    });
  }

  severityIcon(s: string): string {
    return { critical: 'error', warning: 'warning', info: 'info' }[s] ?? 'info';
  }

  severityLabel(s: string): string {
    return { critical: 'Критично', warning: 'Внимание', info: 'Информация' }[s] ?? s;
  }

  priorityLabel(p: string): string {
    return { high: 'Высокий', medium: 'Средний', low: 'Низкий' }[p] ?? p;
  }

  readonly catLabel = catLabel;
  readonly formatCost = formatProductionCost;

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
