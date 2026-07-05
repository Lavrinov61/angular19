// Client-side polyfills for Node.js modules
// This file provides empty implementations for Node.js built-in modules
// that might be referenced in the client bundle

export const fs = {
  readFileSync: () => '',
  writeFileSync: () => undefined,
  existsSync: () => false,
  statSync: () => ({ isFile: () => false, isDirectory: () => false }),
  readdirSync: () => [],
  mkdirSync: () => undefined,
  unlinkSync: () => undefined,
  readFile: (_path: unknown, callback: (err: null, data: string) => void) => callback(null, ''),
  writeFile: (_path: unknown, _data: unknown, callback: (err: null) => void) => callback(null),
};

export const path = {
  join: (...args: string[]) => args.join('/'),
  resolve: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  basename: (p: string) => p.split('/').pop() || '',
  extname: (p: string) => {
    const base = p.split('/').pop() || '';
    const lastDot = base.lastIndexOf('.');
    return lastDot === -1 ? '' : base.slice(lastDot);
  },
  normalize: (p: string) => p,
  isAbsolute: (p: string) => p.startsWith('/'),
  relative: (_from: string, to: string) => to,
  sep: '/',
  delimiter: ':',
  posix: {},
  win32: {},
};

export const os = {
  platform: () => 'browser',
  release: () => '1.0.0',
  type: () => 'Browser',
  hostname: () => {
    // Во время SSR не возвращаем фиксированное значение
    // Позволяем Angular правильно определить hostname
    if (typeof window !== 'undefined' && window.location) {
      return window.location.hostname;
    }
    // Во время SSR возвращаем undefined, чтобы Angular мог использовать свои механизмы
    return undefined;
  },
  tmpdir: () => '/tmp',
  homedir: () => '/home',
  cpus: () => [],
  totalmem: () => 0,
  freemem: () => 0,
  uptime: () => 0,
  loadavg: () => [0, 0, 0],
  networkInterfaces: () => ({}),
  arch: () => 'x64',
  endianness: () => 'LE',
  EOL: '\n',
};

export const crypto = {
  createHash: () => ({
    update: () => ({ digest: () => 'mock-hash' }),
  }),
  createHmac: () => ({
    update: () => ({ digest: () => 'mock-hmac' }),
  }),
  randomBytes: (size: number) => new Uint8Array(size),
  pbkdf2: () => undefined,
  pbkdf2Sync: () => new ArrayBuffer(0),
  createCipher: () => ({
    update: () => '',
    final: () => '',
  }),
  createDecipher: () => ({
    update: () => '',
    final: () => '',
  }),
  constants: {},
};

export const stream = {
  Readable: class {
    pipe() { return this; }
    on() { return this; }
    once() { return this; }
    emit() { return this; }
    end() { return this; }
    write() { return this; }
    read() { return null; }
    pause() { return this; }
    resume() { return this; }
    isPaused() { return false; }
    setEncoding() { return this; }
    destroy() { return this; }
  },
  Writable: class {
    pipe() { return this; }
    on() { return this; }
    once() { return this; }
    emit() { return this; }
    end() { return this; }
    write() { return this; }
    destroy() { return this; }
  },
  Transform: class {
    pipe() { return this; }
    on() { return this; }
    once() { return this; }
    emit() { return this; }
    end() { return this; }
    write() { return this; }
    read() { return null; }
    destroy() { return this; }
    _transform() { void 0; }
  },
  PassThrough: class {
    pipe() { return this; }
    on() { return this; }
    once() { return this; }
    emit() { return this; }
    end() { return this; }
    write() { return this; }
    read() { return null; }
    destroy() { return this; }
  },
};

export const http = {
  createServer: () => ({}),
  request: () => ({}),
  get: () => ({}),
  globalAgent: {},
  Agent: class {},
  Server: class {},
  IncomingMessage: class {},
  ServerResponse: class {},
};

export const https = {
  createServer: () => ({}),
  request: () => ({}),
  get: () => ({}),
  globalAgent: {},
  Agent: class {},
  Server: class {},
};

export const http2 = {
  createServer: () => ({}),
  createSecureServer: () => ({}),
  connect: () => ({}),
  constants: {},
};

