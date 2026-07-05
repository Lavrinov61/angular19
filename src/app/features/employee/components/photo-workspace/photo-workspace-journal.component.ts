import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { PhotoWorkspaceJournalDto } from '../../models/photo-workspace.model';

@Component({
  selector: 'app-photo-workspace-journal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule],
  template: `
    <section class="pwj-panel">
      <header class="pwj-header">
        <mat-icon>history</mat-icon>
        <h3>Журнал</h3>
      </header>

      @if (loading()) {
        <div class="pwj-empty">Загрузка...</div>
      } @else if (error()) {
        <div class="pwj-error">
          <mat-icon>error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      } @else {
        <div class="pwj-list">
          @for (entry of entries(); track entry.id) {
            <article class="pwj-row">
              <mat-icon>{{ eventIcon(entry.event_type) }}</mat-icon>
              <div>
                <strong>{{ eventLabel(entry.event_type) }}</strong>
                <span>{{ entry.created_at | date:'dd.MM HH:mm' }} · {{ entry.actor_id || 'system' }}</span>
                @if (payloadSummary(entry)) {
                  <p>{{ payloadSummary(entry) }}</p>
                }
              </div>
            </article>
          }
          @if (!entries().length) {
            <div class="pwj-empty">Журнал пуст</div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pwj-panel, .pwj-list { display: flex; flex-direction: column; }
    .pwj-panel { gap: 10px; }
    .pwj-list { gap: 7px; }
    .pwj-header, .pwj-row, .pwj-error { display: flex; align-items: flex-start; gap: 7px; }
    .pwj-header { align-items: center; }
    .pwj-header mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    h3, p { margin: 0; }
    h3 { font-size: 13px; font-weight: 650; }
    .pwj-row { padding: 8px; border-radius: 8px; background: var(--crm-surface-raised); }
    .pwj-row > mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; margin-top: 1px; }
    .pwj-row div { min-width: 0; }
    .pwj-row strong, .pwj-row span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pwj-row strong { font-size: 12.5px; }
    .pwj-row span { color: var(--crm-text-muted); font-size: 11.5px; }
    .pwj-row p { margin-top: 4px; color: var(--crm-text-secondary); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .pwj-empty { padding: 10px; border: 1px dashed var(--crm-border); border-radius: 8px; color: var(--crm-text-muted); font-size: 12px; text-align: center; }
    .pwj-error { padding: 8px; border-radius: 8px; color: var(--crm-status-error); background: var(--crm-status-error-muted); font-size: 12px; }
    .pwj-error mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class PhotoWorkspaceJournalComponent {
  readonly entries = input.required<readonly PhotoWorkspaceJournalDto[]>();
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  eventLabel(eventType: string): string {
    switch (eventType) {
      case 'crop_saved':
        return 'Кадрирование сохранено';
      case 'wish_added':
        return 'Пожелание добавлено';
      case 'wish_accepted':
        return 'Пожелание принято';
      case 'wish_rejected':
        return 'Пожелание отклонено';
      case 'reference_added':
        return 'Референс добавлен';
      case 'reference_updated':
        return 'Референс обновлен';
      case 'prompt_plan_rebuilt':
        return 'Prompt plan пересобран';
      case 'variant_prompt_updated':
        return 'Prompt варианта обновлен';
      case 'ai_variant_started':
        return 'AI генерация началась';
      case 'ai_variant_completed':
        return 'AI вариант готов';
      case 'ai_variant_failed':
        return 'Ошибка AI варианта';
      case 'photoshop_uploaded':
        return 'Photoshop файл загружен';
      case 'variant_checked':
        return 'Вариант проверен';
      case 'variant_unchecked':
        return 'Проверка снята';
      case 'verified_variants_sent':
        return 'Варианты отправлены клиенту';
      case 'approval_file_replaced':
        return 'Файл согласования заменен';
      case 'approval_file_deleted':
        return 'Файл согласования удален';
      case 'client_notification_scheduled':
        return 'Уведомление запланировано';
      case 'client_notification_sent':
        return 'Уведомление отправлено';
      default:
        return eventType;
    }
  }

  eventIcon(eventType: string): string {
    if (eventType.startsWith('ai_')) return 'auto_awesome';
    if (eventType.startsWith('wish_')) return 'forum';
    if (eventType.startsWith('reference_')) return 'add_photo_alternate';
    if (eventType.includes('prompt')) return 'psychology';
    if (eventType.includes('photoshop')) return 'brush';
    if (eventType.includes('notification')) return 'notifications';
    if (eventType.includes('sent') || eventType.includes('approval')) return 'send';
    if (eventType.includes('crop')) return 'crop';
    return 'history';
  }

  payloadSummary(entry: PhotoWorkspaceJournalDto): string {
    const payload = entry.payload;
    const message = stringField(payload, 'message');
    if (message) return message;
    const sourceAssetName = stringField(payload, 'sourceAssetName');
    if (sourceAssetName) return sourceAssetName;
    const presetSlug = stringField(payload, 'presetSlug');
    const variantSlotNumber = numberField(payload, 'variantSlotNumber');
    if (presetSlug && variantSlotNumber != null) return `${presetSlug}, вариант ${variantSlotNumber}`;
    if (variantSlotNumber != null) return `Вариант ${variantSlotNumber}`;
    const staleVariantCount = numberField(payload, 'staleVariantCount');
    if (staleVariantCount != null && staleVariantCount > 0) return `Устарело вариантов: ${staleVariantCount}`;
    const variantLimit = numberField(payload, 'variantLimit');
    if (variantLimit != null) return `Количество вариантов: ${variantLimit}`;
    const source = stringField(payload, 'source');
    return source ?? '';
  }
}

function stringField(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberField(source: unknown, key: string): number | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
