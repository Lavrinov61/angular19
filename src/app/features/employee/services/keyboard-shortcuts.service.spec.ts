import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { vi } from 'vitest';
import { KeyboardShortcutsService, ShortcutScope } from './keyboard-shortcuts.service';

/** Dispatch a synthetic keydown event to document. */
function fireKey(key: string, opts: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: EventTarget } = {}): void {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    metaKey: opts.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });

  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target, writable: false });
  }

  document.dispatchEvent(event);
}

describe('KeyboardShortcutsService', () => {
  let service: KeyboardShortcutsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    service = TestBed.inject(KeyboardShortcutsService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('activeScope defaults to "global"', () => {
      expect(service.activeScope()).toBe('global');
    });

    it('helpVisible defaults to false', () => {
      expect(service.helpVisible()).toBe(false);
    });
  });

  // ─── register() & unsubscribe ─────────────────────────────────────────────

  describe('register()', () => {
    it('registers a shortcut and fires handler on matching keydown', () => {
      const handler = vi.fn();
      service.register({ key: 'n', scope: 'global', description: 'New', handler });
      fireKey('n');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('returned unsubscribe function removes the binding', () => {
      const handler = vi.fn();
      const unregister = service.register({ key: 'q', scope: 'global', description: 'Quit', handler });
      unregister();
      fireKey('q');
      expect(handler).not.toHaveBeenCalled();
    });

    it('registers two different shortcuts independently', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      service.register({ key: 'a', scope: 'global', description: 'A', handler: h1 });
      service.register({ key: 'b', scope: 'global', description: 'B', handler: h2 });
      fireKey('a');
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).not.toHaveBeenCalled();
    });
  });

  // ─── setScope() ──────────────────────────────────────────────────────────

  describe('setScope()', () => {
    it('updates activeScope signal', () => {
      service.setScope('inbox');
      expect(service.activeScope()).toBe('inbox');
    });

    it('changing scope changes which bindings are active', () => {
      service.setScope('global');
      const globalHandler = vi.fn();
      const inboxHandler = vi.fn();
      service.register({ key: 'x', scope: 'global', description: 'G', handler: globalHandler });
      service.register({ key: 'x', scope: 'inbox', description: 'I', handler: inboxHandler });

      // In global scope, only global handler fires (inbox not in hierarchy)
      fireKey('x');
      expect(globalHandler).toHaveBeenCalledOnce();
      expect(inboxHandler).not.toHaveBeenCalled();
    });
  });

  // ─── scope hierarchy ─────────────────────────────────────────────────────

  describe('scope hierarchy', () => {
    it('"chat" scope includes global, inbox, detail, chat handlers', () => {
      service.setScope('chat');
      const gH = vi.fn();
      const iH = vi.fn();
      const dH = vi.fn();
      const cH = vi.fn();
      const handlers: Record<ShortcutScope, () => void> = {
        global: gH as () => void,
        inbox: iH as () => void,
        detail: dH as () => void,
        chat: cH as () => void,
      };
      const scopes: ShortcutScope[] = ['global', 'inbox', 'detail', 'chat'];
      scopes.forEach(scope =>
        service.register({ key: 'y', scope, description: scope, handler: handlers[scope] })
      );

      // Most specific (deepest) binding wins
      fireKey('y');
      expect(cH).toHaveBeenCalledOnce();
    });

    it('"global" scope does NOT fire inbox-scoped handler', () => {
      service.setScope('global');
      const inboxHandler = vi.fn();
      service.register({ key: 'z', scope: 'inbox', description: 'Inbox', handler: inboxHandler });
      fireKey('z');
      expect(inboxHandler).not.toHaveBeenCalled();
    });

    it('"detail" scope fires global and inbox handlers but NOT chat handler', () => {
      service.setScope('detail');
      const globalH = vi.fn();
      const chatH = vi.fn();
      service.register({ key: 'w', scope: 'global', description: 'G', handler: globalH });
      service.register({ key: 'w', scope: 'chat', description: 'C', handler: chatH });

      fireKey('w');
      expect(globalH).toHaveBeenCalledOnce();
      expect(chatH).not.toHaveBeenCalled();
    });
  });

  // ─── modifier keys ───────────────────────────────────────────────────────

  describe('modifier keys', () => {
    it('handles ctrl+key combinations', () => {
      const handler = vi.fn();
      service.register({ key: 'ctrl+s', scope: 'global', description: 'Save', handler });
      fireKey('s', { ctrlKey: true });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('handles shift+key combinations', () => {
      const handler = vi.fn();
      service.register({ key: 'shift+/', scope: 'global', description: 'Help', handler });
      fireKey('/', { shiftKey: true });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('does not fire ctrl shortcut for plain key press', () => {
      const handler = vi.fn();
      service.register({ key: 'ctrl+s', scope: 'global', description: 'Save', handler });
      fireKey('s');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ─── input ignore ─────────────────────────────────────────────────────────

  describe('ignores events from form inputs', () => {
    it('does not fire handler when target is an INPUT element', () => {
      const handler = vi.fn();
      service.register({ key: 'n', scope: 'global', description: 'New', handler });

      const input = document.createElement('input');
      document.body.appendChild(input);

      const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true });
      Object.defineProperty(event, 'target', { value: input, writable: false });
      document.dispatchEvent(event);

      expect(handler).not.toHaveBeenCalled();
      input.remove();
    });

    it('does not fire handler when target is a TEXTAREA element', () => {
      const handler = vi.fn();
      service.register({ key: 'n', scope: 'global', description: 'New', handler });

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true });
      Object.defineProperty(event, 'target', { value: textarea, writable: false });
      document.dispatchEvent(event);

      expect(handler).not.toHaveBeenCalled();
      textarea.remove();
    });
  });

  // ─── getBindingsForScope() ───────────────────────────────────────────────

  describe('getBindingsForScope()', () => {
    it('returns bindings visible in the given scope', () => {
      service.register({ key: 'g', scope: 'global', description: 'Global', handler: vi.fn() });
      service.register({ key: 'i', scope: 'inbox', description: 'Inbox', handler: vi.fn() });

      const forInbox = service.getBindingsForScope('inbox');
      const descriptions = forInbox.map(b => b.scope);
      expect(descriptions).toContain('global');
      expect(descriptions).toContain('inbox');
      expect(descriptions).not.toContain('chat');
    });

    it('uses activeScope when no argument is passed', () => {
      service.setScope('detail');
      service.register({ key: 'd', scope: 'detail', description: 'Detail', handler: vi.fn() });
      const bindings = service.getBindingsForScope();
      expect(bindings.some(b => b.scope === 'detail')).toBe(true);
    });
  });

  // ─── toggleHelp() ────────────────────────────────────────────────────────

  describe('toggleHelp()', () => {
    it('sets helpVisible to true on first call', () => {
      service.toggleHelp();
      expect(service.helpVisible()).toBe(true);
    });

    it('toggles back to false on second call', () => {
      service.toggleHelp();
      service.toggleHelp();
      expect(service.helpVisible()).toBe(false);
    });
  });

  // ─── SSR guard ───────────────────────────────────────────────────────────

  describe('SSR guard (server platform)', () => {
    it('does not throw when PLATFORM_ID is "server"', () => {
      expect(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            { provide: PLATFORM_ID, useValue: 'server' },
          ],
        });
        TestBed.inject(KeyboardShortcutsService);
      }).not.toThrow();
    });
  });
});
