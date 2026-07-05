import { Component, input, output, signal, computed, ChangeDetectionStrategy, HostListener } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-mention-autocomplete',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="mention-overlay" (click)="closed.emit()" (keydown.escape)="closed.emit()" tabindex="-1" role="presentation"></div>
    <div class="mention-container" (click)="$event.stopPropagation()" (keydown.escape)="closed.emit()" tabindex="-1" role="listbox">
      @for (p of filtered(); track p.user_id; let i = $index) {
        <button class="mention-item" [class.active]="activeIndex() === i"
                (click)="select(p)" (mouseenter)="activeIndex.set(i)">
          <div class="mention-avatar" [style.background]="avatarColor(p.user_id)">
            {{ initials(p.display_name || p.email) }}
          </div>
          <div class="mention-info">
            <span class="mention-name">{{ p.display_name || p.email }}</span>
            @if (p.display_name && p.email) {
              <span class="mention-email">{{ p.email }}</span>
            }
          </div>
        </button>
      }
      @if (filtered().length === 0) {
        <div class="mention-empty">Никого не найдено</div>
      }
    </div>
  `,
  styles: [`
    :host { position: relative; display: contents; }

    .mention-overlay {
      position: fixed;
      inset: 0;
      z-index: 99;
    }

    .mention-container {
      position: absolute;
      bottom: 100%;
      left: 0;
      width: 280px;
      max-height: 280px;
      overflow-y: auto;
      background: rgba(12, 11, 9, 0.95);
      backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--crm-glass-border);
      border-radius: 12px;
      z-index: 100;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      padding: 6px;
      animation: mentionSlideUp 150ms ease;
    }

    @keyframes mentionSlideUp {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .mention-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      background: none;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      text-align: left;
      color: var(--crm-text-primary);
      transition: all 120ms ease;
      &:hover, &.active {
        background: rgba(245, 158, 11, 0.08);
        transform: translateX(2px);
      }
    }

    .mention-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .mention-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .mention-name {
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mention-email {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 11px;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mention-empty {
      text-align: center;
      padding: 16px;
      font-size: 13px;
      color: var(--crm-text-muted);
    }
  `],
})
export class MentionAutocompleteComponent {
  readonly query = input.required<string>();
  readonly participants = input.required<{ user_id: string; display_name: string | null; email: string }[]>();
  readonly selected = output<{ user_id: string; display_name: string | null; email: string }>();
  readonly closed = output<void>();

  readonly activeIndex = signal(0);

  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    const list = this.participants();
    if (!q) return list.slice(0, 8);
    return list.filter(p =>
      p.display_name?.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    ).slice(0, 8);
  });

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const list = this.filtered();
    if (!list.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      this.activeIndex.update(i => (i + 1) % list.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.activeIndex.update(i => (i - 1 + list.length) % list.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.select(list[this.activeIndex()]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
    }
  }

  select(participant: { user_id: string; display_name: string | null; email: string }): void {
    this.selected.emit(participant);
  }

  avatarColor(id: string): string {
    const colors = ['#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#f57c00', '#0097a7', '#5d4037', '#455a64'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  initials(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name[0] || '?').toUpperCase();
  }
}
