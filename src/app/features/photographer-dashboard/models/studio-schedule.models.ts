// Типы графиков работы
export type WorkScheduleType = 
  | 'flexible'      // Гибкий график (выбор смен)
  | 'fixed-shifts'  // Фиксированные смены (утро/вечер)
  | 'rotation'      // Ротационный график (1/1, 2/2, 3/3, 4/4)
  | 'mixed';        // Смешанный график

// Типы смен
export type ShiftType = 
  | 'regular'    // Обычная смена
  | 'extended'   // Удлиненная смена
  | 'short'      // Короткая смена
  | 'night'      // Ночная смена
  | 'holiday';   // Праздничная смена

// Статусы смен
export type ShiftStatus = 
  | 'scheduled'   // Запланирована
  | 'in-progress' // В процессе
  | 'completed'   // Завершена
  | 'cancelled';  // Отменена

// Типы ротационных графиков
export type RotationType = 
  | '1/1' | '2/1' | '1/2' 
  | '2/2' | '3/1' | '1/3'
  | '3/3' | '4/1' | '1/4'
  | '4/4' | '5/2' | '2/5'
  | 'custom'; // Пользовательский паттерн

export interface Studio {
  id: string;
  name: string;
  address: string;
  phone?: string;
  defaultWorkingHours: {
    start: string; // '09:00'
    end: string;   // '19:30'
  };
  timezone: string;
  isActive: boolean;
  employees: StudioEmployee[];
  schedule: StudioSchedule;
  scheduleSettings: StudioScheduleSettings;
}

export interface StudioEmployee {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'photographer' | 'administrator' | 'assistant';
  hourlyRate?: number;
  isActive: boolean;
  skills: string[];
  
  // Настройки графика работы
  schedulePreferences: EmployeeSchedulePreferences;
  currentRotation?: RotationAssignment;
  workHistory: WorkPeriod[];
}

/**
 * Период работы сотрудника
 */
export interface WorkPeriod {
  id: string;
  startDate: string;
  endDate: string;
  scheduleType: WorkScheduleType;
  totalHours: number;
  completedShifts: number;
  totalShifts: number;
  notes?: string;
}

/**
 * Данные о сотруднике студии
 */

// Предпочтения сотрудника по графику
export interface EmployeeSchedulePreferences {
  preferredRotationType?: RotationType;
  preferredShifts: string[]; // ID предпочитаемых смен
  availableWeekdays: number[]; // 0-6 (воскресенье-суббота)
  maxWorkDaysInRow: number;
  minRestDaysAfterWork: number;
  canWorkWeekends: boolean;
  canWorkNights: boolean;
  flexibilityLevel: number; // 1-10, готовность к изменениям графика
}

// Назначение на ротацию
export interface RotationAssignment {
  employeeId: string;
  rotationType: RotationType;
  startDate: string; // ISO date
  cyclePosition: number; // Текущая позиция в цикле ротации
  nextWorkDate: string;
  nextRestDate: string;
  customPattern?: CustomRotationPattern;
}

export interface WeeklyAvailability {
  monday: DayAvailability;
  tuesday: DayAvailability;
  wednesday: DayAvailability;
  thursday: DayAvailability;
  friday: DayAvailability;
  saturday: DayAvailability;
  sunday: DayAvailability;
}

export interface DayAvailability {
  isAvailable: boolean;
  preferredHours?: {
    start: string;
    end: string;
  };
}

export interface StudioSchedule {
  studioId: string;
  month: string; // '2024-01'
  days: StudioScheduleDay[];
  template?: ScheduleTemplate;
}

export interface StudioScheduleDay {
  date: string; // '2024-01-15'
  dayOfWeek: number; // 0-6, 0 = Sunday
  isWorkingDay: boolean;
  workingHours: {
    start: string;
    end: string;
  };
  shifts: StudioShift[];
  rotationInfo?: DayRotationInfo; // Информация о ротации на день
  notes?: string;
}

// Информация о ротации на конкретный день
export interface DayRotationInfo {
  rotationType: RotationType;
  cycleDay: number; // День в цикле ротации
  isWorkDay: boolean; // Рабочий ли день по ротации
  assignedEmployees: string[]; // ID сотрудников, назначенных на день
}

export interface StudioShift {
  id: string;
  shiftDurationId: string; // Ссылка на ShiftDuration
  startTime: string;
  endTime: string;
  assignedEmployeeId?: string;
  requiredSkills: string[];
  status: 'open' | 'assigned' | 'completed' | 'cancelled';
  bookings: StudioShiftBooking[];
  priority: number; // Приоритет смены (1-10)
  rotationContext?: ShiftRotationContext; // Контекст ротации
  notes?: string;
}

/**
 * Интерфейс для отображения смены в расписании
 */
export interface ScheduleShift {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  type: ShiftType;
  employeeId?: string;
  employeeName?: string;
  maxCapacity: number;
  currentBookings: number;
  status: ShiftStatus;
  notes?: string;
  requiredSkills?: string[];
}

