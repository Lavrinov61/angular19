import { describe, expect, it } from 'vitest';
import { chatMediaRetryUrl } from './chat-media-retry.util';

describe('chatMediaRetryUrl', () => {
  it('adds a cache-busting retry param while preserving the original query', () => {
    expect(chatMediaRetryUrl('https://svoefoto.ru/media/chat/photo.jpg?size=thumb', 42, 'https://svoefoto.ru'))
      .toBe('https://svoefoto.ru/media/chat/photo.jpg?size=thumb&sf_img_retry=42');
  });

  it('replaces an existing retry param instead of growing the URL', () => {
    expect(chatMediaRetryUrl('/media/chat/photo.jpg?sf_img_retry=old&size=thumb', 43, 'https://svoefoto.ru'))
      .toBe('/media/chat/photo.jpg?sf_img_retry=43&size=thumb');
  });

  it('does not rewrite inline or empty image sources', () => {
    expect(chatMediaRetryUrl('data:image/png;base64,abc', 44, 'https://svoefoto.ru'))
      .toBe('data:image/png;base64,abc');
    expect(chatMediaRetryUrl('', 44, 'https://svoefoto.ru')).toBe('');
  });
});
