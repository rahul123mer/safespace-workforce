import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Check, X } from 'lucide-react'
import { useEvents, useReviewEvent } from '../api/queries'
import type { EventStatus, RecognitionEvent } from '../api/types'
import { useSession } from '../auth/session'
import { ActivityFilters, useFilterParams } from '../components/ActivityFilters'
import { EventStatusBadge, EventTypeTag } from '../components/badges'
import { useToast } from '../components/toast'
import { Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeading, Pagination, errorMessage } from '../components/ui'
import { EVENT_STATUS, formatCalendarDate, formatDateTime } from '../utils/format'

const REVIEWABLE: EventStatus[] = ['needs_review']

export function ActivityPage() {
  const { values, set, reset } = useFilterParams()
  const { timezone, can } = useSession()
  const { data, isPending, error, refetch, isFetching } = useEvents({
    dateFrom: values.dateFrom, dateTo: values.dateTo, employeeId: values.employeeId || undefined, cameraId: values.cameraId || undefined,
    eventType: values.eventType || undefined, status: values.status || undefined, department: values.department || undefined,
    page: values.page, pageSize: 50,
  })
  const [reviewing, setReviewing] = useState<{ event: RecognitionEvent; decision: 'confirm' | 'reject' } | null>(null)
  const review = useReviewEvent()
  const toast = useToast()
  const period = values.dateFrom === values.dateTo ? formatCalendarDate(values.dateFrom) : `${formatCalendarDate(values.dateFrom)} – ${formatCalendarDate(values.dateTo)}`

  return (
    <>
      <PageHeading title="Recognition Activity" lead="Every IN and OUT event produced from analysed footage, with the camera that recognised the employee and how the event was classified." />
      <div className="toolbar">
        <ActivityFilters values={values} set={set} show={['employeeId', 'department', 'eventType', 'cameraId']} />
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
      </div>

      {data ? (
        <div className="tabs" role="tablist" aria-label="Recognition status">
          <button role="tab" aria-selected={!values.status} onClick={() => set({ status: '' })}>All ({Object.values(data.statusCounts).reduce((a, b) => a + b, 0)})</button>
          {(Object.keys(EVENT_STATUS) as EventStatus[]).map((s) => (
            <button key={s} role="tab" aria-selected={values.status === s} onClick={() => set({ status: s })} title={EVENT_STATUS[s].hint}>
              {EVENT_STATUS[s].label} ({data.statusCounts[s] ?? 0})
            </button>
          ))}
        </div>
      ) : null}

      {error ? <ErrorState error={error} message="Recognition activity could not be loaded. Please try again." onRetry={() => refetch()} /> : (
        <section className="card table-card">
          {isPending ? <LoadingState label="Loading recognition activity..." /> : data.items.length === 0 ? (
            <EmptyState icon={<Activity size={30} />} title="No recognition activity was recorded for the selected period.">
              {period}. Import footage from entry and exit cameras under Footage Analysis to record employee activity.
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap" style={{ opacity: isFetching ? 0.7 : 1 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th><th className="col-lg">Employee ID</th><th>Event</th><th>Date & Time</th><th className="col-md">Camera</th>
                      <th className="col-xl">Camera Location</th><th className="num col-lg">Confidence</th><th>Recognition Status</th><th className="col-xl">Event Source</th>
                      <th className="actions"><span className="sr-only">Review</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((ev) => (
                      <tr key={ev.id}>
                        <td><Link className="cell-strong" to={`/employees/${ev.employee.id}`}>{ev.employee.fullName}</Link><span className="cell-sub">{ev.employee.department}</span></td>
                        <td className="col-lg mono">{ev.employee.employeeCode}</td>
                        <td><EventTypeTag type={ev.eventType} /></td>
                        <td>{formatDateTime(ev.occurredAt, timezone)}</td>
                        <td className="col-md">{ev.camera.name}</td>
                        <td className="col-xl">{ev.camera.location}</td>
                        <td className="num col-lg" title="Face similarity to the registered face (cosine, 0 to 1)">{ev.confidence !== null ? ev.confidence.toFixed(2) : '—'}</td>
                        <td><EventStatusBadge status={ev.status} /></td>
                        <td className="col-xl">Footage analysis<span className="cell-sub">{ev.decisionMethod === 'pooled_embedding' ? 'Pooled face match' : 'Per-frame face vote'}</span></td>
                        <td className="actions">
                          {can('events.review') && REVIEWABLE.includes(ev.status) ? (
                            <div className="row-actions">
                              <button className="icon-btn" title="Confirm event" aria-label={`Confirm ${ev.eventType} event of ${ev.employee.fullName}`} onClick={() => setReviewing({ event: ev, decision: 'confirm' })}><Check size={16} /></button>
                              <button className="icon-btn" title="Reject event" aria-label={`Reject ${ev.eventType} event of ${ev.employee.fullName}`} onClick={() => setReviewing({ event: ev, decision: 'reject' })}><X size={16} /></button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="events" onPage={(p) => set({ page: String(p) })} />
            </>
          )}
        </section>
      )}

      {reviewing ? (
        <ConfirmDialog
          title={reviewing.decision === 'confirm' ? 'Confirm this event?' : 'Reject this event?'}
          confirmLabel={reviewing.decision === 'confirm' ? 'Confirm event' : 'Reject event'}
          danger={reviewing.decision === 'reject'}
          loading={review.isPending}
          error={review.error ? errorMessage(review.error, 'The event could not be reviewed.') : null}
          onClose={() => { setReviewing(null); review.reset() }}
          onConfirm={() => review.mutate({ id: reviewing.event.id, decision: reviewing.decision }, {
            onSuccess: () => { toast('success', reviewing.decision === 'confirm' ? 'The event now counts towards attendance.' : 'The event was rejected.'); setReviewing(null) },
          })}
        >
          <p style={{ margin: 0 }}>
            {reviewing.event.employee.fullName} · {reviewing.event.eventType.toUpperCase()} · {formatDateTime(reviewing.event.occurredAt, timezone)} · {reviewing.event.camera.name}
          </p>
          <p style={{ margin: '8px 0 0' }}>
            {reviewing.decision === 'confirm'
              ? 'Confirm only if you have verified that this was the employee, for example from the recording. Confirmed events count towards attendance.'
              : 'The event stays in the activity log as rejected and does not count towards attendance.'}
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}
