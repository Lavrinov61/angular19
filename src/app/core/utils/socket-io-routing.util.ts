export type SocketIoTransport = 'websocket' | 'polling';

export function getSocketIoEndpoint(wsUrl: string): string | undefined {
  const endpoint = wsUrl.trim();
  return endpoint || undefined;
}

export function getSocketIoTransports(wsUrl: string): SocketIoTransport[] {
  return getSocketIoEndpoint(wsUrl) ? ['websocket', 'polling'] : ['polling'];
}
