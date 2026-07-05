import type { PhotoForApproval } from '../../../../core/models/photo-approval.model';
export type { PhotoForApproval };

export interface ApprovalSession {
  sessionId: string;
  name: string;
  items: PhotoForApproval[];
  overallStatus: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'mixed';
  pendingCount: number;
  approvedCount: number;
  publicToken?: string;
  createdAt: Date;
}

export interface ApprovalStats {
  pending: number;
  approved: number;
  rejected: number;
  changes_requested: number;
  total?: number;
}

export type PageState = 'loading' | 'error' | 'empty' | 'sessions' | 'ordering';
