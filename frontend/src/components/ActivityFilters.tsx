import { useSearchParams } from 'react-router-dom'
import { useCameras, useDirectory, useEmployeeOptions, useShifts } from '../api/queries'
import { useSession } from '../auth/session'
import { todayIn } from '../utils/format'

export type FilterKey = 'dateFrom' | 'dateTo' | 'employeeId' | 'department' | 'shiftId' | 'eventType' | 'cameraId' | 'status'

/** Filter state kept in the URL so views can be bookmarked and shared. */
export function useFilterParams(defaults: Partial<Record<FilterKey, string>> = {}) {
  const [params, setParams] = useSearchParams()
  const { timezone } = useSession()
  const today = todayIn(timezone)
  const get = (k: FilterKey) => params.get(k) ?? defaults[k] ?? ''
  const values = {
    dateFrom: get('dateFrom') || today,
    dateTo: get('dateTo') || get('dateFrom') || today,
    employeeId: get('employeeId'),
    department: get('department'),
    shiftId: get('shiftId'),
    eventType: get('eventType'),
    cameraId: get('cameraId'),
    status: get('status'),
    page: Number(params.get('page') ?? 1),
  }
  const set = (patch: Partial<Record<FilterKey | 'page', string>>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }
  const reset = () => setParams({}, { replace: true })
  return { values, set, reset, today }
}

export function ActivityFilters({ values, set, show }: {
  values: ReturnType<typeof useFilterParams>['values']
  set: ReturnType<typeof useFilterParams>['set']
  show: FilterKey[]
}) {
  const employees = useEmployeeOptions('all')
  const directory = useDirectory()
  const shifts = useShifts()
  const cameras = useCameras()
  const has = (k: FilterKey) => show.includes(k)
  return (
    <>
      <label className="sr-only" htmlFor="flt-from">From date</label>
      <input id="flt-from" className="input" type="date" value={values.dateFrom} max={values.dateTo}
             onChange={(e) => set({ dateFrom: e.target.value, ...(e.target.value > values.dateTo ? { dateTo: e.target.value } : {}) })} />
      <span className="cell-sub" style={{ marginTop: 0 }}>to</span>
      <label className="sr-only" htmlFor="flt-to">To date</label>
      <input id="flt-to" className="input" type="date" value={values.dateTo} min={values.dateFrom} onChange={(e) => set({ dateTo: e.target.value })} />
      {has('employeeId') ? (
        <select className="select" aria-label="Employee" value={values.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
          <option value="">All employees</option>
          {employees.data?.items.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</option>)}
        </select>
      ) : null}
      {has('department') ? (
        <select className="select" aria-label="Department" value={values.department} onChange={(e) => set({ department: e.target.value })}>
          <option value="">All departments</option>
          {directory.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      ) : null}
      {has('shiftId') ? (
        <select className="select" aria-label="Shift" value={values.shiftId} onChange={(e) => set({ shiftId: e.target.value })}>
          <option value="">All shifts</option>
          {shifts.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : null}
      {has('eventType') ? (
        <select className="select" aria-label="Event type" value={values.eventType} onChange={(e) => set({ eventType: e.target.value })}>
          <option value="">IN and OUT</option>
          <option value="in">IN only</option>
          <option value="out">OUT only</option>
        </select>
      ) : null}
      {has('cameraId') ? (
        <select className="select" aria-label="Camera" value={values.cameraId} onChange={(e) => set({ cameraId: e.target.value })}>
          <option value="">All cameras</option>
          {cameras.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : null}
    </>
  )
}
