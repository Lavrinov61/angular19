import { describe, expect, it } from 'vitest';
import { hasRealMediaCaption, isGeneratedMediaCaption } from './chat-caption.util';

describe('chat media captions', () => {
  it('treats generated photo labels as service captions', () => {
    expect(isGeneratedMediaCaption('[Фото]')).toBe(true);
    expect(isGeneratedMediaCaption('📷 Фото')).toBe(true);
    expect(isGeneratedMediaCaption('📷 Фото 12/15')).toBe(true);
    expect(isGeneratedMediaCaption('Фото 12 / 15')).toBe(true);
    expect(hasRealMediaCaption('📷 Фото 12/15')).toBe(false);
  });

  it('keeps user-entered text as a real caption', () => {
    expect(hasRealMediaCaption('📷 Фото 1/15 — срочно напечатать')).toBe(true);
    expect(hasRealMediaCaption('Фото на документы')).toBe(true);
  });
});
