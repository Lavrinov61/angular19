// ── Payment Dialog Models ──

// ── Dialog Input / Output ──

/**
 * Unified payment dialog modes:
 * - 'chat': Operator selects services, sends payment link into chat or creates POS receipt
 * - 'order': Order already exists with known totalPrice; accept payment via cash/card/SBP/link
 * - 'pos': Standalone POS flow without chat and online payment links
 */
export type PaymentDialogMode = 'chat' | 'order' | 'pos';

export interface PaymentDialogPrefillService {
  readonly id?: string | null;
  readonly slug?: string | null;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
  readonly pricingGroupKey?: string | null;
}

export interface PaymentDialogEditLinkData {
  readonly id: string;
  readonly orderRef: string;
  readonly amount: number;
  readonly description?: string | null;
  readonly services?: readonly PaymentDialogPrefillService[];
}

export interface PaymentDialogData {
  readonly mode: PaymentDialogMode;
  readonly phone: string;
  readonly clientName?: string;
  /**
   * Личность клиента из чата (user_id / contact_id). Нужна потому, что телефон в чате
   * МАСКИРУЕТСЯ для не-админов. Frontend не резолвит реальный номер; backend использует
   * эти id только внутри pricing/payment расчёта.
   */
  readonly clientUserId?: string;
  readonly clientContactId?: string;
  /** Chat session ID — present in 'chat' mode for auto-sending payment link */
  readonly sessionId?: string;
  /** Order ID — present in 'order' mode */
  readonly orderId?: string;
  /** Internal photo_print_orders.id UUID used to link POS receipts back to the order */
  readonly printOrderId?: string;
  /** Studio ID for standalone POS mode where there may be no dashboard workday */
  readonly studioId?: string;
  /** Pre-set total from order — present in 'order' mode */
  readonly totalPrice?: number;
  /** Prefill services for repeat order (F58) — resolved from loaded categories */
  readonly prefillSlugs?: readonly { readonly slug: string; readonly quantity: number }[];
  /**
   * Конфигуратор «Супер обработки» — лист-задание ретушёру (необязательно).
   * Тот же контракт, что OrderSelectedEvent.retouchConfig; прокидывается в createFromPricing.
   */
  readonly retouchConfig?: {
    readonly gender?: 'male' | 'female' | 'any';
    readonly groups: Record<string, string[]>;
    readonly notes?: string;
  };
  /** Prefill services from the operator/client cart */
  readonly prefillServices?: readonly PaymentDialogPrefillService[];
  /** Exact cart breakdown from the operator/client cart */
  readonly prefillCartDetails?: PaymentCartDetails;
  /** Existing pending payment link opened for editing */
  readonly editPaymentLink?: PaymentDialogEditLinkData;
}

export type PaymentDialogResult =
  | { readonly type: 'sent'; readonly orderId?: string; readonly amount?: number }
  | { readonly type: 'transferInstructions'; readonly amount?: number }
  | { readonly type: 'updated'; readonly orderId?: string; readonly amount?: number }
  | { readonly type: 'copied' }
  | { readonly type: 'posReceipt'; readonly receiptNumber: string; readonly amount?: number }
  | { readonly type: 'cash'; readonly receiptNumber?: string; readonly amount?: number }
  | { readonly type: 'transfer'; readonly receiptNumber?: string; readonly amount?: number }
  | { readonly type: 'card'; readonly transactionId?: string; readonly cardInfo?: string; readonly receiptNumber?: string; readonly amount?: number }
  | { readonly type: 'sbp'; readonly transactionId?: string; readonly receiptNumber?: string; readonly amount?: number }
  | { readonly type: 'subscription'; readonly subscriptionId: string; readonly creditUsed: number; readonly receiptNumber?: string; readonly amount?: number }
  | { readonly type: 'cancelled' };

// ── API response types (from /api/pricing/categories) ──

export interface ApiServiceOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly base_price: number;
  readonly price_online: number | null;
  readonly price_studio: number | null;
  readonly price_next_unit: number | null;
  readonly price_max: number | null;
  readonly features: string[];
  readonly popular: boolean;
  readonly original_price: number | null;
  readonly discount_percent: number | null;
  readonly product_id?: string | null;
}

export interface ApiOptionGroup {
  readonly name: string;
  readonly slug: string;
  readonly selection_type: string;
  readonly options: readonly ApiServiceOption[];
}

export interface ApiCategory {
  readonly slug: string;
  readonly name: string;
  readonly icon: string | null;
  readonly optionGroups: readonly ApiOptionGroup[];
}

export interface ApiCategoriesResponse {
  readonly success: boolean;
  readonly categories: readonly ApiCategory[];
}

// ── UI models (mapped from API) ──

export interface UiServiceOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly categorySlug: string;
  readonly groupSlug: string;
  readonly description: string;
  readonly price: number;
  readonly priceMax: number | null;
  readonly icon: string;
  readonly popular: boolean;
  readonly originalPrice: number | null;
  readonly features: readonly string[];
  readonly productId: string | null;
}

export interface UiOptionGroup {
  readonly name: string;
  readonly slug: string;
  readonly options: readonly UiServiceOption[];
}

export interface UiCategory {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly groups: readonly UiOptionGroup[];
  readonly allOptions: readonly UiServiceOption[];
}

// ── Selection ──

export interface SelectedItem {
  readonly service: UiServiceOption;
  readonly categoryName: string;
  readonly quantity: number;
  readonly peopleCount?: number;
}

export interface ExpandedSelectedItem {
  readonly item: SelectedItem;
  readonly quantity: number;
  readonly pricingGroupKey?: string;
  readonly personIndex?: number;
}

// ── Quick presets ──

export interface QuickPreset {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly optionSlugs: readonly string[];
}

// ── Search ──

export interface SearchResult {
  readonly service: UiServiceOption;
  readonly categorySlug: string;
  readonly categoryName: string;
}

// ── Recent services ──

export interface RecentService {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly price: number;
  readonly categoryName: string;
}

// ── Breakdown item (for summary) ──

export interface BreakdownItem {
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
  readonly priceNote: string | null;
  readonly discountLabel: string | null;
  readonly discountAmount: number;
}

export interface PaymentCartDetails {
  readonly lines: readonly BreakdownItem[];
  readonly subtotal: number;
  readonly savings: number;
}
