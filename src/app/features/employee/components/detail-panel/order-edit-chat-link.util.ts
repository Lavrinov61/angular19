export interface OrderEditChatSelectionData {
  readonly contact_name: string;
  readonly contact_phone: string;
  readonly chat_session_id: string;
}

export interface OrderEditChatSearchResult {
  readonly id: string;
  readonly clientName?: string | null;
  readonly clientPhone?: string | null;
  readonly channel?: string | null;
  readonly preview?: string | null;
  readonly sortTime?: string | null;
}

export function applyOrderEditChatSelection<T extends OrderEditChatSelectionData>(
  current: T,
  chat: OrderEditChatSearchResult,
): T {
  return {
    ...current,
    contact_name: chat.clientName || '',
    contact_phone: chat.clientPhone || '',
    chat_session_id: chat.id,
  };
}
