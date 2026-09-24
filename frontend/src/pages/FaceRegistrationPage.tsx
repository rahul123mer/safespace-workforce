import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, RotateCcw, ScanFace, Trash2, XCircle } from 'lucide-react'
import { mediaUrl } from '../api/client'
import { useEmployee, useEmployees, useRegistration, useRemoveFace, useRemoveSideImage, useRequestReregistration, useSettings, useSubmitFace } from '../api/queries'
import type { EmployeeDetail, PoseSlot } from '../api/types'
import { useSession } from '../auth/session'
import { FaceBadge } from '../components/badges'
import { FaceCapture, RECOMMENDED_EDGE, type CapturedImage } from '../components/FaceCapture'
import { useToast } from '../components/toast'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeading,
  SearchInput,
  errorMessage,
} from '../components/ui'
import { formatDateTime } from '../utils/format'
import { useDebounced } from '../utils/hooks'

export function FaceRegistrationPage() {
  const { employeeId } = useParams()
  return employeeId ? <RegistrationWizard employeeId={employeeId} /> : <EmployeePicker />
}

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    ['Select employee', 'Confirm who is being registered'],
    ['Capture or upload', 'Front (required), left and right'],
    ['Register', 'Checked by the recognition pipeline'],
  ]
  return (
    <ol className="stepper" style={{ padding: 0 }}>
      {steps.map(([title, sub], i) => (
        <li key={title} className={i + 1 === current ? 'current' : i + 1 < current ? 'done' : ''}>
          <b>{i + 1 < current ? <CheckCircle2 size={15} /> : i + 1}</b>
          <div><strong>{title}</strong><span>{sub}</span></div>
        </li>
      ))}
    </ol>
  )
}

