import { describe, expect, it } from 'vitest';
import { applyOrderEditChatSelection } from './order-edit-chat-link.util';

describe('applyOrderEditChatSelection', () => {
  it('links the selected chat and replaces client fields from the chat result', () => {
    const current = {
      contact_name: 'Старый клиент',
      contact_phone: '+79990000000',
      contact_email: 'old@example.com',
      chat_session_id: '',
    };

    const next = applyOrderEditChatSelection(current, {
      id: 'chat-42',
      clientName: 'Елизавета',
      clientPhone: '+79001112233',
    });

    expect(next).toEqual({
      contact_name: 'Елизавета',
      contact_phone: '+79001112233',
      contact_email: 'old@example.com',
      chat_session_id: 'chat-42',
    });
    expect(current.chat_session_id).toBe('');
  });
});