/**
 * Интерфейс для временного слота в календаре
 */
export interface TimeSlot {
  startTime: string;
  endTime: string;
  duration: number; // в минутах
  status: 'available' | 'booked' | 'blocked' | 'break';
  isPremium?: boolean; // Премиум слот
  booking?: unknown; // Ссылка на бронирование, если слот забронирован
  shift?: ScheduleShift; // Ссылка на смену
}

// Контекст ротации для смены
export interface ShiftRotationContext {
  isRotationShift: boolean;
  rotationType?: RotationType;
  expectedEmployeeId?: string; // Ожидаемый сотрудник по ротации
  canBeSwapped: boolean; // Можно ли поменяться сменами
  swapRequests?: ShiftSwapRequest[];
}

// Запрос на обмен сменами
export interface ShiftSwapRequest {
  id: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  fromShiftId: string;
  toShiftId: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface StudioShiftBooking {
  id: string;
  clientName: string;
  serviceType: string;
  duration: number; // minutes
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
}

export interface EmployeeWorkStats {
  employeeId: string;
  period: {
    start: string;
    end: string;
  };
  totalHours: number;
  totalShifts: number;
  completedShifts: number;
  cancelledShifts: number;
  averageHoursPerShift: number;
  totalEarnings?: number;
  efficiency: number; // 0-100%
  punctuality: number; // 0-100%
  clientRating?: number; // 1-5
  bookingStats: {
    totalBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    noShowBookings: number;
  };
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  description: string;
  weeklyPattern: {
    monday: DayTemplate;
    tuesday: DayTemplate;
    wednesday: DayTemplate;
    thursday: DayTemplate;
    friday: DayTemplate;
    saturday: DayTemplate;
    sunday: DayTemplate;
  };
}

export interface DayTemplate {
  isWorkingDay: boolean;
  workingHours?: {
    start: string;
    end: string;
  };
  defaultShifts: {
    startTime: string;
    endTime: string;
    requiredSkills: string[];
  }[];
}

// Настройки расписания студии
export interface StudioScheduleSettings {
  scheduleType: WorkScheduleType;
  rotationType?: RotationType;
  customRotationPattern?: CustomRotationPattern;
  shiftDurations: ShiftDuration[];
  minStaffPerShift: number;
  maxStaffPerShift: number;
  allowOverlap: boolean; // Разрешить пересекающиеся смены
  autoAssignment: boolean; // Автоматическое назначение сотрудников
}

// Кастомный паттерн ротации
export interface CustomRotationPattern {
  workDays: number;
  restDays: number;
  cycleLength: number; // Общая длина цикла в днях
  description: string; // Например: "3 дня работы, 2 дня отдыха"
}

// Длительность смен
export interface ShiftDuration {
  id: string;
  name: string; // "Утренняя", "Дневная", "Вечерняя", "Ночная"
  startTime: string;
  endTime: string;
  duration: number; // в часах
  isActive: boolean;
  color?: string; // Цвет для UI
}

export const STANDARD_TEMPLATES: ScheduleTemplate[] = [
  {
    id: 'standard-weekdays',
    name: 'Стандартный (будни)',
    description: 'Работа только в будние дни 9:00-19:30',
    weeklyPattern: {
      monday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      tuesday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      wednesday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      thursday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      friday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      saturday: {
        isWorkingDay: false,
        defaultShifts: []
      },
      sunday: {
        isWorkingDay: false,
        defaultShifts: []
      }
    }
  },
  {
    id: 'full-week',
    name: 'Полная неделя',
    description: 'Работа 7 дней в неделю',
    weeklyPattern: {
      monday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      tuesday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      wednesday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      thursday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      friday: {
        isWorkingDay: true,
        workingHours: { start: '09:00', end: '19:30' },
        defaultShifts: [
          { startTime: '09:00', endTime: '14:00', requiredSkills: ['photography'] },
          { startTime: '14:00', endTime: '19:30', requiredSkills: ['photography'] }
        ]
      },
      saturday: {
        isWorkingDay: true,
        workingHours: { start: '10:00', end: '18:00' },
        defaultShifts: [
          { startTime: '10:00', endTime: '18:00', requiredSkills: ['photography'] }
        ]
      },
      sunday: {
        isWorkingDay: true,
        workingHours: { start: '10:00', end: '18:00' },
        defaultShifts: [
          { startTime: '10:00', endTime: '18:00', requiredSkills: ['photography'] }
        ]
      }
    }
  }
];

// Предустановленные типы смен
export const DEFAULT_SHIFT_DURATIONS: ShiftDuration[] = [
  {
    id: 'morning',
    name: 'Утренняя',
    startTime: '08:00',
    endTime: '14:00',
    duration: 6,
    isActive: true,
    color: '#FFF3E0' // Светло-оранжевый
  },
  {
    id: 'day',
    name: 'Дневная',
    startTime: '10:00',
    endTime: '18:00',
    duration: 8,
    isActive: true,
    color: '#E3F2FD' // Светло-синий
  },
  {
    id: 'evening',
    name: 'Вечерняя',
    startTime: '14:00',
    endTime: '20:00',
    duration: 6,
    isActive: true,
    color: '#F3E5F5' // Светло-фиолетовый
  },
  {
    id: 'full-day',
    name: 'Полный день',
    startTime: '09:00',
    endTime: '19:30',
    duration: 10.5,
    isActive: true,
    color: '#E8F5E8' // Светло-зеленый
  },
  {
    id: 'weekend',
    name: 'Выходной день',
    startTime: '10:00',
    endTime: '18:00',
    duration: 8,
    isActive: true,
    color: '#FFF8E1' // Светло-желтый
  }
];

// Предустановленные ротационные паттерны
export const ROTATION_PATTERNS: Record<RotationType, CustomRotationPattern | null> = {
  '1/1': { workDays: 1, restDays: 1, cycleLength: 2, description: '1 день работы, 1 день отдыха' },
  '2/1': { workDays: 2, restDays: 1, cycleLength: 3, description: '2 дня работы, 1 день отдыха' },
  '1/2': { workDays: 1, restDays: 2, cycleLength: 3, description: '1 день работы, 2 дня отдыха' },
  '2/2': { workDays: 2, restDays: 2, cycleLength: 4, description: '2 дня работы, 2 дня отдыха' },
  '3/1': { workDays: 3, restDays: 1, cycleLength: 4, description: '3 дня работы, 1 день отдыха' },
  '1/3': { workDays: 1, restDays: 3, cycleLength: 4, description: '1 день работы, 3 дня отдыха' },
  '3/3': { workDays: 3, restDays: 3, cycleLength: 6, description: '3 дня работы, 3 дня отдыха' },
  '4/1': { workDays: 4, restDays: 1, cycleLength: 5, description: '4 дня работы, 1 день отдыха' },
  '1/4': { workDays: 1, restDays: 4, cycleLength: 5, description: '1 день работы, 4 дня отдыха' },
  '4/4': { workDays: 4, restDays: 4, cycleLength: 8, description: '4 дня работы, 4 дня отдыха' },
  '5/2': { workDays: 5, restDays: 2, cycleLength: 7, description: '5 дней работы, 2 дня отдыха (рабочая неделя)' },
  '2/5': { workDays: 2, restDays: 5, cycleLength: 7, description: '2 дня работы, 5 дней отдыха (выходные)' },
  'custom': null // Пользовательский паттерн
};

// Современные шаблоны расписания
export const MODERN_SCHEDULE_TEMPLATES = {
  flexible: {
    id: 'flexible-shifts',
    name: 'Гибкий график',
    description: 'Свободный выбор смен сотрудниками',
    scheduleType: 'flexible' as WorkScheduleType,
    settings: {
      scheduleType: 'flexible' as WorkScheduleType,
      shiftDurations: DEFAULT_SHIFT_DURATIONS,
      minStaffPerShift: 1,
      maxStaffPerShift: 3,
      allowOverlap: true,
      autoAssignment: false
    }
  },
  
  rotation_2_2: {
    id: 'rotation-2-2',
    name: 'Ротация 2/2',
    description: '2 дня работы, 2 дня отдыха',
    scheduleType: 'rotation' as WorkScheduleType,
    rotationType: '2/2' as RotationType,
    settings: {
      scheduleType: 'rotation' as WorkScheduleType,
      rotationType: '2/2' as RotationType,
      shiftDurations: [DEFAULT_SHIFT_DURATIONS[3]], // Полный день
      minStaffPerShift: 1,
      maxStaffPerShift: 2,
      allowOverlap: false,
      autoAssignment: true
    }
  },
  
  rotation_3_3: {
    id: 'rotation-3-3',
    name: 'Ротация 3/3',
    description: '3 дня работы, 3 дня отдыха',
    scheduleType: 'rotation' as WorkScheduleType,
    rotationType: '3/3' as RotationType,
    settings: {
      scheduleType: 'rotation' as WorkScheduleType,
      rotationType: '3/3' as RotationType,
      shiftDurations: [DEFAULT_SHIFT_DURATIONS[3]], // Полный день
      minStaffPerShift: 1,
      maxStaffPerShift: 2,
      allowOverlap: false,
      autoAssignment: true
    }
  },
  
  mixed_weekday_weekend: {
    id: 'mixed-schedule',
    name: 'Смешанный график',
    description: 'Будни - фиксированные смены, выходные - ротация',
    scheduleType: 'mixed' as WorkScheduleType,
    settings: {
      scheduleType: 'mixed' as WorkScheduleType,
      shiftDurations: DEFAULT_SHIFT_DURATIONS,
      minStaffPerShift: 1,
      maxStaffPerShift: 3,
      allowOverlap: true,
      autoAssignment: true
    }
  }
};
