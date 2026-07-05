import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { WebSocketService, ChatMessage } from './websocket.service';
import { AuthService } from './auth.service';
import { LoggerService } from './logger.service';

export interface ChatConversation {
  booking_id: string;
  booking_title: string;
  photographer_name: string;
  client_name: string;
  last_message: string;
  last_message_timestamp: string;
  unread_count: number;
}

export interface ChatHistoryResponse {
  success: boolean;
  data: {
    messages: ChatMessage[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

/**
 * Chat Service для работы с чатом
 *
 * Функции:
 * - Отправка/получение сообщений через WebSocket
 * - Fallback на HTTP API если WebSocket недоступен
 * - Загрузка истории сообщений
 * - Управление индикаторами набора текста
 * - Отслеживание непрочитанных сообщений
 */
@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private log = inject(LoggerService);

  // Current active booking
  readonly activeBookingId = signal<string | null>(null);

  // Signals
  readonly conversations = signal<ChatConversation[]>([]);
  readonly totalUnreadCount = signal<number>(0);
  readonly isLoadingHistory = signal<boolean>(false);

  // Computed
  readonly activeBookingMessages = computed(() => {
    const bookingId = this.activeBookingId();
    if (!bookingId) return [];
    return this.wsService.getMessagesForBooking(bookingId);
  });

  readonly typingIndicators = computed(() => {
    const bookingId = this.activeBookingId();
    if (!bookingId) return [];
    return this.wsService.getTypingUsersForBooking(bookingId);
  });

  readonly isConnected = computed(() => this.wsService.isConnected());

  /**
   * Загрузить список разговоров
   */
  async loadConversations(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ success: boolean; data: ChatConversation[] }>(`/api/chat/conversations`)
      );

      if (response.success) {
        this.conversations.set(response.data);
      }
    } catch (error) {
      this.log.error('[ChatService] Failed to load conversations:', error);
      throw error;
    }
  }

  /**
   * Загрузить историю сообщений для бронирования
   */
  async loadMessageHistory(bookingId: string, page = 1, limit = 50): Promise<void> {
    this.isLoadingHistory.set(true);

    try {
      const response = await firstValueFrom(
        this.http.get<ChatHistoryResponse>(
          `/api/chat/bookings/${bookingId}/messages`,
          { params: { page: page.toString(), limit: limit.toString() } }
        )
      );

      if (response.success) {
        // Загруженные сообщения добавляем в WebSocketService
        const existingMessages = this.wsService.messages();
        const newMessages = response.data.messages.filter(
          newMsg => !existingMessages.some(msg => msg.id === newMsg.id)
        );

        this.wsService.messages.update(messages => [...newMessages, ...messages]);
      }
    } catch (error) {
      this.log.error('[ChatService] Failed to load message history:', error);
      throw error;
    } finally {
      this.isLoadingHistory.set(false);
    }
  }

  /**
   * Загрузить количество непрочитанных сообщений
   */
  async loadUnreadCount(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ success: boolean; data: { unreadCount: number } }>(`/api/chat/unread-count`)
      );

      if (response.success) {
        this.totalUnreadCount.set(response.data.unreadCount);
      }
    } catch (error) {
      this.log.error('[ChatService] Failed to load unread count:', error);
    }
  }

  /**
   * Открыть чат для бронирования
   */
  async openChat(bookingId: string): Promise<void> {
    // Закрыть предыдущий чат если открыт
    const previousBookingId = this.activeBookingId();
    if (previousBookingId && previousBookingId !== bookingId) {
      this.closeChat();
    }

    this.activeBookingId.set(bookingId);

    // Присоединиться к WebSocket комнате
    if (this.wsService.isConnected()) {
      this.wsService.joinBooking(bookingId);
    }

    // Загрузить историю сообщений
    await this.loadMessageHistory(bookingId);
  }

  /**
   * Закрыть текущий чат
   */
  closeChat(): void {
    const bookingId = this.activeBookingId();
    if (bookingId && this.wsService.isConnected()) {
      this.wsService.leaveBooking(bookingId);
    }

    this.activeBookingId.set(null);
  }

  /**
   * Отправить сообщение
   */
  async sendMessage(bookingId: string, message: string): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const senderName = currentUser.email; // Можно улучшить
    const senderRole = currentUser.role as 'client' | 'photographer';

    // Попытка отправить через WebSocket
    if (this.wsService.isConnected()) {
      this.log.debug('[ChatService] Sending via WebSocket');
      this.wsService.sendMessage(bookingId, message, senderName, senderRole);
    } else {
      // Fallback на HTTP
      this.log.debug('[ChatService] Sending via HTTP fallback');

      try {
        const response = await firstValueFrom(
          this.http.post<{ success: boolean; data: ChatMessage }>(
            `/api/chat/bookings/${bookingId}/messages`,
            { message, senderName, senderRole }
          )
        );

        if (response.success) {
          // Добавить сообщение вручную
          this.wsService.messages.update(messages => [...messages, response.data]);
        }
      } catch (error) {
        this.log.error('[ChatService] Failed to send message via HTTP:', error);
        throw error;
      }
    }
  }

  /**
   * Начать печатать
   */
  startTyping(bookingId: string): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    const userName = currentUser.email; // Можно улучшить
    this.wsService.startTyping(bookingId, userName);
  }

  /**
   * Закончить печатать
   */
  stopTyping(bookingId: string): void {
    this.wsService.stopTyping(bookingId);
  }

  /**
   * Отметить сообщения как прочитанные
   */
  async markAsRead(bookingId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    // Через WebSocket
    if (this.wsService.isConnected()) {
      this.wsService.markMessagesAsRead(bookingId, messageIds);
    }

    // Также отправить HTTP запрос для надежности
    try {
      await firstValueFrom(
        this.http.put(`/api/chat/bookings/${bookingId}/messages/read`, { messageIds })
      );

      // Обновить счетчик непрочитанных
      await this.loadUnreadCount();
    } catch (error) {
      this.log.error('[ChatService] Failed to mark messages as read:', error);
    }
  }

  /**
   * Проверка online статуса пользователя
   */
  isUserOnline(userId: string): boolean {
    return this.wsService.isUserOnline(userId);
  }

  /**
   * Получить непрочитанные сообщения для бронирования
   */
  getUnreadMessagesForBooking(bookingId: string): ChatMessage[] {
    const currentUserId = this.authService.currentUser()?.id;
    return this.wsService.getMessagesForBooking(bookingId)
      .filter(msg => !msg.read && msg.sender_id !== currentUserId);
  }

  /**
   * Получить последнее сообщение для бронирования
   */
  getLastMessageForBooking(bookingId: string): ChatMessage | null {
    const messages = this.wsService.getMessagesForBooking(bookingId);
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }
}
