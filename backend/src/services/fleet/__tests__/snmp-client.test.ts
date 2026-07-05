/**
 * Unit tests for snmp-client.
 *
 * We stub `net-snmp` via `vi.mock()` so no real UDP traffic is generated.
 * The parser logic (level_pct calc, offline fallback, index extraction) is
 * exercised against synthetic varbind arrays.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock net-snmp BEFORE importing the module under test. `vi.hoisted` lets us share
// the mock session object between the factory (hoisted to file top) and the tests.
const mocks = vi.hoisted(() => {
  const mockSession = {
    get: vi.fn(),
    subtree: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
  const mockCreateSession = vi.fn(() => mockSession);
  return { mockSession, mockCreateSession };
});

vi.mock('net-snmp', () => ({
  createSession: mocks.mockCreateSession,
  isVarbindError: vi.fn(() => false),
  varbindError: vi.fn(() => 'error'),
  Version1: 0,
  Version2c: 1,
  ObjectType: {
    Integer: 2,
    OctetString: 4,
    Counter: 65,
    Gauge: 66,
  },
}));

const { mockSession, mockCreateSession } = mocks;

import {
  __resetBreakersForTests,
  __test__,
  fetchTelemetry,
  getCircuitState,
} from '../snmp-client.js';
import { STANDARD_OIDS } from '../snmp-oids.js';

type Varbind = { oid: string; type: number; value: unknown };

interface ScalarPair {
  oid: string;
  value: unknown;
  type?: number;
}

function primeScalars(pairs: ScalarPair[]): void {
  mockSession.get.mockImplementationOnce(
    (oids: string[], cb: (err: Error | null, varbinds?: Varbind[]) => void) => {
      const byOid = new Map(pairs.map((p) => [p.oid, p]));
      const varbinds: Varbind[] = oids.map((oid) => {
        const found = byOid.get(oid);
        if (found) {
          return { oid, type: found.type ?? 4, value: found.value };
        }
        // No-op varbind with a value of 0 so isVarbindError returns false.
        return { oid, type: 2, value: 0 };
      });
      setImmediate(() => cb(null, varbinds));
    },
  );
}

interface WalkFixture {
  baseOid: string;
  rows: Array<{ index: number; value: unknown; type?: number }>;
}

/**
 * Queue up N subtree() responses in the order they will be requested by
 * actualFetchTelemetry. Entries omitted will return an empty walk.
 */
function primeWalks(walks: WalkFixture[]): void {
  const byBase = new Map(walks.map((w) => [w.baseOid, w]));

  mockSession.subtree.mockImplementation(
    (
      baseOid: string,
      _max: number,
      feedCb: (vbs: Varbind[]) => void,
      doneCb: (err: Error | null) => void,
    ) => {
      const fx = byBase.get(baseOid);
      setImmediate(() => {
        if (fx && fx.rows.length > 0) {
          const vbs: Varbind[] = fx.rows.map((r) => ({
            oid: `${baseOid}.${r.index}`,
            type: r.type ?? 2,
            value: r.value,
          }));
          feedCb(vbs);
        }
        doneCb(null);
      });
    },
  );
}

beforeEach(() => {
  __resetBreakersForTests();
  mockSession.get.mockReset();
  mockSession.subtree.mockReset();
  mockSession.close.mockReset();
  mockSession.on.mockReset();
  mockCreateSession.mockClear();
  mockCreateSession.mockImplementation(() => mockSession);
});

afterEach(() => {
  vi.clearAllTimers();
});

