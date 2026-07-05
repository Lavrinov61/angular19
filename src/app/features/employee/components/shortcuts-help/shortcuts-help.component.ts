import { Component, inject, ChangeDetectionStrategy, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';

@Component({
  selector: 'app-shortcuts-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule],
  template: `
    @if (shortcuts.helpVisible()) {
      <div class="overlay" tabindex="0" role="button" (click)="shortcuts.toggleHelp()" (keydown.enter)="shortcuts.toggleHelp()">
        <div class="panel" tabindex="0" role="dialog" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()">
          <div class="panel-header">
            <h3>Горячие клавиши</h3>
            <button mat-icon-button (click)="shortcuts.toggleHelp()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <table class="shortcuts-table">
            <tbody>
              @for (b of bindings(); track b.key + b.scope) {
                <tr>
                  <td class="key-cell"><kbd>{{ formatKey(b.key) }}</kbd></td>
                  <td class="desc-cell">{{ b.description }}</td>
                  <td class="scope-cell">{{ scopeLabel(b.scope) }}</td>
                </tr>
              }
            </tbody>
          </table>
          <div class="panel-footer">Нажмите <kbd>?</kbd> или <kbd>Esc</kbd> чтобы закрыть</div>
        </div>
      </div>
    }
  `,
  styles: [`
    .overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.5); display: flex;
      align-items: center; justify-content: center;
    }
    .panel {
      background: var(--mat-sys-surface, #fff); border-radius: 12px;
      padding: 20px 24px; min-width: 360px; max-width: 480px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px;
      h3 { margin: 0; font-size: 16px; font-weight: 600; }
    }
    .shortcuts-table {
      width: 100%; border-collapse: collapse;
      tr { border-bottom: 1px solid var(--mat-sys-outline-variant, #e0e0e0); }
      td { padding: 8px 4px; font-size: 13px; }
    }
    .key-cell {
      width: 100px;
      kbd {
        background: var(--mat-sys-surface-container, #f5f5f5);
        border: 1px solid var(--mat-sys-outline-variant, #ccc);
        border-radius: 4px; padding: 2px 8px; font-size: 12px;
        font-family: monospace;
      }
    }
    .desc-cell { flex: 1; }
    .scope-cell {
      color: var(--mat-sys-on-surface-variant, #666); font-size: 11px;
      text-align: right;
    }
    .panel-footer {
      margin-top: 12px; font-size: 12px; text-align: center;
      color: var(--mat-sys-on-surface-variant, #999);
      kbd {
        background: var(--mat-sys-surface-container, #f5f5f5);
        border: 1px solid var(--mat-sys-outline-variant, #ccc);
        border-radius: 3px; padding: 1px 5px; font-size: 11px;
        font-family: monospace;
      }
    }
  `],
})
export class ShortcutsHelpComponent {
  readonly shortcuts = inject(KeyboardShortcutsService);

  readonly bindings = computed(() => this.shortcuts.getBindingsForScope());

  formatKey(key: string): string {
    return key
      .replace('ctrl+', 'Ctrl + ')
      .replace('shift+', 'Shift + ')
      .replace('alt+', 'Alt + ')
      .replace('escape', 'Esc')
      .replace('arrowup', '\u2191')
      .replace('arrowdown', '\u2193')
      .replace('enter', 'Enter');
  }

  scopeLabel(scope: string): string {
    const labels: Record<string, string> = {
      global: '',
      inbox: 'Inbox',
      detail: 'Detail',
      chat: 'Chat',
    };
    return labels[scope] || scope;
  }
}
