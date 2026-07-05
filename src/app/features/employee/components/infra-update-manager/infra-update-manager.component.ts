import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatDialogModule } from '@angular/material/dialog';
import { DatePipe, UpperCasePipe, SlicePipe } from '@angular/common';
import {
  InfraApiService,
  AgentRelease, UpdateCommand, RolloutPlan, AgentType,
} from '../../services/infra-api.service';
import { InfraRealtimeService } from '../../services/infra-realtime.service';

@Component({
  selector: 'app-infra-update-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatIconModule, MatButtonModule, MatChipsModule,
    MatTabsModule, MatTableModule, MatMenuModule, MatProgressBarModule,
    MatSnackBarModule, MatTooltipModule, MatSelectModule, MatDialogModule,
    DatePipe, UpperCasePipe, SlicePipe, RouterLink,
  ],
  template: `
    <div class="update-manager">
      <div class="manager-header">
        <a mat-icon-button routerLink="/employee/infrastructure">
          <mat-icon>arrow_back</mat-icon>
        </a>
        <h1>Release & Update Manager</h1>
        <button mat-stroked-button (click)="refresh()">
          <mat-icon>refresh</mat-icon> Обновить
        </button>
      </div>

      <mat-tab-group animationDuration="200ms">
        <!-- TAB: Releases -->
        <mat-tab label="Релизы">
          <div class="tab-content">
            <div class="tab-toolbar">
              <mat-select placeholder="Тип агента" [value]="releaseTypeFilter()"
                          (selectionChange)="releaseTypeFilter.set($event.value)">
                <mat-option [value]="null">Все</mat-option>
                <mat-option value="print">Print</mat-option>
                <mat-option value="pos">POS</mat-option>
                <mat-option value="vision">Vision</mat-option>
                <mat-option value="monitor">Monitor</mat-option>
              </mat-select>
            </div>
            <table mat-table [dataSource]="filteredReleases()" class="releases-table">
              <ng-container matColumnDef="version">
                <th mat-header-cell *matHeaderCellDef>Версия</th>
                <td mat-cell *matCellDef="let r">
                  <strong>v{{ r.version }}</strong>
                  @if (r.is_stable) {
                    <mat-chip class="stable-chip">stable</mat-chip>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="agent_type">
                <th mat-header-cell *matHeaderCellDef>Тип</th>
                <td mat-cell *matCellDef="let r">
                  <mat-chip>{{ r.agent_type }}</mat-chip>
                </td>
              </ng-container>
              <ng-container matColumnDef="platform">
                <th mat-header-cell *matHeaderCellDef>Платформа</th>
                <td mat-cell *matCellDef="let r">{{ r.platform }}</td>
              </ng-container>
              <ng-container matColumnDef="size">
                <th mat-header-cell *matHeaderCellDef>Размер</th>
                <td mat-cell *matCellDef="let r">{{ formatSize(r.artifact_size_bytes) }}</td>
              </ng-container>
              <ng-container matColumnDef="downloads">
                <th mat-header-cell *matHeaderCellDef>Downloads</th>
                <td mat-cell *matCellDef="let r">{{ r.download_count ?? 0 }}</td>
              </ng-container>
              <ng-container matColumnDef="released_at">
                <th mat-header-cell *matHeaderCellDef>Дата</th>
                <td mat-cell *matCellDef="let r">{{ r.released_at | date:'dd.MM.yy HH:mm' }}</td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let r">
                  <button mat-icon-button [matMenuTriggerFor]="releaseMenu">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #releaseMenu="matMenu">
                    <button mat-menu-item (click)="startRollout(r)">
                      <mat-icon>rocket_launch</mat-icon> Staged Rollout
                    </button>
                    <button mat-menu-item (click)="fleetUpdate(r)">
                      <mat-icon>update</mat-icon> Обновить всех
                    </button>
                    @if (!r.is_stable) {
                      <button mat-menu-item (click)="promoteRelease(r)">
                        <mat-icon>verified</mat-icon> Пометить stable
                      </button>
                    }
                  </mat-menu>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="releaseColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: releaseColumns"></tr>
            </table>
            @if (releases().length === 0) {
              <div class="empty-state">Нет зарегистрированных релизов</div>
            }
          </div>
        </mat-tab>

        <!-- TAB: Rollouts -->
        <mat-tab label="Rollouts">
          <div class="tab-content">
            @for (rollout of rollouts(); track rollout.id) {
              <mat-card class="rollout-card" [class]="'rollout-' + rollout.status">
                <div class="rollout-header">
                  <div class="rollout-info">
                    <strong>{{ rollout.target_agent_type | uppercase }}</strong>
                    <mat-chip [class]="'status-' + rollout.status">{{ rollout.status }}</mat-chip>
                    <span class="rollout-strategy">{{ rollout.strategy }}</span>
                    <span class="rollout-date">{{ rollout.created_at | date:'dd.MM HH:mm' }}</span>
                  </div>
                  <div class="rollout-actions">
                    @if (rollout.status === 'in_progress') {
                      @if (!rollout.next_phase_at) {
                        <button mat-stroked-button color="primary" (click)="advancePhase(rollout)">
                          <mat-icon>skip_next</mat-icon> Advance
                        </button>
                      }
                      <button mat-stroked-button color="warn" (click)="pauseRolloutAction(rollout)">
                        <mat-icon>pause</mat-icon> Пауза
                      </button>
                    }
                    @if (rollout.status === 'paused') {
                      <button mat-stroked-button color="primary" (click)="advancePhase(rollout)">
                        <mat-icon>play_arrow</mat-icon> Продолжить
                      </button>
                    }
                    @if (rollout.status !== 'completed' && rollout.status !== 'cancelled') {
                      <button mat-icon-button color="warn" (click)="cancelRolloutAction(rollout)"
                              matTooltip="Отменить">
                        <mat-icon>cancel</mat-icon>
                      </button>
                    }
                  </div>
                </div>
                <div class="rollout-progress">
                  <mat-progress-bar mode="determinate"
                    [value]="rolloutProgress(rollout)">
                  </mat-progress-bar>
                  <div class="progress-label">
                    Phase: {{ rollout.current_phase }}
                    | {{ rollout.completed_agents }}/{{ rollout.total_agents }} completed
                    @if (rollout.failed_agents > 0) {
                      | <span class="failed-count">{{ rollout.failed_agents }} failed</span>
                    }
                    @if (rollout.next_phase_at) {
                      | Next: {{ rollout.next_phase_at | date:'HH:mm' }}
                    }
                  </div>
                </div>
              </mat-card>
            } @empty {
              <div class="empty-state">Нет активных rollout'ов</div>
            }
          </div>
        </mat-tab>

        <!-- TAB: Update History -->
        <mat-tab label="История обновлений">
          <div class="tab-content">
            <table mat-table [dataSource]="updates()" class="updates-table">
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Статус</th>
                <td mat-cell *matCellDef="let u">
                  <mat-chip [class]="'update-status-' + u.status">{{ u.status }}</mat-chip>
                </td>
              </ng-container>
              <ng-container matColumnDef="agent">
                <th mat-header-cell *matHeaderCellDef>Агент</th>
                <td mat-cell *matCellDef="let u">
                  <a [routerLink]="['/employee/infrastructure/agents', u.agent_id]">
                    {{ u.agent_id | slice:0:8 }}...
                  </a>
                </td>
              </ng-container>
              <ng-container matColumnDef="version">
                <th mat-header-cell *matHeaderCellDef>Версия</th>
                <td mat-cell *matCellDef="let u">{{ u.previous_version ?? '?' }} &rarr; ?</td>
              </ng-container>
              <ng-container matColumnDef="progress">
                <th mat-header-cell *matHeaderCellDef>Прогресс</th>
                <td mat-cell *matCellDef="let u">
                  @if (u.status === 'downloading' || u.status === 'installing') {
                    <mat-progress-bar mode="determinate" [value]="u.progress_percent ?? 0">
                    </mat-progress-bar>
                    <span class="progress-text">{{ u.progress_percent ?? 0 }}%</span>
                  } @else if (u.status === 'completed') {
                    <mat-icon class="completed-icon">check_circle</mat-icon>
                  } @else if (u.status === 'failed') {
                    <mat-icon class="failed-icon">error</mat-icon>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="initiated_at">
                <th mat-header-cell *matHeaderCellDef>Дата</th>
                <td mat-cell *matCellDef="let u">{{ u.initiated_at | date:'dd.MM HH:mm' }}</td>
              </ng-container>
              <ng-container matColumnDef="error">
                <th mat-header-cell *matHeaderCellDef>Ошибка</th>
                <td mat-cell *matCellDef="let u" class="error-cell">{{ u.error_message ?? '' }}</td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let u">
                  @if (u.status === 'completed' || u.status === 'failed') {
                    <button mat-icon-button (click)="rollbackUpdateAction(u)"
                            matTooltip="Откатить">
                      <mat-icon>undo</mat-icon>
                    </button>
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="updateColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: updateColumns"></tr>
            </table>
            @if (updates().length === 0) {
              <div class="empty-state">Нет истории обновлений</div>
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .update-manager { padding: 24px; max-width: 1400px; margin: 0 auto; }
    .manager-header {
      display: flex; align-items: center; gap: 12px; margin-bottom: 20px;
    }
    .manager-header h1 { flex: 1; font-size: 22px; font-weight: 600; margin: 0; }

    .tab-content { padding: 16px 0; }
    .tab-toolbar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
    .tab-toolbar mat-select { width: 160px; }

    .releases-table, .updates-table { width: 100%; }
    .stable-chip {
      --mdc-chip-elevated-container-color: #e8f5e9;
      color: #2e7d32; font-size: 10px; min-height: 20px; padding: 2px 6px; margin-left: 6px;
    }

    .rollout-card { margin-bottom: 12px; padding: 16px; }
    .rollout-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .rollout-info { display: flex; align-items: center; gap: 8px; }
    .rollout-strategy { font-size: 12px; color: var(--mat-sys-outline); }
    .rollout-date { font-size: 12px; color: var(--mat-sys-outline); }
    .rollout-actions { display: flex; gap: 8px; align-items: center; }
    .rollout-progress { }
    .progress-label { font-size: 12px; color: var(--mat-sys-outline); margin-top: 6px; }
    .failed-count { color: #f44336; font-weight: 500; }

    .status-pending { --mdc-chip-elevated-container-color: #e3f2fd; color: #1565c0; }
    .status-in_progress { --mdc-chip-elevated-container-color: #fff3e0; color: #e65100; }
    .status-paused { --mdc-chip-elevated-container-color: #fce4ec; color: #c62828; }
    .status-completed { --mdc-chip-elevated-container-color: #e8f5e9; color: #2e7d32; }
    .status-failed { --mdc-chip-elevated-container-color: #ffebee; color: #c62828; }
    .status-cancelled { --mdc-chip-elevated-container-color: #f5f5f5; color: #757575; }

    .update-status-pending { --mdc-chip-elevated-container-color: #e3f2fd; color: #1565c0; }
    .update-status-downloading { --mdc-chip-elevated-container-color: #e8f5e9; color: #2e7d32; }
    .update-status-installing { --mdc-chip-elevated-container-color: #fff3e0; color: #e65100; }
    .update-status-completed { --mdc-chip-elevated-container-color: #e8f5e9; color: #2e7d32; }
    .update-status-failed { --mdc-chip-elevated-container-color: #ffebee; color: #c62828; }
    .update-status-rolled_back { --mdc-chip-elevated-container-color: #f3e5f5; color: #6a1b9a; }

    .progress-text { font-size: 11px; margin-left: 6px; }
    .completed-icon { color: #4caf50; font-size: 18px; }
    .failed-icon { color: #f44336; font-size: 18px; }
    .error-cell { font-size: 12px; color: #c62828; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

    .empty-state { text-align: center; padding: 40px; color: var(--mat-sys-outline); }
  `],
})
export class InfraUpdateManagerComponent implements OnInit, OnDestroy {
  private readonly api = inject(InfraApiService);
  private readonly realtime = inject(InfraRealtimeService);
  private readonly snack = inject(MatSnackBar);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  readonly releases = signal<AgentRelease[]>([]);
  readonly rollouts = signal<RolloutPlan[]>([]);
  readonly updates = signal<UpdateCommand[]>([]);

