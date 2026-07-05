/**
 * BotTemplateService — centralized bot message template management.
 * Templates stored in `bot_message_templates` table, cached in-memory with 5min TTL.
 * All templates are plain text (no **markdown**), with {placeholder} variables.
 */

import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import type BotMessageTemplates from '../types/generated/public/BotMessageTemplates.js';

const logger = createLogger('bot-template');

interface TemplateEntry {
  content: string;
  is_active: boolean | null;
}

class BotTemplateService {
  private cache = new Map<string, TemplateEntry>();
  private cacheExpiry = 0;
  private readonly TTL = 5 * 60_000; // 5 minutes

  /**
   * Render a template by event_type, substituting {placeholder} variables.
   * Returns null if template not found or inactive (error is logged).
   */
  async render(eventType: string, vars: Record<string, string | number> = {}): Promise<string | null> {
    await this.ensureCache();
    const entry = this.cache.get(eventType);
    if (!entry || !entry.is_active) {
      logger.error(`Bot template '${eventType}' not found or inactive`);
      return null;
    }
    const result = entry.content.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (vars[key] === undefined) {
        logger.warn(`Missing placeholder '${key}' in template '${eventType}'`);
      }
      return String(vars[key] ?? '');
    });
    return result;
  }

  /**
   * Get raw template content without variable substitution.
   */
  async getContent(eventType: string): Promise<string | null> {
    await this.ensureCache();
    return this.cache.get(eventType)?.content ?? null;
  }

  /**
   * Invalidate the cache (e.g. after admin edits templates).
   */
  invalidate(): void {
    this.cacheExpiry = 0;
  }

  private async ensureCache(): Promise<void> {
    if (Date.now() < this.cacheExpiry) return;
    try {
      const rows = await pool.query<Pick<BotMessageTemplates, 'event_type' | 'content' | 'is_active'>>(
        'SELECT event_type, content, is_active FROM bot_message_templates',
      );
      this.cache.clear();
      for (const r of rows.rows) {
        this.cache.set(r.event_type, { content: r.content, is_active: r.is_active });
      }
      this.cacheExpiry = Date.now() + this.TTL;
    } catch (err) {
      logger.error('Failed to load bot_message_templates', { error: err });
      // Keep stale cache if we have one, otherwise next call will retry
      if (this.cache.size > 0) {
        this.cacheExpiry = Date.now() + 30_000; // retry in 30s
      }
    }
  }
}

export const botTemplates = new BotTemplateService();
