import crypto from 'crypto';
import { config } from '../config/index.js';
import { fetchWithCB, type ServiceBreakerConfig } from '../utils/circuit-breaker.js';
import { createLogger } from '../utils/logger.js';
import {
  getSdkCallHistory,
  isVoximplantSdkConfigured,
  startSdkScenarios,
} from './voximplant-management-sdk.service.js';

const logger = createLogger('voximplant.service');
const VOXIMPLANT_BREAKER = {
  name: 'voximplant',
  threshold: 5,
  cooldownMs: 30_000,
  timeoutMs: 10_000,
} satisfies ServiceBreakerConfig;

export interface VoximplantSmsResult {
  success: boolean;
  smsId?: string;
  cost?: number;
  fragmentsCount?: number;
  error?: string;
}

export interface VoximplantVoiceCallResult {
  success: boolean;
  requestId?: string;
  callSessionHistoryId?: string;
  callerId?: string;
  verificationCode?: string;
  error?: string;
}

export interface VoximplantVoiceCallEndReason {
  code?: number;
  details?: string;
}

export interface VoximplantVoiceCallHistoryCall {
  callId?: number;
  startTime?: string;
  duration?: number;
  localNumber?: string;
  remoteNumber?: string;
  incoming?: boolean;
  successful?: boolean;
  cost?: number;
  endReason?: VoximplantVoiceCallEndReason;
  direction?: string;
}

export interface VoximplantVoiceCallHistorySession {
  callSessionHistoryId?: number;
  startDate?: string;
  duration?: number;
  finishReason?: string;
  applicationName?: string;
  ruleName?: string;
  calls: VoximplantVoiceCallHistoryCall[];
}

export type VoximplantVoiceCallHistoryResult =
  | { success: true; session: VoximplantVoiceCallHistorySession }
  | { success: false; error: string };

export interface VoximplantStudioClickToCallInput {
  destinationPhone: string;
  sessionId: string;
  operatorUser?: string;
  callerId?: string;
}

export interface VoximplantStudioClickToCallResult {
  success: boolean;
  requestId?: string;
  callSessionHistoryId?: string;
  callerId?: string;
  operatorUser?: string;
  error?: string;
}

export interface VoximplantServiceSurveyCallInput {
  destinationPhone: string;
  sessionId: string;
  callerId?: string;
  maxAnswerMs?: number;
}

export interface VoximplantServiceSurveyCallResult {
  success: boolean;
  requestId?: string;
  callSessionHistoryId?: string;
  callerId?: string;
  error?: string;
}

interface JsonObject {
  [key: string]: unknown;
}

interface VoximplantApiResponse extends JsonObject {
  result?: unknown;
  error?: unknown;
  error_code?: unknown;
  error_msg?: unknown;
  call_session_history_id?: unknown;
  transaction_id?: unknown;
  message_id?: unknown;
  sms_id?: unknown;
  sms_id_list?: unknown;
  session_id?: unknown;
  session_id_list?: unknown;
  media_session_access_url?: unknown;
  media_session_access_secure_url?: unknown;
  fragments_count?: unknown;
  cost?: unknown;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function asApiResponse(value: unknown): VoximplantApiResponse | null {
  return isJsonObject(value) ? value : null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

function firstId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return asString(value[0]);
  }
  return asString(value);
}

function getFirstValue(data: JsonObject, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function asJsonObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonObject);
}

function normalizeCallEndReason(value: unknown): VoximplantVoiceCallEndReason | undefined {
  if (!isJsonObject(value)) return undefined;

  const code = asNumber(value['code']);
  const details = asString(value['details']);
  if (code === undefined && details === undefined) return undefined;

  return { code, details };
}

function normalizeCallHistoryCall(call: JsonObject): VoximplantVoiceCallHistoryCall {
  return {
    callId: asNumber(getFirstValue(call, ['callId', 'call_id'])),
    startTime: asString(getFirstValue(call, ['startTime', 'start_time'])),
    duration: asNumber(call['duration']),
    localNumber: asString(getFirstValue(call, ['localNumber', 'local_number'])),
    remoteNumber: asString(getFirstValue(call, ['remoteNumber', 'remote_number'])),
    incoming: asBoolean(call['incoming']),
    successful: asBoolean(call['successful']),
    cost: asNumber(call['cost']),
    endReason: normalizeCallEndReason(getFirstValue(call, ['endReason', 'end_reason'])),
    direction: asString(call['direction']),
  };
}

