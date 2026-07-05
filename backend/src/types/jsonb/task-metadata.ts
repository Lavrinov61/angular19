/** JSONB contract for work_tasks.metadata */

export interface TaskMetadataBase {
  deadline_notified?: string;
}

export interface TelephonyCallbackTaskMetadata extends TaskMetadataBase {
  source: 'voximplant_inbound';
  voximplantSessionId: string;
  callLogId: string;
  calledNumber?: string;
  reason?: string;
  failureCode?: number;
  failureName?: string;
  destinationUser?: string;
  scenario?: string;
}

export interface TelephonyVoipHealthTaskMetadata extends TaskMetadataBase {
  source: 'telephony_voip_health';
  targetUser: string;
  reason: string;
  firstFailedAt: string;
  lastFailedAt: string;
  checkedAt: string;
  windowMinutes?: number;
  failureCount?: number;
  lastFailureAt?: string | null;
  userActive?: boolean | null;
  recoveredAt?: string;
}

/** Лист-задание ретушёру, созданное из CRM-заказа «Супер обработки». */
export interface CrmRetouchTaskMetadata extends TaskMetadataBase {
  source: 'crm';
  /** Человекочитаемый ярлык заказа (CRM-YYMMDD-XXXX). */
  order_id_label: string;
  gender: string;
  item_count: number;
  chat_session_id: string | null;
}

/** Extensible per task_type when needed. Discriminator is work_tasks.task_type column. */
export type TaskMetadata =
  | TaskMetadataBase
  | TelephonyCallbackTaskMetadata
  | TelephonyVoipHealthTaskMetadata
  | CrmRetouchTaskMetadata;
