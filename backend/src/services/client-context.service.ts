/**
 * Client Context Service — агрегация данных клиента из magnus_photo_db.
 *
 * Источники:
 * - magnus_photo_db: orders, photo_print_orders, bookings, conversations/messages, work_tasks
 */
import { pool as mainPool } from '../database/db.js';
import type Contacts from '../types/generated/public/Contacts.js';
import type Conversations from '../types/generated/public/Conversations.js';

// ============================================================================
// Types
// ============================================================================

export interface ChannelUserInfo {
  channel: string;
  display_name: string | null;
  username: string | null;
  phone: string | null;
}

export interface ApprovalSessionSummary {
  id: string;
  title: string | null;
  status: string | null;
  total_photos: number;
  approved_count: number;
  rejected_count: number;
  created_at: string | null;
}

export interface ClientContext {
  profile: {
    name: string | null;
    phone: string | null;
    channels: string[];
    total_purchases: number;
    total_revenue: number;
    first_visit: string | null;
    unified_customer_id: number | null;
    contact_id: string | null;
    registered_user: {
      is_registered: boolean;
      email: string | null;
      email_verified: boolean;
      registered_at: string | null;
      auth_providers: string[];
    } | null;
  };
  chat_history: ChatHistoryEntry[];
  orders: OrderEntry[];
  bookings: BookingEntry[];
  other_tasks: TaskEntry[];
  channel_users: ChannelUserInfo[];
  approval_sessions: ApprovalSessionSummary[];
}

interface ChatHistoryEntry {
  source: 'website' | 'whatsapp' | 'telegram' | 'max';
  chat_id: string;
  messages: ChatMessage[];
}

interface ChatMessage {
  sender: string;
  direction: 'in' | 'out';
  content: string;
  timestamp: string;
  type: string;
}

interface OrderEntry {
  id: string;
  type: string;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  payment_card_info?: string;
  paid_at?: string;
  payment_id?: string;
  contact_email?: string;
}

interface BookingEntry {
  id: string;
  start_time: string;
  status: string;
  service_id: string | null;
  service_name: string | null;
  studio_name: string | null;
}

interface TaskEntry {
  id: string;
  task_number: number;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
}

interface ClientBookingRow {
  id: string;
  start_time: Date | null;
  status: string | null;
  service_id: string | null;
  service_name: string | null;
  studio_name: string | null;
}

interface ChatMessageRow {
  sender_type: string | null;
  sender_name: string | null;
  content: string | null;
  message_type: string | null;
  created_at: Date | null;
}

interface RegularOrderRow {
  id: string;
  type: string | null;
  status: string | null;
  payment_status: string | null;
  total_amount: string | null;
  created_at: Date | null;
}

interface PrintOrderRow {
  id: string;
  status: string | null;
  payment_status: string | null;
  total_price: string | null;
  created_at: Date | null;
  payment_card_info: string | null;
  paid_at: Date | null;
  payment_id: string | null;
  contact_email: string | null;
}

interface TaskRow {
  id: string;
  task_number: number;
  title: string;
  status: string;
  priority: string;
  due_date: Date | null;
}

interface ChannelUserRow {
  channel: string;
  display_name: string | null;
  username: string | null;
  phone: string | null;
}

interface ApprovalSessionRow {
  id: string;
  title: string | null;
  status: string | null;
  total_photos: number | null;
  approved_count: number | null;
  rejected_count: number | null;
  created_at: Date | null;
}

interface SuggestedBookingRow {
  id: string;
  service_name: string | null;
  start_time: Date | string | null;
  status: string | null;
}

interface AutoLinkConversationLookupRow {
  user_id: string | null;
  contact_user_id: string | null;
  effective_user_id: string | null;
  phone: string | null;
  contact_id: string | null;
  channel: string | null;
  external_chat_id: string | null;
  visitor_id: string | null;
}

interface AutoLinkUserRow {
  id: string;
}

interface AutoLinkBookingMatchRow {
  id: string;
}

interface AutoLinkConversationUpdateRow {
  id: string;
  user_id: string | null;
  contact_id: string | null;
  channel: string | null;
  external_chat_id: string | null;
  visitor_id: string | null;
}

// ============================================================================
// Redis Cache (60 сек TTL, shared across nodes)
// ============================================================================

import { cacheGet, cacheSet } from './redis-cache.service.js';
import { logIdentityLinkEvent } from './identity-link-audit.service.js';

import { createLogger } from '../utils/logger.js';
const CLIENT_CTX_PREFIX = 'cctx:';
const CLIENT_CTX_TTL_SEC = 60;

const logger = createLogger('client-context.service');
async function getCached(key: string): Promise<ClientContext | null> {
  return cacheGet<ClientContext>(`${CLIENT_CTX_PREFIX}${key}`);
}

async function setCache(key: string, data: ClientContext): Promise<void> {
  await cacheSet(`${CLIENT_CTX_PREFIX}${key}`, data, CLIENT_CTX_TTL_SEC);
}

