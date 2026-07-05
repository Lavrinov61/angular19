import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { PhotoWorkspaceWishDto, PhotoWorkspaceWishStatus } from '../../models/photo-workspace.model';
import { ChatSelectionService, type SelectedFile } from '../../services/chat-selection.service';

export interface PhotoWorkspaceWishUpdate {
  wish: PhotoWorkspaceWishDto;
  status: PhotoWorkspaceWishStatus;
  rejectReason: string | null;
}

export interface PhotoWorkspaceWishCreate {
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string | null;
  text: string;
}

@Component({
  selector: 'app-photo-workspace-wishes-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule],
  template: `
    <section class="pww-panel">
      <header class="pww-header">
        <mat-icon>forum</mat-icon>
        <h3>Пожелания</h3>
        @if (pendingCount() > 0) {
          <span class="pww-blocker">{{ pendingCount() }}</span>
        }
      </header>

      @for (group of groups; track group.sourceType) {
        <div class="pww-section">
          <div class="pww-section-head">
            <h4>{{ group.label }}</h4>
            @if (group.sourceType === 'chat_message') {
              <button mat-stroked-button type="button" (click)="startChatSelection()">
                <mat-icon>select_all</mat-icon>
                Из чата
              </button>
            }
          </div>
          @if (group.sourceType === 'chat_message' && chatSelectionMode()) {
            <div class="pww-chat-selection">
              <span>Выбрано: {{ selectedChatCount() }}</span>
              <button mat-stroked-button type="button" [disabled]="selectedChatCount() === 0" (click)="addSelectedChat()">
                <mat-icon>add</mat-icon>
                Добавить выбранное
              </button>
              <button mat-icon-button type="button" title="Отменить выбор" (click)="cancelChatSelection()">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          }
          @for (wish of wishesBySource(group.sourceType); track wish.id) {
            <div class="pww-wish" [class.is-pending]="wish.status === 'pending'">
              @if (wish.source_label) {
                <span class="pww-source-label">{{ wish.source_label }}</span>
              }
              <p>{{ wish.text }}</p>
              <div class="pww-actions">
                <button mat-icon-button type="button" title="Принять" (click)="update.emit({ wish, status: 'accepted', rejectReason: null })">
                  <mat-icon>check</mat-icon>
                </button>
                <button mat-icon-button type="button" title="Отклонить" (click)="update.emit({ wish, status: 'rejected', rejectReason: rejectReason() })">
                  <mat-icon>block</mat-icon>
                </button>
                <button mat-icon-button type="button" title="Вернуть" (click)="update.emit({ wish, status: 'pending', rejectReason: null })">
                  <mat-icon>undo</mat-icon>
                </button>
              </div>
            </div>
          }
          @if (!wishesBySource(group.sourceType).length) {
            <div class="pww-empty">Нет записей</div>
          }
        </div>
      }

      <div class="pww-manual">
        <h4>Ручное дополнение сотрудника</h4>
        <textarea [(ngModel)]="manualText" rows="3"></textarea>
        <div class="pww-manual-actions">
          <select [ngModel]="rejectReason()" (ngModelChange)="rejectReason.set($event)">
            @for (reason of rejectReasons; track reason) {
              <option [value]="reason">{{ reason }}</option>
            }
          </select>
          <button mat-stroked-button type="button" [disabled]="!manualText.trim()" (click)="addManual()">
            <mat-icon>add</mat-icon>
            Добавить
          </button>
          <button mat-stroked-button type="button" (click)="importApproval.emit()">
            <mat-icon>history</mat-icon>
            Из согласования
          </button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pww-panel { display: flex; flex-direction: column; gap: 12px; }
    .pww-header { display: flex; align-items: center; gap: 7px; }
    .pww-header mat-icon { color: var(--crm-accent); font-size: 18px; width: 18px; height: 18px; }
    h3, h4, p { margin: 0; }
    h3 { font-size: 13px; font-weight: 650; }
    h4 { color: var(--crm-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .pww-blocker { margin-left: auto; padding: 2px 7px; border-radius: 999px; color: var(--crm-status-warning); background: var(--crm-status-warning-muted); font-size: 12px; }
    .pww-section, .pww-manual { display: flex; flex-direction: column; gap: 7px; }
    .pww-section-head, .pww-chat-selection { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .pww-section-head h4 { flex: 1; min-width: 120px; }
    .pww-chat-selection {
      padding: 7px;
      border-radius: 8px;
      background: var(--crm-accent-muted);
      color: var(--crm-text-secondary);
      font-size: 12px;
    }
    .pww-chat-selection span { flex: 1; min-width: 80px; }
    .pww-wish { padding: 8px; border-radius: 8px; background: var(--crm-surface-raised); }
    .pww-wish.is-pending { outline: 1px solid var(--crm-status-warning); }
    .pww-source-label { display: block; margin-bottom: 4px; color: var(--crm-text-muted); font-size: 11px; font-weight: 650; }
    .pww-wish p { font-size: 13px; line-height: 1.35; }
    .pww-actions, .pww-manual-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
    textarea, select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: var(--crm-surface-base);
      color: var(--crm-text-primary);
      padding: 8px;
      font: inherit;
    }
    select { width: auto; min-width: 180px; }
    .pww-empty { color: var(--crm-text-muted); font-size: 12px; padding: 8px; border: 1px dashed var(--crm-border); border-radius: 8px; }
  `],
})
export class PhotoWorkspaceWishesPanelComponent {
  private readonly chatSelection = inject(ChatSelectionService);

