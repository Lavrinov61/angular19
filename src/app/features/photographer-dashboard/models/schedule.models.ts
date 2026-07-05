/**
 * Модели для системы расписания студий и сотрудников
 * Система основана на управлении расписанием конкретных точек (адресов)
 */

// Основная точка работы (студия, адрес)
export interface StudioLocation {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  defaultSchedule: WorkingHours;  // Стандартные часы работы точки
  createdAt: Date;
  updatedAt: Date;
}

// Рабочие часы точки (стандартные для всех)
export interface WorkingHours {
  startTime: string;     // "09:00"
  endTime: string;       // "19:30"
  breakStart?: string;   // "13:00"
  breakEnd?: string;     // "14:00"
  workingDays: number[]; // [1,2,3,4,5,6,0] - дни недели
}

// Смена на конкретной точке
export interface LocationShift {
  id: string;
  locationId: string;           // ID точки/студии
  date: Date;                   // Дата смены
  startTime: string;            // "09:00"
  endTime: string;              // "19:30"
  assignedPhotographerId?: string; // ID назначенного фотографа
  assignedPhotographerName?: string;
  status: ShiftStatus;
  breakStart?: string;
  breakEnd?: string;
  notes?: string;              // Заметки к смене
  isHoliday?: boolean;         // Праздничный день
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;           // ID создавшего смену
}

// Шаблон смены (для быстрого создания расписания)
export interface ShiftTemplate {
  id: string;
  name: string;                // "Стандартная смена", "Сокращенная смена"
  locationId: string;
  startTime: string;
  endTime: string;
  breakStart?: string;
  breakEnd?: string;
  isDefault: boolean;          // Является ли шаблоном по умолчанию
  createdAt: Date;
  updatedAt: Date;
}

// Статус смены
export enum ShiftStatus {
  SCHEDULED = 'scheduled',     // Запланирована
  IN_PROGRESS = 'in_progress', // В процессе
  COMPLETED = 'completed',     // Завершена
  CANCELLED = 'cancelled',     // Отменена
  NO_PHOTOGRAPHER = 'no_photographer' // Нет назначенного фотографа
}

// Расписание точки на месяц
export interface LocationMonthSchedule {
  locationId: string;
  locationName: string;
  locationAddress: string;
  year: number;
  month: number;
  shifts: LocationShift[];
  workingHours: WorkingHours;
  totalWorkingDays: number;
  staffStats: StaffMonthStats[];  // Статистика по сотрудникам
}

// Статистика сотрудника за месяц
export interface StaffMonthStats {
  photographerId: string;
  photographerName: string;
  totalShifts: number;
  totalHours: number;           // Общее количество рабочих часов
  weeklyHours: number[];        // Часы по неделям [неделя1, неделя2, неделя3, неделя4]
  averageHoursPerWeek: number;
  shiftsThisWeek: number;
  hoursThisWeek: number;
}

// Настройки расписания точки
export interface LocationScheduleSettings {
  locationId: string;
  autoAssignPhotographer: boolean;    // Автоматически назначать фотографа
  defaultPhotographerId?: string;     // Фотограф по умолчанию
  allowOvertime: boolean;             // Разрешить переработки
  minShiftDuration: number;           // Минимальная длительность смены (часы)
  maxShiftDuration: number;           // Максимальная длительность смены
  requireApproval: boolean;           // Требовать подтверждение смен
  notificationSettings: {
    notifyOnShiftChange: boolean;
    notifyBeforeShift: number;        // За сколько часов уведомлять
    notifyOnNoPhotographer: boolean;
  };
}

// Запрос на создание смен
export interface CreateShiftsRequest {
  locationId: string;
  startDate: Date;
  endDate: Date;
  templateId?: string;                // ID шаблона (если используется)
  photographerId?: string;            // Фотограф для всех смен (если указан)
  customHours?: {
    startTime: string;
    endTime: string;
    breakStart?: string;
    breakEnd?: string;
  };
  workingDays?: number[];             // Дни недели для создания смен
  skipExisting: boolean;              // Пропускать существующие смены
}

// Запрос на назначение фотографа на смену
export interface AssignPhotographerRequest {
  shiftId: string;
  photographerId: string;
  notes?: string;
}

// Фильтр для поиска смен
export interface ShiftFilter {
  locationId?: string;
  photographerId?: string;
  startDate?: Date;
  endDate?: Date;
  status?: ShiftStatus;
  hasPhotographer?: boolean;
}

// Дашборд статистика точки
export interface LocationDashboardStats {
  locationId: string;
  locationName: string;
  currentMonth: {
    totalShifts: number;
    completedShifts: number;
    shiftsWithoutPhotographer: number;
    totalWorkingHours: number;
    activePhotographers: number;
  };
  thisWeek: {
    totalShifts: number;
    hoursScheduled: number;
    shiftsToday: number;
  };
  upcomingShifts: LocationShift[];        // Ближайшие смены
  staffWorkload: StaffWorkloadInfo[];     // Загрузка сотрудников
}

// Информация о загрузке сотрудника
export interface StaffWorkloadInfo {
  photographerId: string;
  photographerName: string;
  hoursThisWeek: number;
  hoursThisMonth: number;
  upcomingShifts: number;
  workloadPercentage: number;       // Процент загрузки от стандартной недели
}

// ===== СТАРЫЕ МОДЕЛИ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ =====
// (используются в старых компонентах, будут удалены позже)

export interface MonthSchedule {
  photographerId: string;
  year: number;
  month: number;
  days: ScheduleDay[];
  settings: ScheduleSettings;
}

export interface ScheduleDay {
  date: string;
  isWorkingDay: boolean;
  shifts: WorkShift[];
  notes?: string;
}

export interface WorkShift {
  id: string;
  startTime: string;
  endTime: string;
  type: ShiftType;
  isAvailable: boolean;
  bookingId?: string;
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  pattern: SchedulePattern;
  photographerId: string;
  isDefault: boolean;
}

export interface SchedulePattern {
  workingDays: number[];
  shifts: WorkShift[];
  repeatWeekly: boolean;
}

export enum ShiftType {
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  EVENING = 'evening',
  FULL_DAY = 'full_day'
}

export interface ScheduleSettings {
  photographerId: string;
  defaultWorkingHours: {
    start: string;
    end: string;
  };
  workingDays: number[];
  autoApprove: boolean;
  minBookingHours: number;
  breakTime?: {
    start: string;
    end: string;
  };
}

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  bookingId?: string;
}
