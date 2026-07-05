import type OptionGroups from '../generated/public/OptionGroups.js';
import type ServiceCategories from '../generated/public/ServiceCategories.js';
import type ServiceOptions from '../generated/public/ServiceOptions.js';

export interface PricingCategorySnapshotFields {
  slug?: ServiceCategories['slug'];
  name?: ServiceCategories['name'];
  description?: ServiceCategories['description'];
  icon?: ServiceCategories['icon'];
  gradient?: ServiceCategories['gradient'];
  image_url?: ServiceCategories['image_url'];
  price_range?: ServiceCategories['price_range'];
  display_channels?: ServiceCategories['display_channels'];
  sort_order?: ServiceCategories['sort_order'];
  is_active?: ServiceCategories['is_active'];
}

export interface PricingOptionGroupSnapshotFields {
  slug?: OptionGroups['slug'];
  name?: OptionGroups['name'];
  description?: OptionGroups['description'];
  selection_type?: OptionGroups['selection_type'];
  is_required?: OptionGroups['is_required'];
  min_selections?: OptionGroups['min_selections'];
  max_selections?: OptionGroups['max_selections'];
  sort_order?: OptionGroups['sort_order'];
  is_active?: OptionGroups['is_active'];
}

export interface PricingServiceOptionSnapshotFields {
  slug?: ServiceOptions['slug'];
  name?: ServiceOptions['name'];
  description?: ServiceOptions['description'];
  icon?: ServiceOptions['icon'];
  color?: ServiceOptions['color'];
  product_id?: ServiceOptions['product_id'];
  base_price?: ServiceOptions['base_price'];
  price_online?: ServiceOptions['price_online'];
  price_studio?: ServiceOptions['price_studio'];
  price_next_unit?: ServiceOptions['price_next_unit'];
  price_max?: ServiceOptions['price_max'];
  promo_first_price?: ServiceOptions['promo_first_price'];
  promo_description?: ServiceOptions['promo_description'];
  features?: ServiceOptions['features'];
  popular?: ServiceOptions['popular'];
  original_price?: ServiceOptions['original_price'];
  discount_percent?: ServiceOptions['discount_percent'];
  satisfies_requires?: ServiceOptions['satisfies_requires'];
  sort_order?: ServiceOptions['sort_order'];
  is_active?: ServiceOptions['is_active'];
}