  readonly wishes = input.required<readonly PhotoWorkspaceWishDto[]>();
  readonly addWish = output<PhotoWorkspaceWishCreate>();
  readonly update = output<PhotoWorkspaceWishUpdate>();
  readonly importApproval = output<void>();
  readonly chatSelectionMode = this.chatSelection.selectionMode;
  readonly selectedChatCount = this.chatSelection.count;
  readonly selectedChatFiles = computed(() => this.chatSelection.files());

  readonly groups = [
    { sourceType: 'order', label: 'Из заказа' },
    { sourceType: 'chat_message', label: 'Из чата' },
    { sourceType: 'approval_revision', label: 'Из согласования' },
    { sourceType: 'manual', label: 'Ручные' },
  ] as const;
  readonly rejectReasons = ['Нельзя выполнить', 'Противоречит документу', 'Портит узнаваемость', 'Нужен Photoshop вручную', 'Другое'];
  readonly rejectReason = signal(this.rejectReasons[0]);
  manualText = '';

  pendingCount(): number {
    return this.wishes().filter(wish => wish.status === 'pending').length;
  }

  wishesBySource(sourceType: string): PhotoWorkspaceWishDto[] {
    return this.wishes().filter(wish => wishSourceGroup(wish.source_type) === sourceType);
  }

  addManual(): void {
    const text = this.manualText.trim();
    if (!text) return;
    this.addWish.emit({
      sourceType: 'manual',
      sourceId: null,
      sourceLabel: null,
      text,
    });
    this.manualText = '';
  }

  startChatSelection(): void {
    this.chatSelection.selectionMode.set(true);
  }

  addSelectedChat(): void {
    const files = this.selectedChatFiles();
    for (const file of files) {
      this.addWish.emit({
        sourceType: 'chat_message',
        sourceId: file.msgId,
        sourceLabel: file.name,
        text: chatWishText(file),
      });
    }
    this.chatSelection.exit();
  }

  cancelChatSelection(): void {
    this.chatSelection.exit();
  }
}

function chatWishText(file: SelectedFile): string {
  return file.type === 'image'
    ? `Использовать фото из чата: ${file.name} (${file.url})`
    : `Учесть файл из чата: ${file.name} (${file.url})`;
}

function wishSourceGroup(sourceType: string): string {
  if (sourceType === 'order_comment' || sourceType === 'order_wishes') return 'order';
  if (sourceType === 'approval_feedback' || sourceType === 'approval_revision') return 'approval_revision';
  if (sourceType === 'chat_message') return 'chat_message';
  return 'manual';
}
