import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LogIn, LogOut, Pencil, Plug, Power } from 'lucide-react'
import { useCamera, useCheckConnection, useSetCameraEnabled } from '../api/queries'
import type { CameraDetail } from '../api/types'
import { useSession } from '../auth/session'
import { CameraStatusBadge } from '../components/badges'
import { CameraFormModal } from '../components/CameraFormModal'
import { FootageList } from '../components/FootageList'
import { useToast } from '../components/toast'
import { Alert, Button, Card, ConfirmDialog, ErrorState, LoadingState, PageHeading, errorMessage } from '../components/ui'
import { CAMERA_TYPES, DIRECTIONS, formatDateTime } from '../utils/format'

export function CameraDetailPage() {
  const { id = '' } = useParams()
  const { can, timezone } = useSession()
  const { data, isPending, error, refetch } = useCamera(id)
  const [editing, setEditing] = useState(false)
  const [toggling, setToggling] = useState(false)
  const check = useCheckConnection()
  const setEnabled = useSetCameraEnabled()
  const toast = useToast()

  if (isPending) return <><PageHeading title="Camera" crumb={{ to: '/cameras', label: 'Camera Configuration' }} /><LoadingState label="Loading camera details..." /></>
  if (error || !data) {
    return (
      <>
        <PageHeading title="Camera" crumb={{ to: '/cameras', label: 'Camera Configuration' }} />
        <ErrorState error={error} message="The camera configuration could not be loaded. Please try again." onRetry={() => refetch()} />
      </>
    )
  }
  const c = data
  const manage = can('cameras.manage')

  return (
    <>
      <PageHeading
        crumb={{ to: '/cameras', label: 'Camera Configuration' }}
        title={c.name}
        lead={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="mono">{c.cameraCode}</span> · {c.location} <CameraStatusBadge status={c.status} /></span>}
        actions={manage ? (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>
            <Button variant="secondary" disabled={!c.sourceConfigured || !c.enabled} loading={check.isPending}
                    onClick={() => check.mutate(c.id, {
                      onSuccess: (r) => toast(r.connectionStatus === 'online' ? 'success' : 'error', r.connectionStatus === 'online' ? `${r.name} is online.` : 'This camera is currently unavailable. Verify the camera configuration and connection.'),
                      onError: (err) => toast('error', errorMessage(err, 'The connection check could not be run.')),
                    })}>
              <Plug size={15} /> {check.isPending ? 'Checking connection...' : 'Check connection'}
            </Button>
            <Button variant={c.enabled ? 'danger' : 'primary'} onClick={() => setToggling(true)}><Power size={15} /> {c.enabled ? 'Disable' : 'Enable'}</Button>
          </>
        ) : null}
      />

      {c.status === 'offline' ? (
        <div style={{ marginBottom: 16 }}><Alert tone="crit" title="This camera is currently unavailable.">{c.lastCheckMessage ?? 'Verify the camera configuration and connection.'}</Alert></div>
      ) : null}
      {c.configurationIssues.length && c.enabled ? (
        <div style={{ marginBottom: 16 }}><Alert tone="warn" title="Configuration required">{c.configurationIssues.join(' ')}</Alert></div>
      ) : null}

      <div className="grid-main">
        <div className="stack">
          <Card title="Camera details" eyebrow="Configuration">
            <dl className="facts">
              <div><dt>Camera ID</dt><dd className="mono">{c.cameraCode}</dd></div>
              <div><dt>Camera name</dt><dd>{c.name}</dd></div>
              <div><dt>Location</dt><dd>{c.location}</dd></div>
              <div><dt>Camera type</dt><dd>{CAMERA_TYPES[c.cameraType]}</dd></div>
              <div><dt>Direction</dt><dd>{DIRECTIONS[c.direction]}</dd></div>
              <div><dt>Status</dt><dd><CameraStatusBadge status={c.status} /></dd></div>
              <div style={{ gridColumn: '1 / -1' }}><dt>Stream / source</dt><dd className={c.sourceDisplay ? 'mono' : 'muted'} style={{ wordBreak: 'break-all' }}>{c.sourceDisplay ?? 'No stream address configured'}</dd></div>
              <div><dt>Last connection check</dt><dd className={c.lastCheckedAt ? '' : 'muted'}>{c.lastCheckedAt ? formatDateTime(c.lastCheckedAt, timezone) : 'Never checked'}</dd></div>
              <div><dt>Check result</dt><dd className={c.lastCheckMessage ? '' : 'muted'}>{c.lastCheckMessage ?? '—'}</dd></div>
              <div><dt>Last event</dt><dd className={c.lastEvent ? '' : 'muted'}>{c.lastEvent ? `${c.lastEvent.eventType.toUpperCase()} · ${c.lastEvent.employeeName} · ${formatDateTime(c.lastEvent.at, timezone)}` : 'No events yet'}</dd></div>
            </dl>
          </Card>
          <Card title="Footage analysis" lead="Recordings from this camera analysed by the recognition pipeline."
                actions={can('footage.manage') && c.enabled ? <Link className="btn btn-secondary btn-sm" to={`/footage?cameraId=${c.id}&import=1`}>Import footage</Link> : undefined}>
            <FootageList cameraId={c.id} compact />
          </Card>
        </div>
        <div className="stack">
          <AttendanceTimingCard camera={c} onEdit={manage ? () => setEditing(true) : undefined} />
        </div>
      </div>

      {editing ? <CameraFormModal camera={c} onClose={() => setEditing(false)} /> : null}
      {toggling ? (
        <ConfirmDialog title={c.enabled ? `Disable ${c.name}?` : `Enable ${c.name}?`} confirmLabel={c.enabled ? 'Disable camera' : 'Enable camera'}
                       danger={c.enabled} loading={setEnabled.isPending}
                       error={setEnabled.error ? errorMessage(setEnabled.error, 'The camera could not be updated.') : null}
                       onClose={() => { setToggling(false); setEnabled.reset() }}
                       onConfirm={() => setEnabled.mutate({ id: c.id, enabled: !c.enabled }, { onSuccess: () => { toast('success', `${c.name} was ${c.enabled ? 'disabled' : 'enabled'}.`); setToggling(false) } })}>
          {c.enabled
            ? 'No new footage can be imported for a disabled camera, so it stops recording IN and OUT events. Its recorded events are kept.'
            : 'Footage from this camera can be imported and analysed again.'}
        </ConfirmDialog>
      ) : null}
    </>
  )
}

