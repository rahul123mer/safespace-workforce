import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Cctv, Eye, LogIn, LogOut, Pencil, Plus } from 'lucide-react'
import { useCameras } from '../api/queries'
import type { Camera } from '../api/types'
import { useSession } from '../auth/session'
import { CameraStatusBadge } from '../components/badges'
import { CameraFormModal } from '../components/CameraFormModal'
import { Alert, Button, Card, EmptyState, ErrorState, LoadingState, PageHeading, SearchInput } from '../components/ui'
import { CAMERA_STATUS, CAMERA_TYPES, DIRECTIONS, formatDateTime } from '../utils/format'
import { useDebounced } from '../utils/hooks'

export function CamerasPage() {
  const { can, timezone } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [editing, setEditing] = useState<Camera | null>(null)
  const direction = params.get('direction') ?? ''
  const status = params.get('status') ?? ''
  const { data, isPending, error, refetch } = useCameras({ search: debounced || undefined, direction: direction || undefined, status: status || undefined })
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('new')
    setParams(next, { replace: true })
  }
  const filtered = Boolean(debounced || direction || status)

  return (
    <>
      <PageHeading
        title="Camera Configuration"
        lead="The administrator decides here, once for everyone, which cameras record IN and which record OUT. Every enabled camera recognises every active employee with a registered face."
        actions={can('cameras.manage') ? <Button onClick={() => setCreating(true)}><Plus size={16} /> Add camera</Button> : null}
      />
      <AttendanceTiming />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Camera name, ID or location" label="Search cameras" />
        <select className="select" aria-label="Direction" value={direction} onChange={(e) => update('direction', e.target.value)}>
          <option value="">All directions</option>
          {Object.entries(DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select" aria-label="Camera status" value={status} onChange={(e) => update('status', e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(CAMERA_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="spacer" />
        {data ? <span className="result-count">{data.items.length} {data.items.length === 1 ? 'camera' : 'cameras'}</span> : null}
      </div>

      {error ? <ErrorState error={error} message="The camera configuration could not be loaded. Please try again." onRetry={() => refetch()} /> : (
        <section className="card table-card">
          {isPending ? <LoadingState label="Loading cameras..." /> : data.items.length === 0 ? (
            filtered ? (
              <EmptyState icon={<Cctv size={30} />} title="No cameras match these filters"
                          action={<Button variant="secondary" size="sm" onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={<Cctv size={30} />} title="No cameras have been configured."
                          action={can('cameras.manage') ? <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} /> Add camera</Button> : undefined}>
                Add the cameras at your entrances and exits and set each one's direction: Entry records IN, Exit records OUT.
              </EmptyState>
            )
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Camera</th><th className="col-lg">Camera ID</th><th className="col-md">Location</th><th className="col-xl">Type</th>
                    <th>Direction</th><th>Status</th><th className="col-lg">Last Event</th>
                    <th className="col-xl">Configuration</th><th className="actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td><Link className="cell-strong" to={`/cameras/${c.id}`}>{c.name}</Link><span className="cell-sub">{c.cameraCode}<span className="hide-lg"> · {c.location}</span></span></td>
                      <td className="col-lg mono">{c.cameraCode}</td>
                      <td className="col-md">{c.location}</td>
                      <td className="col-xl">{CAMERA_TYPES[c.cameraType]}</td>
                      <td>{DIRECTIONS[c.direction]}</td>
                      <td><CameraStatusBadge status={c.status} /></td>
                      <td className="col-lg">{c.lastEvent ? <>{formatDateTime(c.lastEvent.at, timezone)}<span className="cell-sub">{c.lastEvent.eventType.toUpperCase()} · {c.lastEvent.employeeName}</span></> : <span className="cell-muted">No events</span>}</td>
                      <td className="col-xl">{c.configurationIssues.length ? <span className="cell-warn">{c.configurationIssues.length} {c.configurationIssues.length === 1 ? 'issue' : 'issues'}</span> : <span className="cell-muted">Complete</span>}</td>
                      <td className="actions">
                        <div className="row-actions">
                          <button className="icon-btn" title="Camera details" aria-label={`Details of ${c.name}`} onClick={() => navigate(`/cameras/${c.id}`)}><Eye size={16} /></button>
                          {can('cameras.manage') ? <button className="icon-btn" title="Edit camera" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil size={16} /></button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {creating ? <CameraFormModal onClose={() => { setCreating(false); update('new', '') }} onSaved={(c) => navigate(`/cameras/${c.id}`)} /> : null}
      {editing ? <CameraFormModal camera={editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function AttendanceTiming() {
  const { data } = useCameras()
  const cameras = data?.items ?? []
  if (!cameras.length) return null
  const enabled = cameras.filter((c) => c.enabled)
  const inCams = enabled.filter((c) => c.direction !== 'exit')
  const outCams = enabled.filter((c) => c.direction !== 'entry')
  const group = (list: Camera[], icon: JSX.Element, title: string, missing: string) => (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      {icon}
      <div className="grow">
        <strong>{title}</strong>
        {list.length ? (
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {list.map((c) => <Link key={c.id} className="chip" to={`/cameras/${c.id}`}>{c.name}{c.direction === 'entry_exit' ? ' (Entry & Exit)' : ''}</Link>)}
          </span>
        ) : <span className="cell-warn">{missing}</span>}
      </div>
    </div>
  )
  return (
    <div style={{ marginBottom: 16 }}>
      <Card title="Attendance timing" eyebrow="Applies to all employees"
            lead="IN time is taken when an employee is first seen on an IN camera; OUT time when last seen on an OUT camera. Change a camera's direction to change what it records.">
        <div className="list">
          {group(inCams, <LogIn size={18} />, 'IN (entry) time recorded by', 'No enabled camera records IN. Set a camera to Entry or Entry & Exit.')}
          {group(outCams, <LogOut size={18} />, 'OUT (exit) time recorded by', 'No enabled camera records OUT, so exits will show as not recorded.')}
        </div>
        {enabled.length < cameras.length ? (
          <div style={{ marginTop: 12 }}><Alert tone="info">{cameras.length - enabled.length} disabled {cameras.length - enabled.length === 1 ? 'camera is' : 'cameras are'} not used for attendance.</Alert></div>
        ) : null}
      </Card>
    </div>
  )
}