describe('fetchTelemetry — happy path', () => {
  it('parses supplies with level_pct correctly', async () => {
    primeScalars([
      { oid: STANDARD_OIDS.sysDescr, value: 'Canon iR-ADV C3226 /P /Firmware: 01.10' },
      { oid: STANDARD_OIDS.hrDeviceStatus, value: 2 },
      { oid: STANDARD_OIDS.prtMarkerLifeCount, value: 12345 },
    ]);

    primeWalks([
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesLevel,
        rows: [
          { index: 1, value: 250 },
          { index: 2, value: 1000 },
        ],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesDescription,
        rows: [
          { index: 1, value: Buffer.from('Cyan Toner', 'utf8'), type: 4 },
          { index: 2, value: Buffer.from('Black Toner', 'utf8'), type: 4 },
        ],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesMaxCapacity,
        rows: [
          { index: 1, value: 1000 },
          { index: 2, value: 1000 },
        ],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesType,
        rows: [
          { index: 1, value: 3 },
          { index: 2, value: 3 },
        ],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesColorantIndex,
        rows: [
          { index: 1, value: 1 },
          { index: 2, value: 2 },
        ],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerColorantValue,
        rows: [
          { index: 1, value: Buffer.from('cyan', 'utf8'), type: 4 },
          { index: 2, value: Buffer.from('black', 'utf8'), type: 4 },
        ],
      },
    ]);

    const snapshot = await fetchTelemetry('10.0.0.1', 'public');

    expect(snapshot.is_online).toBe(true);
    expect(snapshot.state).toBe('running');
    expect(snapshot.supplies).toHaveLength(2);

    const cyan = snapshot.supplies.find((s) => s.colorant === 'cyan');
    const black = snapshot.supplies.find((s) => s.colorant === 'black');
    expect(cyan).toBeDefined();
    expect(cyan?.level_pct).toBe(25); // 250/1000
    expect(cyan?.type).toBe('toner');
    expect(black?.level_pct).toBe(100); // 1000/1000
    expect(snapshot.counters.lifetime).toBe(12345);
    expect(snapshot.firmware_version).toBe('01.10');
  });

  it('clamps negative supply levels to null (RFC 3805: -1 = unknown)', async () => {
    primeScalars([{ oid: STANDARD_OIDS.sysDescr, value: 'Test Printer' }]);

    primeWalks([
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesLevel,
        rows: [{ index: 1, value: -1 }],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesMaxCapacity,
        rows: [{ index: 1, value: 1000 }],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesDescription,
        rows: [{ index: 1, value: Buffer.from('Unknown', 'utf8'), type: 4 }],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesType,
        rows: [{ index: 1, value: 3 }],
      },
    ]);

    const snapshot = await fetchTelemetry('10.0.0.2', 'public');
    expect(snapshot.supplies).toHaveLength(1);
    expect(snapshot.supplies[0]?.level_pct).toBeNull();
  });

  it('caps over-100 ratios at 100', async () => {
    primeScalars([{ oid: STANDARD_OIDS.sysDescr, value: 'Test' }]);
    primeWalks([
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesLevel,
        rows: [{ index: 1, value: 1500 }],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesMaxCapacity,
        rows: [{ index: 1, value: 1000 }],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesDescription,
        rows: [{ index: 1, value: Buffer.from('Overfill', 'utf8'), type: 4 }],
      },
      {
        baseOid: STANDARD_OIDS.prtMarkerSuppliesType,
        rows: [{ index: 1, value: 4 }],
      },
    ]);

    const snapshot = await fetchTelemetry('10.0.0.3', 'public');
    expect(snapshot.supplies[0]?.level_pct).toBe(100);
    expect(snapshot.supplies[0]?.type).toBe('ink');
  });
});

describe('fetchTelemetry — session error path', () => {
  it('returns is_online=false when createSession throws', async () => {
    mockCreateSession.mockImplementationOnce(() => {
      throw new Error('UDP bind failed');
    });

    const snapshot = await fetchTelemetry('10.0.0.99', 'public');
    expect(snapshot.is_online).toBe(false);
    expect(snapshot.state).toBeNull();
    expect(snapshot.supplies).toEqual([]);
    expect(snapshot.trays).toEqual([]);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.counters).toEqual({ lifetime: null, power_on: null });
    expect(snapshot.firmware_version).toBeNull();
    expect(snapshot.serial_number).toBeNull();
  });

  it('returns is_online=false when all scalars and walks are empty', async () => {
    // session.get callback returns an error
    mockSession.get.mockImplementationOnce(
      (_oids: string[], cb: (err: Error | null) => void) => {
        setImmediate(() => cb(new Error('timeout')));
      },
    );
    // all walks return empty
    mockSession.subtree.mockImplementation(
      (
        _base: string,
        _max: number,
        _feed: (vbs: Varbind[]) => void,
        done: (err: Error | null) => void,
      ) => {
        setImmediate(() => done(null));
      },
    );

    const snapshot = await fetchTelemetry('10.0.0.100', 'public');
    expect(snapshot.is_online).toBe(false);
  });
});

describe('extractIndex', () => {
  it('returns the first numeric segment under a base OID', () => {
    const baseOid = '1.3.6.1.2.1.43.11.1.1.9.1';
    expect(__test__.extractIndex(baseOid, `${baseOid}.3`)).toBe(3);
    expect(__test__.extractIndex(baseOid, `${baseOid}.3.5`)).toBe(3);
    expect(__test__.extractIndex(baseOid, '1.2.3.4')).toBeNull();
  });
});

describe('asNumber / asString', () => {
  it('asNumber parses buffers as big-endian integers', () => {
    expect(__test__.asNumber(Buffer.from([0x01, 0x00]))).toBe(256);
    expect(__test__.asNumber(Buffer.from([0x7f]))).toBe(127);
  });

  it('asString decodes buffers and trims trailing spaces', () => {
    expect(__test__.asString(Buffer.from('hello   ', 'utf8'))).toBe('hello');
    expect(__test__.asString(null)).toBeNull();
    expect(__test__.asString('  foo  ')).toBe('  foo  ');
  });
});

describe('getCircuitState', () => {
  it('returns "closed" for an unknown printer', () => {
    expect(getCircuitState('10.255.255.1')).toBe('closed');
  });
});
