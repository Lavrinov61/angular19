import { Injectable, signal, computed, effect, type WritableSignal } from '@angular/core';
import type { SearchResult, UiCategory } from '../models/payment-dialog.models';

/** Cyrillic ↔ Latin transliteration map for cross-layout search */
const CYR_TO_LAT: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

/** QWERTY → ЙЦУКЕН layout mapping (for wrong-layout input) */
const LAT_TO_CYR: Record<string, string> = {
  'q': 'й', 'w': 'ц', 'e': 'у', 'r': 'к', 't': 'е', 'y': 'н', 'u': 'г',
  'i': 'ш', 'o': 'щ', 'p': 'з', '[': 'х', ']': 'ъ', 'a': 'ф', 's': 'ы',
  'd': 'в', 'f': 'а', 'g': 'п', 'h': 'р', 'j': 'о', 'k': 'л', 'l': 'д',
  ';': 'ж', "'": 'э', 'z': 'я', 'x': 'ч', 'c': 'с', 'v': 'м', 'b': 'и',
  'n': 'т', 'm': 'ь', ',': 'б', '.': 'ю',
};

function transliterate(text: string): string {
  return text.split('').map(ch => CYR_TO_LAT[ch] ?? ch).join('');
}

function convertLayout(text: string): string {
  return text.split('').map(ch => LAT_TO_CYR[ch] ?? ch).join('');
}

interface HaystackEntry {
  readonly text: string;
  readonly serviceId: string;
  readonly categorySlug: string;
  readonly categoryName: string;
}

/**
 * Fuzzy search service for payment dialog.
 * Uses @leeoniya/ufuzzy for typo-tolerant matching
 * with cyrillic↔latin transliteration support.
 *
 * NOT providedIn: 'root' — scoped to the dialog.
 */
@Injectable()
export class FuzzySearchService {

  readonly query = signal('');
  readonly results: WritableSignal<readonly SearchResult[]> = signal([]);

  private readonly debouncedQuery = signal('');
  readonly isSearching = computed(() => this.debouncedQuery().length > 0);

  private haystack: readonly HaystackEntry[] = [];
  private haystackTexts: readonly string[] = [];
  private categoriesRef: readonly UiCategory[] = [];

  // uFuzzy instance — lazy loaded
  private ufuzzyInstance: unknown = null;
  private ufuzzyLoaded = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Debounce the query signal (200ms)
    effect(() => {
      const q = this.query();
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debouncedQuery.set(q.trim().toLowerCase());
      }, 200);
    });

    // React to debounced query changes
    effect(() => {
      const q = this.debouncedQuery();
      if (q.length === 0) {
        this.results.set([]);
        return;
      }
      this.performSearch(q);
    });
  }

  /** Build search index from loaded categories */
  buildIndex(categories: readonly UiCategory[]): void {
    this.categoriesRef = categories;
    const entries: HaystackEntry[] = [];

    for (const cat of categories) {
      for (const svc of cat.allOptions) {
        const parts = [
          svc.name,
          svc.description,
          svc.slug,
          ...svc.features,
          transliterate(svc.name.toLowerCase()),
        ];
        entries.push({
          text: parts.join(' ').toLowerCase(),
          serviceId: svc.id,
          categorySlug: cat.slug,
          categoryName: cat.name,
        });
      }
    }

    this.haystack = entries;
    this.haystackTexts = entries.map(e => e.text);
  }

  private async performSearch(query: string): Promise<void> {
    if (this.haystack.length === 0) {
      this.results.set([]);
      return;
    }

    // Try uFuzzy first
    const uf = await this.getUFuzzy();
    if (uf) {
      const ufResults = this.searchWithUFuzzy(uf, query);
      if (ufResults.length > 0) {
        this.results.set(ufResults);
        return;
      }
    }

    // Fallback: includes-based search with layout conversion
    const fallbackResults = this.fallbackSearch(query);
    this.results.set(fallbackResults);
  }

  private searchWithUFuzzy(uf: { search: (haystack: readonly string[], query: string) => [unknown, unknown, unknown] }, query: string): readonly SearchResult[] {
    const queries = [query, convertLayout(query), transliterate(query)];
    const resultMap = new Map<string, SearchResult>();

    for (const q of queries) {
      if (!q) continue;
      const [idxs, , orders] = uf.search(this.haystackTexts, q);
      if (!idxs) continue;

      const sortedIdxs = orders
        ? (orders as number[]).map(oi => (idxs as number[])[oi])
        : (idxs as number[]);

      for (const idx of sortedIdxs) {
        const entry = this.haystack[idx];
        if (!entry || resultMap.has(entry.serviceId)) continue;

        const service = this.findServiceById(entry.serviceId);
        if (service) {
          resultMap.set(entry.serviceId, {
            service,
            categorySlug: entry.categorySlug,
            categoryName: entry.categoryName,
          });
        }
      }
    }

    return [...resultMap.values()];
  }

  private fallbackSearch(query: string): readonly SearchResult[] {
    const queries = [query, convertLayout(query)].filter(Boolean);
    const resultMap = new Map<string, SearchResult>();

    for (const entry of this.haystack) {
      for (const q of queries) {
        if (entry.text.includes(q)) {
          if (!resultMap.has(entry.serviceId)) {
            const service = this.findServiceById(entry.serviceId);
            if (service) {
              resultMap.set(entry.serviceId, {
                service,
                categorySlug: entry.categorySlug,
                categoryName: entry.categoryName,
              });
            }
          }
          break;
        }
      }
    }

    return [...resultMap.values()];
  }

  private findServiceById(id: string): UiCategory['allOptions'][number] | undefined {
    for (const cat of this.categoriesRef) {
      const found = cat.allOptions.find(o => o.id === id);
      if (found) return found;
    }
    return undefined;
  }

  private async getUFuzzy(): Promise<{ search: (haystack: readonly string[], query: string) => [unknown, unknown, unknown] } | null> {
    if (this.ufuzzyLoaded) {
      return this.ufuzzyInstance as { search: (haystack: readonly string[], query: string) => [unknown, unknown, unknown] } | null;
    }

    try {
      const mod = await import('@leeoniya/ufuzzy');
      const UFuzzy = mod.default ?? mod;
      this.ufuzzyInstance = new (UFuzzy as new (opts: Record<string, unknown>) => unknown)({ intraMode: 1 });
      this.ufuzzyLoaded = true;
      return this.ufuzzyInstance as { search: (haystack: readonly string[], query: string) => [unknown, unknown, unknown] };
    } catch {
      this.ufuzzyLoaded = true;
      this.ufuzzyInstance = null;
      return null;
    }
  }
}
