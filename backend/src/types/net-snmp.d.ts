/**
 * Minimal ambient typings for `net-snmp`.
 *
 * The upstream package ships pure CommonJS with no .d.ts. We declare only the
 * subset the Fleet service consumes, and keep everything else as `unknown`.
 */

declare module 'net-snmp' {
  export interface Varbind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface SessionOptions {
    version?: number;
    timeout?: number;
    retries?: number;
    transport?: string;
    port?: number;
    backoff?: number;
    idBitsSize?: number;
    sourceAddress?: string;
    sourcePort?: number;
  }

  export interface Session {
    get(
      oids: string[],
      callback: (error: Error | null, varbinds?: Varbind[]) => void,
    ): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feedCallback: (varbinds: Varbind[]) => void,
      doneCallback: (error: Error | null) => void,
    ): void;
    close(): void;
    on(event: 'close' | 'error', listener: (err?: Error) => void): void;
  }

  export function createSession(
    target: string,
    community: string,
    options?: SessionOptions,
  ): Session;

  export function isVarbindError(varbind: Varbind): boolean;
  export function varbindError(varbind: Varbind): string;

  export const Version1: number;
  export const Version2c: number;
  export const Version3: number;

  export const ObjectType: Readonly<Record<string, number>>;
  export const ErrorStatus: Readonly<Record<string, number>>;
  export const TrapType: Readonly<Record<string, number>>;
  export const PduType: Readonly<Record<string, number>>;
}
