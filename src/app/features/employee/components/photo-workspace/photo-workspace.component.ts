import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { PhotoWorkspaceApiService } from '../../services/photo-workspace-api.service';
import { WebSocketService, type RetouchSocketEvent } from '../../../../core/services/websocket.service';
import type {
  PhotoWorkspaceAssetView,
  PhotoWorkspaceCropPayloadDto,
  PhotoWorkspaceEnvelopeDto,
  PhotoWorkspaceJournalDto,
  PhotoWorkspaceReadinessBlocker,
  PhotoWorkspaceReadinessDto,
  PhotoWorkspaceVariantDto,
} from '../../models/photo-workspace.model';
import {
  canStartInitialAiGeneration,
  initialWorkspaceAssetToCreate,
  notificationCountdownLabel,
  photoWorkspaceAssetKey,
  photoWorkspaceCounters,
  samePhotoWorkspaceAssetUrl,
  type PhotoWorkspaceAiProgressPhase,
} from './photo-workspace-state';
import { PhotoWorkspaceAiPanelComponent, type PhotoWorkspaceAiVariantProgressView } from './photo-workspace-ai-panel.component';
import { PhotoWorkspaceAssetsPanelComponent } from './photo-workspace-assets-panel.component';
import { PhotoWorkspaceCropPanelComponent } from './photo-workspace-crop-panel.component';
import { PhotoWorkspaceJournalComponent } from './photo-workspace-journal.component';
import {
  PhotoWorkspacePhotoshopPanelComponent,
  type PhotoWorkspaceCheckedUpdate,
  type PhotoWorkspacePhotoshopUploadRequest,
} from './photo-workspace-photoshop-panel.component';
import { PhotoWorkspacePromptPlanComponent, type PhotoWorkspacePromptUpdate } from './photo-workspace-prompt-plan.component';
import { PhotoWorkspaceWishesPanelComponent, type PhotoWorkspaceWishCreate, type PhotoWorkspaceWishUpdate } from './photo-workspace-wishes-panel.component';

interface PhotoWorkspaceScheduledNotificationView {
  scheduled_for: string;
}

type PhotoWorkspaceWorkflowTab = 'wishes' | 'prompt' | 'ai' | 'photoshop' | 'journal';

interface PhotoWorkspaceWorkflowTabView {
  id: PhotoWorkspaceWorkflowTab;
  label: string;
  badge: string | null;
  tone: 'neutral' | 'warning' | 'success';
}

