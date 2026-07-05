/**
 * This module provides a unified way to import Node.js built-in modules in a way that's
 * compatible with both the browser and server environments in SSR.
 * 
 * Usage example:
 * ```
 * import { fs, path, process } from './server-module-proxy';
 * ```
 */

// Dummy implementations for browser
const dummyFs = {
  existsSync: (_path: string) => false,
  readFileSync: (_path: string, _options?: unknown) => '',
  writeFileSync: (_path: string, _data: unknown) => undefined,
  promises: {
    readFile: async (_path: string) => '',
    writeFile: async (_path: string, _data: unknown) => undefined
  }
};

const dummyPath = {
  resolve: (...paths: string[]) => paths.join('/'),
  join: (...paths: string[]) => paths.join('/'),
  dirname: (p: string) => p,
  basename: (p: string) => p
};

const dummyProcess = {
  cwd: () => '',
  env: {} as Record<string, string | undefined>,
  nextTick: (cb: (...args: unknown[]) => void) => setTimeout(cb, 0)
};

const dummyCrypto = {
  randomBytes: () => ({ toString: () => 'random' }),
  createHash: () => ({
    update: () => ({ digest: () => 'hash' })
  })
};

const dummyHttp = {
  createServer: () => ({
    listen: () => undefined
  })
};

// Detect server environment
const isServer = typeof window === 'undefined';

interface ServerProcess {
  cwd: () => string;
  env: Record<string, string | undefined>;
  nextTick: (cb: (...args: unknown[]) => void) => unknown;
}
interface GlobalWithRequire { require?: (id: string) => unknown; process?: ServerProcess }

// Safe import function for Node.js modules
function safeRequire(moduleName: string): unknown {
  if (!isServer) return null;

  try {
    const g = globalThis as GlobalWithRequire;
    return g.require?.(moduleName) ?? null;
  } catch {
    return null;
  }
}

// Type-safe server module loaders (safeRequire returns unknown, fallback provides the shape)
function loadFs(): typeof dummyFs {
  const mod = safeRequire('fs');
  return isNodeFs(mod) ? mod : dummyFs;
}
function isNodeFs(mod: unknown): mod is typeof dummyFs {
  return mod != null && typeof (mod as typeof dummyFs).existsSync === 'function';
}

function loadPath(): typeof dummyPath {
  const mod = safeRequire('path');
  return isNodePath(mod) ? mod : dummyPath;
}
function isNodePath(mod: unknown): mod is typeof dummyPath {
  return mod != null && typeof (mod as typeof dummyPath).resolve === 'function';
}

// Export the real modules on server or dummies on browser
export const fs = isServer ? loadFs() : dummyFs;
export const path = isServer ? loadPath() : dummyPath;
function getServerProcess(): ServerProcess {
  const g = globalThis as GlobalWithRequire;
  return g.process || dummyProcess;
}
export const process: ServerProcess = isServer ? getServerProcess() : dummyProcess;
function loadModule<T>(name: string, dummy: T, check: (mod: unknown) => mod is T): T {
  const mod = safeRequire(name);
  return check(mod) ? mod : dummy;
}
function isCryptoLike(mod: unknown): mod is typeof dummyCrypto {
  return mod != null && typeof (mod as typeof dummyCrypto).randomBytes === 'function';
}
function isHttpLike(mod: unknown): mod is typeof dummyHttp {
  return mod != null && typeof (mod as typeof dummyHttp).createServer === 'function';
}

export const crypto = isServer ? loadModule('crypto', dummyCrypto, isCryptoLike) : dummyCrypto;
export const http = isServer ? loadModule('http', dummyHttp, isHttpLike) : dummyHttp;
export const https = isServer ? loadModule('https', dummyHttp, isHttpLike) : dummyHttp;

// Helper function to check if we're running on the server
export function isServerPlatform(): boolean {
  return isServer;
}
