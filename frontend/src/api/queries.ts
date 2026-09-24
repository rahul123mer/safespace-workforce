import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  AttendancePage,
  AuditEntry,
  Camera,
  CameraDetail,
  Dashboard,
  Employee,
  EmployeeDetail,
  EmployeeOption,
  EventPage,
  FaceRegistration,
  Footage,
  PoseSlot,
  Page,
  RecognitionEvent,
  Rules,
  SettingsView,
  Shift,
  User,
} from './types'

type Params = Record<string, string | number | undefined>

export const keys = {
  dashboard: ['dashboard'] as const,
  employees: (p?: Params) => ['employees', p ?? {}] as const,
  employee: (id: string) => ['employee', id] as const,
  employeeOptions: (status: string) => ['employee-options', status] as const,
  directory: ['directory'] as const,
  registrations: (id: string) => ['registrations', id] as const,
  registration: (id: string) => ['registration', id] as const,
  history: (id: string) => ['history', id] as const,
  employeeEvents: (id: string) => ['employee-events', id] as const,
  shifts: ['shifts'] as const,
  cameras: (p?: Params) => ['cameras', p ?? {}] as const,
  camera: (id: string) => ['camera', id] as const,
  events: (p?: Params) => ['events', p ?? {}] as const,
  attendance: (p?: Params) => ['attendance', p ?? {}] as const,
  footage: (p?: Params) => ['footage', p ?? {}] as const,
  settings: ['settings'] as const,
  users: ['users'] as const,
}

// --- reads -------------------------------------------------------------------

export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 60_000 })

export const useEmployees = (params: Params) =>
  useQuery({ queryKey: keys.employees(params), queryFn: () => api.get<Page<Employee>>('/employees', params), placeholderData: keepPreviousData })

export const useEmployee = (id: string | undefined, poll = false) =>
  useQuery({
    queryKey: keys.employee(id ?? ''),
    queryFn: () => api.get<EmployeeDetail>(`/employees/${id}`),
    enabled: Boolean(id),
    refetchInterval: poll ? 2500 : false,
  })

export const useEmployeeOptions = (status: 'active' | 'inactive' | 'all' = 'active') =>
  useQuery({ queryKey: keys.employeeOptions(status), queryFn: () => api.get<{ items: EmployeeOption[] }>('/employees/options', { status }) })

export const useDirectory = () =>
  useQuery({ queryKey: keys.directory, queryFn: () => api.get<{ departments: string[]; designations: string[] }>('/employees/directory') })

export const useRegistrations = (employeeId: string) =>
  useQuery({ queryKey: keys.registrations(employeeId), queryFn: () => api.get<{ items: FaceRegistration[] }>(`/employees/${employeeId}/face-registrations`) })