@Component({
  selector: 'app-photo-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    PhotoWorkspaceAssetsPanelComponent,
    PhotoWorkspaceAiPanelComponent,
    PhotoWorkspaceCropPanelComponent,
    PhotoWorkspaceJournalComponent,
    PhotoWorkspacePhotoshopPanelComponent,
    PhotoWorkspacePromptPlanComponent,
    PhotoWorkspaceWishesPanelComponent,
  ],
  template: `
    <section class="pw-shell">
      <header class="pw-header">
        <button mat-icon-button type="button" matTooltip="Назад к заказу" (click)="closed.emit()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="pw-title">
          <span class="pw-kicker">Рабочее место</span>
          <h2>Заказ {{ orderNumber() }}</h2>
        </div>
        <div class="pw-counters" aria-label="Статусы рабочего места">
          <span>AI {{ counters().aiDone }}/{{ counters().aiTotal }}</span>
          @if (counters().aiErrors > 0) {
            <span class="is-error">AI {{ counters().aiErrors }}</span>
          }
          <span>PS {{ counters().photoshopWaiting }}</span>
          <span>Готово {{ counters().readyToSend }}</span>
        </div>
        <button mat-icon-button type="button" matTooltip="Обновить" [disabled]="loading()" (click)="refresh()">
          <mat-icon>refresh</mat-icon>
        </button>
      </header>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (error()) {
        <div class="pw-error">
          <mat-icon>error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      }

      @if (scheduledNotification(); as notification) {
        <div class="pw-notification-indicator">
          <mat-icon>notifications</mat-icon>
          <span>Уведомление клиенту через {{ notificationCountdownLabel(now(), notification.scheduled_for) }}</span>
        </div>
      }

      <nav class="pw-tabs" aria-label="Фото заказа">
        @for (envelope of envelopes(); track envelope.item.id; let idx = $index) {
          <button
            type="button"
            class="pw-tab"
            [class.is-active]="activeItemId() === envelope.item.id"
            (click)="activeItemId.set(envelope.item.id)">
            <span>{{ envelope.item.label || ('Фото ' + (idx + 1)) }}</span>
            <small>{{ envelope.variants.length }}</small>
          </button>
        }
        @if (!envelopes().length && initialSourceUrl()) {
          <button type="button" class="pw-tab is-active">
            <span>{{ initialSourceName() || 'Фото 1' }}</span>
            <small>0</small>
          </button>
        }
      </nav>

      <div class="pw-layout">
        <aside class="pw-panel pw-panel--assets">
          <app-photo-workspace-assets-panel
            [assets]="assetViews()"
            [items]="envelopes()"
            [activeItemId]="activeItemId()"
            (makeMain)="makeMain($event)"
            (addReference)="addReference($event)"
            (openAsset)="openAsset($event)" />
        </aside>

        <main class="pw-panel pw-panel--crop">
          <app-photo-workspace-crop-panel
            [envelope]="activeEnvelope()"
            (saveCrop)="saveCrop($event)"
            (runCrop)="runCrop($event)" />
        </main>

        <aside class="pw-panel pw-panel--workflow">
          @if (activeEnvelope(); as envelope) {
            <nav class="pw-workflow-tabs" aria-label="Рабочий процесс фото">
              @for (tab of workflowTabs(); track tab.id) {
                <button
                  type="button"
                  class="pw-workflow-tab"
                  [class.is-active]="activeWorkflowTab() === tab.id"
                  (click)="selectWorkflowTab(tab.id)">
                  <span>{{ tab.label }}</span>
                  @if (tab.badge) {
                    <small [attr.data-tone]="tab.tone">{{ tab.badge }}</small>
                  }
                </button>
              }
            </nav>

            <div class="pw-workflow-body">
              @switch (activeWorkflowTab()) {
                @case ('wishes') {
                  <app-photo-workspace-wishes-panel
                    [wishes]="envelope.wishes"
                    (addWish)="addWish($event)"
                    (update)="updateWish($event)"
                    (importApproval)="importApprovalFeedback()" />
                }
                @case ('prompt') {
                  <app-photo-workspace-prompt-plan
                    [variants]="envelope.variants"
                    [readiness]="activeReadiness()"
                    (rebuild)="rebuildPromptPlan()"
                    (updatePrompt)="updateVariantPrompt($event)" />
                }
                @case ('ai') {
                  <app-photo-workspace-ai-panel
                    [envelope]="envelope"
                    [readiness]="activeReadiness()"
                    [running]="aiRunning()"
                    [initialRunSubmitted]="aiSubmittedItemIds().has(envelope.item.id)"
                    [archiveDownloading]="archiveDownloading()"
                    [now]="now()"
                    [progressByVariantId]="aiProgressByVariantId()"
                    (runAi)="runAi()"
                    (retryVariant)="retryAiVariant($event)"
                    (downloadArchive)="downloadAiArchive()" />
                }
                @case ('photoshop') {
                  <app-photo-workspace-photoshop-panel
                    [envelope]="envelope"
                    [uploadingVariantId]="uploadingVariantId()"
                    [uploadProgress]="uploadProgress()"
                    [sending]="sendingVerified()"
                    (uploadPhotoshop)="uploadPhotoshop($event)"
                    (checkedChange)="setVariantChecked($event)"
                    (sendVerified)="sendVerified()"
                    (deleteApprovalFile)="deleteApprovalFile($event)" />
                }
                @case ('journal') {
                  <app-photo-workspace-journal
                    [entries]="journal()"
                    [loading]="journalLoading()"
                    [error]="journalError()" />
                }
              }
            </div>
          } @else {
            <div class="pw-empty">Нет данных</div>
          }
        </aside>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    .pw-shell {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }

    .pw-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: var(--crm-surface-base);
    }

    .pw-title {
      min-width: 0;
      flex: 1;

      h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 650;
      }
    }

    .pw-kicker {
      display: block;
      color: var(--crm-text-muted);
      font-size: 11px;
      text-transform: uppercase;
    }

    .pw-counters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;

      span {
        padding: 4px 7px;
        border-radius: 6px;
        background: var(--crm-surface-raised);
        color: var(--crm-text-secondary);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      .is-error {
        color: var(--crm-status-error);
        background: var(--crm-status-error-muted);
      }
    }

    .pw-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      color: var(--crm-status-error);
      background: var(--crm-status-error-muted);
      font-size: 13px;
    }

    .pw-notification-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      color: var(--crm-status-warning);
      background: var(--crm-status-warning-muted);
      font-size: 13px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .pw-tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .pw-tab {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid var(--crm-border);
      border-radius: 7px;
      background: var(--crm-surface-base);
      color: var(--crm-text-secondary);
      font: inherit;
      cursor: pointer;

      &.is-active {
        color: var(--crm-accent);
        border-color: var(--crm-accent);
        background: var(--crm-accent-muted);
      }

      small {
        color: var(--crm-text-muted);
        font-variant-numeric: tabular-nums;
      }
    }

    .pw-layout {
      display: grid;
      grid-template-columns: 160px minmax(540px, 2.35fr) minmax(300px, 1fr);
      gap: 8px;
      min-height: 0;
      flex: 1;
      overflow: hidden;
    }

    .pw-panel {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 10px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: var(--crm-surface-base);
    }

    .pw-panel--assets { padding: 8px 6px; }

    .pw-panel--crop {
      display: flex;
      overflow: hidden;
    }

    .pw-panel--workflow {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
    }

    .pw-workflow-tabs {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 4px;
      flex: 0 0 auto;
    }

    .pw-workflow-tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 0;
      min-height: 32px;
      padding: 0 6px;
      border: 1px solid var(--crm-border);
      border-radius: 7px;
      background: var(--crm-surface-raised);
      color: var(--crm-text-secondary);
      font: inherit;
      font-size: 12px;
      cursor: pointer;

      &.is-active {
        border-color: var(--crm-accent);
        color: var(--crm-accent);
        background: var(--crm-accent-muted);
      }

      span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      small {
        flex: 0 0 auto;
        min-width: 16px;
        padding: 1px 5px;
        border-radius: 999px;
        color: var(--crm-text-muted);
        background: var(--crm-surface-base);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }

      small[data-tone="warning"] {
        color: var(--crm-status-warning);
        background: var(--crm-status-warning-muted);
      }

      small[data-tone="success"] {
        color: var(--crm-status-success);
        background: var(--crm-status-success-muted);
      }
    }

    .pw-workflow-body {
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
      padding-right: 2px;
    }

    .pw-empty {
      display: grid;
      place-items: center;
      min-height: 120px;
      color: var(--crm-text-muted);
      font-size: 13px;
      border: 1px dashed var(--crm-border);
      border-radius: 8px;
    }

    @media (max-width: 1180px) {
      .pw-layout {
        grid-template-columns: 136px minmax(460px, 1.7fr) minmax(260px, 0.95fr);
      }
    }

    @media (max-width: 960px) {
      .pw-header {
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .pw-counters {
        width: 100%;
      }

      .pw-layout {
        grid-template-columns: 1fr;
      }

      .pw-panel--crop {
        overflow: auto;
      }

      .pw-workflow-tabs {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `],
})
export class PhotoWorkspaceComponent {
  private readonly api = inject(PhotoWorkspaceApiService);

