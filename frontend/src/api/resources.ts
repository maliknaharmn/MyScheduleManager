export type CapacityLevel = 'Free' | 'Light' | 'Medium' | 'Busy'

export type ScheduleTime = {
  mode: 'timed_interval' | 'daily_pattern' | 'date_only' | 'all_day'
  timezone: string
  starts_at?: string
  ends_at?: string
  range_start?: string
  range_end?: string
  weekdays?: number[] | null
  start_local_time?: string
  end_local_time?: string
  end_day_offset?: 0 | 1
}

export type Schedule = {
  id: string
  title: string
  category: string
  status: 'Confirmed' | 'Tentative'
  time: ScheduleTime
  tags: { id: string; name: string; system_key: string | null }[]
  reminder_offsets_minutes: number[]
  version: number
  created_at: string
  updated_at: string
}

export type Occurrence = {
  occurrence_key: string
  schedule_id: string
  title: string
  category: string
  status: 'Confirmed' | 'Tentative'
  is_important: boolean
  starts_at: string | null
  ends_at: string | null
  unknown_date: string | null
}

export type CapacityDay = {
  date: string
  level: CapacityLevel
  known_scheduled_minutes: number
  is_partial: boolean
  unknown_duration_count: number
  occurrence_count: number
  important_occurrence_count: number
  has_conflicts: boolean
  occurrences: Occurrence[]
}

export type WeekOverview = {
  week_start: string
  week_end: string
  timezone: string
  days: CapacityDay[]
}

export type Note = {
  id: string
  title: string
  body: string | null
  target_start: string
  target_end: string
  is_important: boolean
  completed_at: string | null
  version: number
  checklist: { id: string; title: string; position: number; completed_at: string | null }[]
  completed_items: number
  total_items: number
  reminder_enabled: boolean
  reminder_status: 'off' | 'needs_connection'
  created_at: string
  updated_at: string
}

export type NoteDetail = Note & { prerequisite_count: number; dependent_count: number; has_calendar_mapping: boolean }

export type ListResult<T> = { items: T[]; has_more: boolean }
export type Tag = { id: string; name: string; system_key: string | null }
