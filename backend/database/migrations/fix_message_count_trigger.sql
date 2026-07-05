-- Fix: handle DELETE in message counter trigger
-- Previously only INSERT was handled; message_count never decreased on DELETE

CREATE OR REPLACE FUNCTION public.update_conversation_counters()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations SET
      message_count = COALESCE(message_count, 0) + 1,
      last_message_content = NEW.content,
      last_message_at = NEW.created_at,
      unread_count = CASE
        WHEN NEW.sender_type = 'visitor' THEN COALESCE(unread_count, 0) + 1
        ELSE unread_count
      END,
      updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE conversations SET
      message_count = GREATEST(0, COALESCE(message_count, 0) - 1),
      unread_count = CASE
        WHEN OLD.sender_type = 'visitor' THEN GREATEST(0, COALESCE(unread_count, 0) - 1)
        ELSE unread_count
      END,
      updated_at = NOW()
    WHERE id = OLD.conversation_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- Recreate trigger to fire on both INSERT and DELETE
DROP TRIGGER IF EXISTS trg_message_counters ON messages;
CREATE TRIGGER trg_message_counters
  AFTER INSERT OR DELETE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_counters();
