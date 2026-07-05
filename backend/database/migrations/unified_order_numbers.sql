-- Unified Order Numbers: единая последовательность для всех заказов
-- Было: chat-заказы = chat_order_number_seq (1001-1042), CRM/другие = random strings
-- Стало: все заказы = order_number_seq → SF-{number}

-- 1. Получаем текущий max из chat_order_number_seq (если существует)
--    и создаём единую последовательность
DO $$
DECLARE
  current_max BIGINT := 1000;
  seq_val BIGINT;
BEGIN
  -- Проверяем существование старой chat sequence
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'chat_order_number_seq') THEN
    SELECT last_value INTO seq_val FROM chat_order_number_seq;
    IF seq_val > current_max THEN
      current_max := seq_val;
    END IF;
  END IF;

  -- Также проверяем max из существующих order_id с числовым суффиксом
  PERFORM 1 FROM photo_print_orders LIMIT 1;
  IF FOUND THEN
    SELECT COALESCE(
      max((regexp_match(order_id, '(\d+)$'))[1]::bigint),
      0
    ) INTO seq_val
    FROM photo_print_orders
    WHERE order_id ~ '\d+$';

    IF seq_val > current_max THEN
      current_max := seq_val;
    END IF;
  END IF;

  -- Создаём единую последовательность (стартуя с max + 1)
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'order_number_seq') THEN
    EXECUTE format('CREATE SEQUENCE order_number_seq START WITH %s', current_max + 1);
  END IF;
END $$;
