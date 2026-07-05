/**
 * kb-faq.service.ts — F68: Search Knowledge Base for FAQ answers.
 *
 * Called before AI/operator handoff in chat message flow.
 * Uses KB Rust API (localhost:3003) for full-text + fuzzy search.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('kb-faq');

const KB_API_BASE = process.env['KB_API_URL'] || 'http://localhost:3003';
const KB_SEARCH_TIMEOUT = 3000; // 3s — don't block chat if KB is slow
const KB_MIN_QUERY_LENGTH = 5;  // Skip very short messages ("да", "ок")
const KB_SCORE_THRESHOLD = 0.3; // Minimum relevance score

interface KbSearchResult {
  id: string;
  title: string;
  content: string;
  score: number;
  category?: string;
}

interface KbSearchResponse {
  results: KbSearchResult[];
  total: number;
}

/**
 * Search KB for an answer to the visitor's question.
 * Returns formatted bot response or null if no relevant results.
 */
export async function searchKbForFaq(query: string): Promise<string | null> {
  if (!query || query.length < KB_MIN_QUERY_LENGTH) return null;

  try {
    const res = await fetch(`${KB_API_BASE}/api/kb/search/combined`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, limit: 3 }),
      signal: AbortSignal.timeout(KB_SEARCH_TIMEOUT),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as KbSearchResponse;
    if (!data.results?.length) return null;

    // Filter by score threshold
    const relevant = data.results.filter(r => r.score >= KB_SCORE_THRESHOLD);
    if (relevant.length === 0) return null;

    const best = relevant[0];
    // Truncate long content
    const answer = best.content.length > 500
      ? best.content.substring(0, 497) + '...'
      : best.content;

    logger.info('KB FAQ match', { query: query.substring(0, 50), title: best.title, score: best.score });

    return `📋 ${best.title}\n\n${answer}\n\n💬 Если нужна помощь — напишите, подключим оператора.`;
  } catch (err) {
    // KB unavailable — silently fall through to AI/operator
    logger.debug('KB search failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
