import Redis from 'ioredis';
import type { Server as SocketIOServer } from 'socket.io';
import type { ConnectionOptions } from 'tls';
import { markOperatorActive } from './ai-chat.service.js';
import { pool } from '../database/db.js';
import { sendVisitorChatPush } from './visitor-push.service.js';
import { createTaskFromOrder, createTaskFromChat } from './task-auto.service.js';
import { buildWidgetPaymentButton } from '../routes/chat/chat-pricing.helpers.js';
import { config } from '../config/index.js';
import { broadcastChatMessage } from './chat-broadcast.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import type { PubSubEvent } from '../websocket/ws-pubsub.service.js';
import { createLogger } from '../utils/logger.js';
import { cachePosTelemetrySnapshot } from './pos-fiscal-shift.service.js';
import { finalizeShiftReconciliation } from './pos-reconciliation.service.js';

const log = createLogger('redis-subscriber');

export interface RedisMessage {
  type: 'operator_message';
  session_id: string;
  message: {
    id: string;
    sender_type: 'operator';
    sender_name: string;
    content: string;
    timestamp: string;
    attachments?: Array<{
      type: string;
      url: string;
      name: string;
    }>;
  };
}

export interface ChatMessage {
  id: string;
  session_id: string;
  sender_type: 'bot' | 'visitor' | 'operator';
  content: string;
  message_type: 'text' | 'image' | 'file' | 'video' | 'audio';
  attachment_url: string | null;
  created_at: Date;
}

interface InfraRelayMessage {
  [key: string]: unknown;
}

function isInfraRelayMessage(value: unknown): value is InfraRelayMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Redis Pub/Sub Subscriber для получения ответов операторов.
 *
 * PHP handler_website.php публикует сообщения в канал website_chat:{session_id}
 * Этот сервис подписывается на эти каналы и пересылает сообщения через WebSocket.
 */
export class RedisSubscriberService {
  private static readonly DEFAULT_PATTERNS = [
    'website_chat:*',
    'print:*',
    'pos:*',
    'infra:*',
  ] as const;

  private subscriber: Redis | null = null;
  /**
   * Optional Socket.IO reference — установлен только в api-процессе (через setIO).
   * Используется ТОЛЬКО для `io.in(room).allSockets()` (presence check).
   * Все эмиты идут через `broadcastToRoom()` (PM2-split aware).
   */
  private io: SocketIOServer | null = null;
  private isConnected: boolean = false;
  /** Patterns we intend to subscribe to — persisted across reconnects */
  private subscribedPatterns: Set<string> = new Set();
  /** Max reconnect delay (exponential backoff capped here) */
  private static readonly MAX_RETRY_DELAY_MS = 30_000;

  constructor() {
    // no io — emits go through broadcastToRoom
  }

  /** Bind Socket.IO instance — only called by api process for presence-check support. */
  public setIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Инициализация подключения к Redis.
   *
   * Reconnect strategy: exponential backoff, max 30s, unlimited attempts.
   * On reconnect (ioredis 'ready' event): automatically re-subscribes to all patterns.
   * Error handler: logs but never throws — process stays alive.
   */
  async connect(): Promise<void> {
    try {
      this.subscriber = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password || undefined,
        ...(config.redis.tls ? { tls: config.redis.tls as ConnectionOptions } : {}),
        retryStrategy: (times: number) => {
          // Exponential backoff, capped at 30s, never gives up
          const delay = Math.min(500 * Math.pow(2, times - 1), RedisSubscriberService.MAX_RETRY_DELAY_MS);
          log.info('reconnecting', { attempt: times, delayMs: delay });
          return delay;
        },
        lazyConnect: true,
      });

      // --- Lifecycle events ---