export const url = {
  parse: (urlStr: string) => ({
    protocol: null,
    slashes: null,
    auth: null,
    host: null,
    port: null,
    hostname: null,
    hash: null,
    search: null,
    query: null,
    pathname: urlStr,
    path: urlStr,
    href: urlStr,
  }),
  resolve: (_from: string, to: string) => to,
  format: () => '',
  URL: class {
    constructor(public href: string) {}
    toString() { return this.href; }
  },
  URLSearchParams: class {
    append() { void 0; }
    delete() { void 0; }
    get() { return null; }
    getAll() { return []; }
    has() { return false; }
    set() { void 0; }
    sort() { void 0; }
    toString() { return ''; }
  },
};

export const querystring = {
  parse: () => ({}),
  stringify: () => '',
  escape: (str: string) => str,
  unescape: (str: string) => str,
};

export const buffer = {
  Buffer: {
    from: (_data: unknown) => new Uint8Array(),
    alloc: (size: number) => new Uint8Array(size),
    allocUnsafe: (size: number) => new Uint8Array(size),
    isBuffer: () => false,
    byteLength: () => 0,
    compare: () => 0,
    concat: () => new Uint8Array(),
  },
};

export const events = {
  EventEmitter: class {
    on() { return this; }
    once() { return this; }
    emit() { return this; }
    removeListener() { return this; }
    removeAllListeners() { return this; }
    setMaxListeners() { return this; }
    getMaxListeners() { return 0; }
    listeners() { return []; }
    listenerCount() { return 0; }
    prependListener() { return this; }
    prependOnceListener() { return this; }
    eventNames() { return []; }
  },
};

export const util = {
  format: (...args: unknown[]) => args.map(String).join(' '),
  inspect: (obj: unknown) => String(obj),
  isArray: Array.isArray,
  isRegExp: (obj: unknown) => obj instanceof RegExp,
  isDate: (obj: unknown) => obj instanceof Date,
  isError: (obj: unknown) => obj instanceof Error,
  inherits: () => undefined,
  deprecate: (fn: (...a: unknown[]) => unknown) => fn,
  debuglog: () => () => undefined,
  isDeepStrictEqual: () => false,
  promisify: (_fn: (...a: unknown[]) => unknown) => (..._args: unknown[]) => Promise.resolve(),
  callbackify: (fn: (...a: unknown[]) => unknown) => fn,
  types: {},
};

export const zlib = {
  gzip: () => undefined,
  gunzip: () => undefined,
  deflate: () => undefined,
  inflate: () => undefined,
  createGzip: () => ({}),
  createGunzip: () => ({}),
  createDeflate: () => ({}),
  createInflate: () => ({}),
  constants: {},
};

export const net = {
  createServer: () => ({}),
  createConnection: () => ({}),
  connect: () => ({}),
  Socket: class {},
  Server: class {},
};

export const tls = {
  createServer: () => ({}),
  createSecureContext: () => ({}),
  connect: () => ({}),
  TLSSocket: class {},
  Server: class {},
};

export const child_process = {
  spawn: () => ({}),
  exec: () => ({}),
  execFile: () => ({}),
  fork: () => ({}),
  execSync: () => '',
  execFileSync: () => '',
  spawnSync: () => ({}),
  ChildProcess: class {},
};

export const cluster = {
  isMaster: true,
  isWorker: false,
  worker: null,
  workers: {},
  settings: {},
  fork: () => ({}),
  disconnect: () => undefined,
  setupMaster: () => undefined,
};

export const process = {
  argv: [],
  env: {},
  platform: 'browser',
  version: '1.0.0',
  versions: {},
  arch: 'x64',
  pid: 1,
  ppid: 0,
  title: 'browser',
  cwd: () => '/',
  chdir: () => undefined,
  exit: () => undefined,
  kill: () => undefined,
  nextTick: (fn: (...args: unknown[]) => void) => setTimeout(fn, 0),
  stdout: { write: () => undefined },
  stderr: { write: () => undefined },
  stdin: { on: () => undefined, pause: () => undefined, resume: () => undefined },
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
  uptime: () => 0,
  hrtime: () => [0, 0],
  on: () => undefined,
  once: () => undefined,
  emit: () => false,
  removeListener: () => undefined,
  removeAllListeners: () => undefined,
};

// Default export for dynamic imports
export default {
  fs,
  path,
  os,
  crypto,
  stream,
  http,
  https,
  http2,
  url,
  querystring,
  buffer,
  events,
  util,
  zlib,
  net,
  tls,
  child_process,
  cluster,
  process,
};
