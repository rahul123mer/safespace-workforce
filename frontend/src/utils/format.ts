// Display helpers. Timestamps arrive from the API in UTC and are always shown
// in the site time zone configured under Settings, so every viewer sees the
// same local times regardless of their own computer's zone.

import type {
  AttendanceStatus,
  CameraDirection,
  CameraStatus,
  CameraType,
  EmploymentType,
  EventStatus,
  FaceStatus,
  FootageStatus,
  ShiftType,
} from '../api/types'

export const EMPLOYMENT_TYPES: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
}

export const SHIFT_TYPES: Record<ShiftType, string> = {
  morning: 'Morning',
  general: 'General',
  evening: 'Evening',
  night: 'Night',
  custom: 'Custom',
}

export const WEEKDAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
]

export const CAMERA_TYPES: Record<CameraType, string> = {
  dome: 'Dome',
  bullet: 'Bullet',
  turret: 'Turret',
  ptz: 'PTZ',
  box: 'Box',
  other: 'Other',
}

export const DIRECTIONS: Record<CameraDirection, string> = {
  entry: 'Entry',
  exit: 'Exit',
  entry_exit: 'Entry & Exit',
}

type Tone = 'good' | 'warn' | 'crit' | 'info' | 'neutral' | 'dark'

export const FACE_STATUS: Record<FaceStatus, { label: string; tone: Tone }> = {
  not_registered: { label: 'Not Registered', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  registered: { label: 'Registered', tone: 'good' },
  failed: { label: 'Failed', tone: 'crit' },
  requires_reregistration: { label: 'Requires Re-registration', tone: 'warn' },
}

export const CAMERA_STATUS: Record<CameraStatus, { label: string; tone: Tone }> = {
  online: { label: 'Online', tone: 'good' },
  offline: { label: 'Offline', tone: 'crit' },
  not_verified: { label: 'Not Verified', tone: 'info' },
  configuration_required: { label: 'Configuration Required', tone: 'warn' },
  disabled: { label: 'Disabled', tone: 'neutral' },
}

export const EVENT_STATUS: Record<EventStatus, { label: string; tone: Tone; hint: string }> = {
  confirmed: { label: 'Confirmed', tone: 'good', hint: 'Counts towards attendance.' },
  needs_review: { label: 'Needs Review', tone: 'warn', hint: 'The pipeline was not certain of the identity. Confirm or reject it.' },
  rejected: { label: 'Rejected', tone: 'neutral', hint: 'Rejected by a reviewer. Does not count towards attendance.' },
  duplicate: { label: 'Duplicate', tone: 'neutral', hint: 'Another confirmed event of the same type was recorded within the minimum event interval.' },
}

export const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  completed: { label: 'Completed', tone: 'good' },
  inside: { label: 'Currently In', tone: 'info' },
  exit_not_recorded: { label: 'Exit Not Recorded', tone: 'warn' },
  entry_not_recorded: { label: 'Entry Not Recorded', tone: 'warn' },
}

export const FOOTAGE_STATUS: Record<FootageStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Analysing', tone: 'info' },
  completed: { label: 'Completed', tone: 'good' },
  failed: { label: 'Failed', tone: 'crit' },
}

function fmt(iso: string, tz: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...options }).format(new Date(iso))
}

export const formatDateTime = (iso: string | null | undefined, tz: string) =>
  iso ? fmt(iso, tz, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/[ap]m$/, (m) => m.toUpperCase()) : '—'

export const formatTime = (iso: string | null | undefined, tz: string) =>
  iso ? fmt(iso, tz, { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '—'

export const formatDateOnly = (iso: string | null | undefined, tz: string) =>
  iso ? fmt(iso, tz, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/** A plain calendar date (YYYY-MM-DD) with no time zone conversion. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d))
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function formatVideoLength(ms: number | null): string {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`
}

export function workingDaysLabel(days: number[]): string {
  const set = [...days].sort()
  if (set.length === 7) return 'Every day'
  if (set.join(',') === '1,2,3,4,5') return 'Monday to Friday'
  if (set.join(',') === '1,2,3,4,5,6') return 'Monday to Saturday'
  return set.map((d) => WEEKDAYS[d - 1]?.short).join(', ')
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Today's date (YYYY-MM-DD) in the site time zone. */
export function todayIn(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return parts
}

export function relativeFromNow(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