      // 'ready' fires on initial connect AND every successful reconnect.
      // This is where we (re-)subscribe to all patterns.
      this.subscriber.on('ready', () => {
        this.isConnected = true;
        log.info('connected to Redis', { host: config.redis.host });
        // Re-subscribe to all tracked patterns after reconnect
        this.resubscribeAll().catch((err: unknown) => {
          log.error('failed to resubscribe after reconnect', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });

      // 'pmessage' — pattern subscription messages
      this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
        this.handleMessage(_pattern, channel, message);
      });

      // Error handler — log but NEVER crash
      this.subscriber.on('error', (error: Error) => {
        log.error('redis error', { error: error.message });
      });

      this.subscriber.on('close', () => {
        log.warn('connection closed');
        this.isConnected = false;
      });

      this.subscriber.on('reconnecting', () => {
        log.info('reconnecting...');
      });

      this.subscriber.on('end', () => {
        log.warn('connection ended (retryStrategy returned null — should not happen)');
        this.isConnected = false;
      });

      // Register desired patterns before connect: ioredis emits `ready` during
      // connect(), and the ready handler performs the initial psubscribe.
      for (const pattern of RedisSubscriberService.DEFAULT_PATTERNS) {
        this.subscribedPatterns.add(pattern);
      }

      // Initial connect
      await this.subscriber.connect();
    } catch (error: unknown) {
      log.error('failed to connect to Redis', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.isConnected = false;
      // ioredis retryStrategy will handle reconnection automatically
    }
  }

