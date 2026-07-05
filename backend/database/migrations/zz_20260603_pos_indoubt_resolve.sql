-- Контур надёжности POS-оплаты (S3): разрешение зависших (in_doubt) оплат.
-- При подтверждении «деньги получены» resolve создаёт чек по сохранённым позициям
-- и фискализирует его БЕЗ повторного списания. Чтобы исключить второй чек/двойную
-- фискализацию при гонке/дабл-клике, привязываем закрывающий чек к payment-tx
-- отдельной колонкой settled_receipt_id (однозначный инвариант «один чек на оплату»,
-- безопаснее перегрузки receipt_id, у которой своя семантика для fiscal_sale-tx).
-- Idempotent, аддитивно, nullable, без backfill. БД общая dev/prod — применяется один раз.

ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS settled_receipt_id uuid REFERENCES pos_receipts(id);

CREATE INDEX IF NOT EXISTS idx_pos_tx_settled_receipt
  ON pos_transactions (settled_receipt_id)
  WHERE settled_receipt_id IS NOT NULL;
