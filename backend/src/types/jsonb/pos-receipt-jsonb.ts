/** JSONB contract for pos_receipts.metadata. */

export interface PosReceiptRetouchConfigJsonb {
  gender: string;
  options: readonly unknown[];
  notes: string | null;
}

export interface PosReceiptMetadataJsonb {
  retouch_config?: PosReceiptRetouchConfigJsonb;
}
