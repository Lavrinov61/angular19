import { Injectable, inject, signal, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ShortcutScope = 'global' | 'inbox' | 'detail' | 'chat';

export interface ShortcutBinding {
  key: string;
  scope: ShortcutScope;
  description: string;
  handler: () => void;
}

/**
 * Centralized keyboard shortcuts registry.
 * Scope hierarchy: global > inbox > detail > chat.
 * Ignores input/textarea/contenteditable focus.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bindings = new Map<string, ShortcutBinding[]>();

  readonly activeScope = signal<ShortcutScope>('global');
  readonly helpVisible = signal(false);

  private readonly scopeHierarchy: Record<ShortcutScope, ShortcutScope[]> = {
    global: ['global'],
    inbox: ['global', 'inbox'],
    detail: ['global', 'inbox', 'detail'],
    chat: ['global', 'inbox', 'detail', 'chat'],
  };

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const handler = (e: KeyboardEvent) => this.handleKeydown(e);
      document.addEventListener('keydown', handler);
      this.destroyRef.onDestroy(() => document.removeEventListener('keydown', handler));
    }
  }

  register(binding: ShortcutBinding): () => void {
    const key = binding.key.toLowerCase();
    const existing = this.bindings.get(key) || [];
    existing.push(binding);
    this.bindings.set(key, existing);

    return () => {
      const arr = this.bindings.get(key);
      if (arr) {
        const idx = arr.indexOf(binding);
        if (idx >= 0) arr.splice(idx, 1);
        if (arr.length === 0) this.bindings.delete(key);
      }
    };
  }

  setScope(scope: ShortcutScope): void {
    this.activeScope.set(scope);
  }

  getBindingsForScope(scope?: ShortcutScope): ShortcutBinding[] {
    const s = scope ?? this.activeScope();
    const allowed = this.scopeHierarchy[s];
    const result: ShortcutBinding[] = [];
    for (const bindings of this.bindings.values()) {
      for (const b of bindings) {
        if (allowed.includes(b.scope)) result.push(b);
      }
    }
    return result;
  }

  toggleHelp(): void {
    this.helpVisible.update(v => !v);
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Ignore when typing in inputs
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ) {
      return;
    }

    // Build key string
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    parts.push(e.key.toLowerCase());
    const keyStr = parts.join('+');

    const bindings = this.bindings.get(keyStr);
    if (!bindings?.length) return;

    const currentScope = this.activeScope();
    const allowed = this.scopeHierarchy[currentScope];

    // Find most specific binding (deepest scope match)
    let best: ShortcutBinding | null = null;
    let bestDepth = -1;
    for (const b of bindings) {
      const depth = allowed.indexOf(b.scope);
      if (depth >= 0 && depth > bestDepth) {
        best = b;
        bestDepth = depth;
      }
    }

    if (best) {
      e.preventDefault();
      best.handler();
    }
  }
}
