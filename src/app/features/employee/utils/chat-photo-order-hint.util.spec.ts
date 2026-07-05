import { describe, expect, it } from 'vitest';
import { parseChatPhotoOrderHint } from './chat-photo-order-hint.util';

describe('chat photo order hint parser', () => {
  it('parses square custom size with decimal comma', () => {
    expect(parseChatPhotoOrderHint('Лика просила 10,5x10,5 ещё')).toMatchObject({
      widthMm: 105,
      heightMm: 105,
      label: '10,5×10,5 см',
      whiteBorder: false,
    });
  });

  it('parses an extra comma after x separator', () => {
    expect(parseChatPhotoOrderHint('Лика просила 10,5x,10,5 ещё')).toMatchObject({
      widthMm: 105,
      heightMm: 105,
      label: '10,5×10,5 см',
    });
  });

  it('parses colon size when there is order context', () => {
    expect(parseChatPhotoOrderHint('64 фотографии Размер: 5:7,5')).toMatchObject({
      widthMm: 50,
      heightMm: 75,
      label: '5×7,5 см',
    });
  });

  it('parses half of a standard photo', () => {
    expect(parseChatPhotoOrderHint('1 фото Размер половина стандартного фото')).toMatchObject({
      widthMm: 75,
      heightMm: 100,
      label: '7,5×10 см',
    });
  });

  it('detects white border requests', () => {
    expect(parseChatPhotoOrderHint('4 фотографии: половина от стандартного фото, с белой рамкой')).toMatchObject({
      widthMm: 75,
      heightMm: 100,
      whiteBorder: true,
    });
  });

  it('does not parse a plain chat time as a size', () => {
    expect(parseChatPhotoOrderHint('Сообщение отправлено в 12:35')).toBeNull();
  });
});
