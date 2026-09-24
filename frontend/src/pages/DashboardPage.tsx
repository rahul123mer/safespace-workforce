import { Link } from 'react-router-dom'
import { Activity, Cctv, Clock3, ScanFace, UserCheck, Users } from 'lucide-react'
import { useDashboard } from '../api/queries'
import { useSession } from '../auth/session'
import { CameraStatusBadge, EventStatusBadge, EventTypeTag } from '../components/badges'
import { Alert, Avatar, Card, EmptyState, ErrorState, LoadingState, PageHeading, Stat } from '../components/ui'
import { DIRECTIONS, FACE_STATUS, formatCalendarDate, formatClock, formatTime, relativeFromNow, workingDaysLabel } from '../utils/format'

const FACE_COLORS: Record<string, string> = {
  registered: '#22c55e',
  requires_reregistration: '#f59e0b',
  processing: '#60a5fa',
  failed: '#ef4444',
  not_registered: '#cbd5e1',
}

export function DashboardPage() {
  const { timezone, can } = useSession()
  const { data, isPending, error, refetch } = useDashboard()

  if (isPending) return <><PageHeading title="Dashboard" /><LoadingState label="Loading today's overview..." /></>
  if (error || !data) {
    return (
      <>
        <PageHeading title="Dashboard" />
        <ErrorState error={error} message="The dashboard could not be loaded. Please try again." onRetry={() => refetch()} />
      </>
    )
  }
  const m = data.metrics
  const faceTotal = Object.values(data.faceStatus).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHeading title="Dashboard" lead={`Workforce, face registration and attendance for ${formatCalendarDate(data.date)} (${timezone}).`} />

      {m.eventsNeedingReview > 0 && can('events.review') ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warn" title={`${m.eventsNeedingReview} recognition ${m.eventsNeedingReview === 1 ? 'event needs' : 'events need'} review`}
                 action={<Link className="btn btn-secondary btn-sm" to="/activity?status=needs_review">Review events</Link>}>
            The pipeline was not certain enough to confirm these identities. They do not count towards attendance until confirmed.
          </Alert>
        </div>
      ) : null}

      <div className="stat-grid">
        <Stat label="Total Employees" value={m.totalEmployees} note={`${m.activeEmployees} active · ${m.inactiveEmployees} inactive`} to="/employees" icon={<Users size={13} />} />
        <Stat label="Active Employees" value={m.activeEmployees} to="/employees?status=active" />
        <Stat label="Inactive Employees" value={m.inactiveEmployees} to="/employees?status=inactive" />
        <Stat label="Face Registered" value={m.faceRegistered} tone="good" note="Active employees recognisable" to="/employees?faceStatus=registered" icon={<ScanFace size={13} />} />
        <Stat label="Face Registration Pending" value={m.faceRegistrationPending} tone={m.faceRegistrationPending ? 'warn' : undefined}
              note="Not registered, failed or re-registration" to="/face-registration" />
        <Stat label="Currently In" value={m.currentlyIn} tone="info" note="Latest confirmed event is IN" icon={<UserCheck size={13} />} />
        <Stat label="Currently Out" value={m.currentlyOut} note="Latest confirmed event is OUT" />
        <Stat label="Detected Today" value={m.detectedToday} note="Employees with a confirmed event" to="/attendance" />
        <Stat label="Entry Events Today" value={m.entryEventsToday} to="/activity?eventType=in&status=confirmed" />
        <Stat label="Exit Events Today" value={m.exitEventsToday} to="/activity?eventType=out&status=confirmed" />
        <Stat label="Configured Cameras" value={m.configuredCameras} note="Enabled cameras" to="/cameras" icon={<Cctv size={13} />} />
        <Stat label="Cameras With Issues" value={m.camerasWithIssues} tone={m.camerasWithIssues ? 'warn' : undefined}
              note="Offline or configuration required" to="/cameras?status=configuration_required" />
      </div>

      <div className="grid-main">
        <div className="stack">
          <Card title="Recent entry and exit events" lead="Latest recognition events from analysed camera footage."
                actions={<Link className="btn btn-ghost btn-sm" to="/activity">View all activity</Link>}>
            {data.recentEvents.length === 0 ? (
              <EmptyState compact icon={<Activity size={28} />} title="No recognition activity yet">
                Events appear here once footage from an entry or exit camera has been analysed.
              </EmptyState>
            ) : (
              <div className="list">
                {data.recentEvents.map((ev) => (
                  <div className="list-row" key={ev.id}>
                    <EventTypeTag type={ev.eventType} />
                    <div className="grow">
                      <strong><Link to={`/employees/${ev.employee.id}`}>{ev.employee.fullName}</Link></strong>
                      <span>{ev.camera.name} · {ev.camera.location}</span>
                    </div>
                    <EventStatusBadge status={ev.status} />
                    <time dateTime={ev.occurredAt}>{formatTime(ev.occurredAt, timezone)}</time>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Camera status" lead="Configuration and connection state of every camera."
                actions={<Link className="btn btn-ghost btn-sm" to="/cameras">Manage cameras</Link>}>
            {data.cameras.length === 0 ? (
              <EmptyState compact icon={<Cctv size={28} />} title="No cameras have been configured."
                          action={can('cameras.manage') ? <Link className="btn btn-primary btn-sm" to="/cameras?new=1">Add camera</Link> : undefined}>
                Add the entry and exit cameras that recognise employees.
              </EmptyState>
            ) : (
              <div className="list">
                {data.cameras.map((c) => (
                  <div className="list-row" key={c.id}>
                    <div className="grow">
                      <strong><Link to={`/cameras/${c.id}`}>{c.name}</Link></strong>
                      <span>{c.location} · {DIRECTIONS[c.direction]}{c.enabled ? '' : ' · disabled'}</span>
                    </div>
                    <CameraStatusBadge status={c.status} />
                    <time>{c.lastEvent ? relativeFromNow(c.lastEvent.at) : 'No events'}</time>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Employees currently inside" lead="Latest confirmed event is an entry within the maximum session length.">
            {data.currentlyInside.length === 0 ? (
              <EmptyState compact icon={<UserCheck size={28} />} title="No employee is recorded as inside">
                Employees appear here after a confirmed IN event without a later OUT.
              </EmptyState>
            ) : (
              <div className="list">
                {data.currentlyInside.map((row) => (
                  <div className="list-row" key={row.employee.id}>
                    <Avatar name={row.employee.fullName} />
                    <div className="grow">
                      <strong><Link to={`/employees/${row.employee.id}`}>{row.employee.fullName}</Link></strong>
                      <span>{row.employee.employeeCode} · via {row.camera.name}</span>
                    </div>
                    <time dateTime={row.since}>since {formatTime(row.since, timezone)}</time>
                  </div>
                ))}
                {m.currentlyIn > data.currentlyInside.length ? (
                  <p className="cell-sub" style={{ marginTop: 8 }}>and {m.currentlyIn - data.currentlyInside.length} more.</p>
                ) : null}
              </div>
            )}
          </Card>

          <Card title="Face registration status" lead="Active employees by registration state.">
            {faceTotal === 0 ? (
              <EmptyState compact icon={<ScanFace size={28} />} title="No active employees yet">
                Register employees first, then capture their faces.
              </EmptyState>
            ) : (
              <>
                <div className="bar" role="img" aria-label="Face registration distribution">
                  {Object.entries(data.faceStatus).map(([k, v]) => v ? <i key={k} style={{ width: `${(v / faceTotal) * 100}%`, background: FACE_COLORS[k] }} /> : null)}
                </div>
                <div className="legend">
                  {Object.entries(data.faceStatus).map(([k, v]) => (
                    <span key={k}><i style={{ background: FACE_COLORS[k] }} />{FACE_STATUS[k as keyof typeof FACE_STATUS].label}: <b>{v}</b></span>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card title="Shift summary" lead="Active shifts and the active employees assigned to them."
                actions={<Link className="btn btn-ghost btn-sm" to="/shifts">Manage shifts</Link>}>
            {data.shifts.length === 0 ? (
              <EmptyState compact icon={<Clock3 size={28} />} title="No shifts have been configured."
                          action={can('shifts.manage') ? <Link className="btn btn-primary btn-sm" to="/shifts?new=1">Create shift</Link> : undefined}>
                Shifts define expected start times, grace periods and working days.
              </EmptyState>
            ) : (
              <div className="list">
                {data.shifts.map((s) => (
                  <div className="list-row" key={s.id}>
                    <div className="grow">
                      <strong>{s.name}</strong>
                      <span>{formatClock(s.startTime)} – {formatClock(s.endTime)} · {workingDaysLabel(s.workingDays)}</span>
                    </div>
                    <span className="chip">{s.employeeCount} employees</span>
                  </div>
                ))}
                {data.unassignedShiftEmployees > 0 ? (
                  <div className="list-row">
                    <div className="grow"><strong>No shift assigned</strong><span>Late arrivals cannot be evaluated for these employees.</span></div>
                    <Link className="chip" to="/employees?shiftId=none">{data.unassignedShiftEmployees} employees</Link>
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
