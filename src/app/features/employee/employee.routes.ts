import { Routes } from '@angular/router';
import { adminGuard, permissionGuard } from '../../core/guards/auth.guard';

export const EMPLOYEE_ROUTES: Routes = [
  {
    path: 'print/tv-dashboard',
    loadComponent: () => import('./components/print-tv-dashboard/print-tv-dashboard.component').then(m => m.PrintTvDashboardComponent),
    title: 'Печать — TV Dashboard',
  },
  {
    path: '',
    loadComponent: () => import('./components/workspace-layout/workspace-layout.component').then(m => m.WorkspaceLayoutComponent),
    children: [
      // Main workspace (3-column: inbox | detail | client)
      {
        path: '',
        loadComponent: () => import('./components/workspace/workspace.component').then(m => m.WorkspaceComponent),
        title: 'ФотоПульт',
      },
      // POS — fullscreen terminal
      {
        path: 'pos',
        loadComponent: () => import('./components/pos/pos.component').then(m => m.PosComponent),
        title: 'ФотоПульт — Касса',
        canActivate: [permissionGuard('pos:use')],
      },
      // More section — admin tools hub
      {
        path: 'more',
        loadComponent: () => import('./components/more-section/more-section.component').then(m => m.MoreSectionComponent),
        title: 'ФотоПульт — Ещё',
      },
      // Admin sub-pages (accessed from "More")
      {
        path: 'bookings',
        loadComponent: () => import('./components/booking-manager/booking-manager.component').then(m => m.BookingManagerComponent),
        title: 'ФотоПульт — Записи',
      },
      {
        path: 'catalog',
        loadComponent: () => import('./components/catalog-manager/catalog-manager.component').then(m => m.CatalogManagerComponent),
        title: 'ФотоПульт — Каталог',
        canActivate: [permissionGuard('catalog:manage')],
      },
      {
        path: 'inventory',
        loadComponent: () => import('./components/inventory-overview/inventory-overview.component').then(m => m.InventoryOverviewComponent),
        title: 'ФотоПульт — Склад',
        canActivate: [permissionGuard('pos:use')],
      },
      {
        path: 'ready-forms',
        loadComponent: () => import('./components/ready-forms/ready-forms.component').then(m => m.ReadyFormsComponent),
        title: 'ФотоПульт — Готовые формы',
        canActivate: [adminGuard],
      },
      {
        path: 'inventory/receive',
        loadComponent: () => import('./components/inventory-receive/inventory-receive.component').then(m => m.InventoryReceiveComponent),
        title: 'ФотоПульт — Приёмка товара',
        canActivate: [permissionGuard('pos:use')],
      },
      {
        path: 'subscription-manager',
        loadComponent: () => import('./components/subscription-manager/subscription-manager.component').then(m => m.SubscriptionManagerComponent),
        title: 'ФотоПульт — Подписки',
        canActivate: [permissionGuard('subscriptions:manage')],
      },
      {
        // Фото-верификация студентов теперь живёт на главной панели (кнопка + плитка).
        // Маршрут оставлен как fallback/диплинк и ведёт на тот же гибридный экран.
        path: 'student-verifications',
        loadComponent: () => import('./components/student-verifications/student-verification-review.component').then(m => m.StudentVerificationReviewComponent),
        title: 'ФотоПульт — Образование',
        canActivate: [permissionGuard('students:verify')],
      },
      {
        path: 'analytics',
        loadComponent: () => import('./components/task-analytics/task-analytics.component').then(m => m.TaskAnalyticsComponent),
        title: 'ФотоПульт — Аналитика',
        canActivate: [permissionGuard('analytics:view')],
      },
      // Revenue Attribution — выручка по каналам
      {
        path: 'analytics/revenue',
        loadComponent: () => import('./components/analytics/revenue-attribution.component').then(m => m.RevenueAttributionComponent),
        title: 'ФотоПульт — Revenue Attribution',
        canActivate: [permissionGuard('analytics:view')],
      },
      // Legacy: attribution tab lives inside /marketing
      { path: 'attribution', redirectTo: 'marketing', pathMatch: 'full' },
      {
        path: 'my-shifts',
        loadComponent: () => import('./components/my-shifts/my-shifts.component').then(m => m.MyShiftsComponent),
        title: 'ФотоПульт — Мои смены',
        canActivate: [permissionGuard('shifts:manage')],
      },
      { path: 'shifts', redirectTo: 'my-shifts', pathMatch: 'full' },
      { path: 'my-earnings', redirectTo: 'my-profile', pathMatch: 'full' },
      {
        path: 'my-fines',
        loadComponent: () => import('./components/my-fines/my-fines.component').then(m => m.MyFinesComponent),
        title: 'ФотоПульт — Штрафы',
      },
      {
        path: 'approvals',
        loadComponent: () => import('./components/approvals-list/approvals-list.component').then(m => m.ApprovalsListComponent),
        title: 'ФотоПульт — Согласования',
      },
      {
        path: 'reports',
        loadComponent: () => import('./components/reports/reports.component').then(m => m.ReportsComponent),
        title: 'ФотоПульт — Отчёты',
        canActivate: [permissionGuard('reports:view')],
      },
      {
        path: 'service-surveys',
        loadComponent: () => import('./components/service-surveys/service-surveys.component').then(m => m.ServiceSurveysComponent),
        title: 'ФотоПульт — Пожелания клиентов',
        canActivate: [adminGuard],
      },
      {
        path: 'knowledge',
        loadComponent: () => import('./components/knowledge-base/knowledge-base.component').then(m => m.KnowledgeBaseComponent),
        title: 'ФотоПульт — Инструкции',
      },
      {
        path: 'knowledge/:slug',
        loadComponent: () => import('./components/knowledge-base/kb-entity-detail.component').then(m => m.KbEntityDetailComponent),
        title: 'ФотоПульт — Инструкция',
      },
      {
        path: 'sales',
        loadComponent: () => import('./components/sales-overview/sales-overview.component').then(m => m.SalesOverviewComponent),
        title: 'ФотоПульт — Продажи',
        canActivate: [permissionGuard('pos:use')],
      },
      {
        path: 'cash-control',
        loadComponent: () => import('./components/cash-control/cash-control.component').then(m => m.CashControlComponent),
        title: 'ФотоПульт — Контроль кассы',
        canActivate: [permissionGuard('reports:view')],
      },
      {
        path: 'clients',
        loadComponent: () => import('./components/client-lookup/client-lookup.component').then(m => m.ClientLookupComponent),
        title: 'ФотоПульт — Клиенты',
      },
      // Team chat
      {
        path: 'team',
        loadComponent: () => import('./components/team-chat/team-chat.component').then(m => m.TeamChatComponent),
        title: 'ФотоПульт — Чат',
      },
      // Task create (used as standalone page from deep links)
      {
        path: 'tasks/new',
        loadComponent: () => import('./components/task-create/task-create.component').then(m => m.TaskCreateComponent),
        title: 'ФотоПульт — Новая задача',
      },
      // Operator dashboard
      {
        path: 'operators',
        loadComponent: () => import('./components/operator-dashboard/operator-dashboard.component').then(m => m.OperatorDashboardComponent),
        title: 'ФотоПульт — Операторы',
        canActivate: [permissionGuard('analytics:view')],
      },
      // Legacy: conversions tab lives inside /marketing
      { path: 'conversions', redirectTo: 'marketing', pathMatch: 'full' },
      // Audit log
      {
        path: 'audit',
        loadComponent: () => import('./components/audit-log/audit-log.component').then(m => m.AuditLogComponent),
        title: 'ФотоПульт — Аудит',
        canActivate: [permissionGuard('reports:view')],
      },
      // AI Follow-Up dashboard
      {
        path: 'follow-up',
        loadComponent: () => import('./components/ai-follow-up/ai-follow-up.component').then(m => m.AiFollowUpComponent),
        title: 'ФотоПульт — AI Follow-Up',
      },
      // AI Insights dashboard
      {
        path: 'ai-insights',
        loadComponent: () => import('./components/ai-insights/ai-insights.component').then(m => m.AiInsightsComponent),
        title: 'ФотоПульт — AI Аналитика',
      },
      // Pricing Manager — CRM управление ценообразованием
      {
        path: 'pricing',
        loadComponent: () => import('./components/pricing-manager/pricing-manager.component').then(m => m.PricingManagerComponent),
        title: 'ФотоПульт — Цены',
        canActivate: [permissionGuard('catalog:manage')],
      },
      // Workflow Automation Builder
      {
        path: 'workflows',
        loadComponent: () => import('./components/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent),
        title: 'ФотоПульт — Автоматизации',
        canActivate: [permissionGuard('workflows:manage')],
      },
      // Team Hub — unified team dashboard
      {
        path: 'team-hub',
        loadComponent: () => import('./components/team-hub/team-hub.component').then(m => m.TeamHubComponent),
        canActivate: [permissionGuard('users:manage')],
        children: [
          { path: '', redirectTo: 'staff', pathMatch: 'full' },
          {
            path: 'staff',
            loadComponent: () => import('./components/team-management/team-management.component').then(m => m.TeamManagementComponent),
            title: 'Команда — Сотрудники',
          },
          {
            path: 'schedule',
            loadComponent: () => import('./components/team-schedule/team-schedule.component').then(m => m.TeamScheduleComponent),
            title: 'Команда — Расписание',
          },
          { path: 'requests', redirectTo: 'schedule', pathMatch: 'full' },
          {
            path: 'payroll',
            loadComponent: () => import('./components/admin-bonuses/admin-bonuses.component').then(m => m.AdminBonusesComponent),
            title: 'Команда — Зарплаты',
          },
        ],
      },
      // Legacy redirect: team-management → team-hub/staff
      { path: 'team-management', redirectTo: 'team-hub/staff', pathMatch: 'full' },
      // User Registrations Dashboard (admin)
      {
        path: 'registrations',
        loadComponent: () => import('./components/registrations-dashboard/registrations-dashboard.component').then(m => m.RegistrationsDashboardComponent),
        title: 'ФотоПульт — Регистрации',
        canActivate: [permissionGuard('users:manage')],
      },
      // Partner Program Management
      {
        path: 'partners',
        loadComponent: () => import('./components/partners/partners.component').then(m => m.PartnersComponent),
        title: 'ФотоПульт — Партнёры',
        canActivate: [permissionGuard('partners:manage')],
      },
      // Partner Economics Calculator
      {
        path: 'partner-economics',
        loadComponent: () => import('./components/partner-economics/partner-economics.component').then(m => m.PartnerEconomicsComponent),
        title: 'ФотоПульт — Экономика партнёров',
        canActivate: [permissionGuard('partners:manage')],
      },
      // Marketing Dashboard — unified: Конверсии + Воронки + Реклама
      {
        path: 'marketing',
        loadComponent: () => import('./components/marketing-dashboard/marketing-dashboard.component').then(m => m.MarketingDashboardComponent),
        title: 'ФотоПульт — Маркетинг',
        canActivate: [permissionGuard('analytics:view')],
      },
      // Legacy: funnels tab lives inside /marketing
      { path: 'funnels', redirectTo: 'marketing', pathMatch: 'full' },
      // Legacy redirect: schedule-approvals → team-hub/schedule
      { path: 'schedule-approvals', redirectTo: 'team-hub/schedule', pathMatch: 'full' },
      // Запрос на график (сотрудник)
      {
        path: 'schedule-request',
        loadComponent: () => import('./components/schedule-request/schedule-request.component').then(m => m.ScheduleRequestComponent),
        title: 'ФотоПульт — Запрос на график',
        canActivate: [permissionGuard('shifts:manage')],
      },
      // Часы работы студий
      {
        path: 'studio-hours',
        loadComponent: () => import('./components/studio-hours/studio-hours.component').then(m => m.StudioHoursComponent),
        title: 'ФотоПульт — Часы работы',
        canActivate: [permissionGuard('catalog:manage')],
      },
      // Управление студиями (открыть/закрыть точки)
      {
        path: 'studios',
        loadComponent: () => import('./components/studio-management/studio-management.component').then(m => m.StudioManagementComponent),
        title: 'ФотоПульт — Студии',
        canActivate: [permissionGuard('settings:manage')],
      },
      // Legacy task detail route (for deep links / notifications)
      {
        path: 'tasks/:id',
        loadComponent: () => import('./components/task-detail/task-detail.component').then(m => m.TaskDetailComponent),
        title: 'ФотоПульт — Задача',
      },
      // Retouch Queue — очередь ретуши
      {
        path: 'retouch-queue',
        loadComponent: () => import('./components/retouch-queue/retouch-queue.component').then(m => m.RetouchQueueComponent),
        title: 'ФотоПульт — Очередь ретуши',
      },
      {
        path: 'retouch-queue/:id',
        loadComponent: () => import('./components/retouch-queue/retouch-task-card.component').then(m => m.RetouchTaskCardComponent),
        title: 'ФотоПульт — Задача ретуши',
      },
      // Order Queue — очередь заказов (workflow)
      {
        path: 'order-queue',
        loadComponent: () => import('./components/order-queue/order-queue.component').then(m => m.OrderQueueComponent),
        title: 'ФотоПульт — Очередь заказов',
      },
      // Доставка — операторская доска курьерской доставки
      {
        path: 'delivery',
        loadComponent: () => import('./components/delivery-board/delivery-board.component').then(m => m.DeliveryBoardComponent),
        title: 'ФотоПульт — Доставка',
        canActivate: [permissionGuard('pos:use')],
      },
      // Очередь печати (Epson L8050 + Canon C3226i)
      {
        path: 'print-center',
        loadComponent: () => import('./components/print-center/print-center.component').then(m => m.PrintCenterComponent),
        title: 'ФотоПульт — Единая печать',
        canActivate: [permissionGuard('pos:use')],
      },
      {
        path: 'print-queue',
        loadComponent: () => import('./components/print-queue/print-queue.component').then(m => m.PrintQueueComponent),
        title: 'ФотоПульт — Очередь печати',
      },
      // Аналитика печати
      {
        path: 'print-analytics',
        loadComponent: () => import('./components/print-analytics/print-analytics.component').then(m => m.PrintAnalyticsComponent),
        title: 'ФотоПульт — Аналитика печати',
      },
      // Пресеты печати
      {
        path: 'print-presets',
        loadComponent: () => import('./components/preset-management/preset-management.component').then(m => m.PresetManagementComponent),
        title: 'ФотоПульт — Пресеты печати',
        canActivate: [permissionGuard('catalog:manage')],
      },
      // Расходные материалы
      {
        path: 'consumables',
        loadComponent: () => import('./components/consumables-management/consumables-management.component').then(m => m.ConsumablesManagementComponent),
        title: 'ФотоПульт — Расходники',
        canActivate: [permissionGuard('catalog:manage')],
      },
      // Управление принтерами
      {
        path: 'printers',
        loadComponent: () => import('./components/printer-management/printer-management.component').then(m => m.PrinterManagementComponent),
        title: 'ФотоПульт — Принтеры',
        canActivate: [permissionGuard('catalog:manage')],
      },
      // Мониторинг парка принтеров (телеметрия/алерты/задания)
      {
        path: 'fleet',
        loadChildren: () => import('./components/fleet/fleet.routes').then(m => m.FLEET_ROUTES),
        canActivate: [permissionGuard('catalog:manage')],
      },
      // Production — заказы в типографии
      {
        path: 'production',
        loadComponent: () => import('./components/production/production.component').then(m => m.ProductionComponent),
        title: 'ФотоПульт — Производства',
        canActivate: [permissionGuard('production:manage')],
      },
      // Walk-in order creation
      {
        path: 'create-order',
        loadComponent: () => import('./components/unified-order/unified-order.component').then(m => m.UnifiedOrderComponent),
        title: 'ФотоПульт — Новый заказ',
      },
      // Order Wizard — устаревший, redirect на workspace
      {
        path: 'create-order-wizard',
        redirectTo: '',
        pathMatch: 'full' as const,
      },
      // Channel Admin — omnichannel management
      {
        path: 'channels',
        loadComponent: () => import('./components/channel-admin/channel-admin.component').then(m => m.ChannelAdminComponent),
        title: 'ФотоПульт — Каналы',
        canActivate: [permissionGuard('settings:manage')],
      },
      // Session Replay — глобальный дашборд
      {
        path: 'replay',
        loadComponent: () => import('./components/session-replay-dashboard/session-replay-dashboard.component').then(m => m.SessionReplayDashboardComponent),
        title: 'ФотоПульт — Session Replay',
        canActivate: [permissionGuard('clients:view')],
      },
      // Session Replay — глобальная тепловая карта
      {
        path: 'heatmap',
        loadComponent: () => import('./components/heatmap-viewer/heatmap-viewer.component').then(m => m.HeatmapViewerComponent),
        title: 'ФотоПульт — Тепловая карта',
        canActivate: [permissionGuard('clients:view')],
      },
      // Сдача кассы — подсчёт наличных по номиналам
      {
        path: 'cash-handover',
        loadComponent: () => import('./components/cash-handover/cash-handover.component').then(m => m.CashHandoverComponent),
        title: 'ФотоПульт — Сдача кассы',
      },
      // Error Logs — CRM error tracking
      {
        path: 'error-logs',
        loadComponent: () => import('./components/error-log-viewer/error-log-viewer.component').then(m => m.ErrorLogViewerComponent),
        title: 'ФотоПульт — Error Logs',
        canActivate: [permissionGuard('reports:view')],
      },
      // Employee Personal Dashboard — мой профиль, смены, ставка
      {
        path: 'my-profile',
        loadComponent: () => import('./components/employee-personal-dashboard/employee-personal-dashboard.component').then(m => m.EmployeePersonalDashboardComponent),
        title: 'ФотоПульт — Мой профиль',
      },
      // Legacy redirect: bonuses → team-hub/payroll
      { path: 'bonuses', redirectTo: 'team-hub/payroll', pathMatch: 'full' },
      // KPI Dashboard — показатели эффективности сотрудников
      {
        path: 'kpi',
        loadComponent: () => import('./components/kpi-dashboard/kpi-dashboard.component').then(m => m.KpiDashboardComponent),
        title: 'ФотоПульт — KPI',
        canActivate: [permissionGuard('analytics:view')],
      },
      // SLA Config — настройка времени выполнения
      {
        path: 'sla-config',
        loadComponent: () => import('./components/sla-config/sla-config.component').then(m => m.SlaConfigComponent),
        title: 'ФотоПульт — Настройка SLA',
        canActivate: [permissionGuard('settings:manage')],
      },
      // Campaigns Manager — маркетинговые кампании
      {
        path: 'campaigns',
        loadComponent: () => import('./components/campaigns-manager/campaigns-manager.component').then(m => m.CampaignsManagerComponent),
        title: 'ФотоПульт — Кампании',
        canActivate: [permissionGuard('analytics:view')],
      },
      // Broadcasts Manager — TG-рассылки и воронка доставки
      {
        path: 'broadcasts',
        loadComponent: () => import('./components/broadcasts-manager/broadcasts-manager.component').then(m => m.BroadcastsManagerComponent),
        title: 'ФотоПульт — Рассылки',
        canActivate: [permissionGuard('settings:manage')],
      },
      // Infrastructure — управление агентами и обновлениями
      {
        path: 'infrastructure',
        loadComponent: () => import('./components/infra-dashboard/infra-dashboard.component').then(m => m.InfraDashboardComponent),
        title: 'ФотоПульт — Инфраструктура',
        canActivate: [permissionGuard('settings:manage')],
      },
      {
        path: 'infrastructure/locations/:id',
        loadComponent: () => import('./components/studio-dashboard/studio-dashboard.component').then(m => m.StudioDashboardComponent),
        title: 'ФотоПульт — Студия',
        canActivate: [permissionGuard('settings:manage')],
      },
      {
        path: 'infrastructure/agents/:id',
        loadComponent: () => import('./components/infra-agent-detail/infra-agent-detail.component').then(m => m.InfraAgentDetailComponent),
        title: 'ФотоПульт — Агент',
        canActivate: [permissionGuard('settings:manage')],
      },
      {
        path: 'infrastructure/releases',
        loadComponent: () => import('./components/infra-update-manager/infra-update-manager.component').then(m => m.InfraUpdateManagerComponent),
        title: 'ФотоПульт — Обновления',
        canActivate: [permissionGuard('settings:manage')],
      },
      // Redirects for old URLs
      { path: 'workday', redirectTo: '', pathMatch: 'full' },
      { path: 'tasks', redirectTo: '', pathMatch: 'full' },
      {
        path: 'orders',
        loadComponent: () => import('./components/orders/orders.component').then(m => m.OrdersComponent),
        title: 'ФотоПульт — Заказы',
        canActivate: [permissionGuard('pos:use')],
      },
      { path: 'chats', redirectTo: '', pathMatch: 'full' },
      { path: 'quick-sale', redirectTo: 'pos', pathMatch: 'full' },
    ],
  },
];
