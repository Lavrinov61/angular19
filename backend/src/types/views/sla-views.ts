import type { ServiceCategoriesId } from '../generated/public/ServiceCategories.js';
import type { ServiceOptionsId } from '../generated/public/ServiceOptions.js';

export interface SlaOptionRow {
  option_id: ServiceOptionsId;
  category_id: ServiceCategoriesId;
  selection_type: string;
  estimated_minutes: number | null;
}

export interface SlaSlugOptionRow {
  selection_type: string;
  estimated_minutes: number | null;
  option_slug: string;
}
