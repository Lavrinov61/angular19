import { pool } from '../../database/db.js';

export interface AiVisibleHistoryRow {
  sender_type: string;
  message_type: string | null;
  content: string;
  original_file_name: string | null;
  original_mime_type: string | null;
}

const AI_VISIBLE_MESSAGE_TYPES = ['text', 'file', 'image', 'video', 'audio'];

const MEDIA_LABELS: Record<string, string> = {
  file: 'файл',
  image: 'изображение',
  video: 'видео',
  audio: 'аудио',
};

export async function loadAiVisibleHistoryRows(
  conversationId: string,
  limit: number,
): Promise<AiVisibleHistoryRow[]> {
  const result = await pool.query<AiVisibleHistoryRow>(
    `SELECT m.sender_type,
            m.message_type,
            m.content,
            ma.file_name AS original_file_name,
            ma.mime_type AS original_mime_type
       FROM messages m
       LEFT JOIN LATERAL (
         SELECT file_name, mime_type
           FROM media_attachments
          WHERE message_id = m.id
            AND processing_status = 'uploaded'
          ORDER BY created_at ASC
          LIMIT 1
       ) ma ON TRUE
      WHERE m.conversation_id = $1
        AND m.message_type = ANY($3::text[])
        AND m.content IS NOT NULL
        AND m.content != ''
        AND m.sender_type IN ('visitor', 'bot', 'operator')
      ORDER BY m.created_at DESC
      LIMIT $2`,
    [conversationId, limit, AI_VISIBLE_MESSAGE_TYPES],
  );

  return result.rows.reverse();
}

export function isAiMediaOnlyMessage(row: Pick<AiVisibleHistoryRow, 'message_type' | 'content'>): boolean {
  if (row.message_type === 'text') return false;
  if (!row.message_type || !MEDIA_LABELS[row.message_type]) return false;
  return isBareAttachmentPlaceholder(row.content);
}

export function formatAiVisibleMessageContent(row: AiVisibleHistoryRow): string {
  const content = row.content.trim();
  const messageType = row.message_type ?? 'text';
  const mediaLabel = MEDIA_LABELS[messageType];

  if (!mediaLabel) {
    return content;
  }

  const parts = [`Вложение: ${mediaLabel}`];
  const fileName = row.original_file_name?.trim() || extractBracketAttachmentName(content);
  if (fileName) {
    parts.push(`имя файла: ${fileName}`);
  }
  if (row.original_mime_type) {
    parts.push(`тип: ${row.original_mime_type}`);
  }

  const bodyText = stripLeadingAttachmentPlaceholder(content);
  if (bodyText) {
    parts.push(`текст сообщения: ${bodyText}`);
  }

  return `${parts.join('; ')}.`;
}

function isBareAttachmentPlaceholder(content: string): boolean {
  return /^\[[^\]\n]+\]$/u.test(content.trim());
}

function stripLeadingAttachmentPlaceholder(content: string): string {
  return content.trim().replace(/^\[[^\]\n]+\]\s*/u, '').trim();
}

function extractBracketAttachmentName(content: string): string | null {
  const match = content.match(/^\[(?:Файл|Фото|Видео|Аудио):\s*([^\]\n]+)\]/u);
  const value = match?.[1]?.trim();
  return value || null;
}
