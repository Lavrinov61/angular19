import { Injectable, inject, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { WebSocketService } from '../../../core/services/websocket.service';
import { TelephonyApiService } from './telephony-api.service';
import { LoggerService } from '../../../core/services/logger.service';

export type CallState = 'idle' | 'ringing' | 'connecting' | 'active';

export interface IncomingCallInfo {
  callId: string;
  callerNumber: string;
  clientName: string | null;
  clientId: string | null;
  ordersCount: number;
  sessionId: string;
}

export interface ActiveCallInfo {
  callId: string;
  phone: string;
  clientName: string | null;
  direction: 'inbound' | 'outbound';
  startedAt: Date;
}

interface TelephonyCallEventInfo {
  callId: string;
  event: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isIncomingCallInfo(value: unknown): value is IncomingCallInfo {
  if (!isRecord(value)) return false;

  return typeof value['callId'] === 'string'
    && typeof value['callerNumber'] === 'string'
    && isNullableString(value['clientName'])
    && isNullableString(value['clientId'])
    && typeof value['ordersCount'] === 'number'
    && typeof value['sessionId'] === 'string';
}

function isTelephonyCallEventInfo(value: unknown): value is TelephonyCallEventInfo {
  if (!isRecord(value)) return false;

  return typeof value['callId'] === 'string'
    && typeof value['event'] === 'string';
}

@Injectable({ providedIn: 'root' })
export class TelephonyService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ws = inject(WebSocketService);
  private readonly api = inject(TelephonyApiService);
  private readonly log = inject(LoggerService);

  // State signals
  readonly callState = signal<CallState>('idle');
  readonly incomingCall = signal<IncomingCallInfo | null>(null);
  readonly activeCall = signal<ActiveCallInfo | null>(null);
  readonly muted = signal(false);
  readonly recording = signal(false);
  readonly callDuration = signal(0);
  readonly outboundRequesting = signal(false);
  readonly callHistoryRefreshTick = signal(0);

  // Computed
  readonly hasIncomingCall = computed(() => this.callState() === 'ringing' && this.incomingCall() !== null);
  readonly isInCall = computed(() => this.callState() === 'active' || this.callState() === 'connecting');

  // MediaRecorder
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private localStream: MediaStream | null = null;

  // Voximplant SDK (lazy loaded)
  private voxSDK: VoxImplantInstance | null = null;
  private currentVoxCall: VoxImplantCall | null = null;

  // Timer
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    // Listen for telephony WebSocket events
    effect(() => {
      const event = this.ws.telephonyEvent();
      if (!event) return;

      if (event.event === 'telephony:incoming_call') {
        if (isIncomingCallInfo(event.data)) {
          this.handleIncomingCall(event.data);
        } else {
          this.log.warn('[Telephony] Invalid incoming call event payload');
        }
      } else if (event.event === 'telephony:call_event') {
        if (isTelephonyCallEventInfo(event.data)) {
          this.handleCallEvent(event.data);
        } else {
          this.log.warn('[Telephony] Invalid call event payload');
        }
      }
    });
  }

  /**
   * Инициализация Voximplant Web SDK
   */
  async initSDK(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.voxSDK) return;

    try {
      // Dynamic import — voximplant-websdk устанавливается отдельно
      const moduleName = 'voximplant-websdk';
      const VoxImplant = await new Function('m', 'return import(m)')(moduleName).catch(() => null);
      if (!VoxImplant) {
        this.log.warn('[Telephony] voximplant-websdk not installed, SDK features disabled');
        return;
      }
      this.voxSDK = VoxImplant.getInstance() as VoxImplantInstance;

      await this.voxSDK!.init({
        micRequired: true,
        showDebugInfo: false,
      });

      this.log.debug('[Telephony] SDK initialized');
    } catch (err) {
      this.log.error('[Telephony] SDK init failed:', err);
    }
  }

  /**
   * Подключиться к Voximplant
   */
  async connectAndLogin(username: string, password: string): Promise<boolean> {
    if (!this.voxSDK) return false;

    try {
      await this.voxSDK.connect();
      await this.voxSDK.login(username, password);
      this.log.debug('[Telephony] Connected and logged in');
      return true;
    } catch (err) {
      this.log.error('[Telephony] Connect/login failed:', err);
      return false;
    }
  }

  /**
   * Входящий звонок — показать popup
   */
  private handleIncomingCall(data: IncomingCallInfo): void {
    this.log.debug('[Telephony] Incoming call:', data);
    this.callState.set('ringing');
    this.incomingCall.set(data);
    this.requestCallHistoryRefresh();

    // Auto-dismiss через 30 секунд
    this.dismissTimer = setTimeout(() => {
      if (this.callState() === 'ringing') {
        this.dismissIncomingNotification();
      }
    }, 30_000);
  }

  /**
   * Обработка событий звонка
   */
  private handleCallEvent(data: TelephonyCallEventInfo): void {
    this.requestCallHistoryRefresh();

    if (data.event === 'answered') {
      // Оператор поднял SIP-трубку и ответил на звонок — гасим звонящее
      // CRM-уведомление (рингтон перестаёт пиликать). Реальную SIP-линию это
      // не трогает: оператор уже разговаривает на физической трубке.
      if (this.callState() === 'ringing' && this.incomingCall()?.callId === data.callId) {
        this.dismissIncomingNotification();
      }
      return;
    }

    if (data.event === 'ended' || data.event === 'missed' || data.event === 'failed') {
      if (this.activeCall()?.callId === data.callId || this.incomingCall()?.callId === data.callId) {
        this.endCall();
      }
    }
  }

  /**
   * Click-to-call — исходящий звонок
   */
  async makeCall(phone: string): Promise<void> {
    const destination = phone.trim();
    if (!destination || this.outboundRequesting()) return;

    this.outboundRequesting.set(true);
    this.api.makeCall(destination).subscribe({
      next: (res) => {
        this.outboundRequesting.set(false);
        if (!res.success) {
          this.log.warn('[Telephony] Click-to-call request was not accepted');
          return;
        }
        this.requestCallHistoryRefresh();
      },
      error: (err: unknown) => {
        this.outboundRequesting.set(false);
        this.log.error('[Telephony] Click-to-call request failed:', err);
      },
    });
  }

  private requestCallHistoryRefresh(): void {
    this.callHistoryRefreshTick.update(value => value + 1);
  }

  /**
   * Скрыть CRM-уведомление о звонке без влияния на реальную SIP-линию.
   */
  dismissIncomingNotification(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    if (this.callState() === 'ringing') {
      this.callState.set('idle');
    }
    this.incomingCall.set(null);
  }

  /**
   * Отклонить входящий звонок
   */
  dismissIncoming(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    if (this.currentVoxCall) {
      this.currentVoxCall.decline();
      this.currentVoxCall = null;
    }

    this.callState.set('idle');
    this.incomingCall.set(null);
  }

  /**
   * Положить трубку
   */
  hangup(): void {
    if (this.currentVoxCall) {
      this.currentVoxCall.hangup();
      this.currentVoxCall = null;
    }
    this.endCall();
  }

  /**
   * Mute/unmute
   */
  toggleMute(): void {
    this.muted.update(v => !v);
    if (this.currentVoxCall) {
      if (this.muted()) {
        this.currentVoxCall.muteMicrophone();
      } else {
        this.currentVoxCall.unmuteMicrophone();
      }
    }
  }

  /**
   * Завершение звонка — cleanup
   */
  private endCall(): void {
    this.stopRecording();
    this.stopDurationTimer();

    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    this.callState.set('idle');
    this.activeCall.set(null);
    this.incomingCall.set(null);
    this.muted.set(false);
    this.callDuration.set(0);
    this.currentVoxCall = null;
  }

  // ============================================================
  // MediaRecorder — запись на стороне браузера
  // ============================================================

  private async startRecording(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType: 'audio/webm;codecs=opus' });
      this.recordingChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordingChunks.push(e.data);
      };

      this.mediaRecorder.start(1000); // chunk каждую секунду
      this.recording.set(true);
      this.log.debug('[Telephony] Recording started');
    } catch (err) {
      this.log.error('[Telephony] Failed to start recording:', err);
    }
  }

  private stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder.onstop = () => {
        this.uploadRecording();
      };
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    this.recording.set(false);
  }

  private uploadRecording(): void {
    const callId = this.activeCall()?.callId;
    if (!callId || this.recordingChunks.length === 0) return;

    const blob = new Blob(this.recordingChunks, { type: 'audio/webm' });
    this.recordingChunks = [];

    this.api.uploadRecording(callId, blob).subscribe({
      next: () => this.log.debug('[Telephony] Recording uploaded'),
      error: (err) => this.log.error('[Telephony] Recording upload failed:', err),
    });
  }

  // ============================================================
  // Duration timer
  // ============================================================

  private startDurationTimer(): void {
    this.callDuration.set(0);
    this.durationTimer = setInterval(() => {
      this.callDuration.update(d => d + 1);
    }, 1000);
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  /**
   * Форматирование длительности MM:SS
   */
  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

// Voximplant SDK types (minimal)
interface VoxImplantInstance {
  init(config: Record<string, unknown>): Promise<void>;
  connect(): Promise<void>;
  login(username: string, password: string): Promise<void>;
  call(params: { number: string; video: boolean }): VoxImplantCall;
}

interface VoxImplantCall {
  answer(): void;
  hangup(): void;
  decline(): void;
  muteMicrophone(): void;
  unmuteMicrophone(): void;
}
