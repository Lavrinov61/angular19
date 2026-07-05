export interface PrintPackageCoverageTier {
  min_percent: number;
  max_percent: number;
  credit_multiplier: number;
  title: string;
  description: string;
}

export interface PrintPackageUsageFaq {
  question: string;
  answer: string;
}

export interface PrintPackageProductMultiplier {
  product_id: string;
  product_name: string;
  base_product_id: string | null;
  credit_multiplier: number;
  description: string;
}

export interface PrintPackageUsagePolicy {
  kind: 'coverage_print_package' | 'photo_print_package';
  unit_label: string;
  base_coverage_percent: number | null;
  max_coverage_percent: number | null;
  coverage_tiers: readonly PrintPackageCoverageTier[];
  product_multipliers?: readonly PrintPackageProductMultiplier[];
  terms: readonly string[];
  steps: readonly string[];
  faq: readonly PrintPackageUsageFaq[];
}

export type SubscriptionPlanUsagePolicy = PrintPackageUsagePolicy | Record<string, never>;
