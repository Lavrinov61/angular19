import { Component, input, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

const EMOJI_DATA: { key: string; label: string; icon: string; emojis: string[] }[] = [
  { key: 'recent', label: 'Недавние', icon: '🕐', emojis: [] },
  { key: 'smileys', label: 'Смайлы и люди', icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
  { key: 'gestures', label: 'Жесты', icon: '👋', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','👀','👁️','🧠','🫀','🫁','🦷','🦴','👅','👄'] },
  { key: 'animals', label: 'Животные и природа', icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦂','🦀','🐠','🐟','🐡','🐬','🦈','🐋','🐙','🌸','🌺','🌻','🌹','🌷','🌱','🌲','🌳','🌴','🌵','🍀','🍁','🍂','🍃'] },
  { key: 'food', label: 'Еда и напитки', icon: '🍕', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','☕','🫖','🍵','🍶','🍺','🍻','🥂','🍷','🍸','🍹','🧃','🥤','🧋'] },
  { key: 'travel', label: 'Путешествия', icon: '✈️', emojis: ['🚗','🚕','🚙','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🚏','🛣️','🛤️','⛽','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚠','🚡','🚀','🛸','🌍','🌎','🌏','🗺️','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋'] },
  { key: 'objects', label: 'Объекты', icon: '💡', emojis: ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','💾','💿','📀','🎥','📷','📸','📹','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','📡','🔋','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🔒','🔓','🔑','🗝️','📦','📫','📬','📭','📮','📝','📁','📂','📅','📆','📇','📈','📉','📊','📋','📌','📍','📎','🖇️','📏','📐','✂️','🗃️','🗄️','🗑️'] },
  { key: 'symbols', label: 'Символы', icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚱','🚳','🚯','🚭','📵','🔞','☢️','☣️','⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔃','🔄','🔙','🔚','🔛','🔜','🔝','✅','☑️','✔️','❎','➕','➖','➗','✖️','♾️','❓','❔','❕','❗','〰️','⚠️','🔱','⚜️','♻️','🔰','🔷','🔶','🔵','🔴','🟠','🟡','🟢','🟣','🟤','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜'] },
];

@Component({
  selector: 'app-emoji-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    <div class="emoji-overlay" (click)="closed.emit()" (keydown.escape)="closed.emit()" tabindex="-1" role="presentation"></div>
    <div class="emoji-container" (click)="$event.stopPropagation()" (keydown.escape)="closed.emit()" tabindex="-1" role="dialog">
      <div class="emoji-search">
        <mat-icon>search</mat-icon>
        <input placeholder="Найти эмодзи..." [(ngModel)]="searchText"
               (ngModelChange)="onSearch($event)" />
      </div>
      <div class="emoji-tabs">
        @for (cat of categories; track cat.key) {
          <button class="tab-btn" [class.active]="activeCategory() === cat.key"
                  (click)="activeCategory.set(cat.key)" [attr.aria-label]="cat.label">
            {{ cat.icon }}
          </button>
        }
      </div>
      <div class="emoji-grid">
        @for (emoji of visibleEmojis(); track emoji) {
          <button class="emoji-btn" (click)="selectEmoji(emoji)">{{ emoji }}</button>
        }
        @if (visibleEmojis().length === 0) {
          <div class="emoji-empty">Ничего не найдено</div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { position: relative; display: contents; }

    .emoji-overlay {
      position: fixed;
      inset: 0;
      z-index: 99;
    }

    .emoji-container {
      position: absolute;
      bottom: 100%;
      right: 0;
      width: 340px;
      max-height: 380px;
      background: rgba(12, 11, 9, 0.95);
      backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--crm-glass-border);
      border-radius: 16px;
      z-index: 100;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      animation: pickerSlideUp 200ms ease;
    }

    @keyframes pickerSlideUp {
      from { opacity: 0; transform: translateY(8px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .emoji-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--crm-glass-border);
      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-muted);
      }
      input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: var(--crm-text-primary);
        font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
        font-size: 13px;
        &::placeholder { color: var(--crm-text-muted); }
      }
    }

    .emoji-tabs {
      display: flex;
      gap: 2px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--crm-glass-border);
      overflow-x: auto;
    }

    .tab-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 16px;
      line-height: 1;
      transition: all 150ms;
      &:hover {
        background: rgba(245, 158, 11, 0.08);
        transform: scale(1.1);
      }
      &.active {
        background: rgba(245, 158, 11, 0.15);
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.3);
      }
    }

    .emoji-grid {
      flex: 1;
      overflow-y: auto;
      padding: 10px 4px;
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 4px;
      align-content: start;
    }

    .emoji-btn {
      width: 36px;
      height: 36px;
      background: none;
      border: none;
      cursor: pointer;
      border-radius: 8px;
      font-size: 20px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 120ms ease;
      &:hover {
        background: rgba(255, 255, 255, 0.08);
        transform: scale(1.25);
      }
    }

    .emoji-empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 24px;
      font-size: 13px;
      color: var(--crm-text-muted);
    }
  `],
})
export class EmojiPickerComponent {
  readonly recentEmojis = input<string[]>([]);
  readonly emojiSelected = output<string>();
  readonly closed = output<void>();

  readonly categories = EMOJI_DATA;
  readonly activeCategory = signal('smileys');
  readonly searchText = signal('');

  readonly visibleEmojis = computed(() => {
    const search = this.searchText().trim();
    if (search) {
      const all: string[] = [];
      for (const cat of EMOJI_DATA) {
        if (cat.key === 'recent') continue;
        all.push(...cat.emojis);
      }
      return all.filter(e => e.includes(search));
    }
    const key = this.activeCategory();
    if (key === 'recent') {
      return this.recentEmojis();
    }
    const cat = EMOJI_DATA.find(c => c.key === key);
    return cat?.emojis ?? [];
  });

  onSearch(value: string): void {
    this.searchText.set(value);
  }

  selectEmoji(emoji: string): void {
    this.emojiSelected.emit(emoji);
  }
}
