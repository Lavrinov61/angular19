/**
 * Channel Metrics Service (Redis-based daily counters)
 *
 * Tracks per-channel message metrics with daily bucketing.
 * All operations are fire-and-forget — failures never block delivery.
 * TTL: 90 days per key.
 */

import { createResilientRedis } from './redis-factory.js';

import { createLogger } from '../utils/logger.js';
const redis = createResilientRedis('channel-metrics', {
  lazyConnect: true,
  enableOfflineQueue: false,
});
redis.connect().catch((err: Error) => logger.warn('[ChannelMetrics] Redis connect error:', { detail: err.message }));

const logger = createLogger('channel-metrics.service');
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function dateKey(date?: Date): string {
  const d = date || new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function metricKey(channel: string, metric: string, date?: Date): string {
  return `metrics:${channel}:${dateKey(date)}:${metric}`;
}

async function incrMetric(channel: string, metric: string): Promise<void> {
  try {
    const key = metricKey(channel, metric);
    await redis.incr(key);
    await redis.expire(key, TTL_SECONDS);
  } catch {
    // fire-and-forget
  }
}

async function incrByMetric(channel: string, metric: string, value: number): Promise<void> {
  try {
    const key = metricKey(channel, metric);
    await redis.incrby(key, value);
    await redis.expire(key, TTL_SECONDS);
  } catch {
    // fire-and-forget
  }
}

export function recordSent(channel: string): void {
  incrMetric(channel, 'sent').catch(() => {});
}

export function recordReceived(channel: string): void {
  incrMetric(channel, 'received').catch(() => {});
}

export function recordDelivered(channel: string, deliveryTimeMs: number): void {
  incrMetric(channel, 'delivered').catch(() => {});
  incrByMetric(channel, 'delivery_time_sum', deliveryTimeMs).catch(() => {});
  incrMetric(channel, 'delivery_count').catch(() => {});
}

export function recordFailed(channel: string): void {
  incrMetric(channel, 'failed').catch(() => {});
}

export interface ChannelDayMetrics {
  sent: number;
  received: number;
  delivered: number;
  failed: number;
  avgDeliveryMs: number;
}

export async function getChannelMetrics(channel: string, date?: Date): Promise<ChannelDayMetrics> {
  try {
    const d = date;
    const [sent, received, delivered, failed, deliveryTimeSum, deliveryCount] = await Promise.all([
      redis.get(metricKey(channel, 'sent', d)),
      redis.get(metricKey(channel, 'received', d)),
      redis.get(metricKey(channel, 'delivered', d)),
      redis.get(metricKey(channel, 'failed', d)),
      redis.get(metricKey(channel, 'delivery_time_sum', d)),
      redis.get(metricKey(channel, 'delivery_count', d)),
    ]);
    const dCount = parseInt(deliveryCount || '0', 10);
    const dSum = parseInt(deliveryTimeSum || '0', 10);
    return {
      sent: parseInt(sent || '0', 10),
      received: parseInt(received || '0', 10),
      delivered: parseInt(delivered || '0', 10),
      failed: parseInt(failed || '0', 10),
      avgDeliveryMs: dCount > 0 ? Math.round(dSum / dCount) : 0,
    };
  } catch {
    return { sent: 0, received: 0, delivered: 0, failed: 0, avgDeliveryMs: 0 };
  }
}

export async function getAllChannelMetrics(date?: Date): Promise<Record<string, ChannelDayMetrics>> {
  const channels = ['telegram', 'vk', 'max', 'whatsapp', 'instagram'];
  const results: Record<string, ChannelDayMetrics> = {};
  await Promise.all(channels.map(async (ch) => {
    results[ch] = await getChannelMetrics(ch, date);
  }));
  return results;
}

export async function closeChannelMetrics(): Promise<void> {
  try {
    await redis.quit();
    logger.info('[ChannelMetrics] Redis connection closed');
  } catch (err) {
    logger.warn('[ChannelMetrics] Redis close error:', { error: String(err) });
  }
}
