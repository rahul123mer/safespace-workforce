import type { AttendanceStatus, CameraStatus, EmployeeStatus, EventStatus, EventType, FaceStatus, FootageStatus, Presence } from '../api/types'
import { ATTENDANCE_STATUS, CAMERA_STATUS, EVENT_STATUS, FACE_STATUS, FOOTAGE_STATUS } from '../utils/format'
import { Badge } from './ui'

export const FaceBadge = ({ status, title }: { status: FaceStatus; title?: string | null }) => (
  <Badge tone={FACE_STATUS[status].tone} title={title ?? undefined}>{FACE_STATUS[status].label}</Badge>
)

export const EmployeeStatusBadge = ({ status }: { status: EmployeeStatus }) => (
  <Badge tone={status === 'active' ? 'good' : 'neutral'}>{status === 'active' ? 'Active' : 'Inactive'}</Badge>
)

export const CameraStatusBadge = ({ status }: { status: CameraStatus }) => (
  <Badge tone={CAMERA_STATUS[status].tone}>{CAMERA_STATUS[status].label}</Badge>
)

export const EventStatusBadge = ({ status }: { status: EventStatus }) => (
  <Badge tone={EVENT_STATUS[status].tone} title={EVENT_STATUS[status].hint}>{EVENT_STATUS[status].label}</Badge>
)

export const AttendanceBadge = ({ status }: { status: AttendanceStatus }) => (
  <Badge tone={ATTENDANCE_STATUS[status].tone}>{ATTENDANCE_STATUS[status].label}</Badge>
)

export const FootageBadge = ({ status }: { status: FootageStatus }) => (
  <Badge tone={FOOTAGE_STATUS[status].tone}>{FOOTAGE_STATUS[status].label}</Badge>
)

export const EventTypeTag = ({ type }: { type: EventType }) => <span className={`event-type ${type}`}>{type.toUpperCase()}</span>

export function PresenceBadge({ presence }: { presence: Presence }) {
  if (presence === 'in') return <Badge tone="info">In</Badge>
  if (presence === 'out') return <Badge tone="neutral">Out</Badge>
  if (presence === 'exit_not_recorded') return <Badge tone="warn" title="The last confirmed event is an entry older than the maximum session length">Exit not recorded</Badge>
  return <Badge tone="neutral" plain title="No confirmed recognition event yet">No activity</Badge>
}
