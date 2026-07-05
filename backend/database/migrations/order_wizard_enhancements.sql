-- Migration: order_wizard_enhancements
-- Adds wizard-specific columns to photo_print_orders and order_attachments

BEGIN;

-- photo_print_orders: document template reference
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS document_template_id UUID;
DO $$ BEGIN
  ALTER TABLE photo_print_orders ADD CONSTRAINT ppo_document_template_id_fkey
    FOREIGN KEY (document_template_id) REFERENCES document_templates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- photo_print_orders: wizard fields
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS photo_size VARCHAR(20);
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS medals_required BOOLEAN DEFAULT false;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS medals_description TEXT;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS wishes TEXT;
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS employee_reminder JSONB DEFAULT '[]';

-- order_attachments: attachment type + sort order
ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(30) DEFAULT 'client_photo';
ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ppo_document_template ON photo_print_orders(document_template_id) WHERE document_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ppo_medals_required ON photo_print_orders(medals_required) WHERE medals_required = true;
CREATE INDEX IF NOT EXISTS idx_order_attachments_type ON order_attachments(order_id, attachment_type);

COMMIT;
