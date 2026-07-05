import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { forkJoin, switchMap } from 'rxjs';

import {
  KnowledgeBaseService,
  KBEntity,
  KBRelationExpanded,
  KBEntityVersion,
  KBNeighborNode,
} from '../../services/knowledge-base.service';

const TYPE_LABELS: Record<string, string> = {
  service: 'Услуга', equipment: 'Оборудование', location: 'Локация',
  person: 'Человек', competitor: 'Конкурент', process: 'Процесс',
  faq: 'FAQ', usp: 'УТП', content: 'Контент',
  market_insight: 'Инсайт', product: 'Товар', brand_asset: 'Бренд-актив',
};

const TYPE_ICONS: Record<string, string> = {
  service: 'camera_alt', equipment: 'build', location: 'location_on',
  person: 'person', competitor: 'analytics', process: 'account_tree',
  faq: 'help', usp: 'emoji_events', content: 'edit_note',
  market_insight: 'trending_up', product: 'inventory_2', brand_asset: 'palette',
};

interface KbScreenshot {
  readonly src: string;
  readonly alt: string;
  readonly caption: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readScreenshotMetadata(metadata: Record<string, unknown>): KbScreenshot[] {
  const screenshots = metadata['screenshots'];
  if (!Array.isArray(screenshots)) {
    return [];
  }

  return screenshots.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const src = item['src'];
    const alt = item['alt'];
    const caption = item['caption'];
    if (typeof src !== 'string' || src.length === 0) {
      return [];
    }

    return [{
      src,
      alt: typeof alt === 'string' ? alt : '',
      caption: typeof caption === 'string' ? caption : '',
    }];
  });
}