function normalizeCallHistorySession(value: unknown): VoximplantVoiceCallHistorySession | null {
  if (!isJsonObject(value)) return null;

  return {
    callSessionHistoryId: asNumber(getFirstValue(value, ['callSessionHistoryId', 'call_session_history_id'])),
    startDate: asString(getFirstValue(value, ['startDate', 'start_date'])),
    duration: asNumber(value['duration']),
    finishReason: asString(getFirstValue(value, ['finishReason', 'finish_reason'])),
    applicationName: asString(getFirstValue(value, ['applicationName', 'application_name'])),
    ruleName: asString(getFirstValue(value, ['ruleName', 'rule_name'])),
    calls: asJsonObjectArray(value['calls']).map(normalizeCallHistoryCall),
  };
}

function normalizeCallHistoryResult(value: unknown): VoximplantVoiceCallHistorySession | null {
  if (!isJsonObject(value)) return null;

  const sessions = asJsonObjectArray(value['result'])
    .map(normalizeCallHistorySession)
    .filter((session): session is VoximplantVoiceCallHistorySession => session !== null);

  return sessions[0] || null;
}

function errorText(data: VoximplantApiResponse): string {
  return asString(data.error_msg)
    || asString(data.error)
    || asString(data.error_code)
    || 'Voximplant API error';
}

function buildApiUrl(method: string): string {
  const baseUrl = config.voximplant.apiBaseUrl.replace(/\/+$/, '');
  return `${baseUrl}/${method}/`;
}

function buildApiBody(params: URLSearchParams): URLSearchParams {
  params.set('account_id', config.voximplant.accountId);
  params.set('api_key', config.voximplant.apiKey);
  return params;
}

function normalizeDestination(phone: string): string {
  return phone.replace(/\D/g, '');
}

async function callManagementApi(method: string, params: URLSearchParams): Promise<VoximplantApiResponse | null> {
  const response = await fetchWithCB(VOXIMPLANT_BREAKER, buildApiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildApiBody(params),
  });
  if (!response.ok) {
    logger.error('Voximplant HTTP error', { method, status: response.status });
    return {
      error: `HTTP ${response.status}`,
    };
  }

  const parsed = await response.json() as unknown;
  return asApiResponse(parsed);
}

export function isVoximplantSmsConfigured(): boolean {
  return config.voximplant.smsEnabled
    && !!config.voximplant.accountId
    && !!config.voximplant.apiKey
    && !!config.voximplant.smsFrom;
}

export function isVoximplantVoiceCallConfigured(): boolean {
  return config.voximplant.voiceCall.enabled
    && !!config.voximplant.accountId
    && !!config.voximplant.voiceCall.ruleId
    && config.voximplant.voiceCall.callerIds.length > 0
    && (isVoximplantSdkConfigured() || !!config.voximplant.apiKey);
}

export function isVoximplantStudioClickToCallConfigured(): boolean {
  const ruleId = Number(config.voximplant.studioClickToCall.outboundRuleId);
  return config.voximplant.studioClickToCall.enabled
    && !!config.voximplant.accountId
    && Number.isInteger(ruleId)
    && ruleId > 0
    && normalizeDestination(config.voximplant.studioClickToCall.callerId).length >= 10
    && !!config.voximplant.studioClickToCall.sipUser
    && (isVoximplantSdkConfigured() || !!config.voximplant.apiKey);
}

export function isVoximplantServiceSurveyConfigured(): boolean {
  const ruleId = Number(config.voximplant.serviceSurvey.outboundRuleId);
  return config.voximplant.serviceSurvey.enabled
    && !!config.voximplant.accountId
    && Number.isInteger(ruleId)
    && ruleId > 0
    && normalizeDestination(config.voximplant.serviceSurvey.callerId).length >= 10
    && config.voximplant.serviceSurvey.question.trim().length > 0
    && (isVoximplantSdkConfigured() || !!config.voximplant.apiKey);
}

