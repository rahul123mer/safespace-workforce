import { Link } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import { useAttendance } from '../api/queries'
import { useSession } from '../auth/session'
import { ActivityFilters, useFilterParams } from '../components/ActivityFilters'
import { AttendanceBadge } from '../components/badges'
import { Button, EmptyState, ErrorState, LoadingState, PageHeading, Pagination, Stat } from '../components/ui'
import { formatCalendarDate, formatDuration, formatTime } from '../utils/format'

export function AttendancePage() {
  const { values, set, reset } = useFilterParams()
  const { timezone } = useSession()
  const { data, isPending, error, refetch, isFetching } = useAttendance({
    dateFrom: values.dateFrom, dateTo: values.dateTo, employeeId: values.employeeId || undefined, department: values.department || undefined,
    shiftId: values.shiftId || undefined, eventType: values.eventType || undefined, cameraId: values.cameraId || undefined,
    page: values.page, pageSize: 50,
  })

  return (
    <>
      <PageHeading title="Attendance" lead="Confirmed IN and OUT events paired into attendance sessions. A missing entry or exit is shown as not recorded and is never estimated." />
      <div className="toolbar">
        <ActivityFilters values={values} set={set} show={['employeeId', 'department', 'shiftId', 'eventType', 'cameraId']} />
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
      </div>

      {data ? (
        <div className="stat-grid">
          <Stat label="Sessions" value={data.summary.sessions} note={`${data.summary.employees} employees`} />
          <Stat label="Currently In" value={data.summary.inside} tone="info" />
          <Stat label="Late Arrivals" value={data.summary.late} tone={data.summary.late ? 'warn' : undefined} note="After shift start + grace" />
          <Stat label="Exit Not Recorded" value={data.summary.exitNotRecorded} tone={data.summary.exitNotRecorded ? 'warn' : undefined} />
          <Stat label="Entry Not Recorded" value={data.summary.entryNotRecorded} tone={data.summary.entryNotRecorded ? 'warn' : undefined} />
        </div>
      ) : null}

      {error ? <ErrorState error={error} message="Attendance could not be loaded. Please try again." onRetry={() => refetch()} /> : (
        <section className="card table-card">
          {isPending ? <LoadingState label="Loading attendance history..." /> : data.items.length === 0 ? (
            <EmptyState icon={<CalendarCheck size={30} />} title="No attendance activity is available for the selected date.">
              Attendance appears once confirmed IN or OUT events exist for this period.
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap" style={{ opacity: isFetching ? 0.7 : 1 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th><th>Date</th><th>IN Time</th><th>OUT Time</th><th className="col-md">Duration</th>
                      <th className="col-lg">Entry Camera</th><th className="col-lg">Exit Camera</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r, i) => (
                      <tr key={`${r.employee.id}-${r.date}-${r.inAt ?? r.outAt}-${i}`}>
                        <td>
                          <Link className="cell-strong" to={`/employees/${r.employee.id}?tab=attendance`}>{r.employee.fullName}</Link>
                          <span className="cell-sub">{r.employee.employeeCode}{r.employee.shift ? ` · ${r.employee.shift.name}` : ''}</span>
                        </td>
                        <td>{formatCalendarDate(r.date)}</td>
                        <td>
                          {r.inAt ? formatTime(r.inAt, timezone) : <span className="cell-warn">Entry event not recorded</span>}
                          {r.lateMinutes ? <span className="cell-sub" style={{ color: 'var(--warn)' }}>Late by {formatDuration(r.lateMinutes)}</span> : null}
                        </td>
                        <td>{r.outAt ? formatTime(r.outAt, timezone) : r.status === 'inside'
                          ? <span className="cell-muted">Exit event not recorded yet</span>
                          : <span className="cell-warn">Exit event not recorded</span>}</td>
                        <td className="col-md">{formatDuration(r.durationMinutes)}</td>
                        <td className="col-lg">{r.entryCamera ? <>{r.entryCamera.name}<span className="cell-sub">{r.entryCamera.location}</span></> : '—'}</td>
                        <td className="col-lg">{r.exitCamera ? <>{r.exitCamera.name}<span className="cell-sub">{r.exitCamera.location}</span></> : '—'}</td>
                        <td><AttendanceBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="sessions" onPage={(p) => set({ page: String(p) })} />
            </>
          )}
        </section>
      )}
    </>
  )
}