@Component({
  selector: 'app-kb-entity-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatTooltipModule,
    MatChipsModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatMenuModule,
  ],
  template: `
    <div class="kbd-container">
      @if (loading()) {
        <div class="kbd-loading"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (error()) {
        <div class="kbd-error">
          <mat-icon>cloud_off</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button routerLink="/employee/knowledge">Назад к списку</button>
        </div>
      } @else if (entity()) {
        <!-- Header -->
        <header class="kbd-header">
          <button class="kbd-back" routerLink="/employee/knowledge">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="kbd-header__main">
            <div class="kbd-header__type">
              <mat-icon>{{ getIcon(entity()!.entity_type) }}</mat-icon>
              <span>{{ getLabel(entity()!.entity_type) }}</span>
              <span class="kbd-header__status" [attr.data-status]="entity()!.status">
                {{ entity()!.status }}
              </span>
              @if (entity()!.is_verified) {
                <mat-icon class="kbd-verified" matTooltip="Верифицировано">verified</mat-icon>
              }
            </div>
            <h1 class="kbd-title">{{ entity()!.name }}</h1>
            @if (entity()!.summary) {
              <p class="kbd-summary">{{ entity()!.summary }}</p>
            }
            <div class="kbd-meta">
              <span>v{{ entity()!.version }}</span>
              <span>•</span>
              <span>{{ entity()!.source_type }}</span>
              <span>•</span>
              <span>confidence {{ (entity()!.confidence * 100).toFixed(0) }}%</span>
              <span>•</span>
              <span>{{ entity()!.visibility }}</span>
            </div>
          </div>
          <div class="kbd-header__actions">
            @if (!entity()!.is_verified) {
              <button mat-stroked-button (click)="verify()">
                <mat-icon>verified</mat-icon> Верифицировать
              </button>
            }
            <button mat-icon-button [matMenuTriggerFor]="entityMenu">
              <mat-icon>more_vert</mat-icon>
            </button>
            <mat-menu #entityMenu="matMenu">
              <button mat-menu-item (click)="embedEntity()">
                <mat-icon>auto_fix_high</mat-icon> Сгенерировать embedding
              </button>
              <button mat-menu-item (click)="archiveEntity()">
                <mat-icon>archive</mat-icon> Архивировать
              </button>
            </mat-menu>
          </div>
        </header>

        <!-- Tags -->
        @if (entity()!.tags.length) {
          <div class="kbd-tags">
            @for (tag of entity()!.tags; track tag) {
              <span class="kbd-tag">{{ tag }}</span>
            }
          </div>
        }

        <!-- Tabs -->
        <mat-tab-group class="kbd-tabs" animationDuration="0ms">
          <!-- Content -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>article</mat-icon> Контент
            </ng-template>
            <div class="kbd-tab-content">
              @if (entity()!.content) {
                <div class="kbd-content-text">{{ entity()!.content }}</div>
                @if (screenshots().length) {
                  <div class="kbd-screenshots" aria-label="Скриншоты инструкции">
                    @for (shot of screenshots(); track shot.src) {
                      <figure class="kbd-screenshot">
                        <img [src]="shot.src" [alt]="shot.alt" loading="lazy">
                        @if (shot.caption) {
                          <figcaption>{{ shot.caption }}</figcaption>
                        }
                      </figure>
                    }
                  </div>
                }
              } @else {
                <div class="kbd-empty">Контент не заполнен</div>
              }
            </div>
          </mat-tab>

          <!-- Metadata -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>data_object</mat-icon> Метаданные
            </ng-template>
            <div class="kbd-tab-content">
              <div class="kbd-metadata">
                @for (entry of metadataEntries(); track entry.key) {
                  <div class="kbd-meta-row">
                    <span class="kbd-meta-row__key">{{ entry.key }}</span>
                    <span class="kbd-meta-row__value">{{ entry.value }}</span>
                  </div>
                }
                @empty {
                  <div class="kbd-empty">Нет метаданных</div>
                }
              </div>
            </div>
          </mat-tab>

          <!-- Relations -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>link</mat-icon> Связи ({{ relations().length }})
            </ng-template>
            <div class="kbd-tab-content">
              @for (rel of relations(); track rel.id) {
                <div class="kbd-relation">
                  <div class="kbd-relation__type">{{ rel.relation_type }}</div>
                  <div class="kbd-relation__arrow">
                    @if (rel.bidirectional) {
                      ↔
                    } @else if (rel.from_id === entity()!.id) {
                      →
                    } @else {
                      ←
                    }
                  </div>
                  <div
                    class="kbd-relation__entity"
                    tabindex="0" role="button" (click)="navigateTo(rel.from_id === entity()!.id ? rel.to_id : rel.from_id)" (keydown.enter)="navigateTo(rel.from_id === entity()!.id ? rel.to_id : rel.from_id)"
                  >
                    <mat-icon>{{ getIcon(rel.from_id === entity()!.id ? rel.to_type : rel.from_type) }}</mat-icon>
                    <span>{{ rel.from_id === entity()!.id ? rel.to_name : rel.from_name }}</span>
                  </div>
                  <span class="kbd-relation__weight">{{ rel.weight }}</span>
                </div>
              } @empty {
                <div class="kbd-empty">Нет связей</div>
              }

              @if (neighbors().length) {
                <h3 class="kbd-subsection">Расширенный граф (2 уровня)</h3>
                @for (n of neighbors(); track n.id) {
                  <div class="kbd-neighbor" tabindex="0" role="button" (click)="navigateTo(n.id)" (keydown.enter)="navigateTo(n.id)">
                    <span class="kbd-neighbor__depth">L{{ n.depth }}</span>
                    <mat-icon>{{ getIcon(n.entity_type) }}</mat-icon>
                    <span class="kbd-neighbor__name">{{ n.name }}</span>
                    <span class="kbd-neighbor__rel">{{ n.relation_type }}</span>
                  </div>
                }
              }
            </div>
          </mat-tab>

          <!-- Versions -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>history</mat-icon> История ({{ versions().length }})
            </ng-template>
            <div class="kbd-tab-content">
              @for (v of versions(); track v.id) {
                <div class="kbd-version">
                  <div class="kbd-version__badge">v{{ v.version }}</div>
                  <div class="kbd-version__info">
                    <span class="kbd-version__type" [attr.data-type]="v.change_type">{{ v.change_type }}</span>
                    <span class="kbd-version__name">{{ v.name }}</span>
                    @if (v.change_reason) {
                      <span class="kbd-version__reason">{{ v.change_reason }}</span>
                    }
                  </div>
                  <span class="kbd-version__date">{{ formatDate(v.created_at) }}</span>
                </div>
              } @empty {
                <div class="kbd-empty">Нет истории изменений</div>
              }
            </div>
          </mat-tab>
        </mat-tab-group>
      } @else {
        <div class="kbd-empty">
          <mat-icon>error_outline</mat-icon>
          <span>Запись не найдена</span>
          <a routerLink="/employee/knowledge">← Назад</a>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .kbd-container {
      height: 100%;
      overflow-y: auto;
      background: #0c0b09;
      color: #e8e4dc;
    }

    .kbd-loading { display: flex; justify-content: center; padding: 80px 0; }
    .kbd-error {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 80px 0; color: rgba(239,68,68,0.7); font-size: 14px;
    }
    .kbd-error mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.5; }
    .kbd-error p { margin: 0; max-width: 400px; text-align: center; }

    .kbd-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: 20px 24px;
      border-bottom: 1px solid rgba(245,158,11,0.15);
    }

    .kbd-back {
      background: none;
      border: none;
      color: rgba(232,228,220,0.5);
      cursor: pointer;
      padding: 6px;
      border-radius: 8px;
      margin-top: 4px;
    }
    .kbd-back:hover { background: rgba(255,255,255,0.05); }

    .kbd-header__main { flex: 1; }

    .kbd-header__type {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: rgba(232,228,220,0.4);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .kbd-header__type mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .kbd-header__status {
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 600;
    }
    .kbd-header__status[data-status="active"] { background: rgba(34,197,94,0.12); color: #22c55e; }
    .kbd-header__status[data-status="draft"] { background: rgba(148,163,184,0.12); color: #94a3b8; }
    .kbd-header__status[data-status="review"] { background: rgba(245,158,11,0.12); color: #f59e0b; }

    .kbd-verified { color: #22c55e; font-size: 16px !important; }

    .kbd-title {
      font-family: 'Oswald', sans-serif;
      font-weight: 600;
      font-size: 26px;
      letter-spacing: 0.02em;
      margin: 0;
      color: #f59e0b;
    }

    .kbd-summary { font-size: 14px; color: rgba(232,228,220,0.7); margin: 6px 0 0; line-height: 1.5; }

    .kbd-meta {
      display: flex;
      gap: 6px;
      font-size: 11px;
      color: rgba(232,228,220,0.3);
      margin-top: 8px;
    }

    .kbd-header__actions { display: flex; gap: 8px; align-items: center; }

    .kbd-tags {
      display: flex;
      gap: 6px;
      padding: 10px 24px;
      flex-wrap: wrap;
    }
    .kbd-tag {
      padding: 3px 10px;
      border-radius: 8px;
      background: rgba(245,158,11,0.1);
      color: #f59e0b;
      font-size: 12px;
    }

    .kbd-tabs {
      --mdc-tab-indicator-active-indicator-color: #f59e0b;
      --mat-tab-header-active-label-text-color: #f59e0b;
      --mat-tab-header-inactive-label-text-color: rgba(232,228,220,0.5);
    }

    .kbd-tab-content { padding: 20px 24px; }

    .kbd-content-text {
      font-size: 14px;
      line-height: 1.7;
      white-space: pre-wrap;
      color: rgba(232,228,220,0.8);
    }

    .kbd-screenshots {
      display: grid;
      gap: 14px;
      margin-top: 20px;
    }

    .kbd-screenshot {
      margin: 0;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(255,255,255,0.03);
    }

    .kbd-screenshot img {
      display: block;
      width: 100%;
      height: auto;
      background: #050504;
    }

    .kbd-screenshot figcaption {
      padding: 8px 10px;
      border-top: 1px solid rgba(255,255,255,0.06);
      color: rgba(232,228,220,0.55);
      font-size: 12px;
      line-height: 1.4;
    }

    .kbd-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px 0;
      color: rgba(232,228,220,0.3);
      font-size: 13px;
    }

    /* Metadata */
    .kbd-meta-row {
      display: flex;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .kbd-meta-row__key {
      font-size: 12px;
      color: rgba(232,228,220,0.4);
      min-width: 180px;
      font-family: monospace;
    }
    .kbd-meta-row__value {
      font-size: 13px;
      word-break: break-word;
    }

    /* Relations */
    .kbd-relation {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .kbd-relation__type {
      font-size: 11px;
      text-transform: uppercase;
      color: rgba(232,228,220,0.4);
      min-width: 120px;
      font-weight: 600;
    }
    .kbd-relation__arrow { font-size: 16px; color: #f59e0b; }
    .kbd-relation__entity {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 8px;
      transition: background 0.15s;
    }
    .kbd-relation__entity:hover { background: rgba(245,158,11,0.05); }
    .kbd-relation__entity mat-icon { font-size: 16px; width: 16px; height: 16px; color: rgba(232,228,220,0.4); }
    .kbd-relation__weight { font-size: 11px; color: rgba(232,228,220,0.3); }

    .kbd-subsection {
      font-family: 'Oswald', sans-serif;
      font-size: 13px;
      text-transform: uppercase;
      color: rgba(232,228,220,0.4);
      margin: 20px 0 10px;
      letter-spacing: 0.03em;
    }

    .kbd-neighbor {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .kbd-neighbor:hover { background: rgba(245,158,11,0.03); }
    .kbd-neighbor__depth {
      font-size: 10px;
      font-weight: 700;
      color: #f59e0b;
      background: rgba(245,158,11,0.1);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .kbd-neighbor mat-icon { font-size: 16px; color: rgba(232,228,220,0.3); }
    .kbd-neighbor__name { flex: 1; font-size: 13px; }
    .kbd-neighbor__rel { font-size: 11px; color: rgba(232,228,220,0.3); }

    /* Versions */
    .kbd-version {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .kbd-version__badge {
      font-size: 11px;
      font-weight: 700;
      color: #f59e0b;
      background: rgba(245,158,11,0.1);
      padding: 3px 8px;
      border-radius: 6px;
      min-width: 36px;
      text-align: center;
    }
    .kbd-version__info { flex: 1; }
    .kbd-version__type {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
      margin-right: 8px;
    }
    .kbd-version__type[data-type="create"] { color: #22c55e; }
    .kbd-version__type[data-type="update"] { color: #3b82f6; }
    .kbd-version__type[data-type="verify"] { color: #f59e0b; }
    .kbd-version__name { font-size: 13px; }
    .kbd-version__reason { display: block; font-size: 11px; color: rgba(232,228,220,0.4); margin-top: 2px; }
    .kbd-version__date { font-size: 11px; color: rgba(232,228,220,0.3); }
  `],
})
export class KbEntityDetailComponent implements OnInit {
  private readonly kb = inject(KnowledgeBaseService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly entity = signal<KBEntity | null>(null);
  readonly relations = signal<KBRelationExpanded[]>([]);
  readonly versions = signal<KBEntityVersion[]>([]);
  readonly neighbors = signal<KBNeighborNode[]>([]);
  readonly metadataEntries = signal<{ key: string; value: string }[]>([]);
  readonly screenshots = signal<KbScreenshot[]>([]);

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap(params => {
        const slug = params.get('slug')!;
        this.loading.set(true);
        return this.kb.getEntity(slug);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: entity => {
        this.entity.set(entity);
        this.loading.set(false);
        this.parseMetadata(entity.metadata);
        this.loadRelated(entity.id);
      },
      error: () => {
        this.entity.set(null);
        this.loading.set(false);
        this.error.set('Не удалось загрузить запись. Проверьте, что KB API запущен.');
      },
    });
  }