function chooseCallerId(): string {
  const callerIds = config.voximplant.voiceCall.callerIds;
  if (callerIds.length === 0) return '';
  return callerIds[crypto.randomInt(callerIds.length)] || '';
}

/**
 * Start CRM click-to-call where Voximplant rings the studio SIP user first.
 * Once the employee answers the desk phone, the scenario dials the customer
 * over PSTN and bridges both legs.
 */
export async function startVoximplantStudioClickToCall(
  input: VoximplantStudioClickToCallInput,
): Promise<VoximplantStudioClickToCallResult> {
  if (!isVoximplantStudioClickToCallConfigured()) {
    return { success: false, error: 'Voximplant studio click-to-call is not configured' };
  }

  const destinationDigits = normalizeDestination(input.destinationPhone);
  if (destinationDigits.length < 10) {
    return { success: false, error: 'Invalid destination phone' };
  }

  const callerId = input.callerId || config.voximplant.studioClickToCall.callerId;
  const callerIdDigits = normalizeDestination(callerId);
  if (callerIdDigits.length < 10) {
    return { success: false, error: 'Invalid caller ID' };
  }

  const operatorUser = input.operatorUser || config.voximplant.studioClickToCall.sipUser;
  const customData = JSON.stringify({
    type: 'studio_click_to_call',
    destination: `+${destinationDigits}`,
    callerId: `+${callerIdDigits}`,
    operatorUser,
    sessionId: input.sessionId,
  });
  const ruleId = Number(config.voximplant.studioClickToCall.outboundRuleId);

  const params = new URLSearchParams({
    rule_id: config.voximplant.studioClickToCall.outboundRuleId,
    script_custom_data: customData,
  });

  const data = isVoximplantSdkConfigured()
    ? await startSdkScenarios({
      ruleId,
      scriptCustomData: customData,
    }).then((sdkResponse): VoximplantApiResponse => ({
      result: sdkResponse.result,
      call_session_history_id: sdkResponse.callSessionHistoryId,
      media_session_access_url: sdkResponse.mediaSessionAccessUrl,
      media_session_access_secure_url: sdkResponse.mediaSessionAccessSecureUrl,
    }))
    : await callManagementApi('StartScenarios', params);

  if (!data) {
    return { success: false, error: 'Unexpected Voximplant response' };
  }
  if (data.error !== undefined || data.error_code !== undefined) {
    const error = errorText(data);
    logger.warn('Voximplant studio click-to-call API error', { error });
    return { success: false, error };
  }

  const requestId = firstId(data.session_id_list)
    || asString(data.session_id)
    || asString(data.media_session_access_url);
  const callSessionHistoryId = asString(data.call_session_history_id)
    || (isJsonObject(data.result) ? asString(data.result['call_session_history_id']) : undefined);

  return {
    success: true,
    requestId,
    callSessionHistoryId,
    callerId: `+${callerIdDigits}`,
    operatorUser,
  };
}

/**
 * Start an automated post-service survey call.
 *
 * The studio outbound VoxEngine scenario records the call, asks the configured
 * question, runs ASR on the client's answer, and posts the result back to our API.
 */