  readonly orderId = input.required<string>();
  readonly orderNumber = input.required<string>();
  readonly initialSourceUrl = input<string | null>(null);
  readonly initialSourceName = input<string | null>(null);
  readonly chatSessionId = input<string | null>(null);
  readonly closed = output<void>();
  readonly approvalChanged = output<void>();

  readonly envelopes = signal<PhotoWorkspaceEnvelopeDto[]>([]);
  readonly activeItemId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly aiRunning = signal(false);
  readonly aiSubmittedItemIds = signal<ReadonlySet<string>>(new Set());
  readonly aiProgressByVariantId = signal<ReadonlyMap<string, PhotoWorkspaceAiVariantProgressView>>(new Map());
  readonly archiveDownloading = signal(false);
  readonly uploadingVariantId = signal<string | null>(null);
  readonly uploadProgress = signal(0);
  readonly sendingVerified = signal(false);
  readonly journal = signal<PhotoWorkspaceJournalDto[]>([]);
  readonly journalLoading = signal(false);
  readonly journalError = signal<string | null>(null);
  readonly now = signal(new Date());
  private readonly manualWorkflowTab = signal<PhotoWorkspaceWorkflowTab | null>(null);
  private readonly creatingMainAssetUrl = signal<string | null>(null);
  private readonly wsService = inject(WebSocketService);

  readonly activeEnvelope = computed(() => {
    const activeId = this.activeItemId();
    return this.envelopes().find(envelope => envelope.item.id === activeId) ?? this.envelopes()[0] ?? null;
  });

  readonly counters = computed(() => photoWorkspaceCounters(
    this.envelopes().map(envelope => ({
      id: envelope.item.id,
      variants: envelope.variants,
    })),
  ));

  readonly assetViews = computed(() => buildAssetViews(this.envelopes(), this.initialSourceUrl(), this.initialSourceName()));

  readonly activeReadiness = computed<PhotoWorkspaceReadinessDto>(() => {
    const envelope = this.activeEnvelope();
    if (!envelope) return { promptReady: false, blockers: ['crop_missing'] };
    const blockers: PhotoWorkspaceReadinessBlocker[] = [];
    if (!envelope.item.crop_result_url) blockers.push('crop_missing');
    if (envelope.wishes.some(wish => wish.status === 'pending')) blockers.push('wish_pending');
    if (envelope.references.some(reference => reference.use_in_ai && reference.roles.length === 0)) {
      blockers.push('reference_role_missing');
    }
    const enabled = envelope.variants.filter(variant => variant.enabled);
    if (enabled.length === 0 || enabled.some(variant => !variant.prompt_ready)) {
      blockers.push('variant_prompt_missing');
    }
    return { promptReady: blockers.length === 0, blockers };
  });

  readonly scheduledNotification = computed<PhotoWorkspaceScheduledNotificationView | null>(() =>
    scheduledNotificationFromJournal(this.journal(), this.now()),
  );

