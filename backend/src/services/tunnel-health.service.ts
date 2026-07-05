/**
 * SSH Tunnel Health Monitor — checks reverse tunnels every 5 minutes.
 *
 * Known tunnels:
 *   - Soborny   → localhost:10001
 *   - Barrikadnaya → localhost:10002
 *
 * On failure: inserts infra_alert (severity='warning', dedup 30 min).
 * On recovery: auto-resolves the open alert.
 * Runs only on the leader node (registered in server.ts).
 */
import net from 'node:net';
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tunnel-health');

const INTERVAL_MS = 5 * 60_000; // 5 minutes
const TCP_TIMEOUT_MS = 5_000;
const DEDUP_MINUTES = 30;
const ALERT_TYPE = 'ssh_tunnel_down';

interface TunnelTarget {
  name: string;
  port: number;
  studioId: string;
}

const TUNNELS: TunnelTarget[] = [
  { name: 'Soborny',      port: 10001, studioId: '30ef357f-06a6-4b01-b1ff-dbbe7eaed446' },
  { name: 'Barrikadnaya', port: 10002, studioId: 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69' },
];

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function tcpProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, TCP_TIMEOUT_MS);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

async function checkTunnels(): Promise<void> {
  for (const tunnel of TUNNELS) {
    try {
      const alive = await tcpProbe(tunnel.port);

      if (alive) {
        // Auto-resolve any open alert for this tunnel
        const resolved = await db.query<{ id: string }>(
          `UPDATE infra_alerts
           SET resolved_at = NOW()
           WHERE studio_id = $1
             AND alert_type = $2
             AND resolved_at IS NULL
           RETURNING id`,
          [tunnel.studioId, ALERT_TYPE],
        );
        if (resolved.length > 0) {
          logger.info(`Tunnel ${tunnel.name} (:${tunnel.port}) recovered — resolved ${resolved.length} alert(s)`);
        }
      } else {
        // Check dedup: don't create duplicate alert within DEDUP_MINUTES
        const existing = await db.query<{ id: string }>(
          `SELECT id FROM infra_alerts
           WHERE studio_id = $1
             AND alert_type = $2
             AND resolved_at IS NULL
             AND created_at > NOW() - INTERVAL '${DEDUP_MINUTES} minutes'
           LIMIT 1`,
          [tunnel.studioId, ALERT_TYPE],
        );

        if (existing.length === 0) {
          await db.query(
            `INSERT INTO infra_alerts (studio_id, alert_type, severity, title, details)
             VALUES ($1, $2, 'warning', $3, $4::jsonb)`,
            [
              tunnel.studioId,
              ALERT_TYPE,
              `SSH tunnel ${tunnel.name} unreachable`,
              JSON.stringify({ port: tunnel.port, host: '127.0.0.1', timeout_ms: TCP_TIMEOUT_MS }),
            ],
          );
          logger.warn(`Tunnel ${tunnel.name} (:${tunnel.port}) DOWN — alert created`);
        } else {
          logger.debug(`Tunnel ${tunnel.name} (:${tunnel.port}) still down (dedup active)`);
        }
      }
    } catch (err) {
      logger.error(`Tunnel health check error for ${tunnel.name}`, { error: String(err) });
    }
  }
}

export function startTunnelHealthScheduler(): void {
  if (intervalHandle) {
    logger.warn('Tunnel health scheduler already running');
    return;
  }

  logger.info(`Tunnel health scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // First check after 30s (let system stabilize)
  setTimeout(() => { checkTunnels(); }, 30_000);
  intervalHandle = setInterval(checkTunnels, INTERVAL_MS);
}

export function stopTunnelHealthScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Tunnel health scheduler stopped');
  }
}