export async function startVoximplantServiceSurveyCall(
  input: VoximplantServiceSurveyCallInput,
): Promise<VoximplantServiceSurveyCallResult> {
  if (!isVoximplantServiceSurveyConfigured()) {
    return { success: false, error: 'Voximplant service survey is not configured' };
  }

  const destinationDigits = normalizeDestination(input.destinationPhone);
  if (destinationDigits.length < 10) {
    return { success: false, error: 'Invalid destination phone' };
  }

  const callerId = input.callerId || config.voximplant.serviceSurvey.callerId;
  const callerIdDigits = normalizeDestination(callerId);
  if (callerIdDigits.length < 10) {
    return { success: false, error: 'Invalid caller ID' };
  }

  const surveyCfg = config.voximplant.serviceSurvey;
  const maxAnswerMs = input.maxAnswerMs || surveyCfg.maxAnswerMs;
  const customData = JSON.stringify({
    type: 'service_survey',
    destination: `+${destinationDigits}`,
    callerId: `+${callerIdDigits}`,
    sessionId: input.sessionId,
    maxAnswerMs,
    // Разговорный режим (опрос-забота). При conversational=true сценарий ведёт диалог
    // через /service-survey/turn вместо односторонней зачитки одного вопроса.
    conversational: surveyCfg.conversational,
    greeting: surveyCfg.greeting,
    maxTurns: surveyCfg.maxTurns,
    voiceEngine: surveyCfg.voiceEngine,
    // Realtime-режим (voiceEngine='grok_realtime'): VoxEngine использует
    // готовый Grok Voice Agent client и секрет XAI_API_KEY внутри Voximplant.
    realtimeModel: surveyCfg.realtimeModel,
    realtimeVoice: surveyCfg.realtimeVoice,
    realtimeInstructions: surveyCfg.realtimeInstructions,
  });
  const ruleId = Number(config.voximplant.serviceSurvey.outboundRuleId);

  const params = new URLSearchParams({
    rule_id: config.voximplant.serviceSurvey.outboundRuleId,
    script_custom_data: customData,
  });

  const data = isVoximplantSdkConfigured()
    ? await startSdkScenarios({
      ruleId,
      scriptCustomData: customData,
    }).then((sdkResponse): VoximplantApiResponse => ({
      result: sdkResponse.result,
      call_session_history_id: sdkResponse.callSessionHistoryId,
      media_session_access_url: sdkResponse.mediaSessionAccessUrl,
      media_session_access_secure_url: sdkResponse.mediaSessionAccessSecureUrl,
    }))
    : await callManagementApi('StartScenarios', params);

  if (!data) {
    return { success: false, error: 'Unexpected Voximplant response' };
  }
  if (data.error !== undefined || data.error_code !== undefined) {
    const error = errorText(data);
    logger.warn('Voximplant service survey API error', { error });
    return { success: false, error };
  }

  const requestId = firstId(data.session_id_list)
    || asString(data.session_id)
    || asString(data.media_session_access_url);
  const callSessionHistoryId = asString(data.call_session_history_id)
    || (isJsonObject(data.result) ? asString(data.result['call_session_history_id']) : undefined);

  return {
    success: true,
    requestId,
    callSessionHistoryId,
    callerId: `+${callerIdDigits}`,
  };
}

/**
 * Send an SMS through Voximplant Management API.
 *
 * A2P is the default mode for transactional notifications and OTP.
 * Two-way mode can be enabled with VOXIMPLANT_SMS_MODE=two_way when a real
 * SMS-capable Voximplant phone number is configured as VOXIMPLANT_SMS_FROM.
 */
export async function sendVoximplantSms(phone: string, message: string): Promise<VoximplantSmsResult> {
  if (!isVoximplantSmsConfigured()) {
    return { success: false, error: 'Voximplant SMS is not configured' };
  }

  const destination = normalizeDestination(phone);
  if (destination.length < 10) {
    return { success: false, error: 'Invalid destination phone' };
  }

  const params = new URLSearchParams();
  let method = 'A2PSendSms';

  if (config.voximplant.smsMode === 'two_way') {
    method = 'SendSmsMessage';
    params.set('source', config.voximplant.smsFrom);
    params.set('destination', destination);
    params.set('sms_body', message);
  } else {
    params.set('src_number', config.voximplant.smsFrom);
    params.set('dst_numbers', destination);
    params.set('text', message);
  }

  const data = await callManagementApi(method, params);
  if (!data) {
    return { success: false, error: 'Unexpected Voximplant response' };
  }

  if (data.error !== undefined || data.error_code !== undefined) {
    const error = errorText(data);
    logger.warn('Voximplant SMS API error', { error });
    return { success: false, error };
  }

  const resultRecord = isJsonObject(data.result) ? data.result : null;
  const smsId = firstId(data.sms_id_list)
    || asString(data.sms_id)
    || asString(data.message_id)
    || asString(data.transaction_id)
    || (resultRecord ? firstId(resultRecord['sms_id_list']) : undefined)
    || (resultRecord ? asString(resultRecord['sms_id']) : undefined)
    || (resultRecord ? asString(resultRecord['transaction_id']) : undefined);

  return {
    success: true,
    smsId,
    cost: asNumber(data.cost) ?? (resultRecord ? asNumber(resultRecord['cost']) : undefined),
    fragmentsCount: asNumber(data.fragments_count) ?? (resultRecord ? asNumber(resultRecord['fragments_count']) : undefined),
  };
}