// ============================================================================
// Phone normalization: +7/8 → 7xxxxxxxxxx
// ============================================================================

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) {
    return '7' + digits.slice(1);
  }
  if (digits.startsWith('+7')) {
    return digits.slice(1);
  }
  if (digits.startsWith('7') && digits.length === 11) {
    return digits;
  }
  return digits;
}

// ============================================================================
// Contacts lookup
// ============================================================================

async function findContactIdByPhone(phoneVariants: string[]): Promise<string | null> {
  try {
    const res = await mainPool.query<Pick<Contacts, 'id'>>(
      `SELECT id FROM contacts
       WHERE phone = ANY($1) AND deleted_at IS NULL
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT 1`,
      [phoneVariants],
    );
    return res.rows[0]?.id ?? null;
  } catch (err: unknown) {
    logger.warn('findContactIdByPhone failed', { error: String(err) });
    return null;
  }
}

async function findContactIdByUserId(userId: string): Promise<string | null> {
  try {
    const res = await mainPool.query<Pick<Contacts, 'id'>>(
      `SELECT id FROM contacts
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT 1`,
      [userId],
    );
    return res.rows[0]?.id ?? null;
  } catch (err: unknown) {
    logger.warn('findContactIdByUserId failed', { error: String(err) });
    return null;
  }
}

/** Resolve display name by phone: contacts.display_name → conversations.visitor_name → null */
async function resolveNameByPhone(phoneVariants: string[]): Promise<string | null> {
  try {
    // Priority 1: contact display_name
    const contactRes = await mainPool.query<Pick<Contacts, 'display_name'>>(
      `SELECT display_name FROM contacts
       WHERE phone = ANY($1) AND deleted_at IS NULL AND display_name IS NOT NULL
       ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`,
      [phoneVariants],
    );
    if (contactRes.rows[0]?.display_name) return contactRes.rows[0].display_name;

    // Priority 2: conversation visitor_name (exclude auto-generated names)
    const visitorRes = await mainPool.query<Pick<Conversations, 'visitor_name'>>(
      `SELECT visitor_name FROM conversations
       WHERE visitor_phone = ANY($1) AND visitor_name IS NOT NULL
         AND visitor_name !~ '^Посетитель #'
       ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
      [phoneVariants],
    );
    return visitorRes.rows[0]?.visitor_name ?? null;
  } catch (err: unknown) {
    logger.warn('resolveNameByPhone failed', { error: String(err) });
    return null;
  }
}

// ============================================================================
// Main functions
// ============================================================================

export async function getClientContextByUserId(userId: string, currentTaskId?: string): Promise<ClientContext> {
  const cacheKey = `uid:${userId}` + (currentTaskId || '');
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // Get user record first to determine phone
  let phone: string | null = null;
  let displayName: string | null = null;
  let registeredUser: ClientContext['profile']['registered_user'] = null;
  try {
    const userRes = await mainPool.query(
      `SELECT phone, display_name, email, email_verified,
              yandex_id IS NOT NULL as has_yandex,
              google_id IS NOT NULL as has_google,
              vk_id IS NOT NULL as has_vk,
              apple_id IS NOT NULL as has_apple,
              created_at as registered_at
       FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [userId],
    );
    const row = userRes.rows[0];
    if (row) {
      phone = row.phone || null;
      displayName = row.display_name || null;
      const providers: string[] = [];
      if (row.has_yandex) providers.push('yandex');
      if (row.has_google) providers.push('google');
      if (row.has_vk) providers.push('vk');
      if (row.has_apple) providers.push('apple');
      registeredUser = {
        is_registered: true,
        email: row.email || null,
        email_verified: Boolean(row.email_verified),
        registered_at: row.registered_at?.toISOString() || null,
        auth_providers: providers,
      };
    }
  } catch (err) {
    logger.error('[ClientCtx] fetchUserById error:', { error: String(err) });
  }

  const [
    websiteChats,
    regularOrders,
    printOrders,
    bookings,
    otherTasks,
    contactId,
    approvalSessions,
  ] = await Promise.all([
    fetchWebsiteChatsByUserId(userId),
    fetchRegularOrdersByUserId(userId),
    fetchPrintOrdersByUserId(userId),
    fetchBookingsByUserId(userId),
    fetchOtherTasksByUserId(userId, currentTaskId),
    findContactIdByUserId(userId),
    fetchApprovalSessionsByUserId(userId),
  ]);

  // Fetch channel users if contact found
  const channelUsers = contactId ? await fetchChannelUsersByContactId(contactId) : [];

  const channels: string[] = [];
  if (websiteChats.length > 0) channels.push('website');
  for (const cu of channelUsers) {
    if (cu.channel && !channels.includes(cu.channel)) channels.push(cu.channel);
  }

  const allOrders = [...regularOrders, ...printOrders];
  const totalRevenue = allOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);

  const context: ClientContext = {
    profile: {
      name: displayName || null,
      phone,
      channels,
      total_purchases: allOrders.length,
      total_revenue: totalRevenue,
      first_visit: null,
      unified_customer_id: null,
      contact_id: contactId,
      registered_user: registeredUser,
    },
    chat_history: [...websiteChats],
    orders: allOrders,
    bookings,
    other_tasks: otherTasks,
    channel_users: channelUsers,
    approval_sessions: approvalSessions,
  };

  await setCache(cacheKey, context);
  return context;
}

