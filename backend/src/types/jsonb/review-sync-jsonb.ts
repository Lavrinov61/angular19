export type ReviewStatsRawSource = 'embedded-org' | 'embedded-page' | 'meta-description' | 'json' | 'itemprop-meta';

export interface ReviewStatsRawResponse {
  source: ReviewStatsRawSource;
  rating: number;
  reviewCount: number;
  orgId?: string;
}
