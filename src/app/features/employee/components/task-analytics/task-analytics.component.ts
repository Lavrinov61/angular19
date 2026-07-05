import { Component, inject, signal, OnInit, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { TasksApiService, TaskAnalytics } from '../../services/tasks-api.service';
import { typeIcon, typeLabel, priorityLabel } from '../../utils/crm-helpers';

@Component({
  selector: 'app-task-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatIconModule, MatChipsModule],
  templateUrl: './task-analytics.component.html',
  styleUrl: './task-analytics.component.scss',
})
export class TaskAnalyticsComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly tasksApi = inject(TasksApiService);

  data = signal<TaskAnalytics | null>(null);
  loading = signal(true);
  period = signal('30d');

  readonly typeIcon = typeIcon;
  readonly typeLabel = typeLabel;
  readonly priorityLabel = priorityLabel;

  periods = [
    { value: '7d', label: '7 дней' },
    { value: '30d', label: '30 дней' },
    { value: '90d', label: '90 дней' },
    { value: 'all', label: 'Всё время' },
  ];

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadAnalytics();
    }
  }

  setPeriod(p: string) {
    this.period.set(p);
    this.loadAnalytics();
  }

  loadAnalytics() {
    this.loading.set(true);
    const params: { date_from?: string; date_to?: string } = {};

    if (this.period() !== 'all') {
      const days = parseInt(this.period());
      const from = new Date();
      from.setDate(from.getDate() - days);
      params.date_from = from.toISOString().slice(0, 10);
    }

    this.tasksApi.getAnalytics(params).subscribe({
      next: (res) => {
        if (res.success && res.data) this.data.set(res.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  formatHours(h: number | null): string {
    if (h === null || h === undefined) return '---';
    if (h < 1) return Math.round(h * 60) + 'м';
    if (h >= 24) return Math.round(h / 24) + 'д';
    return h.toFixed(1) + 'ч';
  }

  barWidth(completed: number, total: number): number {
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  }

  slaGood(v: number | null): boolean { return v !== null && v >= 90; }
  slaWarn(v: number | null): boolean { return v !== null && v >= 70 && v < 90; }
  slaBad(v: number | null): boolean { return v !== null && v < 70; }

  formatDay(date: string): string {
    return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  dayBarHeight(value: number, days: { created: number; completed: number }[]): number {
    const max = Math.max(...days.map(d => Math.max(d.created, d.completed)), 1);
    return Math.max(2, Math.round((value / max) * 100));
  }
}