  /**
   * Re-subscribe to all tracked patterns.
   * Called on initial connect and on every reconnect.
   */
  private async resubscribeAll(): Promise<void> {
    if (!this.subscriber) return;

    for (const pattern of this.subscribedPatterns) {
      try {
        await this.subscriber.psubscribe(pattern);
        log.info('subscribed to pattern', { pattern });
      } catch (error: unknown) {
        log.error('failed to subscribe to pattern', {
          pattern,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Подписка на паттерн каналов.
   * Idempotent — won't re-subscribe if already tracking this pattern.
   */
  private async subscribeToPattern(pattern: string): Promise<void> {
    this.subscribedPatterns.add(pattern);
    if (!this.subscriber || !this.isConnected) return;

    try {
      await this.subscriber.psubscribe(pattern);
      log.info('subscribed to pattern', { pattern });
    } catch (error: unknown) {
      log.error('failed to subscribe to pattern', {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Обработка входящего сообщения из Redis
   */
  private async handleMessage(pattern: string, channel: string, rawMessage: string): Promise<void> {
    // Route infra/print/pos channels to CRM relay
    if (channel.startsWith('print:') || channel.startsWith('pos:') || channel.startsWith('infra:')) {
      this.handleInfraMessage(channel, rawMessage);
      return;
    }

    log.info(`[RedisSubscriber] Received message on channel ${channel}`);

    try {
      const message: RedisMessage = JSON.parse(rawMessage);

      if (message.type !== 'operator_message') {
        log.info(`[RedisSubscriber] Unknown message type: ${message.type}`);
        return;
      }

      const sessionId = message.session_id;

      if (!sessionId) {
        log.warn('[RedisSubscriber] Message without session_id');
        return;
      }

      // Проверяем, не является ли сообщение автоответом
      const isAutoReply = this.isAutoReplyMessage(message.message.content, message.message.sender_name);

      if (isAutoReply) {
        log.info(`[RedisSubscriber] Auto-reply detected for session ${sessionId} — AI stays active`);
      } else {
        // Настоящий оператор ответил — AI отключается для этой сессии
        markOperatorActive(sessionId);
      }

      // Проверяем, является ли сообщение командой оператора (начинается с /)
      const content = message.message.content?.trim() || '';
      if (content.startsWith('/')) {
        await this.handleOperatorCommand(sessionId, content, message.message.sender_name);
        return; // Не отправляем команду клиенту как обычное сообщение
      }

      // Формируем сообщение для WebSocket
      const chatMessage: ChatMessage = {
        id: message.message.id,
        session_id: sessionId,
        sender_type: 'operator',
        content: message.message.content,
        message_type: 'text',
        attachment_url: null,
        created_at: new Date(message.message.timestamp),
      };

      // Если есть вложения — добавляем первое как attachment_url
      if (message.message.attachments && message.message.attachments.length > 0) {
        const firstAttachment = message.message.attachments[0];
        if (firstAttachment.type === 'image') {
          chatMessage.message_type = 'image';
          chatMessage.attachment_url = firstAttachment.url;
        } else if (firstAttachment.type === 'document' || firstAttachment.type === 'file') {
          chatMessage.message_type = 'file';
          chatMessage.attachment_url = firstAttachment.url;
          chatMessage.content = chatMessage.content || firstAttachment.name || 'Файл';
        } else if (firstAttachment.type === 'video') {
          chatMessage.message_type = 'video';
          chatMessage.attachment_url = firstAttachment.url;
          chatMessage.content = chatMessage.content || firstAttachment.name || 'Видео';
        } else if (firstAttachment.type === 'audio') {
          chatMessage.message_type = 'audio';
          chatMessage.attachment_url = firstAttachment.url;
          chatMessage.content = chatMessage.content || firstAttachment.name || 'Голосовое сообщение';
        }
      }

      // Сохраняем в messages для персистентности
      const savedMessage = await this.saveOperatorMessage(sessionId, chatMessage, message.message.sender_name);

      // Используем ID из БД если сохранение прошло успешно
      if (savedMessage) {
        chatMessage.id = savedMessage.id;
        chatMessage.created_at = savedMessage.created_at;
      }

      // Отправляем посетителю через WebSocket
      this.sendToVisitor(sessionId, chatMessage, message.message.sender_name);

      const hasActiveVisitor = await this.hasActiveVisitor(sessionId);
      if (!hasActiveVisitor) {
        await sendVisitorChatPush(sessionId, {
          title: message.message.sender_name || 'Своё Фото',
          body: this.formatPushBody(chatMessage),
        });
      }

      log.info(`[RedisSubscriber] Message saved & forwarded to visitor:${sessionId}`);

    } catch (error) {
      log.error('[RedisSubscriber] Failed to parse message:', { error: String(error) });
      log.error('[RedisSubscriber] Raw message:', { detail: rawMessage });
    }
  }

  /**
   * Сохранение сообщения оператора в messages для персистентности.
   * Без этого при обновлении страницы клиент теряет сообщения оператора.
   */
  private async saveOperatorMessage(
    sessionId: string,
    message: ChatMessage,
    operatorName: string,
  ): Promise<{ id: string; created_at: Date } | null> {
    try {
      const result = await pool.query(
        `INSERT INTO messages
          (conversation_id, sender_type, sender_name, message_type, content, attachment_url, bitrix_message_id)
         VALUES ($1, 'operator', $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [
          sessionId,
          operatorName,
          message.message_type,
          message.content,
          message.attachment_url,
          message.id, // bitrix message id (e.g. "b24_34884")
        ],
      );

      if (result.rows.length > 0) {
        log.info(`[RedisSubscriber] Operator message saved to DB for session ${sessionId}`);
        return result.rows[0];
      }
      return null;
    } catch (err) {
      log.error('[RedisSubscriber] Failed to save operator message to DB:', { error: String(err) });
      return null;
    }
  }

  /**
   * Отправка сообщения посетителю через WebSocket
   */
  private sendToVisitor(sessionId: string, message: ChatMessage, operatorName: string): void {
    broadcastToRoom('operator:message', `visitor:${sessionId}`, {
      sessionId: sessionId,
      conversationId: sessionId,
      content: message.content,
      senderName: operatorName,
      senderType: 'operator',
      messageType: message.message_type,
      attachmentUrl: message.attachment_url,
      timestamp: message.created_at,
      id: message.id,
    });

    broadcastChatMessage({
      sessionId,
      message: {
        id: message.id,
        sender_type: 'operator',
        sender_name: operatorName,
        content: message.content,
        message_type: message.message_type,
        attachment_url: message.attachment_url,
        created_at: message.created_at,
      },
    }).catch(err => log.error('[RedisSubscriber] CRM broadcast failed', { error: String(err) }));
  }

  private async hasActiveVisitor(sessionId: string): Promise<boolean> {
    if (!this.io) return false; // worker-process: no direct socket room access
    try {
      const sockets = await this.io.in(`visitor:${sessionId}`).allSockets();
      return sockets.size > 0;
    } catch (err) {
      log.warn('[RedisSubscriber] Failed to check active visitor sockets', { error: String(err) });
      return false;
    }
  }

  /**
   * Определяет, является ли сообщение автоответом.
   * Автоответы не должны отключать AI — это системные сообщения, а не реальный оператор.
   */
  private isAutoReplyMessage(content: string, senderName: string): boolean {
    if (!content) return false;

    const autoReplyPatterns = [
      'свяжемся с вами в рабочее время',
      'свяжемся с вами в ближайшее время',
      'ваше сообщение получено',
      'обращение зарегистрировано',
      'ответим вам в рабочее время',
    ];

    const lowerContent = content.toLowerCase();
    return autoReplyPatterns.some(pattern => lowerContent.includes(pattern));
  }

  private formatPushBody(message: ChatMessage): string {
    if (message.message_type === 'image') {
      return '📷 Новое фото';
    }
    if (message.message_type === 'file') {
      return '📎 Новый файл';
    }
    if (message.message_type === 'video') {
      return '🎬 Новое видео';
    }
    if (message.message_type === 'audio') {
      return '🎵 Голосовое сообщение';
    }
    return message.content || 'Новое сообщение';
  }

  // ============================================================================
  // Оператор-команды из CRM
  // ============================================================================

  /**
   * Обработка команд оператора (начинаются с /).
   * Команда не пересылается клиенту — вместо неё отправляется результат.
   */
  private async handleOperatorCommand(sessionId: string, command: string, operatorName: string): Promise<void> {
    log.info(`[RedisSubscriber] Operator command: "${command}" (session: ${sessionId}, operator: ${operatorName})`);

    // /pay <сумма> <описание>
    const payMatch = command.match(/^\/pay\s+(\d+(?:\.\d{1,2})?)\s+(.+)$/i);
    if (payMatch) {
      const amount = parseFloat(payMatch[1]);
      const description = payMatch[2].trim();
      await this.handlePayCommand(sessionId, amount, description, operatorName);
      return;
    }

    // /task <описание> — создать задачу на рабочей доске
    const taskMatch = command.match(/^\/task\s+(.+)$/i);
    if (taskMatch) {
      const description = taskMatch[1].trim();
      await this.handleTaskCommand(sessionId, description, operatorName);
      return;
    }

    // /help — список команд
    if (command.match(/^\/help\s*$/i)) {
      await this.sendBotMessage(sessionId, operatorName,
        '📋 **Команды оператора:**\n\n' +
        '`/pay <сумма> <описание>` — сформировать счёт и отправить клиенту кнопку оплаты\n' +
        'Пример: `/pay 590 Фото на паспорт РФ 3шт`\n\n' +
        '`/task <описание>` — создать задачу на рабочей доске\n' +
        'Пример: `/task Распечатать 50 фото 10x15`\n\n' +
        '`/help` — список команд',
      );
      return;
    }

    // Неизвестная команда
    log.warn(`[RedisSubscriber] Unknown operator command: "${command}"`);
  }

  /**
   * /pay — создать заказ и отправить клиенту кнопку оплаты
   */
  private async handlePayCommand(sessionId: string, amount: number, description: string, operatorName: string): Promise<void> {
    if (amount <= 0 || amount > 100000) {
      await this.sendBotMessage(sessionId, operatorName, '⚠️ Некорректная сумма. Допустимо от 1 до 100000₽.');
      return;
    }

    // Получаем данные сессии
    const sessionResult = await pool.query(
      `SELECT visitor_name FROM conversations WHERE id = $1`,
      [sessionId],
    );
    const visitorName = sessionResult.rows[0]?.visitor_name || 'Клиент';

    // Создаём заказ (order_id varchar(50) — сокращаем)
    const shortSession = sessionId.split('-')[0];
    const seq = Date.now() % 100000;
    const orderId = `chat-${shortSession}-op-${seq}`;
    try {
      await pool.query(
        `INSERT INTO photo_print_orders
          (order_id, mode, total_price, status, payment_status, contact_name, contact_phone, comments, items, chat_session_id)
         VALUES ($1, 'custom', $2, 'pending_payment', 'none', $3, '', $4, $5, $6::uuid)`,
        [
          orderId,
          amount,
          visitorName,
          JSON.stringify({ sessionId, operator: operatorName, description }),
          JSON.stringify([{ description, price: amount }]),
          sessionId,
        ],
      );
    } catch (err) {
      log.error('[RedisSubscriber] Failed to create operator order:', { error: String(err) });
      await this.sendBotMessage(sessionId, operatorName, '⚠️ Не удалось создать заказ. Попробуйте позже.');
      return;
    }

    // Отправляем клиенту текстовое сообщение
    const textContent = `💳 Сотрудник сформировал счёт на **${amount}₽**\n\n📋 ${description}`;
    await this.sendBotMessage(sessionId, operatorName, textContent);

    // Отправляем интерактивное сообщение с кнопкой оплаты
    const interactive = {
      type: 'buttons',
      step: 'operator_payment',
      buttons: [
        buildWidgetPaymentButton(orderId, amount, description),
      ],
    };

    const interactiveResult = await pool.query(
      `INSERT INTO messages
        (conversation_id, sender_type, sender_name, message_type, content, metadata)
       VALUES ($1, 'bot', 'Своё Фото', 'interactive', 'Оплатите заказ:', $2)
       RETURNING id, created_at`,
      [sessionId, JSON.stringify({ interactive })],
    );

    // Отправляем через WebSocket
    if (interactiveResult.rows[0]) {
      broadcastToRoom('operator:message', `visitor:${sessionId}`, {
        sessionId,
        content: 'Оплатите заказ:',
        senderName: 'Своё Фото',
        senderType: 'bot',
        messageType: 'interactive',
        attachmentUrl: null,
        timestamp: interactiveResult.rows[0].created_at,
        id: interactiveResult.rows[0].id,
        interactive,
      });

      broadcastChatMessage({
        sessionId,
        message: {
          id: interactiveResult.rows[0].id,
          sender_type: 'bot',
          sender_name: 'Своё Фото',
          content: 'Оплатите заказ:',
          message_type: 'interactive',
          created_at: interactiveResult.rows[0].created_at,
        },
      }).catch(err => log.error('[RedisSubscriber] CRM broadcast failed', { error: String(err) }));
    }

    // Push-уведомление
    sendVisitorChatPush(sessionId, {
      title: 'Своё Фото',
      body: `Счёт на ${amount}₽: ${description}`,
    }).catch(err => log.error('[RedisSubscriber] Push failed', { error: String(err) }));

    // Автосоздание задачи из /pay заказа
    createTaskFromOrder({
      orderId,
      orderTable: 'photo_print_orders',
      clientName: visitorName,
      clientChannel: 'online',
      chatSessionId: sessionId,
      title: `Заказ из чата — ${visitorName}`,
      description: `${description} (${amount}₽)`,
      priority: 'normal',
    }).catch(err => log.error('[RedisSubscriber] Auto-task from /pay error', { error: String(err) }));

    log.info(`[RedisSubscriber] Operator payment: order ${orderId}, amount ${amount}₽, session ${sessionId}`);
  }

  /**
   * /task — создать задачу на рабочей доске из чата
   */
  private async handleTaskCommand(sessionId: string, description: string, operatorName: string): Promise<void> {
    // Получаем данные сессии
    const sessionResult = await pool.query(
      `SELECT visitor_name, visitor_phone FROM conversations WHERE id = $1`,
      [sessionId],
    );
    const visitorName = sessionResult.rows[0]?.visitor_name || 'Клиент';
    const visitorPhone = sessionResult.rows[0]?.visitor_phone || '';

    const task = await createTaskFromChat({
      chatSessionId: sessionId,
      messengerType: 'website',
      clientName: visitorName,
      clientPhone: visitorPhone,
      clientChannel: 'online',
      taskType: 'photo_order',
      title: description,
      description: `Создано оператором ${operatorName} из веб-чата`,
    });

    if (task) {
      await this.sendBotMessage(sessionId, operatorName,
        `✅ Задача #${task.task_number} создана на рабочей доске:\n«${description}»`,
      );
    } else {
      await this.sendBotMessage(sessionId, operatorName,
        '⚠️ Не удалось создать задачу. Попробуйте позже.',
      );
    }
  }

  /**
   * Отправить бот-сообщение клиенту (текст) + WebSocket + push
   */
  private async sendBotMessage(sessionId: string, _operatorName: string, content: string): Promise<void> {
    const result = await pool.query(
      `INSERT INTO messages
        (conversation_id, sender_type, sender_name, message_type, content)
       VALUES ($1, 'bot', 'Своё Фото', 'text', $2)
       RETURNING id, created_at`,
      [sessionId, content],
    );

    if (result.rows[0]) {
      broadcastToRoom('operator:message', `visitor:${sessionId}`, {
        sessionId,
        content,
        senderName: 'Своё Фото',
        senderType: 'bot',
        messageType: 'text',
        attachmentUrl: null,
        timestamp: result.rows[0].created_at,
        id: result.rows[0].id,
      });

      broadcastChatMessage({
        sessionId,
        message: {
          id: result.rows[0].id,
          sender_type: 'bot',
          sender_name: 'Своё Фото',
          content,
          message_type: 'text',
          created_at: result.rows[0].created_at,
        },
      }).catch(err => log.error('[RedisSubscriber] CRM broadcast failed', { error: String(err) }));
    }
  }

  // ============================================================================
  // Infrastructure relay: print-api Redis → CRM Socket.IO
  // ============================================================================

  /**
   * Relay infra/print/pos events from print-api (via Redis) to CRM frontend (via Socket.IO).
   *
   * Channels:
   *   print:job_update      → io.to('admin:infra').emit('print:job-update', data)
   *   pos:transaction_update → io.to('admin:infra').emit('pos:transaction-update', data)
   *   infra:heartbeat       → io.to('admin:infra').emit('infra:heartbeat', data)
   *   infra:alert           → io.to('admin:infra').emit('infra:alert', data)
   *   infra:telemetry       → io.to('admin:infra').emit('infra:telemetry', data)
   *   infra:printer_status  → io.to('admin:infra').emit('infra:printer-status', data)
   *   infra:security_event  → io.to('admin:infra').emit('infra:security-event', data)
   */
  private handleInfraMessage(channel: string, rawMessage: string): void {
    let data: InfraRelayMessage;
    try {
      const parsed: unknown = JSON.parse(rawMessage);
      if (!isInfraRelayMessage(parsed)) {
        log.warn('infra relay: invalid JSON payload', { channel });
        return;
      }
      data = parsed;
    } catch {
      log.warn('infra relay: invalid JSON', { channel });
      return;
    }

    if (channel === 'pos:telemetry') {
      cachePosTelemetrySnapshot(data).catch((error: unknown) => {
        log.warn('infra relay: POS telemetry cache failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    // Дозапись результата сверки эквайринга (op59) при завершении bank_settlement.
    // P0-2: payload содержит transaction_id/status/bank_report, но НЕ
    // transaction_type. finalizeShiftReconciliation сам проверяет, что
    // transaction_id принадлежит pending-строке сверки (иначе no-op).
    if (channel === 'pos:transaction_update') {
      this.tryFinalizeShiftReconciliation(data);
    }

    const eventMap: Record<string, string> = {
      'print:job_update': 'print:job-update',
      'pos:transaction_update': 'pos:transaction-update',
      'infra:heartbeat': 'infra:heartbeat',
      'infra:alert': 'infra:alert',
      'infra:telemetry': 'infra:telemetry',
      'infra:printer_status': 'infra:printer-status',
      'infra:security_event': 'infra:security-event',
      // Copy-center features (P0–P1)
      'print:job_paused': 'print:job-paused',           // P0-1 pause/resume job
      'print:job_resumed': 'print:job-resumed',         // P0-1 pause/resume job
      'print:queue_paused': 'print:queue-paused',       // P0-2 pause/resume queue
      'print:queue_resumed': 'print:queue-resumed',     // P0-2 pause/resume queue
      'print:copy_progress': 'print:copy-progress',     // P0-3 copy progress
      'print:job_split': 'print:job-split',             // P0-4 job splitting
      'print:supply_alert': 'print:supply-alert',       // P1-8 supply alerts
      'print:finishing_update': 'print:finishing-update', // P1-11 finishing ops
      // Enterprise print management
      'print:job_held': 'print:job-held',
      'print:job_released': 'print:job-released',
      'print:job_scheduled': 'print:job-scheduled',
      'print:template_applied': 'print:template-applied',
      'print:state_transition': 'print:state-transition',
    };

    const event = eventMap[channel];
    if (!event) {
      log.debug('infra relay: unmapped channel', { channel });
      return;
    }

    // All eventMap values are guaranteed to be in PUBSUB_EVENTS whitelist
    // (see ws-pubsub.service.ts — print:*, pos:transaction-update, infra:* all listed).
    broadcastToRoom(event as PubSubEvent, 'admin:infra', data);
    log.debug('infra relay', { channel, event, studioId: data['studio_id'] ?? '-' });

    // Emit fiscal:success to studio room when POS transaction completes fiscal sale
    if (channel === 'pos:transaction_update' && data['success'] === true && data['studio_id']) {
      const studioId = data['studio_id'] as string;
      broadcastToRoom('fiscal:success', `studio:${studioId}`, {
        receipt_id: data['receipt_id'] ?? null,
        receipt_number: data['receipt_number'] ?? null,
        fiscal_receipt_number: data['fiscal_number'] ?? null,
        fiscal_sign: data['fiscal_sign'] ?? null,
      });
    }
  }

  /**
   * Дозапись результата op59-сверки из payload pos:transaction_update.
   *
   * Извлекает transaction_id / status / bank_report и передаёт в
   * finalizeShiftReconciliation, которая проверяет принадлежность к pending-
   * строке сверки. Чужой transaction_id → no-op (внутри finalize). Ошибки
   * логируются и не роняют процесс.
   */
  private tryFinalizeShiftReconciliation(data: InfraRelayMessage): void {
    const transactionId = typeof data['transaction_id'] === 'string' ? data['transaction_id'] : null;
    if (!transactionId) return;

    const bankReport = typeof data['bank_report'] === 'string' ? data['bank_report'] : null;
    const status = typeof data['status'] === 'string' ? data['status'] : null;

    finalizeShiftReconciliation(transactionId, bankReport, status).catch((error: unknown) => {
      log.warn('infra relay: shift reconciliation finalize failed', {
        transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Отключение от Redis (graceful shutdown)
   */
  async disconnect(): Promise<void> {
    if (this.subscriber) {
      try {
        for (const pattern of this.subscribedPatterns) {
          await this.subscriber.punsubscribe(pattern);
        }
      } catch (err: unknown) {
        log.warn('error during punsubscribe on disconnect', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.subscribedPatterns.clear();

      try {
        await this.subscriber.quit();
      } catch (err: unknown) {
        log.warn('error during quit on disconnect', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.subscriber = null;
      this.isConnected = false;
      log.info('disconnected from Redis');
    }
  }

  /**
   * Проверка состояния подключения
   */
  isReady(): boolean {
    return this.isConnected && this.subscriber !== null;
  }

  /**
   * Получить статистику
   */
  getStats(): { connected: boolean; subscribedPatterns: string[] } {
    return {
      connected: this.isConnected,
      subscribedPatterns: Array.from(this.subscribedPatterns),
    };
  }
}
