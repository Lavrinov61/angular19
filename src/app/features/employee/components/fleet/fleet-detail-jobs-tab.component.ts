import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FleetDetailStateService } from './services/fleet-detail-state.service';

@Component({
  selector: 'app-fleet-detail-jobs-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <section class="card">
      <header class="card-head">
        <h3>Последние задания</h3>
        <span class="chip-soon">Фильтры скоро</span>
      </header>
      @if (jobs().length === 0) {
        <p class="empty">Заданий пока нет.</p>
      } @else {
        <div class="jobs-wrap">
          <table class="jobs">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Файл</th>
                <th>Страниц</th>
                <th>Копий</th>
                <th>Источник</th>
                <th>Оператор</th>
              </tr>
            </thead>
            <tbody>
              @for (j of jobs(); track j.id) {
                <tr>
                  <td class="jobs-when">{{ j.completed_at ?? j.created_at | date:'dd MMM HH:mm' }}</td>
                  <td class="jobs-file">{{ j.file_name ?? '—' }}</td>
                  <td>{{ j.pages_printed ?? '—' }}</td>
                  <td>{{ j.copies ?? '—' }}</td>
                  <td class="jobs-src">{{ sourceLabel(j.print_source) }}</td>
                  <td>{{ j.created_by_name ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .card { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 16px 20px; }
    .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .card-head h3 {
      margin: 0;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      font-weight: 700;
    }
    .chip-soon {
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
      padding: 2px 8px; background: rgba(0,0,0,0.06); border-radius: 999px; color: #6b7280;
    }
    .jobs-wrap { overflow-x: auto; }
    .jobs {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .jobs th, .jobs td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(0,0,0,0.04);
    }
    .jobs th {
      font-weight: 600;
      color: #6b7280;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .jobs td { color: #1a1a1a; }
    .jobs-when { white-space: nowrap; color: #4b5563; }
    .jobs-file { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .jobs-src { text-transform: capitalize; color: #6b7280; }
    .empty { margin: 0; padding: 24px; text-align: center; color: #9ca3af; font-style: italic; font-size: 13px; }
  `]
})
export class FleetDetailJobsTabComponent {
  private readonly state = inject(FleetDetailStateService);
  readonly jobs = computed(() => this.state.detail()?.recent_jobs ?? []);

  sourceLabel(src: string | null): string {
    if (!src) return '—';
    switch (src) {
      case 'rust_api':        return 'Rust API';
      case 'cups':            return 'CUPS';
      case 'canon_remote_ui': return 'Canon UI';
      case 'windows_event':   return 'Windows';
      case 'bridge_agent':    return 'Agent';
      default: return src;
    }
  }
}