  readonly workflowTabs = computed<readonly PhotoWorkspaceWorkflowTabView[]>(() => {
    const envelope = this.activeEnvelope();
    const readiness = this.activeReadiness();
    const wishesPending = envelope?.wishes.filter(wish => wish.status === 'pending').length ?? 0;
    const enabledVariants = envelope?.variants.filter(variant => variant.enabled) ?? [];
    const generatedCount = enabledVariants.filter(variant => !!variant.ai_original_url).length;
    const checkedCount = enabledVariants.filter(variant => !!variant.checked_at).length;
    const promptReady = readiness.promptReady && readiness.blockers.length === 0;

    return [
      {
        id: 'wishes',
        label: 'Пожелания',
        badge: wishesPending > 0 ? String(wishesPending) : null,
        tone: wishesPending > 0 ? 'warning' : 'neutral',
      },
      {
        id: 'prompt',
        label: 'Prompt',
        badge: promptReady ? 'ok' : '!',
        tone: promptReady ? 'success' : 'warning',
      },
      {
        id: 'ai',
        label: 'AI',
        badge: enabledVariants.length ? `${generatedCount}/${enabledVariants.length}` : null,
        tone: generatedCount > 0 && generatedCount === enabledVariants.length ? 'success' : 'neutral',
      },
      {
        id: 'photoshop',
        label: 'PS',
        badge: enabledVariants.length ? String(checkedCount) : null,
        tone: checkedCount > 0 ? 'success' : 'neutral',
      },
      {
        id: 'journal',
        label: 'Журнал',
        badge: this.journal().length ? String(this.journal().length) : null,
        tone: 'neutral',
      },
    ];
  });

  private readonly recommendedWorkflowTab = computed<PhotoWorkspaceWorkflowTab>(() => {
    const envelope = this.activeEnvelope();
    if (!envelope) return 'wishes';
    if (envelope.wishes.some(wish => wish.status === 'pending')) return 'wishes';
    if (!this.activeReadiness().promptReady || this.activeReadiness().blockers.length > 0) return 'prompt';

    const enabledVariants = envelope.variants.filter(variant => variant.enabled);
    if (enabledVariants.some(variant => !variant.ai_original_url)) return 'ai';
    if (enabledVariants.some(variant => !!variant.ai_original_url && !variant.checked_at)) return 'photoshop';
    return 'wishes';
  });

  readonly activeWorkflowTab = computed<PhotoWorkspaceWorkflowTab>(() =>
    this.manualWorkflowTab() ?? this.recommendedWorkflowTab(),
  );

  readonly notificationCountdownLabel = notificationCountdownLabel;

  private readonly loadEffect = effect(() => {
    const orderId = this.orderId();
    if (orderId) this.loadWorkspace(orderId);
  });

  private readonly initialSourceCreateEffect = effect(() => {
    const asset = initialWorkspaceAssetToCreate(this.envelopes(), this.initialSourceUrl(), this.initialSourceName());
    if (!asset || this.loading() || this.creatingMainAssetUrl() === asset.url) return;
    untracked(() => this.createMainItem(asset));
  });

  private readonly journalLoadEffect = effect(() => {
    const itemId = this.activeItemId();
    if (itemId) {
      this.loadJournal(itemId);
    } else {
      this.journal.set([]);
    }
  });

  private readonly notificationTickEffect = effect(onCleanup => {
    if ((!this.scheduledNotification() && this.aiProgressByVariantId().size === 0) || typeof window === 'undefined') return;
    const timerId = window.setInterval(() => this.now.set(new Date()), 1000);
    onCleanup(() => window.clearInterval(timerId));
  });

  private readonly photoWorkspaceEventEffect = effect(() => {
    const evt = this.wsService.photoWorkspaceEvent();
    if (!evt || evt.orderId !== this.orderId()) return;
    untracked(() => {
      this.loadWorkspace(this.orderId());
      const itemId = this.activeItemId();
      if (itemId) this.loadJournal(itemId);
    });
  });

  private readonly retouchProgressEffect = effect(() => {
    const evt = this.wsService.retouchEvent();
    const itemId = evt?.workspaceItemId;
    const variantId = evt?.workspaceVariantId;
    if (!evt || !itemId || !variantId) return;
    if (!untracked(() => this.hasWorkspaceVariant(itemId, variantId))) return;

    untracked(() => {
      this.applyRetouchProgress(evt);
      if (evt.event === 'retouch:completed' || evt.event === 'retouch:failed') {
        this.loadWorkspace(this.orderId());
        this.loadJournal(itemId);
      }
    });
  });

  refresh(): void {
    this.loadWorkspace(this.orderId());
  }

  selectWorkflowTab(tab: PhotoWorkspaceWorkflowTab): void {
    this.manualWorkflowTab.set(tab);
  }

