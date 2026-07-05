-- Промоутерская комиссия через POS-кассу: promo_code и partner_id в pos_receipts
ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);
ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id);
CREATE INDEX IF NOT EXISTS idx_pos_receipts_partner_id ON pos_receipts(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_receipts_promo_code ON pos_receipts(promo_code) WHERE promo_code IS NOT NULL;
