import { pool } from '../database/db.js';

interface ChatRow {
  sender_type: string;
  sender_name: string | null;
  content: string;
  message_type: string;
  created_at: string;
}

interface SessionRow {
  visitor_name: string | null;
  channel: string;
  status: string;
  created_at: string;
}

async function getSessionAndMessages(sessionId: string): Promise<{ session: SessionRow; messages: ChatRow[] }> {
  const [sessionResult, messagesResult] = await Promise.all([
    pool.query(
      `SELECT visitor_name, channel, status, created_at FROM conversations WHERE id = $1`,
      [sessionId]
    ),
    pool.query(
      `SELECT sender_type, sender_name, content, message_type, created_at
       FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    ),
  ]);

  return {
    session: sessionResult.rows[0],
    messages: messagesResult.rows,
  };
}

function senderLabel(type: string, name: string | null): string {
  if (type === 'visitor') return 'Клиент';
  if (type === 'bot') return 'Бот';
  if (type === 'internal_note') return `${name || 'Оператор'} (заметка)`;
  return name || 'Оператор';
}

export async function exportChatAsCsv(sessionId: string): Promise<string> {
  const { session, messages } = await getSessionAndMessages(sessionId);

  const BOM = '\uFEFF'; // UTF-8 BOM for Excel
  const header = 'Время;Отправитель;Тип;Сообщение\n';
  const rows = messages.map(m => {
    const time = new Date(m.created_at).toLocaleString('ru-RU');
    const sender = senderLabel(m.sender_type, m.sender_name);
    const content = (m.content || '').replace(/"/g, '""');
    return `${time};${sender};${m.message_type};"${content}"`;
  }).join('\n');

  const meta = `# Чат: ${session?.visitor_name || 'Посетитель'} | ${session?.channel} | ${session?.status}\n# Создан: ${session?.created_at}\n\n`;

  return BOM + meta + header + rows;
}

export async function exportChatAsText(sessionId: string): Promise<string> {
  const { session, messages } = await getSessionAndMessages(sessionId);

  let text = `=== Транскрипт чата ===\n`;
  text += `Клиент: ${session?.visitor_name || 'Посетитель'}\n`;
  text += `Канал: ${session?.channel}\n`;
  text += `Статус: ${session?.status}\n`;
  text += `Создан: ${new Date(session?.created_at).toLocaleString('ru-RU')}\n`;
  text += `Сообщений: ${messages.length}\n`;
  text += `${'='.repeat(30)}\n\n`;

  for (const m of messages) {
    const time = new Date(m.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const sender = senderLabel(m.sender_type, m.sender_name);
    text += `[${time}] ${sender}: ${m.content || `[${m.message_type}]`}\n`;
  }

  return text;
}
