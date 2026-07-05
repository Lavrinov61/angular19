import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
  PhotoWorkspaceEnvelopeDto,
  PhotoWorkspaceReadinessDto,
  PhotoWorkspaceVariantDto,
} from '../../models/photo-workspace.model';
import {
  canStartInitialAiGeneration,
  photoWorkspaceAiElapsedLabel,
  photoWorkspaceAiProgressLabel,
  photoWorkspaceAiProgressMode,
  photoWorkspaceAiProgressValue,
  type PhotoWorkspaceAiProgressStatus,
} from './photo-workspace-state';

export interface PhotoWorkspaceAiVariantProgressView extends PhotoWorkspaceAiProgressStatus {
  variantId: string;
  itemId: string;
  jobId: string | null;
  detail: string | null;
  startedAtMs: number;
  updatedAtMs: number;
}

@Component({
  selector: 'app-photo-workspace-ai-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <section class="pwai-panel">
      <header class="pwai-header">
        <mat-icon>auto_awesome</mat-icon>
        <h3>AI-варианты</h3>
        <span>{{ generatedCount() }}/{{ enabledVariants().length }}</span>
      </header>

      <div class="pwai-actions">
        <button
          mat-flat-button
          type="button"
          [disabled]="!canRunInitialAi()"
          (click)="runAi.emit()">
          @if (running()) {
            <mat-spinner diameter="16" />
          } @else {
            <mat-icon>play_arrow</mat-icon>
          }
          Сгенерировать варианты
        </button>
        <button
          mat-stroked-button
          type="button"
          [disabled]="!canDownloadArchive() || archiveDownloading()"
          (click)="downloadArchive.emit()"
          matTooltip="Скачать все внутренние AI-файлы одним архивом">
          <mat-icon>folder_zip</mat-icon>
          Скачать все AI-варианты
        </button>
      </div>

      @if (readiness().blockers.length > 0) {
        <div class="pwai-blockers">
          <mat-icon>lock</mat-icon>
          <span>{{ readiness().blockers.join(', ') }}</span>
        </div>
      }

      @if (generationProgress(); as progress) {
        <div class="pwai-run-progress">
          <div>
            <strong>{{ progress.label }}</strong>
            <span>{{ progress.detail }}</span>
          </div>
          <mat-progress-bar mode="determinate" [value]="progress.value" />
        </div>
      }

      <div class="pwai-list">
        @for (variant of variants(); track variant.id) {
          @let progress = progressFor(variant);
          <article class="pwai-card" [class.is-disabled]="!variant.enabled">
            <header>
              <div>
                <strong>{{ variant.preset_label }}</strong>
                <span>{{ variant.internal_name }}</span>
              </div>
              <small [attr.data-status]="progress?.phase || variant.status">
                {{ progress ? progressLabel(progress) : statusLabel(variant.status) }}
              </small>
            </header>

            @if (progress) {
              <div class="pwai-progress">
                <mat-progress-bar [mode]="progressMode(progress)" [value]="progressValue(progress)" />
                <div>
                  <span>{{ progressLabel(progress) }}</span>
                  <small>{{ progress.detail || ('В работе ' + progressElapsed(progress)) }}</small>
                </div>
              </div>
            }

            @if (variant.ai_original_url) {
              <a class="pwai-preview" [href]="variant.ai_original_url" target="_blank" rel="noopener">
                <img [src]="variant.ai_original_thumbnail_url || variant.ai_original_url" [alt]="variant.preset_label" />
              </a>
              <p class="pwai-internal">Внутренний AI-файл, клиенту не отправляется</p>
            } @else if (variant.error_message) {
              <p class="pwai-error">{{ variant.error_message }}</p>
            } @else {
              <div class="pwai-empty">{{ variant.enabled ? statusLabel(variant.status) : 'Отключен' }}</div>
            }

            @if (canRetry(variant)) {
              <button mat-stroked-button type="button" (click)="retryVariant.emit(variant)">
                <mat-icon>refresh</mat-icon>
                Повторить этот вариант
              </button>
            }
          </article>
        }
        @if (!variants().length) {
          <div class="pwai-empty">Нет запланированных вариантов</div>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pwai-panel, .pwai-list, .pwai-card { display: flex; flex-direction: column; }
    .pwai-panel { gap: 10px; }
    .pwai-list { gap: 8px; }
    .pwai-header, .pwai-actions, .pwai-card header, .pwai-blockers { display: flex; align-items: center; gap: 7px; }
    .pwai-header mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    h3 { margin: 0; font-size: 13px; font-weight: 650; }
    .pwai-header span { margin-left: auto; color: var(--crm-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .pwai-actions { flex-wrap: wrap; }
    .pwai-blockers { padding: 7px 8px; border-radius: 8px; color: var(--crm-status-warning); background: var(--crm-status-warning-muted); font-size: 12px; }
    .pwai-blockers mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pwai-card { gap: 8px; padding: 9px; border-radius: 8px; background: var(--crm-surface-raised); }
    .pwai-card.is-disabled { opacity: 0.65; }
    .pwai-card header div { min-width: 0; flex: 1; }
    .pwai-card strong, .pwai-card span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pwai-card strong { font-size: 13px; }
    .pwai-card span { color: var(--crm-text-muted); font-size: 12px; }
    .pwai-card small { padding: 3px 7px; border-radius: 999px; color: var(--crm-text-secondary); background: var(--crm-surface-base); font-size: 11px; }
    .pwai-card small[data-status="ai_generated"] { color: var(--crm-status-success); background: var(--crm-status-success-muted); }
    .pwai-card small[data-status="error"] { color: var(--crm-status-error); background: var(--crm-status-error-muted); }
    .pwai-card small[data-status="generating"],
    .pwai-card small[data-status="submitted"],
    .pwai-card small[data-status="queued"],
    .pwai-card small[data-status="in_progress"],
    .pwai-card small[data-status="fetching_result"] { color: var(--crm-status-info); background: var(--crm-status-info-muted); }
    .pwai-run-progress {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: var(--crm-surface-raised);
    }
    .pwai-run-progress div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .pwai-run-progress strong { font-size: 12px; font-weight: 650; }
    .pwai-run-progress span { color: var(--crm-text-muted); font-size: 11.5px; }
    .pwai-progress {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 7px;
      border-radius: 7px;
      background: var(--crm-surface-base);
    }
    .pwai-progress div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .pwai-progress span, .pwai-progress small {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11.5px;
    }
    .pwai-progress span { color: var(--crm-text-secondary); }
    .pwai-progress small { color: var(--crm-text-muted); font-variant-numeric: tabular-nums; }
    .pwai-preview { display: block; border-radius: 8px; overflow: hidden; background: var(--crm-surface-base); }
    .pwai-preview img { display: block; width: 100%; max-height: 240px; object-fit: contain; }
    .pwai-internal, .pwai-error { margin: 0; font-size: 12px; line-height: 1.35; }
    .pwai-internal { color: var(--crm-text-muted); }
    .pwai-error { color: var(--crm-status-error); }
    .pwai-empty { padding: 10px; border: 1px dashed var(--crm-border); border-radius: 8px; color: var(--crm-text-muted); font-size: 12px; text-align: center; }
  `],
})
export class PhotoWorkspaceAiPanelComponent {
  readonly envelope = input<PhotoWorkspaceEnvelopeDto | null>(null);
  readonly readiness = input.required<PhotoWorkspaceReadinessDto>();
  readonly running = input(false);
  readonly initialRunSubmitted = input(false);
  readonly archiveDownloading = input(false);
  readonly now = input(new Date());
  readonly progressByVariantId = input<ReadonlyMap<string, PhotoWorkspaceAiVariantProgressView>>(new Map());
  readonly runAi = output<void>();
  readonly retryVariant = output<PhotoWorkspaceVariantDto>();
  readonly downloadArchive = output<void>();

  readonly variants = computed(() => this.envelope()?.variants ?? []);
  readonly enabledVariants = computed(() => this.variants().filter(variant => variant.enabled));
  readonly generatedCount = computed(() => this.enabledVariants().filter(variant => !!variant.ai_original_url).length);
  readonly activeProgresses = computed(() =>
    this.enabledVariants()
      .map(variant => this.progressByVariantId().get(variant.id) ?? null)
      .filter((progress): progress is PhotoWorkspaceAiVariantProgressView =>
        !!progress && progress.phase !== 'completed' && progress.phase !== 'failed',
      ),
  );
  readonly generationProgress = computed(() => {
    const enabled = this.enabledVariants();
    const total = enabled.length;
    if (total === 0 || this.activeProgresses().length === 0) return null;

    const finished = enabled.filter(variant => !!variant.ai_original_url).length;
    const value = Math.max(8, Math.min(99, Math.round((finished / total) * 100)));
    return {
      value,
      label: `Генерация ${finished}/${total}`,
      detail: `активно ${this.activeProgresses().length}`,
    };
  });
  readonly canRunInitialAi = computed(() => canStartInitialAiGeneration(
    this.readiness(),
    this.variants(),
    this.running(),
    this.initialRunSubmitted(),
  ));
  readonly canDownloadArchive = computed(() => {
    const enabled = this.enabledVariants();
    return enabled.length > 0 && enabled.every(variant => !!variant.ai_original_url);
  });

  canRetry(variant: PhotoWorkspaceVariantDto): boolean {
    return variant.enabled && (variant.status === 'error' || variant.status === 'stale_after_recrop');
  }

  progressFor(variant: PhotoWorkspaceVariantDto): PhotoWorkspaceAiVariantProgressView | null {
    return this.progressByVariantId().get(variant.id) ?? null;
  }

  progressLabel(progress: PhotoWorkspaceAiVariantProgressView): string {
    return photoWorkspaceAiProgressLabel(progress);
  }

  progressValue(progress: PhotoWorkspaceAiVariantProgressView): number {
    return photoWorkspaceAiProgressValue(progress);
  }

  progressMode(progress: PhotoWorkspaceAiVariantProgressView): 'determinate' | 'indeterminate' {
    return photoWorkspaceAiProgressMode(progress);
  }

  progressElapsed(progress: PhotoWorkspaceAiVariantProgressView): string {
    return photoWorkspaceAiElapsedLabel(this.now(), progress.startedAtMs);
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'planned':
      case 'pending_generation':
        return 'Ожидает генерации';
      case 'generating':
        return 'Генерируется';
      case 'ai_generated':
        return 'AI сгенерировал';
      case 'error':
        return 'Ошибка';
      case 'stale_after_recrop':
        return 'Устарело после нового кадрирования';
      case 'needs_photoshop_check':
      case 'downloaded_for_check':
        return 'Ждет Photoshop';
      case 'photoshop_uploaded':
        return 'Photoshop загружен';
      case 'checked':
        return 'Проверен';
      case 'sent_to_client':
        return 'Отправлен клиенту';
      default:
        return status;
    }
  }
}
