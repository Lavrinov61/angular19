/** View types for CRM domain (inbox, clients, search). */

import type { CrmInboxMetadata } from '../jsonb/crm-inbox-metadata.js';

// ── Inbox ──────────────────────────────────────────────────────────────

/** Row from crm_inbox_view with window-function total. */
export interface InboxViewRow {
  id: string;
  type: string;
  client_name: string | null;
  client_phone: string | null;
  preview: string;
  status: string;
  priority: number;
  sort_time: string;
  channel: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  unread: boolean;
  metadata: CrmInboxMetadata;
  total_count: string;
  has_paid_unlinked: boolean;
  paid_unlinked_count: number;
  paid_unlinked_amount: string;
  paid_unlinked_order_ref: string | null;
}

/** Tag info joined through conversation → session_tags → chat_tags. */
export interface ConversationTagRow {
  conversation_id: string;
  id: string;
  name: string;
  color: string;
  icon: string;
}

/** Badge counts per type from crm_inbox_view. */
export interface InboxCountRow {
  type: string;
  count: number;
  unread_count: number;
  unassigned_count: number;
  urgent_count: number;
  unpaid_count: number;
}

/** Badge counts row for /crm/inbox/counts with payment-link aggregate. */
export interface InboxPaidUnlinkedCountRow extends InboxCountRow {
  paid_unlinked_count: number;
}

/** Reopened chat row projected into crm_inbox shape. */
export interface ReopenedTodayConversationRow {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  preview: string;
  status: string;
  priority: number;
  sort_time: string;
  channel: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  unread: boolean;
  metadata: CrmInboxMetadata;
}

/** CRM note row (entity-agnostic). */
export interface CrmNoteRow {
  id: string;
  entity_type: string;
  entity_id: string;
  author_id: string;
  author_name: string;
  note_type: string;
  content: string;
  created_at: string;
}

/** CRM note author lookup. */
export interface CrmNoteAuthorRow {
  display_name: string | null;
}

/** Online staff member. */
export interface OnlineUserRow {
  id: string;
  display_name: string;
  role: string;
}

/** CSAT aggregate for last 30 days. */
export interface CsatStatsRow {
  total_ratings: string;
  avg_score: string;
  five_star: string;
  negative: string;
}

/** Conversion summary counters. */
export interface ConversionSummaryRow {
  total_chats: string;
  total_orders: string;
  total_bookings: string;
  total_revenue: string;
  paid_orders: string;
}

/** Daily conversion breakdown. */
export interface ConversionDailyRow {
  day: string;
  chats: string;
  orders: string;
  bookings: string;
  revenue: string;
}

/** Conversion by channel. */
export interface ConversionByChannelRow {
  channel: string;
  chats: string;
  orders: string;
}

// ── Reports ───────────────────────────────────────────────────────────

/** Revenue report projection for admin reports. */
export interface RevenueReportQueryRow {
  period: string;
  pos_revenue: string | number;
  pos_refunds: string | number;
  online_revenue: string | number;
  print_revenue: string | number;
  booking_revenue: string | number;
  total: string | number;
}

export interface DailySummaryQueryRow {
  today_revenue: string | number;
  today_refunds: string | number;
  today_receipts: string | number;
  cash: string | number;
  cash_pos_fiscal: string | number;
  cash_pos_non_fiscal: string | number;
  cash_chat_fiscal: string | number;
  cash_chat_non_fiscal: string | number;
  card: string | number;
  sbp: string | number;
  online: string | number;
  subscription: string | number;
  transfer: string | number;
  today_orders: string | number;
  yesterday_revenue: string | number;
  yesterday_receipts: string | number;
  yesterday_orders: string | number;
  week_avg_revenue: string | number;
  week_avg_receipts: string | number;
  week_avg_orders: string | number;
  pending_orders: string | number;
}

export interface TopProductQueryRow {
  product_name: string;
  product_id: string | null;
  quantity: string | number;
  revenue: string | number;
}

export interface CashReconciliationQueryRow {
  shift_id: string;
  shift_date: string;
  employee_id: string;
  employee_name: string;
  studio_id: string | null;
  studio_name: string;
  workday_status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cash_at_open: string | null;
  cash_at_close: string | null;
  cash_payments: string;
  cash_pos_fiscal_payments: string;
  cash_pos_non_fiscal_payments: string;
  cash_chat_fiscal_payments: string;
  cash_chat_non_fiscal_payments: string;
  cash_withdrawals: string;
  receipts_count: number | string;
}

// ── Clients ────────────────────────────────────────────────────────────

/** Client note row (client_notes table). */
export interface ClientNoteRow {
  id: string;
  text: string;
  pinned: boolean;
  created_at: string;
  author_name: string;
}

/** INSERT RETURNING for client_notes. */
export interface ClientNoteInsertResult {
  id: string;
  created_at: string;
}

/** Chat session history for a client. */
export interface ClientChatSessionRow {
  id: string;
  channel: string;
  status: string;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  message_count: string;
  assigned_operator_name: string | null;
}

/** Universal chat session lookup (by contactId / phone / userId). */
export interface UniversalChatSessionRow extends ClientChatSessionRow {
  last_message_at: string | null;
  last_message_preview: string | null;
  visitor_name: string | null;
}

// ── Search ─────────────────────────────────────────────────────────────

/** Task search result. */
export interface SearchTaskRow {
  id: string;
  task_number: number;
  title: string;
  status: string;
}

/** Booking search result. */
export interface SearchBookingRow {
  id: string;
  client_name: string;
  client_phone: string;
  start_time: string;
  status: string;
}

/** Print order search result. */
export interface SearchOrderRow {
  order_id: string;
  contact_name: string;
  contact_phone: string;
  created_at: string;
  status: string;
  total_price: number;
}

/** Client search result (users table). */
export interface SearchClientRow {
  name: string;
  phone: string;
  source: string;
}

/** Task note content search result. */
export interface SearchTaskNoteRow {
  task_id: string;
  task_number: number;
  task_title: string;
  content: string;
}

/** Chat message content search result. */
export interface SearchChatMessageRow {
  conversation_id: string;
  content: string;
  visitor_name: string;
}

/** Client note content search result. */
export interface SearchClientNoteRow {
  client_phone: string;
  text: string;
}

// ── Timeline ──────────────────────────────────────────────────────────

/** Single event in client activity timeline (UNION ALL projection). */
export interface TimelineEventRow {
  type: string;
  id: string;
  ts: string;
  title: string;
  detail: string;
  amount: number | null;
}

/** Discriminator-значения для activity-плашек операторской ленты. */
export type ActivityType =
  | 'booking'
  | 'order'
  | 'pos_receipt'
  | 'subscription'
  | 'call'
  | 'loyalty';

/**
 * Замороженный контракт (serverJSON == фронт-тип) для компактных плашек
 * активности клиента в операторской ленте чата (`activityItems`).
 * Собирается read-side из доменных таблиц, в `messages` НЕ пишется.
 */
export interface ActivityItem {
  /** Дискриминатор vs OperatorChatMessage. */
  kind: 'activity';
  /** Стабильный id для track: `activity:${activity_type}:${sourceId}`. */
  id: string;
  activity_type: ActivityType;
  /** ISO 8601 — время события, единый ключ сортировки с messages. */
  created_at: string;
  /** Напр. «Запись: фотосессия · Соборный». */
  title: string;
  /** Статус/канал/длительность. */
  detail: string | null;
  /** ₽ если денежное (только отображение). */
  amount: number | null;
  /** Сырой статус источника (confirmed/cancelled/answered/missed/…). */
  status: string | null;
}
