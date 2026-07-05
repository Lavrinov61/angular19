/**
 * Omnichannel v2 — Adapter Registry
 *
 * Singleton registry mapping ChannelType → ChannelAdapter.
 * All 6 channel adapters registered at initialization.
 */

import type { ChannelType } from './types.js';
import type { ChannelAdapter } from './adapter.interface.js';
import { createLogger } from '../../../utils/logger.js';
import { createLazyRedis } from '../../redis-factory.js';

const log = createLogger('adapter-registry');

const adapters = new Map<ChannelType, ChannelAdapter>();

/** Register a channel adapter. Overwrites if already registered (for hot-reload/testing). */
export function registerAdapter(adapter: ChannelAdapter): void {
  const existed = adapters.has(adapter.channel);
  adapters.set(adapter.channel, adapter);
  log.info('adapter registered', { channel: adapter.channel, replaced: existed });
}

/**
 * Initialize and register all built-in channel adapters.
 * Called once at app startup. Returns a promise that resolves when all adapters are ready.
 */
export async function initializeAdapters(): Promise<void> {
  await Promise.all([
    import('../telegram/telegram.adapter.js').then(m => registerAdapter(new m.TelegramAdapter())),
    import('../vk/vk.adapter.js').then(m => registerAdapter(new m.VkAdapter())),
    import('../whatsapp/whatsapp.adapter.js').then(m => registerAdapter(new m.WhatsAppAdapter())),
    import('../instagram/instagram.adapter.js').then(m => registerAdapter(new m.InstagramAdapter())),
    import('../max/max.adapter.js').then(m => registerAdapter(new m.MaxAdapter())),
    import('../email/email.adapter.js').then(m => registerAdapter(new m.EmailAdapter())),
  ]);
  log.info('all adapters initialized', { count: adapters.size });
}

/** Get adapter by channel type. Returns undefined if not registered. */
export function getAdapter(channel: ChannelType): ChannelAdapter | undefined {
  return adapters.get(channel);
}

/** Get adapter or throw — for pipeline code that requires an adapter. */
export function getAdapterOrThrow(channel: ChannelType): ChannelAdapter {
  const adapter = adapters.get(channel);
  if (!adapter) {
    throw new Error(`No adapter registered for channel "${channel}"`);
  }
  return adapter;
}

/** Get all registered adapters. */
export function getAllAdapters(): ChannelAdapter[] {
  return Array.from(adapters.values());
}

/** Get list of registered channel types. */
export function getRegisteredChannels(): ChannelType[] {
  return Array.from(adapters.keys());
}

/** Check if a channel has a registered adapter. */
export function hasAdapter(channel: ChannelType): boolean {
  return adapters.has(channel);
}

/** Remove an adapter (for testing). */
export function unregisterAdapter(channel: ChannelType): boolean {
  return adapters.delete(channel);
}

/** Clear all registered adapters (for testing). */
export function clearAdapters(): void {
  adapters.clear();
}

/** Ensure webhooks are registered for all adapters that support it. */
export async function ensureWebhooks(baseUrl: string): Promise<void> {
  const { getAllActiveAccounts } = await import('./account-store.js');
  const accounts = await getAllActiveAccounts();

  for (const account of accounts) {
    const adapter = adapters.get(account.channel);
    if (!adapter?.ensureWebhook) continue;

    try {
      await adapter.ensureWebhook(account, baseUrl);
    } catch (err) {
      log.error('ensureWebhook failed', { channel: account.channel, accountId: account.id, error: String(err) });
    }
  }
}

// ─── Runtime Channel Toggle (Redis-backed) ──────────────────────────────────

const getToggleRedis = createLazyRedis('adapter-toggle', {
  enableOfflineQueue: false,
});

/** Check if a channel is disabled at runtime via admin toggle. */
export async function isChannelDisabled(channel: string): Promise<boolean> {
  try {
    const redis = getToggleRedis();
    if (!redis) return false; // fail open
    const val = await redis.get(`channel:disabled:${channel}`);
    return val === '1';
  } catch {
    return false; // fail open
  }
}

/** Enable or disable a channel at runtime via admin toggle. */
export async function setChannelDisabled(channel: string, disabled: boolean): Promise<void> {
  const redis = getToggleRedis();
  if (!redis) return;
  if (disabled) {
    // TTL 24h — auto-recovers if admin forgets to re-enable
    await redis.set(`channel:disabled:${channel}`, '1', 'EX', 86400);
  } else {
    await redis.del(`channel:disabled:${channel}`);
  }
}
