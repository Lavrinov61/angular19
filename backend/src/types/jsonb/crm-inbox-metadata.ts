/** JSONB contract for crm_inbox.metadata plus response-only inbox enrichments. */

export interface CrmInboxTagMetadata {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface CrmInboxMetadata {
  taskType?: string;
  paymentStatus?: string;
  totalPrice?: number;
  orderId?: string;
  studioName?: string;
  startTime?: string;
  approvedCount?: number;
  totalPhotos?: number;
  confidence?: number;
  model?: string;
  reviewReason?: string | null;
  restorationAnalysis?: unknown;
  tags?: CrmInboxTagMetadata[];
  hasPaidUnlinked?: boolean;
  paidUnlinkedCount?: number;
  paidUnlinkedAmount?: number;
  paidUnlinkedOrderRef?: string;
  [key: string]: unknown;
}