export async function getClientContext(phone: string, currentTaskId?: string): Promise<ClientContext> {
  const normalized = normalizePhone(phone);
  const cacheKey = normalized + (currentTaskId || '');
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // Варианты номера для поиска
  const phoneVariants = [
    normalized,
    '+7' + normalized.slice(1),
    '8' + normalized.slice(1),
    phone,
  ];

  const [
    websiteChats,
    regularOrders,
    printOrders,
    bookings,
    otherTasks,
    registeredUser,
    contactId,
    resolvedName,
    approvalSessions,
  ] = await Promise.all([
    fetchWebsiteChats(phoneVariants),
    fetchRegularOrders(phoneVariants),
    fetchPrintOrders(phoneVariants),
    fetchBookings(phoneVariants),
    fetchOtherTasks(phoneVariants, currentTaskId),
    fetchRegisteredUser(phoneVariants),
    findContactIdByPhone(phoneVariants),
    resolveNameByPhone(phoneVariants),
    fetchApprovalSessionsByPhone(phoneVariants),
  ]);

  // Fetch channel users if contact found
  const channelUsers = contactId ? await fetchChannelUsersByContactId(contactId) : [];

  // Собираем каналы
  const channels: string[] = [];
  if (websiteChats.length > 0) channels.push('website');
  for (const cu of channelUsers) {
    if (cu.channel && !channels.includes(cu.channel)) channels.push(cu.channel);
  }

  // Профиль
  const allOrders = [...regularOrders, ...printOrders];
  const totalRevenue = allOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);

  const context: ClientContext = {
    profile: {
      name: resolvedName,
      phone,
      channels,
      total_purchases: allOrders.length,
      total_revenue: totalRevenue,
      first_visit: null,
      unified_customer_id: null,
      contact_id: contactId,
      registered_user: registeredUser,
    },
    chat_history: [...websiteChats],
    orders: allOrders,
    bookings,
    other_tasks: otherTasks,
    channel_users: channelUsers,
    approval_sessions: approvalSessions,
  };

  await setCache(cacheKey, context);
  return context;
}

export async function getClientContextByContactId(contactId: string): Promise<ClientContext> {
  const cacheKey = `contact:${contactId}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // Load contact record
  const contactRes = await mainPool.query<Pick<Contacts, 'id' | 'display_name' | 'phone' | 'user_id' | 'source'>>(
    `SELECT id, display_name, phone, user_id, source FROM contacts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [contactId],
  );
  const contact = contactRes.rows[0];
  if (!contact) {
    return emptyContext(contactId);
  }

  // If contact has a user_id, delegate to user-based context (richer data)
  if (contact.user_id) {
    return getClientContextByUserId(contact.user_id);
  }

  // If contact has a phone, delegate to phone-based context
  if (contact.phone) {
    return getClientContext(contact.phone);
  }

  // Contact without phone/user — build minimal context from conversations
  const [chatHistory, channelUsers, approvalSessions] = await Promise.all([
    mainPool.query<Pick<Conversations, 'id' | 'channel' | 'status' | 'visitor_name' | 'created_at' | 'message_count'>>(
      `SELECT id, channel, status, visitor_name, created_at, message_count
       FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [contactId],
    ),
    fetchChannelUsersByContactId(contactId),
    fetchApprovalSessionsByContactId(contactId),
  ]);

  const channels = [...new Set(chatHistory.rows.map(r => String(r.channel)))];
  for (const cu of channelUsers) {
    if (cu.channel && !channels.includes(cu.channel)) channels.push(cu.channel);
  }

  // Resolve name: contact display_name → channel user display_name → visitor_name
  const visitorName = chatHistory.rows.find(r => r.visitor_name && !/^Посетитель #/.test(String(r.visitor_name)))?.visitor_name;
  const channelDisplayName = channelUsers.find(cu => cu.display_name)?.display_name;
  const resolvedName = contact.display_name || channelDisplayName || (visitorName ? String(visitorName) : null);

  const context: ClientContext = {
    profile: {
      name: resolvedName,
      phone: null,
      channels,
      total_purchases: 0,
      total_revenue: 0,
      first_visit: chatHistory.rows.length ? String(chatHistory.rows[chatHistory.rows.length - 1].created_at) : null,
      unified_customer_id: null,
      contact_id: contactId,
      registered_user: null,
    },
    chat_history: chatHistory.rows.map(r => ({
      source: String(r.channel) as ChatHistoryEntry['source'],
      chat_id: String(r.id),
      messages: [],
    })),
    orders: [],
    bookings: [],
    other_tasks: [],
    channel_users: channelUsers,
    approval_sessions: approvalSessions,
  };

  await setCache(cacheKey, context);
  return context;
}

function emptyContext(contactId: string): ClientContext {
  return {
    profile: {
      name: null, phone: null, channels: [], total_purchases: 0, total_revenue: 0,
      first_visit: null, unified_customer_id: null, contact_id: contactId, registered_user: null,
    },
    chat_history: [], orders: [], bookings: [], other_tasks: [],
    channel_users: [], approval_sessions: [],
  };
}

// ============================================================================
// Data fetchers
// ============================================================================

async function fetchWebsiteChats(phoneVariants: string[]): Promise<ChatHistoryEntry[]> {
  try {
    const sessionsRes = await mainPool.query(
      `SELECT id, visitor_name, visitor_phone, status
       FROM conversations
       WHERE visitor_phone = ANY($1)
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT 5`,
      [phoneVariants],
    );

    if (sessionsRes.rows.length === 0) return [];

    const entries: ChatHistoryEntry[] = [];

    for (const session of sessionsRes.rows) {
      const msgsRes = await mainPool.query(
        `SELECT sender_type, sender_name, content, message_type, created_at
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [session.id],
      );

      const messages: ChatMessage[] = msgsRes.rows.map((m: ChatMessageRow) => ({
        sender: m.sender_name || m.sender_type || 'unknown',
        direction: m.sender_type === 'visitor' ? 'in' as const : 'out' as const,
        content: m.content || '',
        timestamp: m.created_at?.toISOString() || '',
        type: m.message_type || 'text',
      })).reverse();

      entries.push({
        source: 'website',
        chat_id: session.id,
        messages,
      });
    }

    return entries;
  } catch (err) {
    logger.error('[ClientCtx] fetchWebsiteChats error:', { error: String(err) });
    return [];
  }
}

