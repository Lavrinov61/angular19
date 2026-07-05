/** Barrel export for view types. */

// Task domain
export type {
  WorkTaskWithMeta, WorkTaskWithJoins, WorkTaskBrief,
  TaskNoteRow, TaskHandoffRow, TaskLinkRow, ChatTaskLinkRow,
  TaskAnalyticsOverview, TaskAnalyticsByType, TaskAnalyticsByPriority,
  TaskAnalyticsByEmployee, TaskAnalyticsByDay,
  ScheduleRequestWithMeta, ScheduleRequestRawRow, ScheduleRequestWithJoins,
  EmployeeShiftWithJoins, ShiftBriefingRow, ShiftBriefingFallback,
  BookingBriefRow, HandoffBriefRow, PendingHandoffRow,
  EmployeeDashboardTaskSummary, ShiftCheckoutSummaryRow, PhotoPrintOrderBrief, TodayOrderStats, StaffListRow,
  WorkTasksId, TaskNotesId, TaskHandoffsId, TaskLinksId, ChatTaskLinksId,
  EmployeeShiftsId, ShiftBriefingsId, ScheduleRequestsId,
} from './task-views.js';

// Chat domain
export type {
  ConversationChannel, ConversationMetadataRow, ConversationStatus,
  MessageRow, MessageDeliveryLookup, QuickReplyRow, ChatSearchResult,
  AssignedOperator, OrderNum, MediaAttachmentUrl, BookingRow,
  ConversationsId, MessagesId,
} from './chat-views.js';

// Staff chat domain
export type {
  StaffConversationFull, StaffConversationId, StaffConversationType,
  StaffMessageFull, StaffMessageReply, StaffMessageSearch,
  StaffConversationParticipantRole, StaffConversationParticipantUserId,
  StaffParticipantDetail, StaffParticipantExists,
  StaffReactionGroup, StaffSenderId, HasOlder,
  StaffConversationsId, StaffMessagesId,
} from './staff-chat-views.js';

// Order/Payment domain
export type {
  OrderRow, OrderWithMeta,
  SavedPaymentMethod, RefundRequestRow, InstallmentRow, PaymentEventRow,
  LoyaltyProfile, PointsTransaction,
  OrdersId, RefundRequestsId, PaymentInstallmentsId,
} from './order-views.js';

// Approval domain
export type {
  PhotoApprovalRow, PhotoApprovalSessionRow, ApprovalStats,
  PhotoApprovalVariantRow, ConversationChannelInfo, ChatSessionId,
  PhotoApprovalsId, PhotoApprovalSessionsId, PhotoStatusRow,
} from './approval-views.js';

// Print order domain
export {
  PhotoPrintOrderStatus, PaymentStatus, ShipmentStatus, DeliveryMethod,
} from './print-order-views.js';
export type {
  PhotoPrintOrder, OrderCheckRow, OrderInstallmentRow, OrderPaymentUpdateRow,
  PhotoPrintOrdersId,
} from './print-order-views.js';

// Channel health domain
export type {
  WebhookFreshnessRow, QueueHealthRow, TokenHealthRow,
} from './channel-health-views.js';

// Earnings domain
export type {
  NdflBracket, NdflDetails, EmployerContributions, PensionPoints,
  EmployeeEarningsView, EarningsQueryRow,
  AdminEmployeeEarningsRow, EmployeeCompensationRow, ManualRevenueRow, TaxDeductionRow, TaxDeductionCreateRow,
  OnlineEarningsSummaryRow,
} from './earnings-views.js';

// CRM domain (inbox, clients, search)
export type {
  InboxViewRow, ConversationTagRow, InboxCountRow, CrmNoteRow,
  OnlineUserRow, CsatStatsRow, ConversionSummaryRow, ConversionDailyRow, ConversionByChannelRow,
  CashReconciliationQueryRow, DailySummaryQueryRow, RevenueReportQueryRow, TopProductQueryRow,
  ClientNoteRow, ClientNoteInsertResult, ClientChatSessionRow, UniversalChatSessionRow,
  SearchTaskRow, SearchBookingRow, SearchOrderRow, SearchClientRow,
  SearchTaskNoteRow, SearchChatMessageRow, SearchClientNoteRow,
} from './crm-views.js';

// Common
export type { CountResult, IdResult } from './common-views.js';

// Ready forms domain
export type {
  ReadyFormTimestamp, ReadyFormBaseRow, ReadyFormRow, ReadyFormListRow, ReadyFormDownloadRow,
} from './ready-form-views.js';

// Studio domain
export type { ShiftStudioRateRow } from './studio-views.js';

// Campaign domain
export type {
  CampaignStatsRow, CampaignPromoCodeWithPromo, CampaignLinkLookup,
  PromoRedemptionLookup,
} from './campaign-views.js';

// KPI domain
export type {
  MetricDefinitionRow, MetricCodeRow, SnapshotRow,
  CompositeHistoryRow, StaffUserRow, ShiftDateRow,
  QuestCompletedRow, XpDayRow, XpTotalRow, LeaderboardRow,
  UncompletedQuestRow, LockedAchievementRow, CompositeScoreValue,
  EmployeeProfileRow, XpLogEntryRow, ShiftHistoryRow, CountRow,
} from './kpi-views.js';

// Booking domain
export type { MyBookingRow, BookingsId as MyBookingsId } from './booking-views.js';

// POS domain
export type {
  FiscalStatusRow, FiscalRetryLookup,
} from './pos-views.js';

// Knowledge Base domain
export type {
  KbAccessRuleRow,
  KbCategoryRow,
  KbConfigRow,
  KbCountRow,
  KbDashboardCategoryRow,
  KbDataSourceRow,
  KbEnrichmentTaskRow,
  KbEntityRow,
  KbEntitySummaryRow,
  KbEntityVersionRow,
  KbFuzzySearchRow,
  KbGraphEdgeRow,
  KbGraphNodeRow,
  KbMetricDefinitionRow,
  KbMetricPointRow,
  KbNeighborRow,
  KbPriceComparisonRow,
  KbRecentChangeRow,
  KbRelationExpandedRow,
  KbSearchCombinedRow,
  KbSearchTextRow,
  KbTypeCountRow,
} from './kb-views.js';

// Employee sales domain
export type {
  EmployeeSalesHistoryReceiptRow,
  EmployeeSalesHistoryPaymentLinkRow,
  EmployeeSalesHistoryPrintOrderRow,
} from './employee-sales-views.js';

// Dashboard domain
export type {
  DashboardBookingStats, DashboardAdminBookingStats, RecentAdminBooking, UpcomingBooking,
  DashboardRevenueStats, RevenueChartRow,
  DashboardPhotoStats, DashboardApprovalStats,
  DashboardUserStats, DashboardOrderStats, DashboardStudioStats,
  PhotographerId, PhotographerServiceRow,
  OrderAggregateRow, PosAggregateRow,
  RevenueByChannelRow, PosRevenueByStudioRow,
} from './dashboard-views.js';
