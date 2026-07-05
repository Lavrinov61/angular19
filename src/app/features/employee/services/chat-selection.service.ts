import { Injectable, signal, computed } from '@angular/core';

export interface SelectedFile {
  msgId: string;
  url: string;
  name: string;
  type: 'image' | 'file';
}

@Injectable({ providedIn: 'root' })
export class ChatSelectionService {
  readonly selectionMode = signal(false);
  readonly selected = signal<Map<string, SelectedFile>>(new Map());
  readonly count = computed(() => this.selected().size);
  readonly files = computed(() => Array.from(this.selected().values()));
  readonly lastClickedId = signal<string | null>(null);

  toggle(msgId: string, file: SelectedFile): void {
    this.selected.update(m => {
      const copy = new Map(m);
      if (copy.has(msgId)) {
        copy.delete(msgId);
      } else {
        copy.set(msgId, file);
      }
      return copy;
    });
  }

  isSelected(msgId: string): boolean {
    return this.selected().has(msgId);
  }

  startWith(msgId: string, file: SelectedFile): void {
    this.selectionMode.set(true);
    this.selected.set(new Map([[msgId, file]]));
    this.lastClickedId.set(msgId);
  }

  toggleWithTrack(msgId: string, file: SelectedFile): void {
    this.toggle(msgId, file);
    this.lastClickedId.set(msgId);
  }

  selectRange(orderedIds: string[], targetId: string, fileMap: Map<string, SelectedFile>): void {
    const lastId = this.lastClickedId();
    if (!lastId) {
      const f = fileMap.get(targetId);
      if (f) this.toggleWithTrack(targetId, f);
      return;
    }
    const startIdx = orderedIds.indexOf(lastId);
    const endIdx = orderedIds.indexOf(targetId);
    if (startIdx === -1 || endIdx === -1) return;
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    this.selected.update(m => {
      const copy = new Map(m);
      for (let i = lo; i <= hi; i++) {
        const id = orderedIds[i];
        const f = fileMap.get(id);
        if (f) copy.set(id, f);
      }
      return copy;
    });
    this.lastClickedId.set(targetId);
  }

  selectAll(items: SelectedFile[]): void {
    this.selectionMode.set(true);
    this.selected.update(m => {
      const copy = new Map(m);
      for (const f of items) {
        copy.set(f.msgId, f);
      }
      return copy;
    });
  }

  replaceSelection(items: SelectedFile[]): void {
    const map = new Map<string, SelectedFile>();
    for (const f of items) {
      map.set(f.msgId, f);
    }
    this.selected.set(map);
  }

  deselectAll(): void {
    this.selected.set(new Map());
  }

  exit(): void {
    this.selectionMode.set(false);
    this.selected.set(new Map());
    this.lastClickedId.set(null);
  }
}