async function fetchRegularOrders(phoneVariants: string[]): Promise<OrderEntry[]> {
  try {
    // orders связаны через client_id → users → phone
    const res = await mainPool.query(
      `SELECT o.id, o.type, o.status, o.payment_status, o.total_amount, o.created_at
       FROM orders o
       JOIN users u ON o.client_id = u.id
       WHERE u.phone = ANY($1)
       ORDER BY o.created_at DESC
       LIMIT 20`,
      [phoneVariants],
    );
    return res.rows.map((r: RegularOrderRow) => ({
      id: r.id,
      type: r.type || 'order',
      status: r.status || 'pending',
      payment_status: r.payment_status || 'pending',
      total_amount: parseFloat(r.total_amount || '0') || 0,
      created_at: r.created_at?.toISOString() || '',
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchRegularOrders error:', { error: String(err) });
    return [];
  }
}

async function fetchPrintOrders(phoneVariants: string[]): Promise<OrderEntry[]> {
  try {
    const res = await mainPool.query(
      `SELECT id, order_id, status, payment_status, total_price, created_at,
              payment_card_info, paid_at, payment_id, contact_email
       FROM photo_print_orders
       WHERE contact_phone = ANY($1)
       ORDER BY created_at DESC
       LIMIT 20`,
      [phoneVariants],
    );
    return res.rows.map((r: PrintOrderRow) => ({
      id: r.id,
      type: 'print',
      status: r.status || 'new',
      payment_status: r.payment_status || 'none',
      total_amount: parseFloat(r.total_price || '0') || 0,
      created_at: r.created_at?.toISOString() || '',
      payment_card_info: r.payment_card_info || undefined,
      paid_at: r.paid_at?.toISOString() || undefined,
      payment_id: r.payment_id || undefined,
      contact_email: r.contact_email || undefined,
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchPrintOrders error:', { error: String(err) });
    return [];
  }
}

async function fetchBookings(phoneVariants: string[]): Promise<BookingEntry[]> {
  try {
    const res = await mainPool.query(
      `SELECT b.id, b.start_time, b.status, b.service_id, b.service_name, s.name AS studio_name
       FROM bookings b
       JOIN users u ON b.client_id = u.id
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE u.phone = ANY($1)
       ORDER BY b.start_time DESC
       LIMIT 10`,
      [phoneVariants],
    );
    return res.rows.map((r: ClientBookingRow) => ({
      id: r.id,
      start_time: r.start_time?.toISOString() || '',
      status: r.status || 'pending',
      service_id: r.service_id || null,
      service_name: r.service_name || null,
      studio_name: r.studio_name || null,
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchBookings error:', { error: String(err) });
    return [];
  }
}

async function fetchRegisteredUser(phoneVariants: string[]) {
  try {
    const res = await mainPool.query(
      `SELECT u.id, u.email, u.display_name, u.email_verified, u.phone_verified,
              u.created_at as registered_at,
              u.yandex_id IS NOT NULL as has_yandex,
              u.google_id IS NOT NULL as has_google,
              u.vk_id IS NOT NULL as has_vk,
              u.apple_id IS NOT NULL as has_apple
       FROM users u WHERE u.phone = ANY($1) AND u.is_active = TRUE AND u.role = 'client'
       LIMIT 1`,
      [phoneVariants],
    );
    const row = res.rows[0];
    if (!row) return null;

    const providers: string[] = [];
    if (row.has_yandex) providers.push('yandex');
    if (row.has_google) providers.push('google');
    if (row.has_vk) providers.push('vk');
    if (row.has_apple) providers.push('apple');

    return {
      is_registered: true,
      email: row.email || null,
      email_verified: Boolean(row.email_verified),
      registered_at: row.registered_at?.toISOString() || null,
      auth_providers: providers,
    };
  } catch (err) {
    logger.error('[ClientCtx] fetchRegisteredUser error:', { error: String(err) });
    return null;
  }
}

async function fetchOtherTasks(phoneVariants: string[], currentTaskId?: string): Promise<TaskEntry[]> {
  try {
    const res = await mainPool.query(
      `SELECT id, task_number, title, status, priority, due_date
       FROM work_tasks
       WHERE client_phone = ANY($1)
         ${currentTaskId ? `AND id != $2` : ''}
         AND status NOT IN ('cancelled')
       ORDER BY created_at DESC
       LIMIT 20`,
      currentTaskId ? [phoneVariants, currentTaskId] : [phoneVariants],
    );
    return res.rows.map((r: TaskRow) => ({
      id: r.id,
      task_number: r.task_number,
      title: r.title,
      status: r.status,
      priority: r.priority,
      due_date: r.due_date?.toISOString() || null,
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchOtherTasks error:', { error: String(err) });
    return [];
  }
}

// ============================================================================
// UserId-based fetchers
// ============================================================================

async function fetchWebsiteChatsByUserId(userId: string): Promise<ChatHistoryEntry[]> {
  try {
    const sessionsRes = await mainPool.query(
      `SELECT id, visitor_name, visitor_phone, status
       FROM conversations
       WHERE user_id = $1
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT 5`,
      [userId],
    );
    if (sessionsRes.rows.length === 0) return [];

    const entries: ChatHistoryEntry[] = [];
    for (const session of sessionsRes.rows) {
      const msgsRes = await mainPool.query(
        `SELECT sender_type, sender_name, content, message_type, created_at
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [session.id],
      );
      const messages: ChatMessage[] = msgsRes.rows.map((m: ChatMessageRow) => ({
        sender: m.sender_name || m.sender_type || 'unknown',
        direction: m.sender_type === 'visitor' ? 'in' as const : 'out' as const,
        content: m.content || '',
        timestamp: m.created_at?.toISOString() || '',
        type: m.message_type || 'text',
      })).reverse();
      entries.push({ source: 'website', chat_id: session.id, messages });
    }
    return entries;
  } catch (err) {
    logger.error('[ClientCtx] fetchWebsiteChatsByUserId error:', { error: String(err) });
    return [];
  }
}

async function fetchRegularOrdersByUserId(userId: string): Promise<OrderEntry[]> {
  try {
    const res = await mainPool.query(
      `SELECT o.id, o.type, o.status, o.payment_status, o.total_amount, o.created_at
       FROM orders o
       WHERE o.client_id = $1
       ORDER BY o.created_at DESC
       LIMIT 20`,
      [userId],
    );
    return res.rows.map((r: RegularOrderRow) => ({
      id: r.id,
      type: r.type || 'order',
      status: r.status || 'pending',
      payment_status: r.payment_status || 'pending',
      total_amount: parseFloat(r.total_amount || '0') || 0,
      created_at: r.created_at?.toISOString() || '',
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchRegularOrdersByUserId error:', { error: String(err) });
    return [];
  }
}

async function fetchPrintOrdersByUserId(userId: string): Promise<OrderEntry[]> {
  try {
    const res = await mainPool.query(
      `SELECT p.id, p.order_id, p.status, p.payment_status, p.total_price, p.created_at,
              p.payment_card_info, p.paid_at, p.payment_id, p.contact_email
       FROM photo_print_orders p
       JOIN conversations c ON c.id = p.chat_session_id
       WHERE c.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [userId],
    );
    return res.rows.map((r: PrintOrderRow) => ({
      id: r.id,
      type: 'print',
      status: r.status || 'new',
      payment_status: r.payment_status || 'none',
      total_amount: parseFloat(r.total_price || '0') || 0,
      created_at: r.created_at?.toISOString() || '',
      payment_card_info: r.payment_card_info || undefined,
      paid_at: r.paid_at?.toISOString() || undefined,
      payment_id: r.payment_id || undefined,
      contact_email: r.contact_email || undefined,
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchPrintOrdersByUserId error:', { error: String(err) });
    return [];
  }
}

async function fetchBookingsByUserId(userId: string): Promise<BookingEntry[]> {
  try {
    const res = await mainPool.query(
      `SELECT b.id, b.start_time, b.status, b.service_id, b.service_name, s.name AS studio_name
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.client_id = $1
       ORDER BY b.start_time DESC
       LIMIT 10`,
      [userId],
    );
    return res.rows.map((r: ClientBookingRow) => ({
      id: r.id,
      start_time: r.start_time?.toISOString() || '',
      status: r.status || 'pending',
      service_id: r.service_id || null,
      service_name: r.service_name || null,
      studio_name: r.studio_name || null,
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchBookingsByUserId error:', { error: String(err) });
    return [];
  }
}

// ============================================================================
// Channel users & Approval sessions fetchers
// ============================================================================

async function fetchChannelUsersByContactId(contactId: string): Promise<ChannelUserInfo[]> {
  try {
    const res = await mainPool.query(
      `SELECT channel, display_name, username, phone
       FROM channel_users
       WHERE contact_id = $1
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT 10`,
      [contactId],
    );
    return res.rows.map((r: ChannelUserRow) => ({
      channel: r.channel,
      display_name: r.display_name || null,
      username: r.username || null,
      phone: r.phone || null,
    }));
  } catch (err) {
    logger.warn('fetchChannelUsersByContactId failed', { error: String(err) });
    return [];
  }
}

async function fetchApprovalSessionsByPhone(phoneVariants: string[]): Promise<ApprovalSessionSummary[]> {
  try {
    const res = await mainPool.query(
      `SELECT id, title, status, total_photos, approved_count, rejected_count, created_at
       FROM photo_approval_sessions
       WHERE client_phone = ANY($1) AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 10`,
      [phoneVariants],
    );
    return res.rows.map((r: ApprovalSessionRow) => ({
      id: r.id,
      title: r.title || null,
      status: r.status || null,
      total_photos: r.total_photos || 0,
      approved_count: r.approved_count || 0,
      rejected_count: r.rejected_count || 0,
      created_at: r.created_at?.toISOString() || null,
    }));
  } catch (err) {
    logger.warn('fetchApprovalSessionsByPhone failed', { error: String(err) });
    return [];
  }
}

async function fetchApprovalSessionsByUserId(userId: string): Promise<ApprovalSessionSummary[]> {
  try {
    const res = await mainPool.query(
      `SELECT id, title, status, total_photos, approved_count, rejected_count, created_at
       FROM photo_approval_sessions
       WHERE client_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId],
    );
    return res.rows.map((r: ApprovalSessionRow) => ({
      id: r.id,
      title: r.title || null,
      status: r.status || null,
      total_photos: r.total_photos || 0,
      approved_count: r.approved_count || 0,
      rejected_count: r.rejected_count || 0,
      created_at: r.created_at?.toISOString() || null,
    }));
  } catch (err) {
    logger.warn('fetchApprovalSessionsByUserId failed', { error: String(err) });
    return [];
  }
}

async function fetchApprovalSessionsByContactId(contactId: string): Promise<ApprovalSessionSummary[]> {
  try {
    const res = await mainPool.query(
      `SELECT id, title, status, total_photos, approved_count, rejected_count, created_at
       FROM photo_approval_sessions
       WHERE contact_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 10`,
      [contactId],
    );
    return res.rows.map((r: ApprovalSessionRow) => ({
      id: r.id,
      title: r.title || null,
      status: r.status || null,
      total_photos: r.total_photos || 0,
      approved_count: r.approved_count || 0,
      rejected_count: r.rejected_count || 0,
      created_at: r.created_at?.toISOString() || null,
    }));
  } catch (err) {
    logger.warn('fetchApprovalSessionsByContactId failed', { error: String(err) });
    return [];
  }
}

// ============================================================================
// Auto-linking: привязка чат-сессии к клиенту и записи
// ============================================================================

export interface SuggestedClient {
  id: string;
  name: string;
  phone: string | null;
  bookings_count: number;
  match_type?: 'user_id' | 'phone';
}

export interface SuggestedBooking {
  id: string;
  service_name: string | null;
  start_time: string;
  status: string;
}

export interface AutoLinkResult {
  linked_user_id: string | null;
  linked_booking_id: string | null;
  suggested_client_ids: string[];
  match_type: 'phone' | null;
}

/**
 * Auto-link a chat session to a registered client.
 * Only phone match — deterministic auto-link by phone number.
 */
export async function autoLinkSessionToClient(sessionId: string): Promise<AutoLinkResult> {
  const result: AutoLinkResult = { linked_user_id: null, linked_booking_id: null, suggested_client_ids: [], match_type: null };

  try {
    const sessionRes = await mainPool.query<AutoLinkConversationLookupRow>(
      `SELECT c.user_id,
              ct.user_id AS contact_user_id,
              COALESCE(ct.user_id, c.user_id) AS effective_user_id,
              COALESCE(ct.phone, c.visitor_phone) AS phone,
              c.contact_id,
              c.channel,
              c.external_chat_id,
              c.visitor_id
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.id = $1`,
      [sessionId],
    );
    const session = sessionRes.rows[0];
    if (!session) return result;

    // Already linked — skip
    if (session.effective_user_id) {
      result.linked_user_id = session.effective_user_id;
      return result;
    }

    // Phone match (deterministic) — reads from contacts (SSOT), fallback visitor_phone
    if (session.phone) {
      const normalized = normalizePhone(session.phone);
      const phoneVariants = [
        normalized,
        '+7' + normalized.slice(1),
        '8' + normalized.slice(1),
        session.phone,
      ];
      const userRes = await mainPool.query<AutoLinkUserRow>(
        `SELECT id FROM users WHERE phone = ANY($1) AND is_active = TRUE AND role = 'client' LIMIT 1`,
        [phoneVariants],
      );
      if (userRes.rows[0]) {
        const userId = userRes.rows[0].id;
        const updateRes = await mainPool.query<AutoLinkConversationUpdateRow>(
          `UPDATE conversations SET user_id = $1, updated_at = NOW()
           WHERE id = $2 AND user_id IS NULL
           RETURNING id, user_id, contact_id, channel, external_chat_id, visitor_id`,
          [userId, sessionId],
        );
        const updatedConversation = updateRes.rows[0];
        if (updatedConversation) {
          await logIdentityLinkEvent({
            action: 'identity_link_chat',
            source: 'client_context_auto_link',
            entityType: 'conversation',
            entityId: updatedConversation.id,
            conversationId: updatedConversation.id,
            contactId: updatedConversation.contact_id,
            channel: updatedConversation.channel,
            externalChatId: updatedConversation.external_chat_id,
            visitorId: updatedConversation.visitor_id,
            previousUserId: session.user_id,
            newUserId: userId,
            reason: 'phone_match',
            result: 'linked',
            metadata: { matchedByPhone: true, phoneAvailable: true },
          });
        } else {
          await logIdentityLinkEvent({
            action: 'identity_link_skipped',
            source: 'client_context_auto_link',
            entityType: 'conversation',
            entityId: sessionId,
            conversationId: sessionId,
            contactId: session.contact_id,
            channel: session.channel,
            externalChatId: session.external_chat_id,
            visitorId: session.visitor_id,
            previousUserId: session.user_id,
            newUserId: userId,
            reason: 'conversation_already_linked_or_missing',
            result: 'skipped',
            metadata: { matchedByPhone: true, phoneAvailable: true },
          });
        }
        result.linked_user_id = userId;
        result.match_type = 'phone';

        // Try to link booking within ±2 hours
        const bookingRes = await mainPool.query<AutoLinkBookingMatchRow>(
          `SELECT id FROM bookings
           WHERE client_id = $1
             AND status IN ('confirmed', 'pending')
             AND ABS(EXTRACT(EPOCH FROM (start_time - NOW()))) < 7200
           ORDER BY ABS(EXTRACT(EPOCH FROM (start_time - NOW()))) ASC LIMIT 1`,
          [userId],
        );
        if (bookingRes.rows[0]) {
          await mainPool.query(
            `UPDATE conversations SET booking_id = $1 WHERE id = $2 AND booking_id IS NULL`,
            [bookingRes.rows[0].id, sessionId],
          );
          result.linked_booking_id = bookingRes.rows[0].id;
        }

        logger.info(`[ClientLink] Auto-linked session ${sessionId} to user ${userId} by phone`);
        return result;
      }
    }
  } catch (err) {
    logger.error('[ClientLink] autoLinkSessionToClient error:', { error: String(err) });
  }

  return result;
}

/**
 * Search for potential client matches for a session (operator-facing).
 * Priority: user_id (already linked) > phone exact.
 */
export async function suggestClientsForSession(sessionId: string): Promise<{ users: SuggestedClient[]; bookings: SuggestedBooking[] }> {
  const sessionRes = await mainPool.query(
    `SELECT visitor_phone, visitor_name, user_id FROM conversations WHERE id = $1`,
    [sessionId],
  );
  const session = sessionRes.rows[0];
  if (!session) return { users: [], bookings: [] };

  // Step 1: Already linked — return only that user
  if (session.user_id) {
    const linkedRes = await mainPool.query(
      `SELECT u.id, u.display_name AS name, u.phone,
              (SELECT count(*) FROM orders o WHERE o.client_id = u.id)::int AS bookings_count
       FROM users u WHERE u.id = $1`,
      [session.user_id],
    );
    const users: SuggestedClient[] = linkedRes.rows.map((r: SuggestedClient) => ({ ...r, match_type: 'user_id' as const }));
    return { users, bookings: [] };
  }

  // Step 2: Phone exact match (strong signal)
  if (session.visitor_phone) {
    const normalized = normalizePhone(session.visitor_phone);
    const phoneVariants = [normalized, '+7' + normalized.slice(1), '8' + normalized.slice(1), session.visitor_phone];
    const phoneRes = await mainPool.query(
      `SELECT u.id, u.display_name AS name, u.phone,
              (SELECT count(*) FROM orders o WHERE o.client_id = u.id)::int AS bookings_count
       FROM users u
       WHERE u.is_active = TRUE AND u.role = 'client'
         AND u.phone = ANY($1)
       LIMIT 5`,
      [phoneVariants],
    );
    if (phoneRes.rows.length > 0) {
      const users: SuggestedClient[] = phoneRes.rows.map((r: SuggestedClient) => ({ ...r, match_type: 'phone' as const }));
      return { users, bookings: await fetchBookingsForUsers(users) };
    }
  }

  return { users: [], bookings: [] };
}

async function fetchBookingsForUsers(users: SuggestedClient[]): Promise<SuggestedBooking[]> {
  if (users.length === 0) return [];
  const userIds = users.map(u => u.id);
  const bookingRes = await mainPool.query(
    `SELECT b.id, b.service_name, b.start_time, b.status
     FROM bookings b
     WHERE b.client_id = ANY($1)
       AND b.status IN ('confirmed', 'pending')
       AND b.start_time >= NOW() - INTERVAL '7 days'
     ORDER BY b.start_time ASC
     LIMIT 20`,
    [userIds],
  );
  return bookingRes.rows.map((r: SuggestedBookingRow) => ({
    id: r.id,
    service_name: r.service_name,
    start_time: r.start_time instanceof Date ? r.start_time.toISOString() : String(r.start_time || ''),
    status: r.status || 'pending',
  }));
}

/**
 * Search for clients by operator query (name, phone, email).
 * Used when operator types in the "link client" search box.
 */
export async function searchClientsByQuery(query: string, _sessionId: string): Promise<{ users: SuggestedClient[]; bookings: SuggestedBooking[] }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  // Determine if query looks like a phone number (starts with +, 7, 8, or all digits)
  const digits = query.replace(/\D/g, '');
  if (digits.length >= 4 && /^[\d+() -]+$/.test(query)) {
    // Phone search: normalize and search variants
    const normalized = normalizePhone(query);
    const phoneVariants = [normalized, '+7' + normalized.slice(1), '8' + normalized.slice(1), query];
    conditions.push(`u.phone = ANY($${idx})`);
    params.push(phoneVariants);
    idx++;
  } else {
    // Text search: ILIKE by display_name, first_name, last_name, email
    conditions.push(`(u.display_name ILIKE $${idx} OR (u.first_name || ' ' || u.last_name) ILIKE $${idx} OR u.email ILIKE $${idx})`);
    params.push(`%${query}%`);
    idx++;
  }

  const userRes = await mainPool.query(
    `SELECT u.id, u.display_name AS name, u.phone,
            (SELECT count(*) FROM orders o WHERE o.client_id = u.id)::int AS bookings_count
     FROM users u
     WHERE u.is_active = TRUE AND u.role = 'client'
       AND (${conditions.join(' OR ')})
     LIMIT 10`,
    params,
  );

  const users: SuggestedClient[] = userRes.rows;

  let bookings: SuggestedBooking[] = [];
  if (users.length > 0) {
    const userIds = users.map(u => u.id);
    const bookingRes = await mainPool.query(
      `SELECT b.id, b.service_name, b.start_time, b.status
       FROM bookings b
       WHERE b.client_id = ANY($1)
         AND b.status IN ('confirmed', 'pending')
         AND b.start_time >= NOW() - INTERVAL '7 days'
       ORDER BY b.start_time ASC
       LIMIT 20`,
      [userIds],
    );
    bookings = bookingRes.rows.map((r: SuggestedBookingRow) => ({
      id: r.id,
      service_name: r.service_name,
      start_time: r.start_time instanceof Date ? r.start_time.toISOString() : String(r.start_time || ''),
      status: r.status || 'pending',
    }));
  }

  return { users, bookings };
}

async function fetchOtherTasksByUserId(userId: string, currentTaskId?: string): Promise<TaskEntry[]> {
  try {
    const res = await mainPool.query(
      `SELECT id, task_number, title, status, priority, due_date
       FROM work_tasks
       WHERE client_id = $1
         ${currentTaskId ? `AND id != $2` : ''}
         AND status NOT IN ('cancelled')
       ORDER BY created_at DESC
       LIMIT 20`,
      currentTaskId ? [userId, currentTaskId] : [userId],
    );
    return res.rows.map((r: TaskRow) => ({
      id: r.id,
      task_number: r.task_number,
      title: r.title,
      status: r.status,
      priority: r.priority,
      due_date: r.due_date?.toISOString() || null,
    }));
  } catch (err) {
    logger.error('[ClientCtx] fetchOtherTasksByUserId error:', { error: String(err) });
    return [];
  }
}
