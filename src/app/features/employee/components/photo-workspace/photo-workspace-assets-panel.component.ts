import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { PhotoWorkspaceAssetView, PhotoWorkspaceEnvelopeDto } from '../../models/photo-workspace.model';

@Component({
  selector: 'app-photo-workspace-assets-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <section class="pwa-panel">
      <header class="pwa-header">
        <mat-icon>photo_library</mat-icon>
        <h3>Активы</h3>
      </header>

      <div class="pwa-section">
        <h4>Основные фото</h4>
        <div class="pwa-list">
          @for (asset of mainAssets(); track asset.id) {
            <div class="pwa-row" [class.is-active]="isActiveSource(asset)">
              <button type="button" class="pwa-thumb" (click)="openAsset.emit(asset)">
                <img [src]="asset.thumbnailUrl || asset.url" [alt]="asset.name" />
              </button>
              <div class="pwa-info">
                <strong>{{ asset.name }}</strong>
                <span>{{ sourceLabel(asset.source) }}</span>
              </div>
              <div class="pwa-actions">
                <button mat-icon-button type="button" matTooltip="Сделать основным" (click)="makeMain.emit(asset)">
                  <mat-icon>stars</mat-icon>
                </button>
              </div>
            </div>
          }
          @if (!mainAssets().length) {
            <div class="pwa-empty">Нет основных фото</div>
          }
        </div>
      </div>

      <div class="pwa-section">
        <h4>Доступные файлы</h4>
        <div class="pwa-list">
          @for (asset of assets(); track asset.id) {
            <div class="pwa-row">
              <button type="button" class="pwa-thumb" (click)="openAsset.emit(asset)">
                <img [src]="asset.thumbnailUrl || asset.url" [alt]="asset.name" />
              </button>
              <div class="pwa-info">
                <strong>{{ asset.name }}</strong>
                <span>{{ sourceLabel(asset.source) }}</span>
              </div>
              <div class="pwa-actions">
                <button
                  mat-icon-button
                  type="button"
                  matTooltip="Сделать основным фото"
                  [disabled]="isMainSource(asset)"
                  (click)="makeMain.emit(asset)">
                  <mat-icon>stars</mat-icon>
                </button>
                <button
                  mat-icon-button
                  type="button"
                  matTooltip="Референс к активному фото"
                  [disabled]="!activeItemId() || isActiveSource(asset)"
                  (click)="addReference.emit(asset)">
                  <mat-icon>add_link</mat-icon>
                </button>
                <button mat-icon-button type="button" matTooltip="Открыть" (click)="openAsset.emit(asset)">
                  <mat-icon>open_in_new</mat-icon>
                </button>
              </div>
            </div>
          }
          @if (!assets().length) {
            <div class="pwa-empty">Нет файлов</div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 0; height: 100%; }
    .pwa-panel { display: flex; flex-direction: column; gap: 12px; min-height: 0; height: 100%; overflow: hidden; }
    .pwa-header { display: flex; align-items: center; gap: 7px; }
    .pwa-header mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    h3, h4 { margin: 0; }
    h3 { font-size: 13px; font-weight: 650; }
    h4 { color: var(--crm-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .pwa-section { display: flex; flex-direction: column; gap: 7px; min-height: 0; }
    .pwa-list { display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow: auto; }
    .pwa-row {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      align-items: center;
      gap: 6px;
      padding: 6px;
      border-radius: 8px;
      background: var(--crm-surface-raised);
      border: 1px solid transparent;
    }
    .pwa-row.is-active { border-color: var(--crm-accent); }
    .pwa-thumb { width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px; overflow: hidden; background: transparent; cursor: pointer; }
    .pwa-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pwa-info { min-width: 0; }
    .pwa-info strong, .pwa-info span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pwa-info strong { font-size: 12.5px; }
    .pwa-info span { color: var(--crm-text-muted); font-size: 11.5px; }
    .pwa-actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 2px;
      min-width: 0;
    }
    .pwa-actions button {
      width: 30px;
      height: 30px;
      padding: 0;
    }
    .pwa-actions mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pwa-empty { padding: 14px; border: 1px dashed var(--crm-border); border-radius: 8px; color: var(--crm-text-muted); text-align: center; font-size: 12px; }
  `],
})
export class PhotoWorkspaceAssetsPanelComponent {
  readonly assets = input.required<readonly PhotoWorkspaceAssetView[]>();
  readonly items = input.required<readonly PhotoWorkspaceEnvelopeDto[]>();
  readonly activeItemId = input<string | null>(null);
  readonly makeMain = output<PhotoWorkspaceAssetView>();
  readonly addReference = output<PhotoWorkspaceAssetView>();
  readonly openAsset = output<PhotoWorkspaceAssetView>();

  readonly mainAssets = computed(() => this.items().map(envelope => ({
    id: `item-source-${envelope.item.id}`,
    url: envelope.item.source_asset_url,
    name: envelope.item.label || envelope.item.source_asset_name,
    source: 'workspace' as const,
    thumbnailUrl: envelope.item.crop_result_thumbnail_url,
  })));

  isActiveSource(asset: PhotoWorkspaceAssetView): boolean {
    const active = this.items().find(envelope => envelope.item.id === this.activeItemId());
    return active?.item.source_asset_url === asset.url;
  }

  isMainSource(asset: PhotoWorkspaceAssetView): boolean {
    return this.items().some(envelope => envelope.item.source_asset_url === asset.url);
  }

  sourceLabel(source: PhotoWorkspaceAssetView['source']): string {
    switch (source) {
      case 'chat': return 'Чат';
      case 'approval': return 'Согласование';
      case 'workspace': return 'Основное';
      default: return 'Заказ';
    }
  }
}