  makeMain(asset: PhotoWorkspaceAssetView): void {
    this.createMainItem(asset);
  }

  private createMainItem(asset: PhotoWorkspaceAssetView): void {
    const existing = this.envelopes().find(envelope => samePhotoWorkspaceAssetUrl(envelope.item.source_asset_url, asset.url));
    if (existing) {
      this.activeItemId.set(existing.item.id);
      return;
    }
    if (samePhotoWorkspaceAssetUrl(this.creatingMainAssetUrl(), asset.url)) return;

    this.creatingMainAssetUrl.set(asset.url);
    this.api.createItem(this.orderId(), {
      sourceAssetUrl: asset.url,
      sourceAssetName: asset.name,
      label: asset.name,
      tariffLevel: this.activeEnvelope()?.item.tariff_level === 'super' ? 'super' : 'basic',
    }).subscribe({
      next: response => {
        this.activeItemId.set(response.data.id);
        this.loadWorkspace(this.orderId());
      },
      error: () => {
        this.error.set('Не удалось создать рабочее фото');
        this.creatingMainAssetUrl.set(null);
      },
      complete: () => this.creatingMainAssetUrl.set(null),
    });
  }

  addReference(asset: PhotoWorkspaceAssetView): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.addReference(envelope.item.id, {
      assetUrl: asset.url,
      assetName: asset.name,
      thumbnailUrl: asset.thumbnailUrl,
      source: asset.source,
      roles: [],
      useInAi: false,
    }).subscribe({
      next: response => this.replaceEnvelope(envelope.item.id, current => ({
        ...current,
        references: [...current.references, response.data],
      })),
      error: () => this.error.set('Не удалось добавить референс'),
    });
  }

  openAsset(asset: PhotoWorkspaceAssetView): void {
    if (typeof window === 'undefined') return;
    window.open(asset.url, '_blank', 'noopener');
  }

  saveCrop(payload: PhotoWorkspaceCropPayloadDto): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.saveCrop(envelope.item.id, { cropPayload: payload }).subscribe({
      next: response => {
        this.replaceEnvelope(envelope.item.id, current => ({ ...current, item: response.data }));
        this.loadJournal(envelope.item.id);
      },
      error: () => this.error.set('Не удалось сохранить кадрирование'),
    });
  }

  runCrop(payload: PhotoWorkspaceCropPayloadDto): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.saveCrop(envelope.item.id, { cropPayload: payload }).subscribe({
      next: () => {
        this.api.runCrop(envelope.item.id).subscribe({
          next: response => {
            this.replaceEnvelope(envelope.item.id, current => ({ ...current, item: response.data }));
            this.loadJournal(envelope.item.id);
          },
          error: () => this.error.set('Не удалось выполнить кадрирование'),
        });
      },
      error: () => this.error.set('Не удалось сохранить кадрирование'),
    });
  }

  addWish(wish: PhotoWorkspaceWishCreate): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.addWish(envelope.item.id, {
      sourceType: wish.sourceType,
      sourceId: wish.sourceId,
      sourceLabel: wish.sourceLabel,
      text: wish.text,
    }).subscribe({
      next: response => this.replaceEnvelope(envelope.item.id, current => ({
        ...current,
        wishes: [...current.wishes, response.data],
      })),
      error: () => this.error.set('Не удалось добавить пожелание'),
    });
  }

  updateWish(update: PhotoWorkspaceWishUpdate): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.updateWish(update.wish.id, {
      text: update.wish.text,
      status: update.status,
      rejectReason: update.rejectReason,
    }).subscribe({
      next: response => this.replaceEnvelope(envelope.item.id, current => ({
        ...current,
        wishes: current.wishes.map(wish => wish.id === response.data.id ? response.data : wish),
      })),
      error: () => this.error.set('Не удалось обновить пожелание'),
    });
  }

  importApprovalFeedback(): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.importApprovalFeedback(envelope.item.id).subscribe({
      next: response => {
        this.error.set(null);
        this.replaceEnvelope(envelope.item.id, current => ({
          ...current,
          wishes: [...current.wishes, ...response.data],
        }));
      },
      error: () => this.error.set('Не удалось импортировать пожелания'),
    });
  }

  rebuildPromptPlan(): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.rebuildPromptPlan(envelope.item.id, {
      variantLimit: envelope.item.variant_limit,
      acceptedWishes: envelope.wishes.filter(wish => wish.status === 'accepted').map(wish => wish.text),
      retouchOptions: [],
      documentLabel: envelope.item.document_type,
    }).subscribe({
      next: response => this.replaceEnvelope(envelope.item.id, current => ({ ...current, variants: response.data })),
      error: () => this.error.set('Не удалось пересобрать prompt plan'),
    });
  }

  updateVariantPrompt(update: PhotoWorkspacePromptUpdate): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.updateVariantPrompt(update.variant.id, {
      basePrompt: update.variant.base_prompt,
      manualPrompt: update.manualPrompt,
    }).subscribe({
      next: response => this.replaceEnvelope(envelope.item.id, current => ({
        ...current,
        variants: current.variants.map(variant => variant.id === response.data.id ? response.data : variant),
      })),
      error: () => this.error.set('Не удалось сохранить prompt'),
    });
  }

  runAi(): void {
    const envelope = this.activeEnvelope();
    if (!envelope || !canStartInitialAiGeneration(
      this.activeReadiness(),
      envelope.variants,
      this.aiRunning(),
      this.aiSubmittedItemIds().has(envelope.item.id),
    )) return;
    this.aiRunning.set(true);
    this.aiSubmittedItemIds.update(current => new Set(current).add(envelope.item.id));
    this.queueAiProgressForItem(envelope);
    this.api.runAi(envelope.item.id).subscribe({
      next: () => {
        this.loadWorkspace(this.orderId());
        this.loadJournal(envelope.item.id);
      },
      error: () => {
        this.error.set('Не удалось запустить AI-варианты');
        this.clearAiProgressForItem(envelope.item.id);
        this.aiRunning.set(false);
        this.aiSubmittedItemIds.update(current => {
          const next = new Set(current);
          next.delete(envelope.item.id);
          return next;
        });
      },
      complete: () => this.aiRunning.set(false),
    });
  }

  retryAiVariant(variant: PhotoWorkspaceVariantDto): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.setVariantProgress({
      itemId: envelope.item.id,
      variantId: variant.id,
      jobId: variant.ai_job_id,
      phase: 'queued',
      providerStatus: null,
      detail: 'Повторный запуск',
    });
    this.api.retryAiVariant(variant.id).subscribe({
      next: response => {
        this.replaceVariant(envelope.item.id, response.data);
        this.loadJournal(envelope.item.id);
      },
      error: () => {
        this.clearVariantProgress(variant.id);
        this.error.set('Не удалось повторить AI-вариант');
      },
    });
  }

  downloadAiArchive(): void {
    const envelope = this.activeEnvelope();
    if (!envelope || this.archiveDownloading()) return;
    this.archiveDownloading.set(true);
    this.api.downloadAiArchive(envelope.item.id).subscribe({
      next: blob => {
        downloadBlob(blob, `photo-workspace-${envelope.item.id}-ai.zip`);
        this.loadJournal(envelope.item.id);
      },
      error: () => {
        this.error.set('Не удалось скачать архив AI-вариантов');
        this.archiveDownloading.set(false);
      },
      complete: () => this.archiveDownloading.set(false),
    });
  }

  async uploadPhotoshop(request: PhotoWorkspacePhotoshopUploadRequest): Promise<void> {
    const envelope = this.activeEnvelope();
    if (!envelope || this.uploadingVariantId()) return;
    this.uploadingVariantId.set(request.variant.id);
    this.uploadProgress.set(8);
    this.error.set(null);
    try {
      const presign = await firstValueFrom(this.api.presignPhotoshopUpload(request.file));
      const upload = presign.data.uploads[0];
      if (!upload) throw new Error('Upload target is missing');
      this.uploadProgress.set(20);
      await this.api.uploadPresignedFile(upload.uploadUrl, request.file, percent => {
        this.uploadProgress.set(20 + Math.round(percent * 0.7));
      });
      this.uploadProgress.set(95);

      if (request.mode === 'replace') {
        await firstValueFrom(this.api.replaceApprovalFile(request.variant.id, { s3Key: upload.s3Key }));
        this.loadWorkspace(this.orderId());
      } else {
        const response = await firstValueFrom(this.api.completePhotoshopUpload(request.variant.id, { s3Key: upload.s3Key }));
        this.replaceVariant(envelope.item.id, response.data);
      }
      this.loadJournal(envelope.item.id);
    } catch {
      this.error.set('Не удалось загрузить Photoshop-файл');
    } finally {
      this.uploadingVariantId.set(null);
      this.uploadProgress.set(0);
    }
  }

  setVariantChecked(update: PhotoWorkspaceCheckedUpdate): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.setChecked(update.variant.id, { checked: update.checked }).subscribe({
      next: response => {
        this.replaceVariant(envelope.item.id, response.data);
        this.loadJournal(envelope.item.id);
      },
      error: () => this.error.set('Не удалось обновить проверку варианта'),
    });
  }

  sendVerified(): void {
    const envelope = this.activeEnvelope();
    if (!envelope || this.sendingVerified()) return;
    this.sendingVerified.set(true);
    this.api.sendVerified(envelope.item.id).subscribe({
      next: () => {
        this.loadWorkspace(this.orderId());
        this.loadJournal(envelope.item.id);
      },
      error: () => {
        this.error.set('Не удалось отправить варианты клиенту');
        this.sendingVerified.set(false);
      },
      complete: () => this.sendingVerified.set(false),
    });
  }

  deleteApprovalFile(variant: PhotoWorkspaceVariantDto): void {
    const envelope = this.activeEnvelope();
    if (!envelope) return;
    this.api.deleteApprovalFile(variant.id).subscribe({
      next: () => {
        this.loadWorkspace(this.orderId());
        this.loadJournal(envelope.item.id);
      },
      error: () => this.error.set('Не удалось удалить файл из согласования'),
    });
  }

  private queueAiProgressForItem(envelope: PhotoWorkspaceEnvelopeDto): void {
    for (const variant of envelope.variants) {
      if (!variant.enabled || variant.ai_original_url || !['planned', 'pending_generation'].includes(variant.status)) continue;
      this.setVariantProgress({
        itemId: envelope.item.id,
        variantId: variant.id,
        jobId: variant.ai_job_id,
        phase: 'queued',
        providerStatus: null,
        detail: 'Ожидает запуска',
      });
    }
  }

  private applyRetouchProgress(evt: RetouchSocketEvent): void {
    const itemId = evt.workspaceItemId;
    const variantId = evt.workspaceVariantId;
    if (!itemId || !variantId) return;

    const phase = retouchProgressPhase(evt);
    this.setVariantProgress({
      itemId,
      variantId,
      jobId: evt.jobId,
      phase,
      providerStatus: evt.providerStatus ?? null,
      detail: retouchProgressDetail(evt),
    });
    this.patchVariantAiStatus(itemId, variantId, localVariantStatusForProgress(phase), evt);
  }

  private setVariantProgress(input: {
    itemId: string;
    variantId: string;
    jobId: string | null;
    phase: PhotoWorkspaceAiProgressPhase;
    providerStatus: string | null;
    detail: string | null;
  }): void {
    const nowMs = Date.now();
    this.aiProgressByVariantId.update(current => {
      const previous = current.get(input.variantId);
      const next = new Map(current);
      next.set(input.variantId, {
        itemId: input.itemId,
        variantId: input.variantId,
        jobId: input.jobId ?? previous?.jobId ?? null,
        phase: input.phase,
        providerStatus: input.providerStatus,
        detail: input.detail,
        startedAtMs: previous?.startedAtMs ?? nowMs,
        updatedAtMs: nowMs,
      });
      return next;
    });
  }

  private patchVariantAiStatus(
    itemId: string,
    variantId: string,
    status: string,
    evt?: RetouchSocketEvent,
  ): void {
    this.replaceEnvelope(itemId, current => ({
      ...current,
      variants: current.variants.map(variant => variant.id === variantId
        ? {
            ...variant,
            status,
            ai_job_id: evt?.jobId ?? variant.ai_job_id,
            error_message: status === 'error'
              ? evt?.error ?? evt?.providerError ?? variant.error_message
              : variant.error_message,
          }
        : variant),
    }));
  }

  private clearAiProgressForItem(itemId: string): void {
    this.aiProgressByVariantId.update(current => {
      const next = new Map(current);
      for (const progress of current.values()) {
        if (progress.itemId === itemId) next.delete(progress.variantId);
      }
      return next;
    });
  }

  private clearVariantProgress(variantId: string): void {
    this.aiProgressByVariantId.update(current => {
      const next = new Map(current);
      next.delete(variantId);
      return next;
    });
  }

  private pruneAiProgress(envelopes: readonly PhotoWorkspaceEnvelopeDto[]): void {
    const finished = new Set<string>();
    for (const envelope of envelopes) {
      for (const variant of envelope.variants) {
        if (variant.ai_original_url || FINISHED_AI_PROGRESS_STATUSES.has(variant.status)) {
          finished.add(variant.id);
        }
      }
    }
    if (finished.size === 0) return;

    this.aiProgressByVariantId.update(current => {
      const next = new Map(current);
      for (const variantId of finished) next.delete(variantId);
      return next;
    });
  }

  private hasWorkspaceVariant(itemId: string, variantId: string): boolean {
    return this.envelopes().some(envelope =>
      envelope.item.id === itemId && envelope.variants.some(variant => variant.id === variantId),
    );
  }

  private loadWorkspace(orderId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getOrderWorkspace(orderId).subscribe({
      next: (response) => {
        this.envelopes.set(response.data);
        this.pruneAiProgress(response.data);
        const currentId = this.activeItemId();
        const nextActive = response.data.find(envelope => envelope.item.id === currentId)?.item.id
          ?? response.data[0]?.item.id
          ?? null;
        this.activeItemId.set(nextActive);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Не удалось загрузить рабочее место');
        this.loading.set(false);
      },
    });
  }

  private replaceEnvelope(itemId: string, updater: (envelope: PhotoWorkspaceEnvelopeDto) => PhotoWorkspaceEnvelopeDto): void {
    this.envelopes.update(current => current.map(envelope => envelope.item.id === itemId ? updater(envelope) : envelope));
  }

  private replaceVariant(itemId: string, variant: PhotoWorkspaceVariantDto): void {
    this.replaceEnvelope(itemId, current => ({
      ...current,
      variants: current.variants.map(item => item.id === variant.id ? variant : item),
    }));
  }

  private loadJournal(itemId: string): void {
    this.journalLoading.set(true);
    this.journalError.set(null);
    this.api.getJournal(itemId).subscribe({
      next: response => {
        this.journal.set([...response.data].sort(compareJournalNewestFirst));
        this.journalLoading.set(false);
      },
      error: () => {
        this.journal.set([]);
        this.journalError.set('Журнал пока недоступен');
        this.journalLoading.set(false);
      },
    });
  }
}

