// Shapes returned by the backend (employee_api/serializers.py). Face
// embeddings and stream credentials are never part of any response.

export type Role = 'administrator' | 'hr_manager' | 'viewer'

export interface User {
  id: string
  email: string
  fullName: string
  role: Role
  roleLabel: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface SessionInfo {
  user: User
  permissions: string[]
  csrfToken: string
  siteTimezone: string
}

export type EmployeeStatus = 'active' | 'inactive'
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern'
export type FaceStatus = 'not_registered' | 'processing' | 'registered' | 'failed' | 'requires_reregistration'
export type Presence = 'in' | 'out' | 'exit_not_recorded' | 'no_activity'

export interface CameraRef {
  id: string
  name: string
  location: string
  code: string
  enabled?: boolean
}

export interface ShiftRef {
  id: string
  name: string
  startTime: string
  endTime: string
  status: 'active' | 'inactive'
}

export interface Employee {
  id: string
  employeeCode: string
  fullName: string
  email: string | null
  phone: string | null
  department: string
  designation: string
  employmentType: EmploymentType
  joiningDate: string
  status: EmployeeStatus
  shift: ShiftRef | null
  faceStatus: FaceStatus
  reregistrationReason: string | null
  faceRegisteredAt: string | null
  presence: Presence
  lastDetected: { at: string; eventType: EventType; camera: CameraRef } | null
  deactivatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PoseSlot = 'front' | 'left' | 'right'

export interface FaceRegistration {
  id: string
  poseSlot: PoseSlot
  status: 'processing' | 'registered' | 'failed' | 'superseded' | 'removed'
  isCurrent: boolean
  captureMethod: 'upload' | 'camera'
  imageAvailable: boolean
  imageWidth: number
  imageHeight: number
  faceSizePx: number | null
  detectionScore: number | null
  headPose: string | null
  failureReason: string | null
  failureMessage: string | null
  failureDetail: string | null
  createdAt: string
  completedAt: string | null
}

export interface EmployeeDetail extends Employee {
  faceRegistration: FaceRegistration | null
  latestRegistrationAttempt: FaceRegistration | null
  faceSamples: Record<PoseSlot, { current: FaceRegistration | null; latestAttempt: FaceRegistration | null }>
  canViewFace: boolean
}

export interface EmployeeOption {
  id: string
  employeeCode: string
  fullName: string
  department: string
  shiftId: string | null
  status: EmployeeStatus
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type ShiftType = 'morning' | 'general' | 'evening' | 'night' | 'custom'

export interface Shift extends ShiftRef {
  shiftType: ShiftType
  gracePeriodMinutes: number
  workingDays: number[]
  crossesMidnight: boolean
  employeeCount: number
  createdAt: string
  updatedAt: string
}

export type CameraDirection = 'entry' | 'exit' | 'entry_exit'
export type CameraType = 'dome' | 'bullet' | 'turret' | 'ptz' | 'box' | 'other'
export type CameraStatus = 'online' | 'offline' | 'not_verified' | 'configuration_required' | 'disabled'

export interface Camera {
  id: string
  cameraCode: string
  name: string
  location: string
  cameraType: CameraType
  direction: CameraDirection
  sourceConfigured: boolean
  sourceDisplay: string | null
  enabled: boolean
  status: CameraStatus
  configurationIssues: string[]
  connectionStatus: 'not_verified' | 'online' | 'offline'
  lastCheckedAt: string | null
  lastCheckMessage: string | null
  lastEvent: { at: string; eventType: EventType; employeeName: string; status: EventStatus } | null
  createdAt: string
  updatedAt: string
}

export type CameraDetail = Camera

export type EventType = 'in' | 'out'
export type EventStatus = 'confirmed' | 'needs_review' | 'rejected' | 'duplicate'

export interface RecognitionEvent {
  id: string
  employee: { id: string; employeeCode: string; fullName: string; department: string }
  camera: CameraRef
  eventType: EventType
  occurredAt: string
  confidence: number | null
  source: string
  status: EventStatus
  decisionMethod: string | null
  recordingId: string
  sourceOffsetMs: number
  reviewedAt: string | null
}

export interface EventPage extends Page<RecognitionEvent> {
  statusCounts: Record<EventStatus, number>
  dateFrom: string
  dateTo: string
}

export type AttendanceStatus = 'completed' | 'inside' | 'exit_not_recorded' | 'entry_not_recorded'

export interface AttendanceRow {
  employee: { id: string; employeeCode: string; fullName: string; department: string; shift: ShiftRef | null }
  date: string
  inAt: string | null
  outAt: string | null
  durationMinutes: number | null
  entryCamera: CameraRef | null
  exitCamera: CameraRef | null
  status: AttendanceStatus
  lateMinutes: number | null
}

export interface AttendancePage extends Page<AttendanceRow> {
  summary: { sessions: number; employees: number; late: number; exitNotRecorded: number; entryNotRecorded: number; inside: number }
  dateFrom: string
  dateTo: string
}

export type FootageStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface Footage {
  id: string
  camera: CameraRef
  originalFilename: string
  sizeBytes: number
  captureStartedAt: string
  durationMs: number | null
  status: FootageStatus
  failureCode: string | null
  failureMessage: string | null
  failureDetail: string | null
  galleryEmployeeCount: number | null
  identityDecisions: number | null
  eventsConfirmed: number | null
  eventsNeedsReview: number | null
  eventsOther: number | null
  createdAt: string
  processingStartedAt: string | null
  completedAt: string | null
}

export interface AuditEntry {
  id: string
  action: string
  actor: string
  summary: string
  changes: Record<string, unknown>
  createdAt: string
}

export interface Dashboard {
  date: string
  metrics: {
    totalEmployees: number
    activeEmployees: number
    inactiveEmployees: number
    faceRegistered: number
    faceRegistrationPending: number
    currentlyIn: number
    currentlyOut: number
    detectedToday: number
    entryEventsToday: number
    exitEventsToday: number
    configuredCameras: number
    camerasWithIssues: number
    eventsNeedingReview: number
    footageInProgress: number
  }
  faceStatus: Record<Exclude<FaceStatus, never>, number>
  recentEvents: RecognitionEvent[]
  currentlyInside: { employee: { id: string; fullName: string; employeeCode: string; department: string }; since: string; camera: CameraRef }[]
  cameras: Camera[]
  shifts: Shift[]
  unassignedShiftEmployees: number
}

export interface Rules {
  siteTimezone: string
  attendance: {
    minEventIntervalMinutes: number
    maxSessionHours: number
    reviewDecisionHandling: 'queue_for_review' | 'ignore'
  }
  registration: {
    minFaceSizePx: number
    requireFrontalFace: boolean
    duplicateSimilarityThreshold: number
    sideMatchMinSimilarity: number
  }
}

export interface PipelineStatus {
  available: boolean
  problems: string[]
  computeRoot: string | null
  allowCpuInference: boolean
  faceModels: { role: string; name: string; present: boolean; sha256: string | null }[]
  modelFingerprint: string | null
  personDetector: string
  tracker: string
  thresholdProfile: Record<string, string | number> | null
}

export interface SettingsView {
  rules: Rules
  limits: { maxFaceImageBytes: number; maxFootageBytes: number; sessionTtlHours: number }
  canEdit: boolean
  pipeline?: PipelineStatus
}
