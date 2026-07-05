/** JSONB contracts for schedule_requests.requested_shifts and shift_briefings.structured_data */

export interface RequestedShift {
  date: string;
  start_time: string;
  end_time: string;
  studio_id?: string;
  startTime?: string;
  endTime?: string;
  studioId?: string;
  action?: 'work' | 'change_address' | 'cancel_shift';
  shift_id?: string;
  shiftId?: string;
  current_studio_id?: string;
  currentStudioId?: string;
  reason?: string;
}

export interface ShiftBriefingData {
  urgent_tasks: number;
  pending_tasks: number;
  active_bookings: number;
  handoffs: HandoffBriefRow[];
  messages: string[];
}

export interface HandoffBriefRow {
  id: string;
  task_id: string;
  task_number: string;
  title: string;
  client_name: string | null;
  from_name: string | null;
  handoff_note: string | null;
  acknowledged: boolean;
  created_at: string;
}
