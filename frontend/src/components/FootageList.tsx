import { useState } from 'react'
import { Film, RotateCcw } from 'lucide-react'
import { useFootage, useRetryFootage } from '../api/queries'
import { useSession } from '../auth/session'
import { FootageBadge } from './badges'
import { useToast } from './toast'
import { EmptyState, ErrorState, LoadingState, Pagination, errorMessage } from './ui'
import { formatBytes, formatDateTime, formatVideoLength } from '../utils/format'

export function FootageList({ cameraId, status, compact }: { cameraId?: string; status?: string; compact?: boolean }) {
  const { timezone, can } = useSession()
  const [page, setPage] = useState(1)
  const { data, isPending, error, refetch } = useFootage({ cameraId, status, page, pageSize: compact ? 5 : 20 })
  const retry = useRetryFootage()
  const toast = useToast()

  if (isPending) return <LoadingState compact={compact} label="Loading footage history..." />
  if (error) return <ErrorState error={error} message="The footage history could not be loaded. Please try again." onRetry={() => refetch()} />
  if (data.items.length === 0) {
    return (
      <EmptyState compact={compact} icon={<Film size={28} />} title="No footage has been analysed yet.">
        Import a recording exported from an entry or exit camera to generate IN/OUT events.
      </EmptyState>
    )
  }
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Recording</th>
              {!cameraId ? <th className="col-md">Camera</th> : null}
              <th className="col-lg">First frame</th>
              <th>Status</th>
              <th className="col-md">Result</th>
              <th className="actions"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((f) => (
              <tr key={f.id}>
                <td>
                  <span className="cell-strong" style={{ wordBreak: 'break-all' }}>{f.originalFilename}</span>
                  <span className="cell-sub">{formatBytes(f.sizeBytes)} · {formatVideoLength(f.durationMs)} · imported {formatDateTime(f.createdAt, timezone)}</span>
                </td>
                {!cameraId ? <td className="col-md">{f.camera.name}<span className="cell-sub">{f.camera.location}</span></td> : null}
                <td className="col-lg">{formatDateTime(f.captureStartedAt, timezone)}</td>
                <td><FootageBadge status={f.status} /></td>
                <td className="col-md">
                  {f.status === 'completed' ? (
                    <>
                      {f.eventsConfirmed} confirmed{f.eventsNeedsReview ? `, ${f.eventsNeedsReview} for review` : ''}{f.eventsOther ? `, ${f.eventsOther} not counted` : ''}
                      <span className="cell-sub">{f.identityDecisions} identity decisions · {f.galleryEmployeeCount} registered faces searched</span>
                    </>
                  ) : f.status === 'failed' ? (
                    <span style={{ color: 'var(--crit)' }}>{f.failureMessage}{f.failureDetail ? <span className="cell-sub">{f.failureDetail}</span> : null}</span>
                  ) : f.status === 'processing' ? (
                    <span className="cell-muted">Analysing with the recognition pipeline...</span>
                  ) : (
                    <span className="cell-muted">Waiting for the recognition worker</span>
                  )}
                </td>
                <td className="actions">
                  {f.status === 'failed' && can('footage.manage') ? (
                    <button className="icon-btn" title="Analyse again" aria-label={`Analyse ${f.originalFilename} again`} disabled={retry.isPending}
                            onClick={() => retry.mutate(f.id, {
                              onSuccess: () => toast('success', `${f.originalFilename} was queued for analysis again.`),
                              onError: (err) => toast('error', errorMessage(err, 'The analysis could not be restarted.')),
                            })}><RotateCcw size={16} /></button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="recordings" onPage={setPage} />
    </>
  )
}
