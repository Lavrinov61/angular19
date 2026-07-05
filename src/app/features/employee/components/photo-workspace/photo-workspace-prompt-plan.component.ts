import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import type { PhotoWorkspaceReadinessDto, PhotoWorkspaceVariantDto } from '../../models/photo-workspace.model';

export interface PhotoWorkspacePromptUpdate {
  variant: PhotoWorkspaceVariantDto;
  manualPrompt: string;
}

@Component({
  selector: 'app-photo-workspace-prompt-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatIconModule],
  template: `
    <section class="pwp-panel">
      <header class="pwp-header">
        <mat-icon>auto_fix_high</mat-icon>
        <h3>Prompt plan</h3>
        <span class="pwp-ready" [class.is-ready]="readiness().promptReady && readiness().blockers.length === 0">
          {{ readiness().promptReady && readiness().blockers.length === 0 ? 'Готов' : blockerLabel() }}
        </span>
      </header>

      <div class="pwp-actions">
        <button mat-stroked-button type="button" (click)="rebuild.emit()">
          <mat-icon>refresh</mat-icon>
          Пересобрать
        </button>
      </div>

      <div class="pwp-list">
        @for (variant of variants(); track variant.id; let idx = $index) {
          <article class="pwp-card">
            <header>
              <mat-checkbox [checked]="variant.enabled" disabled />
              <div>
                <strong>{{ variant.preset_label }}</strong>
                <span>{{ variant.internal_name }}</span>
              </div>
              @if (idx === 0) {
                <em>Пожелания клиента</em>
              }
            </header>
            <p class="pwp-base">{{ variant.base_prompt }}</p>
            <label>
              <span>Дополнить prompt</span>
              <textarea
                rows="3"
                [ngModel]="manualDraft(variant)"
                (ngModelChange)="setManualDraft(variant.id, $event)"></textarea>
            </label>
            <div class="pwp-final" aria-label="Итоговый prompt">{{ variant.final_prompt }}</div>
            <button mat-stroked-button type="button" (click)="saveVariant(variant)">
              <mat-icon>save</mat-icon>
              Сохранить
            </button>
          </article>
        }
        @if (!variants().length) {
          <div class="pwp-empty">Нет вариантов</div>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pwp-panel, .pwp-list, .pwp-card { display: flex; flex-direction: column; }
    .pwp-panel { gap: 10px; }
    .pwp-list { gap: 8px; }
    .pwp-header { display: flex; align-items: center; gap: 7px; }
    .pwp-header mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    h3, p { margin: 0; }
    h3 { font-size: 13px; font-weight: 650; }
    .pwp-ready { margin-left: auto; padding: 3px 8px; border-radius: 999px; color: var(--crm-status-warning); background: var(--crm-status-warning-muted); font-size: 12px; }
    .pwp-ready.is-ready { color: var(--crm-status-success); background: var(--crm-status-success-muted); }
    .pwp-card { gap: 8px; padding: 9px; border-radius: 8px; background: var(--crm-surface-raised); }
    .pwp-card header { display: flex; align-items: center; gap: 8px; }
    .pwp-card strong, .pwp-card span { display: block; }
    .pwp-card span { color: var(--crm-text-muted); font-size: 12px; }
    .pwp-card em { margin-left: auto; color: var(--crm-accent); font-size: 11px; font-style: normal; }
    .pwp-base, .pwp-final { padding: 8px; border-radius: 7px; background: var(--crm-surface-base); font-size: 12px; line-height: 1.35; color: var(--crm-text-secondary); }
    .pwp-final { color: var(--crm-text-primary); }
    label { display: flex; flex-direction: column; gap: 4px; color: var(--crm-text-muted); font-size: 12px; }
    textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--crm-border); border-radius: 8px; background: var(--crm-surface-base); color: var(--crm-text-primary); padding: 8px; font: inherit; }
    .pwp-actions { display: flex; }
    .pwp-empty { color: var(--crm-text-muted); font-size: 12px; padding: 10px; border: 1px dashed var(--crm-border); border-radius: 8px; }
  `],
})
export class PhotoWorkspacePromptPlanComponent {
  readonly variants = input.required<readonly PhotoWorkspaceVariantDto[]>();
  readonly readiness = input.required<PhotoWorkspaceReadinessDto>();
  readonly rebuild = output<void>();
  readonly updatePrompt = output<PhotoWorkspacePromptUpdate>();

  private readonly manualDrafts = signal<ReadonlyMap<string, string>>(new Map());

  manualDraft(variant: PhotoWorkspaceVariantDto): string {
    return this.manualDrafts().get(variant.id) ?? variant.manual_prompt;
  }

  setManualDraft(variantId: string, value: string): void {
    this.manualDrafts.update(current => new Map(current).set(variantId, value));
  }

  saveVariant(variant: PhotoWorkspaceVariantDto): void {
    this.updatePrompt.emit({
      variant,
      manualPrompt: this.manualDraft(variant),
    });
  }

  blockerLabel(): string {
    return this.readiness().blockers.map(blockerLabel).join(', ') || 'Не готов';
  }
}

function blockerLabel(blocker: PhotoWorkspaceReadinessDto['blockers'][number]): string {
  switch (blocker) {
    case 'crop_missing':
      return 'нет кадрирования';
    case 'wish_pending':
      return 'есть неподтвержденные пожелания';
    case 'reference_role_missing':
      return 'у референса нет роли';
    case 'variant_prompt_missing':
      return 'не готов prompt варианта';
    default:
      return blocker;
  }
}
