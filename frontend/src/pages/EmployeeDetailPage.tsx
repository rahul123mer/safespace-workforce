import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Activity, CalendarCheck, History, Pencil, ScanFace, UserCheck, UserX } from 'lucide-react'
import { mediaUrl } from '../api/client'
import { useAttendance, useEmployee, useEmployeeEvents, useEmployeeHistory, useSetEmployeeStatus, useShifts } from '../api/queries'
import type { EmployeeDetail } from '../api/types'
import { useSession } from '../auth/session'
import { AttendanceBadge, EmployeeStatusBadge, EventStatusBadge, EventTypeTag, FaceBadge, PresenceBadge } from '../components/badges'
import { useToast } from '../components/toast'
import { Alert, Avatar, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeading, errorMessage } from '../components/ui'
import {
  EMPLOYMENT_TYPES,
  formatCalendarDate,
  formatClock,
  formatDateTime,
  formatDuration,
  formatTime,
  todayIn,
  workingDaysLabel,
} from '../utils/format'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance History' },
  { id: 'history', label: 'Configuration History' },
]

export function EmployeeDetailPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const { can } = useSession()
  const { data, isPending, error, refetch } = useEmployee(id)
  const [statusOpen, setStatusOpen] = useState(false)
  const setStatus = useSetEmployeeStatus()
  const toast = useToast()

  if (isPending) return <><PageHeading title="Employee" crumb={{ to: '/employees', label: 'Employees' }} /><LoadingState label="Loading employee details..." /></>
  if (error || !data) {
    return (
      <>
        <PageHeading title="Employee" crumb={{ to: '/employees', label: 'Employees' }} />
        <ErrorState error={error} message="The employee information could not be loaded. Please try again." onRetry={() => refetch()} />
      </>
    )
  }
  const e = data
  const faceSrc = e.canViewFace && e.faceRegistration?.imageAvailable ? mediaUrl(`/face-registrations/${e.faceRegistration.id}/image`) : null
  const tabs = TABS.filter((t) => t.id !== 'history' || can('audit.view'))

  return (
    <>
      <PageHeading
        crumb={{ to: '/employees', label: 'Employees' }}
        title={e.fullName}
        lead={
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono">{e.employeeCode}</span> · {e.designation}, {e.department}
            <EmployeeStatusBadge status={e.status} />
            <FaceBadge status={e.faceStatus} />
            <PresenceBadge presence={e.presence} />
          </span>
        }
        actions={
          <>
            {can('employees.manage') ? <Link className="btn btn-secondary" to={`/employees/${e.id}/edit`}><Pencil size={15} /> Edit</Link> : null}
            {can('faces.manage') && e.status === 'active' ? (
              <Link className="btn btn-secondary" to={`/face-registration/${e.id}`}><ScanFace size={15} /> {e.faceStatus === 'not_registered' ? 'Register face' : 'Update face'}</Link>
            ) : null}
            {can('employees.manage') ? (
              <Button variant={e.status === 'active' ? 'danger' : 'primary'} onClick={() => setStatusOpen(true)}>
                {e.status === 'active' ? <><UserX size={15} /> Deactivate</> : <><UserCheck size={15} /> Activate</>}
              </Button>
            ) : null}
          </>
        }
      />

      {e.status === 'inactive' ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info" title="This employee is inactive">
            Deactivated {formatCalendarDate(e.deactivatedAt?.slice(0, 10))}. Their records are kept, but they are not recognised in newly analysed footage.
          </Alert>
        </div>
      ) : null}

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' ? <Overview employee={e} faceSrc={faceSrc} /> : null}
      {tab === 'attendance' ? <AttendanceHistory employee={e} /> : null}
      {tab === 'history' && can('audit.view') ? <ConfigurationHistory employeeId={e.id} /> : null}

      {statusOpen ? (
        <ConfirmDialog
          title={e.status === 'active' ? `Deactivate ${e.fullName}?` : `Activate ${e.fullName}?`}
          confirmLabel={e.status === 'active' ? 'Deactivate employee' : 'Activate employee'}
          danger={e.status === 'active'}
          loading={setStatus.isPending}
          error={setStatus.error ? errorMessage(setStatus.error, 'The status could not be changed.') : null}
          onClose={() => { setStatusOpen(false); setStatus.reset() }}
          onConfirm={() => setStatus.mutate({ id: e.id, status: e.status === 'active' ? 'inactive' : 'active' }, {
            onSuccess: (r) => { toast('success', `${r.fullName} is now ${r.status}.`); setStatusOpen(false) },
          })}
        >
          {e.status === 'active'
            ? 'The employee will no longer be recognised in newly analysed footage. Attendance history and face registration are kept.'
            : 'The employee becomes recognisable again in newly analysed footage.'}
        </ConfirmDialog>
      ) : null}
    </>
  )
}

