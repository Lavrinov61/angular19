import { Component, inject, signal, ChangeDetectionStrategy, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule, MatSelectionList } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { StaffChatService } from '../../services/staff-chat.service';
import { StaffParticipant } from '../../models/staff-chat.model';

@Component({
  selector: 'app-new-conversation-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatListModule, MatTabsModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Новый чат</h2>
    <mat-dialog-content>
      <mat-tab-group (selectedIndexChange)="tabIndex.set($event)">
        <mat-tab label="Личный">
          @if (chatService.contactsLoading()) {
            <div class="state-box">
              <mat-spinner diameter="32"></mat-spinner>
              <div>Загрузка сотрудников…</div>
            </div>
          } @else if (chatService.contactsError()) {
            <div class="state-box error-state">
              <mat-icon>error_outline</mat-icon>
              <div>{{ chatService.contactsError() }}</div>
              <button mat-stroked-button (click)="reload()">Повторить</button>
            </div>
          } @else {
            <mat-nav-list class="contact-list">
              @for (contact of chatService.contacts(); track contact.user_id) {
                <mat-list-item (click)="selectDirect(contact)">
                  <mat-icon matListItemIcon>person</mat-icon>
                  <span matListItemTitle>{{ contact.display_name || contact.email }}</span>
                  @if (contact.display_name) {
                    <span matListItemLine class="contact-email">{{ contact.email }}</span>
                  }
                </mat-list-item>
              } @empty {
                <div class="state-box">
                  <mat-icon>group_off</mat-icon>
                  <div>Нет других активных сотрудников</div>
                </div>
              }
            </mat-nav-list>
          }
        </mat-tab>
        <mat-tab label="Группа">
          <div class="group-form">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Название группы</mat-label>
              <input matInput [(ngModel)]="groupTitle" placeholder="Например: Утренняя смена" />
            </mat-form-field>

            <div class="participants-label">Участники:</div>
            @if (chatService.contactsLoading()) {
              <div class="state-box"><mat-spinner diameter="28"></mat-spinner></div>
            } @else if (chatService.contactsError()) {
              <div class="state-box error-state">
                <mat-icon>error_outline</mat-icon>
                <div>{{ chatService.contactsError() }}</div>
              </div>
            } @else {
              <mat-selection-list #selList class="contact-list">
                @for (contact of chatService.contacts(); track contact.user_id) {
                  <mat-list-option [value]="contact.user_id">
                    {{ contact.display_name || contact.email }}
                  </mat-list-option>
                }
              </mat-selection-list>
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      @if (tabIndex() === 1) {
        <button mat-flat-button color="primary" [disabled]="!groupTitle.trim()"
                (click)="createGroup()">
          Создать группу
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .contact-list { max-height: 300px; overflow-y: auto; }
    .contact-email { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .state-box {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 28px 16px; text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .state-box mat-icon { font-size: 32px; width: 32px; height: 32px; }
    .error-state { color: var(--mat-sys-error); }
    .error-state button { margin-top: 4px; }
    .group-form { padding: 8px 0; }
    .full-width { width: 100%; }
    .participants-label { font-size: 13px; font-weight: 500; margin: 8px 0 4px; }
  `],
})
export class NewConversationDialogComponent {
  protected readonly chatService = inject(StaffChatService);
  private readonly dialogRef = inject(MatDialogRef<NewConversationDialogComponent>);

  readonly selectionList = viewChild<MatSelectionList>('selList');

  readonly tabIndex = signal(0);
  groupTitle = '';

  selectDirect(contact: StaffParticipant): void {
    if (!contact.user_id) return;
    this.dialogRef.close({ type: 'direct', userId: contact.user_id });
  }

  reload(): void {
    this.chatService.loadContacts();
  }

  createGroup(): void {
    const selectedIds = this.selectionList()?.selectedOptions.selected
      .map(opt => opt.value as string)
      .filter(Boolean) ?? [];

    if (selectedIds.length > 0 && this.groupTitle.trim()) {
      this.dialogRef.close({
        type: 'group',
        title: this.groupTitle.trim(),
        participantIds: selectedIds,
      });
    }
  }
}