function AttendanceTimingCard({ camera: c, onEdit }: { camera: CameraDetail; onEdit?: () => void }) {
  const rows = {
    entry: [{ icon: <LogIn size={18} />, title: 'Records IN', text: 'at the moment an employee is first seen.' }],
    exit: [{ icon: <LogOut size={18} />, title: 'Records OUT', text: 'at the moment an employee is last seen.' }],
    entry_exit: [
      { icon: <LogIn size={18} />, title: 'Records IN', text: 'at first sighting, when the employee is not currently inside.' },
      { icon: <LogOut size={18} />, title: 'Records OUT', text: 'at last sighting, when the employee’s latest confirmed event is an IN within the maximum session length.' },
    ],
  }[c.direction]
  return (
    <Card title="Attendance timing" eyebrow="Global configuration"
          lead="Applies to every active employee with a registered face. There is no per-employee camera setup."
          actions={onEdit ? <Button variant="secondary" size="sm" onClick={onEdit}><Pencil size={14} /> Change direction</Button> : undefined}>
      {c.enabled ? (
        <div className="list">
          {rows.map((r) => (
            <div className="list-row" key={r.title}>
              {r.icon}
              <div className="grow"><strong>{r.title}</strong><span>{r.text}</span></div>
            </div>
          ))}
        </div>
      ) : (
        <Alert tone="info">This camera is disabled and records no IN or OUT events. Enable it to use it for attendance.</Alert>
      )}
    </Card>
  )
}
