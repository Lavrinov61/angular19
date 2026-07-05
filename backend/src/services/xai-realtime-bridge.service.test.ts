import { createServer, type Server } from 'node:http';
import { Socket } from 'node:net';
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';

import {
  buildServiceSurveyRealtimeBridgeConnectionConfig,
  computeVoxDueFrameCount,
  createServiceSurveyRealtimeBridgeToken,
  registerXaiRealtimeBridge,
  summarizeVoxPacing,
  VOX_FRAME_BYTES,
  VOX_FRAME_MS,
  verifyServiceSurveyRealtimeBridgeToken,
} from './xai-realtime-bridge.service.js';

const bridgeServiceSource = readFileSync(new URL('./xai-realtime-bridge.service.ts', import.meta.url), 'utf8');

let server: Server | null = null;
let upstreamServer: Server | null = null;
let upstreamWsServer: WebSocketServer | null = null;
let clientSocket: WebSocket | null = null;
let upstreamSocket: WsWebSocket | null = null;

function listen(serverToStart: Server): Promise<number> {
  return new Promise<number>((resolve) => {
    serverToStart.listen(0, '127.0.0.1', () => {
      const address = serverToStart.address();
      if (typeof address === 'object' && address) resolve(address.port);
    });
  });
}

function closeServer(serverToClose: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readUpgradeResponse(port: number, path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = new Socket();
    let response = '';

    socket.setTimeout(2_000);
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
    });
    socket.on('end', () => resolve(response));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(response);
    });
    socket.on('error', reject);
    socket.connect(port, '127.0.0.1', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('websocket open failed')), { once: true });
  });
}

interface ClientMessageQueue {
  nextMessage: (label: string) => Promise<unknown>;
}

function createClientMessageQueue(socket: WebSocket): ClientMessageQueue {
  const messages: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      return;
    }
    try {
      const parsed = JSON.parse(event.data);
      const waiter = waiters.shift();
      if (waiter) {
        waiter(parsed);
      } else {
        messages.push(parsed);
      }
    } catch {
      return;
    }
  });

  return {
    nextMessage: (label: string) => new Promise<unknown>((resolve, reject) => {
      const message = messages.shift();
      if (message !== undefined) {
        resolve(message);
        return;
      }
      const timeout = setTimeout(() => reject(new Error(`timed out waiting for client message: ${label}`)), 1_000);
      waiters.push((queuedMessage) => {
        clearTimeout(timeout);
        resolve(queuedMessage);
      });
    }),
  };
}

interface WsMessageQueue {
  socket: WsWebSocket;
  nextMessage: (label: string) => Promise<unknown>;
  nextMessageWithin: (label: string, timeoutMs: number) => Promise<unknown | null>;
}

function waitForWsConnection(serverToWatch: WebSocketServer): Promise<WsMessageQueue> {
  return new Promise<WsMessageQueue>((resolve) => {
    serverToWatch.once('connection', (socket) => {
      const messages: unknown[] = [];
      const waiters: Array<(message: unknown) => void> = [];

      socket.on('message', (data) => {
        const parsed = JSON.parse(data.toString('utf8'));
        const waiter = waiters.shift();
        if (waiter) {
          waiter(parsed);
        } else {
          messages.push(parsed);
        }
      });

      resolve({
        socket,
        nextMessage: (label: string) => new Promise<unknown>((messageResolve, messageReject) => {
          const message = messages.shift();
          if (message !== undefined) {
            messageResolve(message);
            return;
          }
          const timeout = setTimeout(() => {
            messageReject(new Error(`timed out waiting for upstream message: ${label}`));
          }, 1_000);
          waiters.push((messageFromQueue) => {
            clearTimeout(timeout);
            messageResolve(messageFromQueue);
          });
        }),
        nextMessageWithin: (label: string, timeoutMs: number) => new Promise<unknown | null>((messageResolve) => {
          const message = messages.shift();
          if (message !== undefined) {
            messageResolve(message);
            return;
          }
          const timeout = setTimeout(() => {
            const waiterIndex = waiters.indexOf(waiter);
            if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
            messageResolve(null);
          }, timeoutMs);
          const waiter = (messageFromQueue: unknown) => {
            clearTimeout(timeout);
            messageResolve(messageFromQueue);
          };
          waiters.push(waiter);
        }),
      });
    });
  });
}