/**
 * Start a voice-call OTP scenario.
 *
 * VoxEngine scenario should read VoxEngine.customData(), call destination from
 * the selected caller ID, speak the verification code, then hang up after
 * config.voximplant.voiceCall.hangupAfterMs.
 */
export async function startVoximplantVoiceCall(
  phone: string,
  verificationCode: string,
  preferredCallerId?: string,
): Promise<VoximplantVoiceCallResult> {
  if (!isVoximplantVoiceCallConfigured()) {
    return { success: false, error: 'Voximplant voice call is not configured' };
  }

  const destinationDigits = normalizeDestination(phone);
  if (destinationDigits.length < 10) {
    return { success: false, error: 'Invalid destination phone' };
  }
  const normalizedCode = verificationCode.replace(/\D/g, '');
  if (normalizedCode.length < 4 || normalizedCode.length > 8) {
    return { success: false, error: 'Invalid verification code' };
  }

  const callerId = preferredCallerId || chooseCallerId();
  if (normalizeDestination(callerId).length < 10) {
    return { success: false, error: 'Invalid caller ID' };
  }

  const customPayload: JsonObject = {
    type: 'voice_otp',
    destination: `+${destinationDigits}`,
    callerId: `+${normalizeDestination(callerId)}`,
    code: normalizedCode,
    repeatCount: 2,
    hangupAfterMs: config.voximplant.voiceCall.hangupAfterMs,
  };
  if (config.voximplant.voiceCall.callbackUrl) {
    customPayload['callbackUrl'] = config.voximplant.voiceCall.callbackUrl;
  }
  if (config.voximplant.voiceCall.callbackSecret) {
    customPayload['callbackSecret'] = config.voximplant.voiceCall.callbackSecret;
  }
  const customData = JSON.stringify(customPayload);

  const params = new URLSearchParams({
    rule_id: config.voximplant.voiceCall.ruleId,
    script_custom_data: customData,
  });

  const data = isVoximplantSdkConfigured()
    ? await startSdkScenarios({
      ruleId: Number(config.voximplant.voiceCall.ruleId),
      scriptCustomData: customData,
    }).then((sdkResponse): VoximplantApiResponse => ({
      result: sdkResponse.result,
      call_session_history_id: sdkResponse.callSessionHistoryId,
      media_session_access_url: sdkResponse.mediaSessionAccessUrl,
      media_session_access_secure_url: sdkResponse.mediaSessionAccessSecureUrl,
    }))
    : await callManagementApi('StartScenarios', params);

  if (!data) {
    return { success: false, error: 'Unexpected Voximplant response' };
  }
  if (data.error !== undefined || data.error_code !== undefined) {
    const error = errorText(data);
    logger.warn('Voximplant voice call API error', { error });
    return { success: false, error };
  }

  const requestId = firstId(data.session_id_list)
    || asString(data.session_id)
    || asString(data.media_session_access_url);
  const callSessionHistoryId = asString(data.call_session_history_id)
    || (isJsonObject(data.result) ? asString(data.result['call_session_history_id']) : undefined);

  return {
    success: true,
    requestId,
    callSessionHistoryId,
    callerId,
    verificationCode: normalizedCode,
  };
}

export async function getVoximplantVoiceCallHistory(
  callSessionHistoryId: string,
): Promise<VoximplantVoiceCallHistoryResult> {
  if (!isVoximplantSdkConfigured()) {
    return { success: false, error: 'Voximplant SDK is not configured' };
  }

  const sessionId = Number(callSessionHistoryId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { success: false, error: 'Invalid Voximplant call session history ID' };
  }

  try {
    const history = await getSdkCallHistory({
      fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      toDate: new Date(Date.now() + 60 * 60 * 1000),
      timezone: 'Etc/GMT',
      callSessionHistoryId: [sessionId],
      withCalls: true,
      withRecords: false,
      withOtherResources: true,
      withTotalCount: true,
      count: 1,
    });
    const session = normalizeCallHistoryResult(history);
    if (!session) {
      return { success: false, error: 'Voximplant call history not found' };
    }
    return { success: true, session };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