  private loadRelated(id: string): void {
    forkJoin({
      relations: this.kb.getEntityRelations(id),
      versions: this.kb.getEntityVersions(id),
      neighbors: this.kb.getNeighbors(id, { max_depth: 2 }),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ relations, versions, neighbors }) => {
        this.relations.set(relations);
        this.versions.set(versions);
        this.neighbors.set(neighbors);
      },
    });
  }

  private parseMetadata(metadata: Record<string, unknown>): void {
    const entries = Object.entries(metadata)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([key, value]) => ({
        key,
        value: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
      }));
    this.metadataEntries.set(entries);
    this.screenshots.set(readScreenshotMetadata(metadata));
  }

  verify(): void {
    const e = this.entity();
    if (!e) return;
    this.kb.verifyEntity(e.id).subscribe({
      next: updated => {
        this.entity.set(updated);
        this.snack.open('Запись верифицирована', '', { duration: 2000 });
      },
      error: () => this.snack.open('Ошибка верификации', '', { duration: 2000 }),
    });
  }

  embedEntity(): void {
    const e = this.entity();
    if (!e) return;
    this.kb.createEnrichmentTask({ entity_slug: e.slug, task_type: 'embed', priority: 3 }).subscribe({
      next: () => this.snack.open('Embedding задача создана', '', { duration: 2000 }),
      error: () => this.snack.open('Ошибка', '', { duration: 2000 }),
    });
  }

  archiveEntity(): void {
    const e = this.entity();
    if (!e) return;
    this.kb.updateEntity(e.slug, { status: 'archived' }).subscribe({
      next: updated => {
        this.entity.set(updated);
        this.snack.open('Запись архивирована', '', { duration: 2000 });
      },
    });
  }

  navigateTo(id: string): void {
    this.router.navigate(['/employee/knowledge', id]);
  }

  getLabel(type: string): string { return TYPE_LABELS[type] ?? type; }
  getIcon(type: string): string { return TYPE_ICONS[type] ?? 'article'; }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('ru-RU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