const FINISHED_AI_PROGRESS_STATUSES = new Set<string>([
  'needs_photoshop_check',
  'downloaded_for_check',
  'photoshop_uploaded',
  'checked',
  'sent_to_client',
  'error',
]);

function retouchProgressPhase(evt: RetouchSocketEvent): PhotoWorkspaceAiProgressPhase {
  if (evt.event === 'retouch:failed' || evt.providerStatus === 'FAILED') return 'failed';
  if (evt.event === 'retouch:completed') return 'completed';

  switch (evt.providerStatus) {
    case 'SUBMITTED':
      return 'submitted';
    case 'IN_QUEUE':
      return 'queued';
    case 'IN_PROGRESS':
      return 'in_progress';
    case 'COMPLETED':
      return 'fetching_result';
    default:
      return 'in_progress';
  }
}

function retouchProgressDetail(evt: RetouchSocketEvent): string | null {
  if (typeof evt.providerQueuePosition === 'number') return `позиция ${evt.providerQueuePosition}`;
  if (evt.providerLogMessage) return evt.providerLogMessage;
  if (evt.providerStatus === 'COMPLETED') return 'fal.ai завершил, скачиваем результат';
  if (evt.event === 'retouch:failed') return evt.error ?? evt.providerError ?? 'Ошибка AI-сервиса';
  if (evt.currentOperation && evt.totalOperations) return `операция ${evt.currentOperation}/${evt.totalOperations}`;
  return null;
}