export const useRegistration = (id: string | null) =>
  useQuery({
    queryKey: keys.registration(id ?? ''),
    queryFn: () => api.get<FaceRegistration>(`/face-registrations/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  })

export const useEmployeeHistory = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.history(id), queryFn: () => api.get<{ items: AuditEntry[] }>(`/employees/${id}/history`), enabled })

export const useEmployeeEvents = (id: string) =>
  useQuery({ queryKey: keys.employeeEvents(id), queryFn: () => api.get<{ items: RecognitionEvent[] }>(`/employees/${id}/events`, { limit: 100 }) })

export const useShifts = () => useQuery({ queryKey: keys.shifts, queryFn: () => api.get<{ items: Shift[] }>('/shifts') })

export const useCameras = (params: Params = {}) =>
  useQuery({ queryKey: keys.cameras(params), queryFn: () => api.get<{ items: Camera[] }>('/cameras', params), placeholderData: keepPreviousData })

export const useCamera = (id: string | undefined) =>
  useQuery({ queryKey: keys.camera(id ?? ''), queryFn: () => api.get<CameraDetail>(`/cameras/${id}`), enabled: Boolean(id) })

export const useEvents = (params: Params) =>
  useQuery({ queryKey: keys.events(params), queryFn: () => api.get<EventPage>('/events', params), placeholderData: keepPreviousData })

export const useAttendance = (params: Params) =>
  useQuery({ queryKey: keys.attendance(params), queryFn: () => api.get<AttendancePage>('/attendance', params), placeholderData: keepPreviousData })

export const useFootage = (params: Params) =>
  useQuery({
    queryKey: keys.footage(params),
    queryFn: () => api.get<Page<Footage>>('/footage', params),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((f) => f.status === 'queued' || f.status === 'processing') ? 5000 : false),
  })

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get<SettingsView>('/settings') })

export const useUsers = () =>
  useQuery({ queryKey: keys.users, queryFn: () => api.get<{ items: User[]; roles: { value: string; label: string }[] }>('/users') })

// --- writes ------------------------------------------------------------------

function useInvalidate() {
  const qc = useQueryClient()
  return (...prefixes: string[]) =>
    Promise.all(prefixes.map((p) => qc.invalidateQueries({ queryKey: [p] })))
}

const PEOPLE = ['employees', 'employee', 'employee-options', 'directory', 'dashboard', 'history', 'shifts', 'cameras', 'camera']

export type EmployeeInput = Omit<Employee, 'id' | 'shift' | 'faceStatus' | 'reregistrationReason' | 'faceRegisteredAt' | 'entryCameras' |
  'exitCameras' | 'presence' | 'lastDetected' | 'deactivatedAt' | 'createdAt' | 'updatedAt'> & { shiftId: string | null }

export function useSaveEmployee(id?: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: EmployeeInput) => (id ? api.patch<Employee>(`/employees/${id}`, body) : api.post<Employee>('/employees', body)),
    onSuccess: () => invalidate(...PEOPLE),
  })
}

export function useSetEmployeeStatus() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: 'active' | 'inactive'; reason?: string }) =>
      api.post<Employee>(`/employees/${id}/status`, { status, reason: reason || null }),
    onSuccess: () => invalidate(...PEOPLE),
  })
}

export function useSetEmployeeCameras(id: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: { entryCameraIds: string[]; exitCameraIds: string[] }) => api.put<Employee>(`/employees/${id}/cameras`, body),
    onSuccess: () => invalidate(...PEOPLE),
  })
}

export function useSubmitFace(employeeId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ file, captureMethod, replaceExisting, poseSlot }: { file: Blob; captureMethod: 'upload' | 'camera'; replaceExisting: boolean; poseSlot: PoseSlot }) => {
      const form = new FormData()
      form.append('image', file, captureMethod === 'camera' ? 'camera-capture.jpg' : (file as File).name || 'face-image')
      form.append('captureMethod', captureMethod)
      form.append('replaceExisting', String(replaceExisting))
      form.append('poseSlot', poseSlot)
      return api.upload<FaceRegistration>(`/employees/${employeeId}/face-registrations`, form)
    },
    onSuccess: () => invalidate('employee', 'employees', 'registrations', 'dashboard'),
  })
}

export function useRequestReregistration(employeeId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (reason: string) => api.post<Employee>(`/employees/${employeeId}/face/reregistration-request`, { reason }),
    onSuccess: () => invalidate('employee', 'employees', 'history', 'dashboard'),
  })
}

export function useRemoveSideImage(employeeId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (slot: 'left' | 'right') => api.delete<void>(`/employees/${employeeId}/face/${slot}`),
    onSuccess: () => invalidate('employee', 'registrations', 'history'),
  })
}

export function useRemoveFace(employeeId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => api.delete<void>(`/employees/${employeeId}/face`),
    onSuccess: () => invalidate('employee', 'employees', 'registrations', 'history', 'dashboard'),
  })
}

export type ShiftInput = Pick<Shift, 'name' | 'shiftType' | 'startTime' | 'endTime' | 'gracePeriodMinutes' | 'workingDays'>

export function useSaveShift(id?: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: ShiftInput) => (id ? api.patch<Shift>(`/shifts/${id}`, body) : api.post<Shift>('/shifts', body)),
    onSuccess: () => invalidate('shifts', 'employees', 'employee', 'dashboard'),
  })
}

export function useSetShiftStatus() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) => api.post<Shift>(`/shifts/${id}/status`, { status }),
    onSuccess: () => invalidate('shifts', 'employees', 'employee', 'dashboard'),
  })
}

export function useAssignShift(id: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (employeeIds: string[]) => api.put<Shift>(`/shifts/${id}/employees`, { employeeIds }),
    onSuccess: () => invalidate(...PEOPLE),
  })
}

export type CameraInput = Pick<Camera, 'cameraCode' | 'name' | 'location' | 'cameraType' | 'direction'> & {
  sourceUrl: string | null
  replaceSource?: boolean
}

export function useSaveCamera(id?: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: CameraInput) => (id ? api.patch<Camera>(`/cameras/${id}`, body) : api.post<Camera>('/cameras', body)),
    onSuccess: () => invalidate('cameras', 'camera', 'dashboard', 'employees', 'employee'),
  })
}

export function useSetCameraEnabled() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.post<Camera>(`/cameras/${id}/enabled`, { enabled }),
    onSuccess: () => invalidate('cameras', 'camera', 'dashboard'),
  })
}

export function useCheckConnection() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.post<Camera>(`/cameras/${id}/connection-check`),
    onSuccess: () => invalidate('cameras', 'camera', 'dashboard'),
  })
}

export function useReviewEvent() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'confirm' | 'reject' }) =>
      api.post<RecognitionEvent>(`/events/${id}/review`, { decision }),
    onSuccess: () => invalidate('events', 'attendance', 'dashboard', 'employee-events', 'employees', 'employee'),
  })
}

export function useRetryFootage() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.post<Footage>(`/footage/${id}/retry`),
    onSuccess: () => invalidate('footage', 'dashboard'),
  })
}

export function useSaveRules() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (rules: Rules) => api.put<SettingsView>('/settings/rules', rules),
    onSuccess: () => invalidate('settings', 'session', 'cameras', 'dashboard'),
  })
}

export function useCreateUser() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: { email: string; fullName: string; role: string; password: string }) => api.post<User>('/users', body),
    onSuccess: () => invalidate('users'),
  })
}

export function useUpdateUser() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; fullName?: string; role?: string; isActive?: boolean }) => api.patch<User>(`/users/${id}`, body),
    onSuccess: () => invalidate('users'),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) => api.post<void>(`/users/${id}/password`, { newPassword }),
  })
}