  readonly releaseTypeFilter = signal<AgentType | null>(null);

  readonly filteredReleases = computed(() => {
    const type = this.releaseTypeFilter();
    if (!type) return this.releases();
    return this.releases().filter(r => r.agent_type === type);
  });

  readonly releaseColumns = ['version', 'agent_type', 'platform', 'size', 'downloads', 'released_at', 'actions'];
  readonly updateColumns = ['status', 'agent', 'version', 'progress', 'initiated_at', 'error', 'actions'];

  // Real-time update progress
  private readonly updateProgressEffect = effect(() => {
    const progress = this.realtime.updateProgress();
    if (!progress) return;

    if (progress.type === 'agent_update' && progress.command_id) {
      this.updates.update(list =>
        list.map(u =>
          u.id === progress.command_id
            ? { ...u, status: (progress.status ?? u.status) as UpdateCommand['status'], progress_percent: progress.progress_percent ?? u.progress_percent }
            : u
        )
      );
    }

    if (progress.type === 'rollout_completed' || progress.type === 'rollout_paused' || progress.type === 'rollout_ready') {
      // Refresh rollouts to get latest state
      this.api.getRollouts().subscribe(r => this.rollouts.set(r));
    }
  });

  ngOnInit(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), 30_000);
    this.realtime.subscribe();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.realtime.unsubscribe();
  }

  refresh(): void {
    this.api.getReleases().subscribe(r => this.releases.set(r));
    this.api.getRollouts().subscribe(r => this.rollouts.set(r));
    this.api.getUpdates().subscribe(u => this.updates.set(u));
  }

  rolloutProgress(rollout: RolloutPlan): number {
    if (rollout.total_agents === 0) return 0;
    return Math.round((rollout.completed_agents / rollout.total_agents) * 100);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  startRollout(release: AgentRelease): void {
    this.api.startRollout(release.id).subscribe({
      next: rollout => {
        this.rollouts.update(list => [rollout, ...list]);
        this.snack.open(`Rollout запущен: ${release.agent_type} v${release.version}`, '', { duration: 4000 });
      },
      error: (e) => this.snack.open(e?.error?.message ?? 'Ошибка запуска rollout', '', { duration: 4000 }),
    });
  }

  fleetUpdate(release: AgentRelease): void {
    this.api.fleetUpdate(release.id).subscribe({
      next: result => {
        this.snack.open(`Обновление отправлено ${result.agents_updated} агентам`, '', { duration: 4000 });
        this.refresh();
      },
      error: (e) => this.snack.open(e?.error?.message ?? 'Ошибка fleet update', '', { duration: 4000 }),
    });
  }

  promoteRelease(release: AgentRelease): void {
    this.api.promoteRelease(release.id).subscribe({
      next: () => {
        this.releases.update(list => list.map(r => r.id === release.id ? { ...r, is_stable: true } : r));
        this.snack.open('Релиз помечен как stable', '', { duration: 3000 });
      },
      error: () => this.snack.open('Ошибка', '', { duration: 3000 }),
    });
  }

  advancePhase(rollout: RolloutPlan): void {
    this.api.advanceRollout(rollout.id).subscribe({
      next: updated => {
        this.rollouts.update(list => list.map(r => r.id === rollout.id ? updated : r));
        this.snack.open(`Rollout advanced to ${updated.current_phase}`, '', { duration: 3000 });
      },
      error: (e) => this.snack.open(e?.error?.message ?? 'Ошибка', '', { duration: 3000 }),
    });
  }

  pauseRolloutAction(rollout: RolloutPlan): void {
    this.api.pauseRollout(rollout.id).subscribe({
      next: () => {
        this.rollouts.update(list => list.map(r => r.id === rollout.id ? { ...r, status: 'paused' as const } : r));
        this.snack.open('Rollout приостановлен', '', { duration: 3000 });
      },
      error: () => this.snack.open('Ошибка', '', { duration: 3000 }),
    });
  }

  cancelRolloutAction(rollout: RolloutPlan): void {
    this.api.cancelRollout(rollout.id).subscribe({
      next: () => {
        this.rollouts.update(list => list.map(r => r.id === rollout.id ? { ...r, status: 'cancelled' as const } : r));
        this.snack.open('Rollout отменён', '', { duration: 3000 });
      },
      error: () => this.snack.open('Ошибка', '', { duration: 3000 }),
    });
  }

  rollbackUpdateAction(update: UpdateCommand): void {
    this.api.rollbackUpdate(update.id).subscribe({
      next: result => {
        this.snack.open('Откат запущен', '', { duration: 4000 });
        this.updates.update(list => {
          const updated = list.map(u => u.id === update.id ? { ...u, status: 'rolled_back' as const } : u);
          return [result.rollback_command, ...updated];
        });
      },
      error: (e) => this.snack.open(e?.error?.message ?? 'Ошибка отката', '', { duration: 4000 }),
    });
  }
}