function Overview({ employee: e, faceSrc }: { employee: EmployeeDetail; faceSrc: string | null }) {
  const { timezone, can } = useSession()
  const events = useEmployeeEvents(e.id)
  const today = todayIn(timezone)
  const todays = useMemo(
    () => (events.data?.items ?? []).filter((ev) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(ev.occurredAt)) === today),
    [events.data, timezone, today],
  )
  const reg = e.faceRegistration
  const attempt = e.latestRegistrationAttempt

  return (
    <div className="grid-main">
      <div className="stack">
        <Card title="Profile" eyebrow="Employee information">
          <dl className="facts">
            <div><dt>Employee ID</dt><dd className="mono">{e.employeeCode}</dd></div>
            <div><dt>Full name</dt><dd>{e.fullName}</dd></div>
            <div><dt>Email</dt><dd className={e.email ? '' : 'muted'}>{e.email ?? 'Not provided'}</dd></div>
            <div><dt>Phone number</dt><dd className={e.phone ? '' : 'muted'}>{e.phone ?? 'Not provided'}</dd></div>
            <div><dt>Department</dt><dd>{e.department}</dd></div>
            <div><dt>Designation</dt><dd>{e.designation}</dd></div>
            <div><dt>Employment type</dt><dd>{EMPLOYMENT_TYPES[e.employmentType]}</dd></div>
            <div><dt>Joining date</dt><dd>{formatCalendarDate(e.joiningDate)}</dd></div>
            <div><dt>Record created</dt><dd>{formatDateTime(e.createdAt, timezone)}</dd></div>
            <div><dt>Last updated</dt><dd>{formatDateTime(e.updatedAt, timezone)}</dd></div>
          </dl>
        </Card>

        <Card title="Today's activity" lead={`Recognition events on ${formatCalendarDate(today)}.`} eyebrow="In / Out">
          {events.isPending ? <LoadingState compact label="Loading activity..." /> : events.error ? (
            <ErrorState error={events.error} message="Activity could not be loaded." onRetry={() => events.refetch()} />
          ) : todays.length === 0 ? (
            <EmptyState compact icon={<Activity size={26} />} title="No recognition activity was recorded today." />
          ) : (
            <div className="list">
              {todays.map((ev) => (
                <div className="list-row" key={ev.id}>
                  <EventTypeTag type={ev.eventType} />
                  <div className="grow">
                    <strong>{e.fullName} – {ev.eventType.toUpperCase()} – {formatTime(ev.occurredAt, timezone)} – {ev.camera.name}</strong>
                    <span>{ev.camera.location}{ev.confidence !== null ? ` · similarity ${ev.confidence.toFixed(2)}` : ''}</span>
                  </div>
                  <EventStatusBadge status={ev.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="stack">
        <Card title="Face registration" eyebrow="Biometric"
              actions={can('faces.manage') && e.status === 'active' ? (
                <Link className="btn btn-secondary btn-sm" to={`/face-registration/${e.id}`}>{reg ? 'Re-register' : 'Register face'}</Link>
              ) : undefined}>
          <div className="result-panel">
            <Avatar name={e.fullName} src={faceSrc} large />
            <div className="stack" style={{ gap: 8 }}>
              <FaceBadge status={e.faceStatus} />
              {reg ? (
                <dl className="facts" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div><dt>Registered</dt><dd>{formatDateTime(reg.completedAt, timezone)}</dd></div>
                  <div><dt>Captured by</dt><dd>{reg.captureMethod === 'camera' ? 'Camera capture' : 'Image upload'}</dd></div>
                  <div><dt>Face size</dt><dd>{reg.faceSizePx ? `${reg.faceSizePx} px` : '—'}</dd></div>
                  <div><dt>Detection score</dt><dd>{reg.detectionScore ?? '—'}</dd></div>
                </dl>
              ) : (
                <span className="cell-muted">No face has been registered for this employee.</span>
              )}
            </div>
          </div>
          {reg ? (
            <div className="slot-grid" style={{ marginTop: 14 }}>
              {(['front', 'left', 'right'] as const).map((slot) => {
                const sample = e.faceSamples[slot].current
                const src = e.canViewFace && sample?.imageAvailable ? mediaUrl(`/face-registrations/${sample.id}/image`) : null
                return (
                  <div key={slot} style={{ minWidth: 0 }}>
                    <div className="slot-image" style={{ borderRadius: 10 }}>
                      {src ? <img src={src} alt={`${slot} face image of ${e.fullName}`} /> : <ScanFace size={22} strokeWidth={1.4} />}
                    </div>
                    <span className="cell-sub" style={{ textAlign: 'center' }}>
                      {slot === 'front' ? 'Front' : slot === 'left' ? 'Left' : 'Right'} · {sample ? 'registered' : slot === 'front' ? 'required' : 'not added'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : null}
          {e.reregistrationReason ? <div style={{ marginTop: 12 }}><Alert tone="warn" title="Re-registration required">{e.reregistrationReason}</Alert></div> : null}
          {attempt && attempt.status === 'failed' && attempt.id !== reg?.id ? (
            <div style={{ marginTop: 12 }}>
              <Alert tone="crit" title={`Last attempt failed on ${formatDateTime(attempt.completedAt, timezone)}`}>
                {attempt.failureMessage}{attempt.failureDetail ? ` ${attempt.failureDetail}` : ''}
              </Alert>
            </div>
          ) : null}
          {attempt && attempt.status === 'processing' ? (
            <div style={{ marginTop: 12 }}><Alert tone="info" title="Processing face registration...">The recognition pipeline is checking the submitted image.</Alert></div>
          ) : null}
        </Card>

        <Card title="Shift" eyebrow="Schedule"
              actions={can('employees.manage') ? <Link className="btn btn-ghost btn-sm" to={`/employees/${e.id}/edit`}>Change shift</Link> : undefined}>
          {e.shift ? (
            <dl className="facts">
              <div><dt>Shift name</dt><dd>{e.shift.name}{e.shift.status === 'inactive' ? ' (inactive)' : ''}</dd></div>
              <div><dt>Hours</dt><dd>{formatClock(e.shift.startTime)} – {formatClock(e.shift.endTime)}</dd></div>
              <ShiftExtra shiftId={e.shift.id} />
            </dl>
          ) : (
            <EmptyState compact title="No shift assigned">Late arrivals cannot be evaluated until a shift is assigned.</EmptyState>
          )}
        </Card>
      </div>
    </div>
  )
}

function ShiftExtra({ shiftId }: { shiftId: string }) {
  // Grace period and working days come from the shift list (shared, cached query).
  const s = useShifts().data?.items.find((x) => x.id === shiftId)
  if (!s) return null
  return (
    <>
      <div><dt>Grace period</dt><dd>{s.gracePeriodMinutes} minutes</dd></div>
      <div><dt>Working days</dt><dd>{workingDaysLabel(s.workingDays)}</dd></div>
    </>
  )
}

function AttendanceHistory({ employee }: { employee: EmployeeDetail }) {
  const { timezone } = useSession()
  const today = todayIn(timezone)
  const [from, setFrom] = useState(() => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 29)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(today)
  const attendance = useAttendance({ employeeId: employee.id, dateFrom: from, dateTo: to, pageSize: 200 })
  const events = useEmployeeEvents(employee.id)

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="cell-sub" htmlFor="att-from" style={{ marginTop: 0 }}>From</label>
        <input id="att-from" className="input" type="date" value={from} max={to} onChange={(ev) => setFrom(ev.target.value)} />
        <label className="cell-sub" htmlFor="att-to" style={{ marginTop: 0 }}>To</label>
        <input id="att-to" className="input" type="date" value={to} min={from} onChange={(ev) => setTo(ev.target.value)} />
      </div>
      <section className="card table-card">
        <div className="card-head" style={{ padding: '18px 20px 0' }}><div><h2>Attendance sessions</h2><p>Paired IN and OUT events. Missing events are shown as not recorded, never estimated.</p></div></div>
        {attendance.isPending ? <LoadingState label="Loading attendance history..." /> : attendance.error ? (
          <div style={{ padding: 16 }}><ErrorState error={attendance.error} message="Attendance history could not be loaded." onRetry={() => attendance.refetch()} /></div>
        ) : attendance.data.items.length === 0 ? (
          <EmptyState icon={<CalendarCheck size={28} />} title="No attendance activity is available for the selected period." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>IN Time</th><th>OUT Time</th><th>Duration</th><th className="col-md">Entry Camera</th><th className="col-md">Exit Camera</th><th>Status</th></tr></thead>
              <tbody>
                {attendance.data.items.map((r, i) => (
                  <tr key={`${r.date}-${r.inAt ?? r.outAt}-${i}`}>
                    <td>{formatCalendarDate(r.date)}</td>
                    <td>{r.inAt ? formatTime(r.inAt, timezone) : <span className="cell-warn">Entry event not recorded</span>}
                      {r.lateMinutes ? <span className="cell-sub" style={{ color: 'var(--warn)' }}>Late by {formatDuration(r.lateMinutes)}</span> : null}</td>
                    <td>{r.outAt ? formatTime(r.outAt, timezone) : <span className="cell-warn">Exit event not recorded</span>}</td>
                    <td>{formatDuration(r.durationMinutes)}</td>
                    <td className="col-md">{r.entryCamera?.name ?? '—'}</td>
                    <td className="col-md">{r.exitCamera?.name ?? '—'}</td>
                    <td><AttendanceBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card table-card">
        <div className="card-head" style={{ padding: '18px 20px 0' }}><div><h2>Recognition events</h2><p>The latest 100 events for this employee, including those that did not count towards attendance.</p></div></div>
        {events.isPending ? <LoadingState label="Loading recognition events..." /> : events.error ? (
          <div style={{ padding: 16 }}><ErrorState error={events.error} message="Recognition events could not be loaded." onRetry={() => events.refetch()} /></div>
        ) : events.data.items.length === 0 ? (
          <EmptyState icon={<Activity size={28} />} title="No recognition activity was recorded for this employee." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Event</th><th>Date & time</th><th>Camera</th><th className="col-md">Confidence</th><th>Recognition Status</th></tr></thead>
              <tbody>
                {events.data.items.map((ev) => (
                  <tr key={ev.id}>
                    <td><EventTypeTag type={ev.eventType} /></td>
                    <td>{formatDateTime(ev.occurredAt, timezone)}</td>
                    <td>{ev.camera.name}<span className="cell-sub">{ev.camera.location}</span></td>
                    <td className="col-md">{ev.confidence !== null ? ev.confidence.toFixed(2) : '—'}</td>
                    <td><EventStatusBadge status={ev.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function ConfigurationHistory({ employeeId }: { employeeId: string }) {
  const { timezone } = useSession()
  const history = useEmployeeHistory(employeeId, true)
  if (history.isPending) return <LoadingState label="Loading configuration history..." />
  if (history.error) return <ErrorState error={history.error} message="The configuration history could not be loaded." onRetry={() => history.refetch()} />
  if (history.data.items.length === 0) return <div className="card"><EmptyState icon={<History size={28} />} title="No configuration changes have been recorded." /></div>
  return (
    <section className="card">
      <div className="card-head"><div><h2>Configuration history</h2><p>Every administrative change to this employee, their face registration, shift and cameras.</p></div></div>
      <div className="list">
        {history.data.items.map((h) => (
          <div className="list-row" key={h.id} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <strong style={{ whiteSpace: 'normal' }}>{h.summary}</strong>
              <span>{h.actor}</span>
              {Object.keys(h.changes).length && Object.values(h.changes).some((v) => v && typeof v === 'object' && 'from' in (v as object)) ? (
                <div className="chip-list" style={{ marginTop: 6 }}>
                  {Object.entries(h.changes).filter(([, v]) => v && typeof v === 'object' && 'from' in (v as object)).map(([k, v]) => {
                    const c = v as { from: unknown; to: unknown }
                    const show = (x: unknown) => (Array.isArray(x) ? x.join(', ') || 'none' : x === null || x === '' ? 'none' : String(x))
                    return <span className="chip" key={k}>{k}: {show(c.from)} → {show(c.to)}</span>
                  })}
                </div>
              ) : null}
            </div>
            <time dateTime={h.createdAt}>{formatDateTime(h.createdAt, timezone)}</time>
          </div>
        ))}
      </div>
    </section>
  )
}
