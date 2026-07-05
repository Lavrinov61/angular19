import { z } from 'zod';
import db from '../database/db.js';
import { executeTool, type ToolContext } from './ai-agent/ai-agent-tools.js';
import {
  createBooking,
  getAvailableSlots,
  getStudios,
  type BookingSlot,
} from './booking-autonomous.service.js';

const AI_AGENT_READ_TOOL_NAMES = new Set([
  'get_service_catalog',
  'calculate_price',
  'validate_selection',
  'check_subscription',
  'get_student_discount',
  'get_order_status',
  'get_my_bookings',
  'list_pickup_points',
  'handoff_to_operator',
]);

const VOICE_BOOKING_TOOL_NAMES = new Set([
  'get_studio_status',
  'check_slots',
  'create_booking',
]);

const serviceSchema = z.enum(['photo_documents', 'portrait_photo']);
type VoiceBookingService = z.infer<typeof serviceSchema>;

const studioStatusArgsSchema = z.object({
  studio: z.string().trim().min(1).max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

const checkSlotsArgsSchema = z.object({
  studio: z.string().trim().min(1).max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service: serviceSchema.optional(),
}).strict();

const createBookingArgsSchema = z.object({
  studio: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  service: serviceSchema,
  clientName: z.string().trim().min(1).max(120).optional(),
}).strict();

interface ServiceSurveyToolContactRow {
  id: string;
  display_name: string | null;
  user_id: string | null;
  phone: string | null;
}

interface StudioLookupRow {
  id: string;
  name: string;
  location_code: string | null;
  address: string | null;
}

interface StudioStatusDescription {
  studio: StudioLookupRow;
  date: string;
  open: boolean;
  closed_reason: string | null;
  available_slots: string[];
  total_slots: number;
}

export interface ServiceSurveyRealtimeToolInput {
  sessionId: string;
  toolName: string;
  rawArguments: string;
  callerNumber?: string;
  calledNumber?: string;
  trustedIdentity: boolean;
}

export interface ServiceSurveyRealtimeToolResult {
  toolName: string;
  outcome: string;
  output: string;
}

function normalizePhoneTail(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const tail = phone.replace(/\D/g, '').slice(-10);
  return tail.length === 10 ? tail : null;
}

function preferredClientPhone(input: ServiceSurveyRealtimeToolInput): string | null {
  return input.calledNumber || input.callerNumber || null;
}

function todayMoscow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseToolArgs(rawArguments: string): unknown {
  if (!rawArguments.trim()) return {};
  return JSON.parse(rawArguments);
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

function deniedOutput(toolName: string): ServiceSurveyRealtimeToolResult {
  return {
    toolName,
    outcome: 'denied',
    output: output({ error: 'tool_denied', message: `Инструмент ${toolName} недоступен в голосовом звонке.` }),
  };
}

async function resolveContactForTrustedCall(
  input: ServiceSurveyRealtimeToolInput,
): Promise<ServiceSurveyToolContactRow | null> {
  if (!input.trustedIdentity) return null;
  const tail = normalizePhoneTail(preferredClientPhone(input));
  if (!tail) return null;

  return db.queryOne<ServiceSurveyToolContactRow>(
    `SELECT id, display_name, user_id::text AS user_id, phone
       FROM contacts
      WHERE RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
        AND deleted_at IS NULL
      ORDER BY last_seen_at DESC NULLS LAST, first_seen_at DESC NULLS LAST
      LIMIT 1`,
    [tail],
  );
}

function buildToolContext(
  input: ServiceSurveyRealtimeToolInput,
  contact: ServiceSurveyToolContactRow | null,
): ToolContext {
  return {
    conversationId: `service-survey:${input.sessionId}`,
    contactId: contact?.id ?? null,
    userId: contact?.user_id ?? null,
    phone: contact?.phone ?? preferredClientPhone(input),
    channel: null,
    trustedIdentity: input.trustedIdentity,
  };
}

function serviceName(service: VoiceBookingService): string {
  if (service === 'photo_documents') return 'Фото на документы';
  return 'Портретная съёмка';
}

function serviceDuration(service: VoiceBookingService): number {
  if (service === 'photo_documents') return 15;
  return 30;
}

function serviceCategorySlug(service: VoiceBookingService): string | undefined {
  if (service === 'photo_documents') return 'photo-docs';
  return undefined;
}

function ensureBookingDateAllowed(date: string, time: string): { ok: true } | { ok: false; message: string } {
  const bookingDate = new Date(`${date}T${time}:00+03:00`);
  if (Number.isNaN(bookingDate.getTime())) return { ok: false, message: 'Некорректные дата или время.' };
  if (bookingDate.getTime() < Date.now()) return { ok: false, message: 'Нельзя записаться на прошедшее время.' };
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);
  if (bookingDate > maxDate) return { ok: false, message: 'Запись доступна не более чем на 30 дней вперёд.' };
  return { ok: true };
}

async function resolveStudio(studio: string): Promise<StudioLookupRow | null> {
  const normalized = studio.trim().toLowerCase();
  return db.queryOne<StudioLookupRow>(
    `SELECT id, name, location_code, address
       FROM studios
      WHERE id::text = $1
         OR lower(COALESCE(location_code, '')) = $1
         OR lower(name) LIKE '%' || $1 || '%'
         OR lower(COALESCE(address, '')) LIKE '%' || $1 || '%'
      ORDER BY
        CASE
          WHEN lower(COALESCE(location_code, '')) = $1 THEN 0
          WHEN id::text = $1 THEN 1
          ELSE 2
        END,
        name
      LIMIT 1`,
    [normalized],
  );
}

function availableSlots(slots: BookingSlot[]): BookingSlot[] {
  return slots.filter(slot => slot.available);
}

async function describeStudioStatus(
  studio: StudioLookupRow,
  date: string,
  service?: VoiceBookingService,
): Promise<StudioStatusDescription> {
  const slots = await getAvailableSlots(studio.id, date, service ? serviceCategorySlug(service) : undefined);
  return {
    studio: {
      id: studio.id,
      name: studio.name,
      location_code: studio.location_code,
      address: studio.address,
    },
    date,
    open: slots.slots.length > 0 && !slots.closedReason,
    closed_reason: slots.closedReason ?? null,
    available_slots: availableSlots(slots.slots).map(slot => slot.time),
    total_slots: slots.slots.length,
  };
}

async function runGetStudioStatus(rawArguments: string): Promise<unknown> {
  const args = studioStatusArgsSchema.parse(parseToolArgs(rawArguments));
  const date = args.date ?? todayMoscow();

  if (args.studio) {
    const studio = await resolveStudio(args.studio);
    if (!studio) return { found: false, date };
    return { found: true, ...(await describeStudioStatus(studio, date)) };
  }

  const studios = await getStudios();
  const statuses = await Promise.all(studios.map(studio => describeStudioStatus(studio, date)));
  return { date, studios: statuses };
}

async function runCheckSlots(rawArguments: string): Promise<unknown> {
  const args = checkSlotsArgsSchema.parse(parseToolArgs(rawArguments));

  if (args.studio) {
    const studio = await resolveStudio(args.studio);
    if (!studio) return { found: false, date: args.date, slots: [] };
    return { found: true, ...(await describeStudioStatus(studio, args.date, args.service)) };
  }

  const studios = await getStudios();
  const statuses = await Promise.all(studios.map(studio => describeStudioStatus(studio, args.date, args.service)));
  return { date: args.date, studios: statuses };
}

async function runCreateBooking(
  input: ServiceSurveyRealtimeToolInput,
  rawArguments: string,
  contact: ServiceSurveyToolContactRow | null,
): Promise<unknown> {
  if (!input.trustedIdentity) {
    return { ok: false, need_verification: true, message: 'Не удалось подтвердить телефон звонка.' };
  }

  const args = createBookingArgsSchema.parse(parseToolArgs(rawArguments));
  const dateCheck = ensureBookingDateAllowed(args.date, args.time);
  if (!dateCheck.ok) return { ok: false, message: dateCheck.message };

  const studio = await resolveStudio(args.studio);
  if (!studio) return { ok: false, message: 'Студия не найдена.' };

  const clientPhone = contact?.phone ?? preferredClientPhone(input);
  if (!clientPhone || !normalizePhoneTail(clientPhone)) return { ok: false, message: 'Нет телефона клиента для записи.' };
  const bookingPhone = clientPhone;

  const slots = await getAvailableSlots(studio.id, args.date, serviceCategorySlug(args.service));
  const requestedSlot = slots.slots.find(slot => slot.time === args.time);
  if (!requestedSlot?.available) {
    return {
      ok: false,
      message: slots.closedReason || 'Это время недоступно.',
      available_slots: availableSlots(slots.slots).map(slot => slot.time),
    };
  }

  const result = await createBooking({
    studioId: studio.id,
    date: args.date,
    time: args.time,
    duration: serviceDuration(args.service),
    clientName: args.clientName ?? contact?.display_name ?? 'Клиент',
    clientPhone: bookingPhone,
    serviceName: serviceName(args.service),
    serviceCategorySlug: serviceCategorySlug(args.service),
    source: 'phone',
    notes: `Запись создана голосовым AI по звонку ${input.sessionId}`,
  });

  if (!result.success) return { ok: false, message: result.error || 'Не удалось создать запись.' };
  return {
    ok: true,
    booking_id: result.bookingId,
    studio: { id: studio.id, name: studio.name, address: studio.address, location_code: studio.location_code },
    date: args.date,
    time: args.time,
    service_name: serviceName(args.service),
  };
}

async function runVoiceBookingTool(
  input: ServiceSurveyRealtimeToolInput,
  contact: ServiceSurveyToolContactRow | null,
): Promise<ServiceSurveyRealtimeToolResult> {
  try {
    let result: unknown;
    if (input.toolName === 'get_studio_status') result = await runGetStudioStatus(input.rawArguments);
    else if (input.toolName === 'check_slots') result = await runCheckSlots(input.rawArguments);
    else if (input.toolName === 'create_booking') result = await runCreateBooking(input, input.rawArguments, contact);
    else return deniedOutput(input.toolName);
    return { toolName: input.toolName, outcome: 'executed', output: output(result) };
  } catch (error) {
    return {
      toolName: input.toolName,
      outcome: 'error',
      output: output({ error: 'tool_error', message: error instanceof Error ? error.message : String(error) }),
    };
  }
}

export async function runServiceSurveyRealtimeTool(
  input: ServiceSurveyRealtimeToolInput,
): Promise<ServiceSurveyRealtimeToolResult> {
  if (!AI_AGENT_READ_TOOL_NAMES.has(input.toolName) && !VOICE_BOOKING_TOOL_NAMES.has(input.toolName)) {
    return deniedOutput(input.toolName);
  }

  const contact = await resolveContactForTrustedCall(input);

  if (VOICE_BOOKING_TOOL_NAMES.has(input.toolName)) {
    return runVoiceBookingTool(input, contact);
  }

  const result = await executeTool(
    input.toolName,
    input.rawArguments,
    buildToolContext(input, contact),
  );
  return {
    toolName: input.toolName,
    outcome: result.outcome,
    output: output(result.result ?? { error: result.outcome, message: result.rejectedReason ?? null }),
  };
}
