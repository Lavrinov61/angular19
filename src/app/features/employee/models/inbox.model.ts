export interface InboxItemMetadata {
  hasPaidUnlinked?: boolean;
  paidUnlinkedCount?: number;
  paidUnlinkedAmount?: number;
  paidUnlinkedOrderRef?: string;
  paymentStatus?: 'paid' | 'pending' | 'failed';
  totalPrice?: number;
  orderId?: string;
  studioName?: string;
  approvedCount?: number;
  confidence?: number;
  model?: string;
  reviewReason?: string | null;
  restorationAnalysis?: unknown;
  [k: string]: unknown;
}

export interface InboxItem {
  id: string;
  type: 'chat' | 'task' | 'booking' | 'order' | 'approval';
  clientName: string | null;
  clientPhone: string | null;
  preview: string;
  status: string;
  priority: number; // 0=urgent, 1=high, 2=normal, 3=low
  sortTime: string;
  channel?: string;
  assignedTo?: string;
  assignedToName?: string;
  unread?: boolean;
  reopened?: boolean;
  isPrivate?: boolean;
  privateOwnerId?: string | null;
  metadata: InboxItemMetadata;
}

export interface InboxCounts {
  total: number;
  chat: number;
  task: number;
  booking: number;
  order: number;
  approval: number;
  urgent: number;
  unassigned: number;
  unread: number;
  unpaid: number;
  paidUnlinked: number;
}

export type InboxTypeFilter = 'all' | 'chat' | 'task' | 'booking' | 'order' | 'approval';
export type InboxScopeFilter = 'all' | 'my' | 'unassigned';
export type InboxSortOption = 'time' | 'priority';

export interface InboxGroup {
  label: string;
  items: InboxItem[];
}
