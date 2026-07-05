-- Print job redistribute support
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS reassigned_from UUID REFERENCES printers(id);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS reassign_reason TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS reassigned_at TIMESTAMPTZ;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS reassigned_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_status ON print_jobs(printer_id, status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_order_id ON print_jobs(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_receipt_id ON print_jobs(receipt_id) WHERE receipt_id IS NOT NULL;
