-- Migration 084: Auto-deduct consumables when print job completes
-- Trigger on print_jobs: status → 'completed' → deduct paper from consumable_stock

CREATE OR REPLACE FUNCTION auto_deduct_consumables()
RETURNS TRIGGER AS $$
DECLARE
  _station_id UUID;
  _stock_id UUID;
  _consumable_type TEXT;
BEGIN
  -- Только при переходе в completed
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    -- Найти station_id через printer → bridge_devices
    SELECT bd.id INTO _station_id
    FROM printers p
    JOIN bridge_devices bd ON bd.studio_id = p.studio_id AND bd.agent_type = 'print'
    WHERE p.id = NEW.printer_id
    LIMIT 1;

    IF _station_id IS NOT NULL THEN
      -- Определить тип расходника по paper_size
      _consumable_type := CASE
        WHEN NEW.paper_size IN ('A4', 'Letter') THEN 'paper_a4'
        WHEN NEW.paper_size = 'A3' THEN 'paper_a3'
        ELSE 'paper_' || LOWER(REPLACE(NEW.paper_size, '×', 'x'))
      END;

      -- Бумага: списать copies листов
      UPDATE consumable_stock
      SET current_amount = GREATEST(0, current_amount - COALESCE(NEW.copies, 1)),
          updated_at = NOW()
      WHERE station_id = _station_id
        AND consumable_type = _consumable_type
      RETURNING id INTO _stock_id;

      -- Записать транзакцию (только если stock запись найдена)
      IF _stock_id IS NOT NULL THEN
        INSERT INTO consumable_transactions (stock_id, job_id, transaction_type, amount, notes)
        VALUES (_stock_id, NEW.id, 'usage', -COALESCE(NEW.copies, 1),
                'Auto-deduct: ' || COALESCE(NEW.paper_size, 'unknown'));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_deduct_consumables ON print_jobs;
CREATE TRIGGER trg_auto_deduct_consumables
  AFTER UPDATE OF status ON print_jobs
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION auto_deduct_consumables();