afterEach(async () => {
  clientSocket?.close();
  clientSocket = null;

  upstreamSocket?.close();
  upstreamSocket = null;

  upstreamWsServer?.close();
  upstreamWsServer = null;

  if (server) {
    const serverToClose = server;
    server = null;
    await closeServer(serverToClose);
  }

  if (upstreamServer) {
    const serverToClose = upstreamServer;
    upstreamServer = null;
    await closeServer(serverToClose);
  }
});

describe('xAI realtime bridge service', () => {
  it('does not log raw Voximplant media payloads', () => {
    expect(bridgeServiceSource).not.toContain('[VOX-DIAG] in');
    expect(bridgeServiceSource).not.toContain('rawIn.slice');
  });

  it('paces Voximplant audio as one stable chunk per timer tick', () => {
    expect(VOX_FRAME_MS).toBe(100);
    expect(VOX_FRAME_BYTES).toBe(800);
    expect(computeVoxDueFrameCount({
      nowMs: 1_350,
      nextDrainAtMs: 1_000,
      bufferedBytes: 800 * 10,
    })).toBe(1);
    expect(computeVoxDueFrameCount({
      nowMs: 1_350,
      nextDrainAtMs: 1_000,
      bufferedBytes: 800 * 2,
    })).toBe(1);
    expect(computeVoxDueFrameCount({
      nowMs: 1_099,
      nextDrainAtMs: 1_100,
      bufferedBytes: 800 * 10,
    })).toBe(0);
  });

  it('summarizes Voximplant playback pacing by audio duration and wall duration', () => {
    expect(summarizeVoxPacing({
      sentBytes: 3_200,
      firstSendMs: 1_000,
      lastSendMs: 1_300,
      lastFrameBytes: 800,
    })).toEqual({
      sentAudioSec: 0.4,
      sendWallSec: 0.4,
      effectiveHz: 8000,
    });
    expect(summarizeVoxPacing({
      sentBytes: 3_200,
      firstSendMs: 1_000,
      lastSendMs: 1_700,
      lastFrameBytes: 800,
    })).toEqual({
      sentAudioSec: 0.4,
      sendWallSec: 0.8,
      effectiveHz: 4000,
    });
  });

  it('builds a public wss bridge URL with a verifiable token', () => {
    const connection = buildServiceSurveyRealtimeBridgeConnectionConfig({
      bridgeUrl: 'https://svoefoto.ru/api/telephony/service-survey/realtime',
      sessionId: 'service-survey-1',
      tokenSecret: 'test-secret',
      tokenTtlMs: 60_000,
      nowMs: 1_800_000_000_000,
    });

    const url = new URL(connection.url);
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/api/telephony/service-survey/realtime');
    expect(url.searchParams.get('session_id')).toBe('service-survey-1');
    expect(verifyServiceSurveyRealtimeBridgeToken(
      url.searchParams.get('token') ?? '',
      'test-secret',
      1_800_000_001_000,
    )).toEqual({ sessionId: 'service-survey-1' });
  });

  it('creates and verifies short-lived service survey bridge tokens', () => {
    const token = createServiceSurveyRealtimeBridgeToken({
      sessionId: 'service-survey-1',
      expiresAtMs: Date.now() + 60_000,
    }, 'test-secret');

    expect(verifyServiceSurveyRealtimeBridgeToken(token, 'test-secret')).toEqual({
      sessionId: 'service-survey-1',
    });
    expect(verifyServiceSurveyRealtimeBridgeToken(`${token}x`, 'test-secret')).toBeNull();
    expect(verifyServiceSurveyRealtimeBridgeToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects websocket upgrades without a valid bridge token', async () => {
    server = createServer();
    registerXaiRealtimeBridge(server, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: 'test-secret',
      xaiApiKey: 'test-xai-key',
    });
    const port = await listen(server);

    const response = await readUpgradeResponse(
      port,
      '/api/telephony/service-survey/realtime?session_id=service-survey-1&token=bad',
    );

    expect(response).toContain('HTTP/1.1 401 Unauthorized');
  });

  it('bridges Voximplant media frames and xAI realtime events', async () => {
    const customerPcmuBase64 = Buffer.from([0xff, 0x7f, 0x00, 0x80]).toString('base64');
    const assistantPcmuBase64 = Buffer.from([
      ...new Array<number>(160).fill(0xff),
      ...new Array<number>(160).fill(0x7f),
    ]).toString('base64');
    upstreamServer = createServer();
    upstreamWsServer = new WebSocketServer({ server: upstreamServer });
    const upstreamPort = await listen(upstreamServer);
    const upstreamConnection = waitForWsConnection(upstreamWsServer);

    server = createServer();
    registerXaiRealtimeBridge(server, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: 'test-secret',
      xaiApiKey: 'test-xai-key',
      xaiRealtimeUrl: `ws://127.0.0.1:${upstreamPort}/v1/realtime?model=grok-voice-think-fast-1.0`,
    });
    const port = await listen(server);
    const token = createServiceSurveyRealtimeBridgeToken({
      sessionId: 'service-survey-1',
      expiresAtMs: Date.now() + 60_000,
    }, 'test-secret');

    const client = new WebSocket(
      `ws://127.0.0.1:${port}/api/telephony/service-survey/realtime?session_id=service-survey-1&token=${token}&voice=om17cury&instructions=ru`,
    );
    clientSocket = client;
    const clientMessages = createClientMessageQueue(client);
    await waitForOpen(client);
    const upstream = await upstreamConnection;
    upstreamSocket = upstream.socket;

    expect(await upstream.nextMessage('session.update')).toMatchObject({
      type: 'session.update',
      session: {
        voice: 'om17cury',
      },
    });

    // Первое приветствие проигрывает VoxEngine до открытия bridge.
    // На session.updated backend открывает вход клиента и не просит xAI здороваться.
    upstream.socket.send(JSON.stringify({ type: 'session.updated' }));
    expect(await upstream.nextMessageWithin('unexpected greeting response.create', 120)).toBeNull();

    client.send(JSON.stringify({
      event: 'media',
      sequenceNumber: 1,
      media: {
        chunk: 1,
        timestamp: 20,
        payload: customerPcmuBase64,
      },
    }));
    expect(await upstream.nextMessage('audio append')).toEqual({
      type: 'input_audio_buffer.append',
      audio: customerPcmuBase64,
    });

    upstream.socket.send(JSON.stringify({
      type: 'response.output_audio.delta',
      delta: assistantPcmuBase64,
    }));
    expect(await clientMessages.nextMessage('vox start')).toEqual({
      event: 'start',
      sequenceNumber: 0,
      start: {
        mediaFormat: {
          encoding: 'ULAW',
          sampleRate: 8000,
        },
      },
    });
    expect(await clientMessages.nextMessage('vox media')).toEqual({
      event: 'media',
      sequenceNumber: 1,
      media: {
        chunk: 1,
        // первый кадр — с нулевой метки; далее timestamp растёт пропорционально μ-law.
        // Если накоплено меньше 100мс аудио, отправляем весь хвост одним чанком.
        timestamp: 0,
        payload: Buffer.from(assistantPcmuBase64, 'base64').subarray(0, VOX_FRAME_BYTES).toString('base64'),
      },
    });

    client.send(JSON.stringify({ customEvent: 'barge_in' }));
    expect(await upstream.nextMessage('response cancel')).toEqual({
      type: 'response.cancel',
    });

    client.close();
  });

  it('plays the initial greeting through xAI before forwarding client audio', async () => {
    const customerPcmuBase64 = Buffer.from([0xff, 0x7f, 0x00, 0x80]).toString('base64');
    const greeting = 'Здравствуйте! Это Своё Фото.';
    upstreamServer = createServer();
    upstreamWsServer = new WebSocketServer({ server: upstreamServer });
    const upstreamPort = await listen(upstreamServer);
    const upstreamConnection = waitForWsConnection(upstreamWsServer);

    server = createServer();
    registerXaiRealtimeBridge(server, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: 'test-secret',
      xaiApiKey: 'test-xai-key',
      xaiRealtimeUrl: `ws://127.0.0.1:${upstreamPort}/v1/realtime?model=grok-voice-think-fast-1.0`,
    });
    const port = await listen(server);
    const token = createServiceSurveyRealtimeBridgeToken({
      sessionId: 'service-survey-1',
      expiresAtMs: Date.now() + 60_000,
    }, 'test-secret');

    const client = new WebSocket(
      `ws://127.0.0.1:${port}/api/telephony/service-survey/realtime?session_id=service-survey-1&token=${token}&greeting=${encodeURIComponent(greeting)}`,
    );
    clientSocket = client;
    const clientMessages = createClientMessageQueue(client);
    await waitForOpen(client);
    const upstream = await upstreamConnection;
    upstreamSocket = upstream.socket;

    await upstream.nextMessage('session.update');
    upstream.socket.send(JSON.stringify({ type: 'session.updated' }));

    expect(await upstream.nextMessage('initial response.create')).toEqual({
      type: 'response.create',
      response: {
        instructions: [
          `Скажи дословно эту фразу и больше ничего: «${greeting}»`,
          'Не добавляй приветствий, пояснений, вопросов про запись или лишних фраз.',
        ].join(' '),
      },
    });
    expect(await clientMessages.nextMessage('greeting transcript')).toEqual({
      customEvent: 'transcript',
      role: 'bot',
      text: greeting,
    });

    client.send(JSON.stringify({
      event: 'media',
      sequenceNumber: 1,
      media: {
        chunk: 1,
        timestamp: 20,
        payload: customerPcmuBase64,
      },
    }));
    expect(await upstream.nextMessageWithin('unexpected client audio before greeting done', 120)).toBeNull();

    upstream.socket.send(JSON.stringify({ type: 'response.done' }));
    client.send(JSON.stringify({
      event: 'media',
      sequenceNumber: 2,
      media: {
        chunk: 2,
        timestamp: 40,
        payload: customerPcmuBase64,
      },
    }));
    expect(await upstream.nextMessage('audio append after greeting')).toEqual({
      type: 'input_audio_buffer.append',
      audio: customerPcmuBase64,
    });
    client.close();
  });

  it('does not cancel xAI when a barge-in control arrives after the response is done', async () => {
    upstreamServer = createServer();
    upstreamWsServer = new WebSocketServer({ server: upstreamServer });
    const upstreamPort = await listen(upstreamServer);
    const upstreamConnection = waitForWsConnection(upstreamWsServer);

    server = createServer();
    registerXaiRealtimeBridge(server, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: 'test-secret',
      xaiApiKey: 'test-xai-key',
      xaiRealtimeUrl: `ws://127.0.0.1:${upstreamPort}/v1/realtime?model=grok-voice-think-fast-1.0`,
    });
    const port = await listen(server);
    const token = createServiceSurveyRealtimeBridgeToken({
      sessionId: 'service-survey-1',
      expiresAtMs: Date.now() + 60_000,
    }, 'test-secret');

    const client = new WebSocket(
      `ws://127.0.0.1:${port}/api/telephony/service-survey/realtime?session_id=service-survey-1&token=${token}`,
    );
    clientSocket = client;
    await waitForOpen(client);
    const upstream = await upstreamConnection;
    upstreamSocket = upstream.socket;

    await upstream.nextMessage('session.update');
    upstream.socket.send(JSON.stringify({ type: 'session.updated' }));
    upstream.socket.send(JSON.stringify({ type: 'response.done' }));

    client.send(JSON.stringify({ customEvent: 'barge_in' }));

    expect(await upstream.nextMessageWithin('unexpected response.cancel', 120)).toBeNull();
    client.close();
  });

  it('does not cancel xAI when barge-in arrives after response.created but before assistant audio', async () => {
    upstreamServer = createServer();
    upstreamWsServer = new WebSocketServer({ server: upstreamServer });
    const upstreamPort = await listen(upstreamServer);
    const upstreamConnection = waitForWsConnection(upstreamWsServer);

    server = createServer();
    registerXaiRealtimeBridge(server, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: 'test-secret',
      xaiApiKey: 'test-xai-key',
      xaiRealtimeUrl: `ws://127.0.0.1:${upstreamPort}/v1/realtime?model=grok-voice-think-fast-1.0`,
    });
    const port = await listen(server);
    const token = createServiceSurveyRealtimeBridgeToken({
      sessionId: 'service-survey-1',
      expiresAtMs: Date.now() + 60_000,
    }, 'test-secret');

    const client = new WebSocket(
      `ws://127.0.0.1:${port}/api/telephony/service-survey/realtime?session_id=service-survey-1&token=${token}`,
    );
    clientSocket = client;
    await waitForOpen(client);
    const upstream = await upstreamConnection;
    upstreamSocket = upstream.socket;

    await upstream.nextMessage('session.update');
    upstream.socket.send(JSON.stringify({ type: 'session.updated' }));
    upstream.socket.send(JSON.stringify({ type: 'response.created' }));

    client.send(JSON.stringify({ customEvent: 'barge_in' }));

    expect(await upstream.nextMessageWithin('unexpected response.cancel', 120)).toBeNull();
    client.close();
  });

  it('still cancels xAI when audio arrives before response.created', async () => {
    const assistantPcmuBase64 = Buffer.from(new Array<number>(160).fill(0xff)).toString('base64');
    upstreamServer = createServer();
    upstreamWsServer = new WebSocketServer({ server: upstreamServer });
    const upstreamPort = await listen(upstreamServer);
    const upstreamConnection = waitForWsConnection(upstreamWsServer);

    server = createServer();
    registerXaiRealtimeBridge(server, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: 'test-secret',
      xaiApiKey: 'test-xai-key',
      xaiRealtimeUrl: `ws://127.0.0.1:${upstreamPort}/v1/realtime?model=grok-voice-think-fast-1.0`,
    });
    const port = await listen(server);
    const token = createServiceSurveyRealtimeBridgeToken({
      sessionId: 'service-survey-1',
      expiresAtMs: Date.now() + 60_000,
    }, 'test-secret');

    const client = new WebSocket(
      `ws://127.0.0.1:${port}/api/telephony/service-survey/realtime?session_id=service-survey-1&token=${token}`,
    );
    clientSocket = client;
    const clientMessages = createClientMessageQueue(client);
    await waitForOpen(client);
    const upstream = await upstreamConnection;
    upstreamSocket = upstream.socket;

    await upstream.nextMessage('session.update');
    upstream.socket.send(JSON.stringify({ type: 'session.updated' }));
    upstream.socket.send(JSON.stringify({
      type: 'response.output_audio.delta',
      delta: assistantPcmuBase64,
    }));
    await clientMessages.nextMessage('vox start');
    await clientMessages.nextMessage('vox media');

    client.send(JSON.stringify({ customEvent: 'barge_in' }));

    expect(await upstream.nextMessage('response cancel')).toEqual({
      type: 'response.cancel',
    });
    client.close();
  });

  it('drains buffered assistant audio before closing Voximplant when upstream closes first', async () => {
    const assistantPcmuBase64 = Buffer.from(new Array<number>(VOX_FRAME_BYTES * 2).fill(0xff)).toString('base64');
    upstreamServer = createServer();
    upstreamWsServer = new WebSocketServer({ server: upstreamServer });
    const upstreamPort = await listen(upstreamServer);
    const upstreamConnection = waitForWsConnection(upstreamWsServer);

    server = createServer();
    registerXaiRealtimeBridge(server, {
      path: '/api/telephony/service-survey/realtime',
      tokenSecret: 'test-secret',
      xaiApiKey: 'test-xai-key',
      xaiRealtimeUrl: `ws://127.0.0.1:${upstreamPort}/v1/realtime?model=grok-voice-think-fast-1.0`,
    });
    const port = await listen(server);
    const token = createServiceSurveyRealtimeBridgeToken({
      sessionId: 'service-survey-1',
      expiresAtMs: Date.now() + 60_000,
    }, 'test-secret');

    const client = new WebSocket(
      `ws://127.0.0.1:${port}/api/telephony/service-survey/realtime?session_id=service-survey-1&token=${token}`,
    );
    clientSocket = client;
    const clientMessages = createClientMessageQueue(client);
    await waitForOpen(client);
    const upstream = await upstreamConnection;
    upstreamSocket = upstream.socket;

    await upstream.nextMessage('session.update');
    upstream.socket.send(JSON.stringify({ type: 'session.updated' }));
    upstream.socket.send(JSON.stringify({
      type: 'response.output_audio.delta',
      delta: assistantPcmuBase64,
    }));
    upstream.socket.close();

    await clientMessages.nextMessage('vox start');
    const firstMedia = await clientMessages.nextMessage('first buffered media');
    const secondMedia = await clientMessages.nextMessage('second buffered media');
    expect(firstMedia).toMatchObject({ event: 'media', sequenceNumber: 1 });
    expect(secondMedia).toMatchObject({ event: 'media', sequenceNumber: 2 });
    client.close();
  });
});
