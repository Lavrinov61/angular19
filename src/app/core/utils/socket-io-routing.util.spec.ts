import { describe, expect, it } from 'vitest';
import { getSocketIoEndpoint, getSocketIoTransports } from './socket-io-routing.util';

describe('Socket.IO routing', () => {
  it('uses websocket first when a dedicated websocket endpoint is configured', () => {
    expect(getSocketIoEndpoint('https://ws.svoefoto.ru')).toBe('https://ws.svoefoto.ru');
    expect(getSocketIoTransports('https://ws.svoefoto.ru')).toEqual(['websocket', 'polling']);
  });

  it('keeps same-origin polling only when no websocket endpoint is configured', () => {
    expect(getSocketIoEndpoint('')).toBeUndefined();
    expect(getSocketIoTransports('')).toEqual(['polling']);
  });
});
