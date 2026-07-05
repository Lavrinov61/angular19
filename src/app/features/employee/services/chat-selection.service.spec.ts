import { TestBed } from '@angular/core/testing';
import { ChatSelectionService, SelectedFile } from './chat-selection.service';

const makeFile = (overrides: Partial<SelectedFile> = {}): SelectedFile => ({
  msgId: 'msg-1',
  url: 'https://example.com/photo.jpg',
  name: 'photo.jpg',
  type: 'image',
  ...overrides,
});

describe('ChatSelectionService', () => {
  let service: ChatSelectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChatSelectionService);
    service.exit();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('selectionMode is false', () => {
      expect(service.selectionMode()).toBe(false);
    });

    it('selected Map is empty', () => {
      expect(service.selected().size).toBe(0);
    });

    it('count is 0', () => {
      expect(service.count()).toBe(0);
    });

    it('files is an empty array', () => {
      expect(service.files()).toEqual([]);
    });
  });

  // ─── startWith() ─────────────────────────────────────────────────────────

  describe('startWith()', () => {
    it('enables selectionMode', () => {
      service.startWith('msg-1', makeFile());
      expect(service.selectionMode()).toBe(true);
    });

    it('initialises selected Map with exactly one entry', () => {
      service.startWith('msg-1', makeFile({ msgId: 'msg-1' }));
      expect(service.selected().size).toBe(1);
      expect(service.selected().has('msg-1')).toBe(true);
    });

    it('replaces any existing selection with just the new file', () => {
      service.startWith('msg-1', makeFile({ msgId: 'msg-1' }));
      service.startWith('msg-2', makeFile({ msgId: 'msg-2', url: 'other.jpg', name: 'other.jpg' }));
      expect(service.selected().size).toBe(1);
      expect(service.selected().has('msg-2')).toBe(true);
    });
  });

  // ─── toggle() ────────────────────────────────────────────────────────────

  describe('toggle()', () => {
    it('adds a file when it is not selected', () => {
      service.toggle('msg-1', makeFile());
      expect(service.isSelected('msg-1')).toBe(true);
    });

    it('removes a file when it is already selected', () => {
      service.toggle('msg-1', makeFile());
      service.toggle('msg-1', makeFile());
      expect(service.isSelected('msg-1')).toBe(false);
    });

    it('toggles the same msgId twice and ends up with no selection', () => {
      service.toggle('msg-A', makeFile({ msgId: 'msg-A' }));
      service.toggle('msg-A', makeFile({ msgId: 'msg-A' }));
      expect(service.count()).toBe(0);
    });

    it('adds multiple different files independently', () => {
      service.toggle('msg-1', makeFile({ msgId: 'msg-1' }));
      service.toggle('msg-2', makeFile({ msgId: 'msg-2', url: 'b.jpg', name: 'b.jpg' }));
      expect(service.count()).toBe(2);
    });

    it('does not change selectionMode', () => {
      service.toggle('msg-1', makeFile());
      expect(service.selectionMode()).toBe(false);
    });
  });

  // ─── isSelected() ────────────────────────────────────────────────────────

  describe('isSelected()', () => {
    it('returns false when not selected', () => {
      expect(service.isSelected('not-there')).toBe(false);
    });

    it('returns true after the file is toggled in', () => {
      service.toggle('msg-x', makeFile());
      expect(service.isSelected('msg-x')).toBe(true);
    });

    it('returns false after the file is toggled out', () => {
      service.toggle('msg-x', makeFile());
      service.toggle('msg-x', makeFile());
      expect(service.isSelected('msg-x')).toBe(false);
    });
  });

  // ─── exit() ──────────────────────────────────────────────────────────────

  describe('exit()', () => {
    it('sets selectionMode to false', () => {
      service.startWith('msg-1', makeFile());
      service.exit();
      expect(service.selectionMode()).toBe(false);
    });

    it('clears the selection', () => {
      service.startWith('msg-1', makeFile());
      service.toggle('msg-2', makeFile({ msgId: 'msg-2', url: 'b.jpg', name: 'b.jpg' }));
      service.exit();
      expect(service.count()).toBe(0);
      expect(service.files()).toEqual([]);
    });
  });

  // ─── computed: count & files ─────────────────────────────────────────────

  describe('computed count and files', () => {
    it('count tracks the number of selected files', () => {
      service.toggle('a', makeFile({ msgId: 'a' }));
      service.toggle('b', makeFile({ msgId: 'b', url: 'b.jpg', name: 'b.jpg' }));
      expect(service.count()).toBe(2);
    });

    it('files returns array of all selected SelectedFile objects', () => {
      const file = makeFile({ msgId: 'z', url: 'z.jpg', name: 'z.jpg' });
      service.toggle('z', file);
      const files = service.files();
      expect(files).toHaveLength(1);
      expect(files[0]).toEqual(file);
    });

    it('count decrements after toggle-out', () => {
      service.toggle('a', makeFile({ msgId: 'a' }));
      service.toggle('b', makeFile({ msgId: 'b', url: 'b.jpg', name: 'b.jpg' }));
      service.toggle('a', makeFile({ msgId: 'a' }));
      expect(service.count()).toBe(1);
    });
  });
});