function EmployeePicker() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const pending = useEmployees({ status: 'active', faceStatus: 'not_registered', pageSize: 50, sort: 'name' })
  const failed = useEmployees({ status: 'active', faceStatus: 'failed', pageSize: 50, sort: 'name' })
  const stale = useEmployees({ status: 'active', faceStatus: 'requires_reregistration', pageSize: 50, sort: 'name' })
  const results = useEmployees({ status: 'active', search: debounced || undefined, pageSize: 10, sort: 'name' })
  const attention = [...(stale.data?.items ?? []), ...(failed.data?.items ?? []), ...(pending.data?.items ?? [])]
  const loadingAttention = pending.isPending || failed.isPending || stale.isPending

  return (
    <>
      <PageHeading title="Face Registration" lead="Register each employee's face with the existing SafeSpace recognition pipeline so they can be identified on entry and exit cameras." />
      <Steps current={1} />
      <div className="grid-2">
        <Card title="Find an employee" lead="Search active employees by name, Employee ID or department.">
          <div className="stack">
            <SearchInput value={search} onChange={setSearch} placeholder="Name or Employee ID" label="Search employees" />
            {results.isPending ? <LoadingState compact label="Loading employees..." /> : results.error ? (
              <ErrorState error={results.error} message="The employee information could not be loaded. Please try again." onRetry={() => results.refetch()} />
            ) : results.data.items.length === 0 ? (
              <EmptyState compact title={debounced ? 'No active employee matches this search' : 'No active employees yet'}>
                {debounced ? 'Check the spelling or search by Employee ID.' : 'Register employees before capturing their faces.'}
              </EmptyState>
            ) : (
              <div className="list">
                {results.data.items.map((e) => (
                  <button key={e.id} className="list-row" style={{ border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => navigate(`/face-registration/${e.id}`)}>
                    <Avatar name={e.fullName} />
                    <div className="grow"><strong>{e.fullName}</strong><span>{e.employeeCode} · {e.department}</span></div>
                    <FaceBadge status={e.faceStatus} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
        <Card title="Needs attention" lead="Active employees who are not registered, whose registration failed, or who must re-register.">
          {loadingAttention ? <LoadingState compact label="Loading registration status..." /> : attention.length === 0 ? (
            <EmptyState compact icon={<CheckCircle2 size={28} />} title="Every active employee has a registered face" />
          ) : (
            <div className="list">
              {attention.map((e) => (
                <div className="list-row" key={e.id}>
                  <Avatar name={e.fullName} />
                  <div className="grow"><strong>{e.fullName}</strong><span>{e.employeeCode} · {e.department}</span></div>
                  <FaceBadge status={e.faceStatus} />
                  <Link className="btn btn-secondary btn-sm" to={`/face-registration/${e.id}`}>Register</Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

const SLOTS: { slot: PoseSlot; title: string; required: boolean; instruction: string }[] = [
  { slot: 'front', title: 'Front', required: true, instruction: 'Looking straight at the camera, face centred.' },
  { slot: 'left', title: 'Left', required: false, instruction: 'Head turned about 30–45° to one side, both eyes still visible.' },
  { slot: 'right', title: 'Right', required: false, instruction: 'Head turned about 30–45° to the other side, both eyes still visible.' },
]
const SLOT_NAME: Record<PoseSlot, string> = { front: 'front', left: 'left-side', right: 'right-side' }

function RegistrationWizard({ employeeId }: { employeeId: string }) {
  const employee = useEmployee(employeeId)
  const [active, setActive] = useState<PoseSlot | null>(null)
  const opened = useRef(false)
  // On first load, open the front slot when no front image is registered yet.
  useEffect(() => {
    if (!opened.current && employee.data) {
      opened.current = true
      if (!employee.data.faceSamples.front.current) setActive('front')
    }
  }, [employee.data])

  if (employee.isPending) return <><PageHeading title="Face Registration" crumb={{ to: '/face-registration', label: 'Face Registration' }} /><LoadingState label="Loading employee details..." /></>
  if (employee.error || !employee.data) {
    return (
      <>
        <PageHeading title="Face Registration" crumb={{ to: '/face-registration', label: 'Face Registration' }} />
        <ErrorState error={employee.error} message="The employee information could not be loaded. Please try again." onRetry={() => employee.refetch()} />
      </>
    )
  }
  const e = employee.data
  const frontRegistered = Boolean(e.faceSamples.front.current)
  const current = active
  const registeredCount = SLOTS.filter((s) => e.faceSamples[s.slot].current).length

  return (
    <>
      <PageHeading title={`Face Registration · ${e.fullName}`} crumb={{ to: '/face-registration', label: 'Face Registration' }}
                   lead="Register a front image (required) and, for better recognition when employees are not facing the camera, left and right images. Each image is checked by the existing SafeSpace recognition pipeline; embeddings stay on the server." />
      <Steps current={frontRegistered ? 3 : 2} />
      <div className="grid-main">
        <div className="stack">
          <EmployeeSummary employee={e} />
          {e.status !== 'active' ? (
            <Alert tone="warn" title="This employee is inactive">Activate the employee before registering a face.</Alert>
          ) : (
            <>
              <Card title="Face images" eyebrow="Step 2 · Capture"
                    lead={`${registeredCount} of 3 registered. The front image is required; left and right images are optional and can be added after the front image is registered.`}>
                <div className="slot-grid">
                  {SLOTS.map((s) => (
                    <SlotCard key={s.slot} employee={e} {...s} selected={current === s.slot}
                              locked={s.slot !== 'front' && !frontRegistered} onSelect={() => setActive(s.slot)} />
                  ))}
                </div>
              </Card>
              {current ? (
                <SlotCapture key={current} employee={e} slot={current}
                             onDone={() => { void employee.refetch() }} onClose={() => setActive(null)} canClose={frontRegistered} />
              ) : null}
            </>
          )}
        </div>
        <div className="stack">
          <Card title="Image guidance" eyebrow="For reliable recognition">
            <ul className="guidance">
              <li>Only this employee in the picture; no other faces in the background.</li>
              <li><b>Front:</b> look straight at the camera.</li>
              <li><b>Left and right:</b> turn the head about 30–45° to each side. Keep both eyes visible; a full profile cannot be recognised.</li>
              <li>Even lighting with no strong shadows or backlight.</li>
              <li>Nothing covering the face: no mask, sunglasses or hand.</li>
            </ul>
          </Card>
          <CurrentRegistration employee={e} />
        </div>
      </div>
    </>
  )
}

function SlotCard({ employee, slot, title, required, instruction, selected, locked, onSelect }: {
  employee: EmployeeDetail
  slot: PoseSlot
  title: string
  required: boolean
  instruction: string
  selected: boolean
  locked: boolean
  onSelect: () => void
}) {
  const { current, latestAttempt } = employee.faceSamples[slot]
  const processing = latestAttempt?.status === 'processing'
  const failed = latestAttempt?.status === 'failed' && latestAttempt.id !== current?.id
  const src = employee.canViewFace && current?.imageAvailable ? mediaUrl(`/face-registrations/${current.id}/image`) : null
  let badge = <Badge tone="neutral">{required ? 'Required' : 'Optional'}</Badge>
  if (current) badge = <Badge tone="good">Registered</Badge>
  else if (processing) badge = <Badge tone="info">Processing</Badge>
  else if (failed) badge = <Badge tone="crit">Failed</Badge>
  return (
    <div className={`slot-card${selected ? ' selected' : ''}${locked ? ' locked' : ''}`}>
      <div className="slot-head">
        <strong>{title}{required ? <span className="req" aria-hidden> *</span> : null}</strong>
        {badge}
      </div>
      <div className="slot-image">
        {src ? <img src={src} alt={`${title} face image of ${employee.fullName}`} /> : <ScanFace size={34} strokeWidth={1.4} />}
      </div>
      <p className="slot-note">{locked ? 'Available after the front image is registered.' : failed && !current ? latestAttempt?.failureMessage : instruction}</p>
      <Button variant={current ? 'secondary' : 'primary'} size="sm" disabled={locked || processing || selected} onClick={onSelect}>
        {current ? `Replace ${title.toLowerCase()} image` : `Capture ${title.toLowerCase()} image`}
      </Button>
    </div>
  )
}

function SlotCapture({ employee, slot, onDone, onClose, canClose }: {
  employee: EmployeeDetail
  slot: PoseSlot
  onDone: () => void
  onClose: () => void
  canClose: boolean
}) {
  const settings = useSettings()
  const { timezone } = useSession()
  const [image, setImage] = useState<CapturedImage | null>(null)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const submit = useSubmitFace(employee.id)
  const registration = useRegistration(submittedId)
  const existing = employee.faceSamples[slot].current
  const title = SLOTS.find((s) => s.slot === slot)!.title

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url) }, [image])
  useEffect(() => {
    if (registration.data && registration.data.status !== 'processing') onDone()
  }, [registration.data?.status])
  const onCaptured = useCallback((img: CapturedImage) => { setImage(img); submit.reset() }, [submit])

  const reg = registration.data
  const processing = submit.isPending || reg?.status === 'processing'
  const finished = reg && reg.status !== 'processing'
  const reset = () => { setImage(null); setSubmittedId(null); setReplaceConfirmed(false); submit.reset() }
  const register = () => {
    if (!image) return
    submit.mutate({ file: image.blob, captureMethod: image.method, replaceExisting: Boolean(existing), poseSlot: slot },
                  { onSuccess: (r) => setSubmittedId(r.id) })
  }

  if (finished) {
    return (
      <Card eyebrow={`${title} image`}>
        {reg.status === 'registered' ? (
          <div className="result-panel">
            <CheckCircle2 size={30} color="var(--good)" />
            <div className="stack" style={{ gap: 10 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17 }}>{title} image registered</h2>
                <p style={{ margin: '4px 0 0', color: 'var(--ink-500)' }}>
                  {slot === 'front'
                    ? `${employee.fullName} can now be recognised in newly analysed footage. Add left and right images to improve recognition at an angle.`
                    : `Registered on ${formatDateTime(reg.completedAt, timezone)}. It is used together with the front image.`}
                </p>
              </div>
              <dl className="facts">
                <div><dt>Face size</dt><dd>{reg.faceSizePx} px</dd></div>
                <div><dt>Detection score</dt><dd>{reg.detectionScore}</dd></div>
                <div><dt>Detected pose</dt><dd>{reg.headPose === 'front' ? 'Frontal' : 'Turned'}</dd></div>
              </dl>
              <div className="page-actions">
                <Button onClick={onClose}>Done</Button>
                {slot === 'front' ? <Link className="btn btn-secondary" to={`/employees/${employee.id}?tab=cameras`}>Configure cameras</Link> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="result-panel">
            <XCircle size={30} color="var(--crit)" />
            <div className="stack" style={{ gap: 10 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17 }}>The {SLOT_NAME[slot]} image could not be registered</h2>
                <p style={{ margin: '6px 0 0', color: 'var(--ink-700)', lineHeight: 1.5 }}>{reg.failureMessage ?? 'Verify that the image contains one clear face and try again.'}</p>
                {reg.failureDetail ? <p style={{ margin: '6px 0 0', color: 'var(--ink-500)', fontSize: 13 }}>{reg.failureDetail}</p> : null}
              </div>
              {existing ? <Alert tone="info">The previously registered {SLOT_NAME[slot]} image remains in use.</Alert> : null}
              <div className="page-actions">
                <Button onClick={reset}><RotateCcw size={15} /> Try another image</Button>
                {canClose ? <Button variant="secondary" onClick={onClose}>Close</Button> : null}
              </div>
            </div>
          </div>
        )}
      </Card>
    )
  }

  return (
    <Card title={image ? `Review the ${SLOT_NAME[slot]} image` : `Capture the ${SLOT_NAME[slot]} image`} eyebrow={image ? 'Step 3 · Register' : 'Step 2 · Capture'}
          lead={SLOTS.find((s) => s.slot === slot)!.instruction}
          actions={canClose && !processing ? <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button> : undefined}>
      {!image ? (
        settings.isPending ? <LoadingState compact label="Loading registration settings..." /> : (
          <FaceCapture maxBytes={settings.data?.limits.maxFaceImageBytes ?? 10 * 1024 * 1024} onCaptured={onCaptured} />
        )
      ) : (
        <div className="stack">
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <img className="face-preview" src={image.url} alt={`${title} face image of ${employee.fullName} to register`} />
            <dl className="facts" style={{ flex: '1 1 200px' }}>
              <div><dt>Pose</dt><dd>{title}</dd></div>
              <div><dt>Source</dt><dd>{image.method === 'camera' ? 'Camera capture' : image.name}</dd></div>
              <div><dt>Resolution</dt><dd>{image.width} × {image.height} px</dd></div>
              <div><dt>File size</dt><dd>{Math.max(1, Math.round(image.blob.size / 1024))} KB</dd></div>
            </dl>
          </div>
          {Math.min(image.width, image.height) < RECOMMENDED_EDGE ? (
            <Alert tone="warn">This image is small. If the face occupies only part of it, registration may fail because the face is too small. A photo of at least {RECOMMENDED_EDGE} px per side is recommended.</Alert>
          ) : null}
          {existing ? (
            <Alert tone="warn" title={slot === 'front' ? 'A face is already registered for this employee.' : `A ${SLOT_NAME[slot]} image is already registered.`}>
              {slot === 'front' ? 'Re-registering will replace the existing registration.' : 'Registering this image will replace it.'} The current image stays in use if the new one is rejected.
              <label className="check" style={{ marginTop: 8, display: 'flex' }}>
                <input type="checkbox" checked={replaceConfirmed} onChange={(ev) => setReplaceConfirmed(ev.target.checked)} />
                Replace the existing {SLOT_NAME[slot]} image
              </label>
            </Alert>
          ) : null}
          {submit.error ? <Alert tone="crit">{errorMessage(submit.error, 'Face registration could not be completed. Verify that the image contains one clear face and try again.')}</Alert> : null}
          {processing ? (
            <Alert tone="info" title={submit.isPending ? 'Registering face...' : 'Processing face registration...'}>
              The recognition pipeline is detecting the face and generating the embedding. The page updates automatically.
            </Alert>
          ) : null}
          <div className="page-actions" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={reset} disabled={processing}><RotateCcw size={15} /> {image.method === 'camera' ? 'Retake' : 'Choose another image'}</Button>
            <Button onClick={register} loading={processing} disabled={Boolean(existing) && !replaceConfirmed}>
              {processing ? 'Processing...' : existing ? `Replace ${title.toLowerCase()} image` : `Register ${title.toLowerCase()} image`}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function EmployeeSummary({ employee: e }: { employee: EmployeeDetail }) {
  return (
    <Card eyebrow="Step 1 · Employee">
      <div className="result-panel" style={{ alignItems: 'center' }}>
        <Avatar name={e.fullName} large />
        <dl className="facts" style={{ flex: 1 }}>
          <div><dt>Employee name</dt><dd><Link to={`/employees/${e.id}`}>{e.fullName}</Link></dd></div>
          <div><dt>Employee ID</dt><dd className="mono">{e.employeeCode}</dd></div>
          <div><dt>Department</dt><dd>{e.department}</dd></div>
          <div><dt>Face registration</dt><dd><FaceBadge status={e.faceStatus} /></dd></div>
        </dl>
      </div>
    </Card>
  )
}

function CurrentRegistration({ employee: e }: { employee: EmployeeDetail }) {
  const { timezone } = useSession()
  const [requestOpen, setRequestOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeSide, setRemoveSide] = useState<'left' | 'right' | null>(null)
  const [reason, setReason] = useState('')
  const request = useRequestReregistration(e.id)
  const remove = useRemoveFace(e.id)
  const removeSideImage = useRemoveSideImage(e.id)
  const toast = useToast()
  const reg = e.faceRegistration
  const sides = (['left', 'right'] as const).filter((s) => e.faceSamples[s].current)
  return (
    <Card title="Current registration" eyebrow="On file">
      {!reg ? (
        <EmptyState compact icon={<ScanFace size={26} />} title="No face has been registered for this employee." />
      ) : (
        <div className="stack">
          <dl className="facts">
            <div><dt>Status</dt><dd><FaceBadge status={e.faceStatus} /></dd></div>
            <div><dt>Front registered</dt><dd>{formatDateTime(reg.completedAt, timezone)}</dd></div>
            <div><dt>Images</dt><dd>Front{sides.map((s) => `, ${s === 'left' ? 'Left' : 'Right'}`).join('')}</dd></div>
          </dl>
          {e.reregistrationReason ? <Alert tone="warn">{e.reregistrationReason}</Alert> : null}
          <div className="page-actions">
            {e.faceStatus === 'registered' ? <Button variant="secondary" size="sm" onClick={() => setRequestOpen(true)}>Request re-registration</Button> : null}
            {sides.map((s) => (
              <Button key={s} variant="secondary" size="sm" onClick={() => setRemoveSide(s)}><Trash2 size={14} /> Remove {s} image</Button>
            ))}
            <Button variant="danger" size="sm" onClick={() => setRemoveOpen(true)}><Trash2 size={14} /> Remove all face data</Button>
          </div>
        </div>
      )}
      {requestOpen ? (
        <Modal title="Request re-registration" lead="The employee stays recognisable with the current images until new ones are registered." onClose={() => setRequestOpen(false)}
               footer={<><Button variant="secondary" onClick={() => setRequestOpen(false)}>Cancel</Button>
                 <Button loading={request.isPending} disabled={reason.trim().length < 3}
                         onClick={() => request.mutate(reason.trim(), { onSuccess: () => { toast('success', 'Re-registration was requested.'); setRequestOpen(false) } })}>Request re-registration</Button></>}>
          <div className="stack">
            <Field label="Reason" required htmlFor="rereg-reason" hint="For example: appearance changed significantly, poor-quality original photo.">
              <input id="rereg-reason" className="input" value={reason} maxLength={300} onChange={(ev) => setReason(ev.target.value)} />
            </Field>
            {request.error ? <Alert tone="crit">{errorMessage(request.error, 'The request could not be saved.')}</Alert> : null}
          </div>
        </Modal>
      ) : null}
      {removeSide ? (
        <ConfirmDialog title={`Remove the ${removeSide} image?`} confirmLabel={`Remove ${removeSide} image`} danger loading={removeSideImage.isPending}
                       error={removeSideImage.error ? errorMessage(removeSideImage.error, 'The image could not be removed.') : null}
                       onClose={() => { setRemoveSide(null); removeSideImage.reset() }}
                       onConfirm={() => removeSideImage.mutate(removeSide, { onSuccess: () => { toast('success', `The ${removeSide} image and its embedding were deleted.`); setRemoveSide(null) } })}>
          The {removeSide} image and its embedding are permanently deleted. The employee remains recognisable with the front image.
        </ConfirmDialog>
      ) : null}
      {removeOpen ? (
        <ConfirmDialog title={`Remove all face data of ${e.fullName}?`} confirmLabel="Remove face data" danger loading={remove.isPending}
                       error={remove.error ? errorMessage(remove.error, 'The face data could not be removed.') : null}
                       onClose={() => setRemoveOpen(false)}
                       onConfirm={() => remove.mutate(undefined, { onSuccess: () => { toast('success', 'All face images and embeddings were deleted.'); setRemoveOpen(false) } })}>
          The front, left and right images and their embeddings are permanently deleted. The employee will not be recognised until a new face is registered. Attendance history is kept.
        </ConfirmDialog>
      ) : null}
    </Card>
  )
}