function localVariantStatusForProgress(phase: PhotoWorkspaceAiProgressPhase): string {
  switch (phase) {
    case 'completed':
      return 'needs_photoshop_check';
    case 'failed':
      return 'error';
    default:
      return 'generating';
  }
}

function buildAssetViews(
  envelopes: readonly PhotoWorkspaceEnvelopeDto[],
  initialSourceUrl: string | null,
  initialSourceName: string | null,
): PhotoWorkspaceAssetView[] {
  const out: PhotoWorkspaceAssetView[] = [];
  const seen = new Set<string>();
  const push = (asset: PhotoWorkspaceAssetView): void => {
    const key = photoWorkspaceAssetKey(asset.url);
    if (!asset.url || !key || seen.has(key)) return;
    seen.add(key);
    out.push(asset);
  };

  if (initialSourceUrl) {
    push({
      id: 'initial-source',
      url: initialSourceUrl,
      name: initialSourceName || 'Фото',
      source: 'order',
      thumbnailUrl: null,
    });
  }

  for (const envelope of envelopes) {
    push({
      id: `item-${envelope.item.id}`,
      url: envelope.item.source_asset_url,
      name: envelope.item.source_asset_name,
      source: 'workspace',
      thumbnailUrl: envelope.item.crop_result_thumbnail_url,
    });
    for (const reference of envelope.references) {
      push({
        id: `ref-${reference.id}`,
        url: reference.asset_url,
        name: reference.asset_name,
        source: reference.source === 'approval' || reference.source === 'chat' ? reference.source : 'order',
        thumbnailUrl: reference.thumbnail_url,
      });
    }
  }

  return out;
}

function compareJournalNewestFirst(left: PhotoWorkspaceJournalDto, right: PhotoWorkspaceJournalDto): number {
  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

function scheduledNotificationFromJournal(
  journal: readonly PhotoWorkspaceJournalDto[],
  now: Date,
): PhotoWorkspaceScheduledNotificationView | null {
  const scheduled = journal.find(entry => entry.event_type === 'client_notification_scheduled');
  if (!scheduled) return null;
  const sent = journal.find(entry => entry.event_type === 'client_notification_sent');
  if (sent && new Date(sent.created_at).getTime() >= new Date(scheduled.created_at).getTime()) return null;

  const explicitScheduledFor = stringField(scheduled.payload, 'scheduled_for') ?? stringField(scheduled.payload, 'scheduledFor');
  const scheduledFor = explicitScheduledFor ?? new Date(new Date(scheduled.created_at).getTime() + 5 * 60 * 1000).toISOString();
  if (new Date(scheduledFor).getTime() <= now.getTime()) return null;
  return { scheduled_for: scheduledFor };
}

function stringField(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
