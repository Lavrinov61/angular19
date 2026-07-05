import type { SocketServer } from '../websocket/socket-server.js';

declare module 'express-serve-static-core' {
  interface Application {
    socketServer?: SocketServer;
  }

  interface Request {
    rawBody?: string;
  }
}
