import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, KeyRound, Plus, UserCog, XCircle } from 'lucide-react'
import { useCreateUser, useResetPassword, useSaveRules, useSettings, useUpdateUser, useUsers } from '../api/queries'
import type { PipelineStatus, Rules, User } from '../api/types'
import { useSession } from '../auth/session'
import { useToast } from '../components/toast'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeading, errorMessage, fieldErrors } from '../components/ui'
import { formatDateTime } from '../utils/format'

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
})()

export function SettingsPage() {
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const tabs = [
    { id: 'attendance', label: 'Attendance Rules' },
    { id: 'registration', label: 'Face Registration' },
    ...(can('settings.manage') ? [{ id: 'pipeline', label: 'Recognition Pipeline' }] : []),
    ...(can('users.manage') ? [{ id: 'users', label: 'Users & Access' }] : []),
  ]
  const tab = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'attendance'
  const settings = useSettings()

  return (
    <>
      <PageHeading title="Settings" lead="Rules that turn recognition results into attendance, face registration requirements, the recognition pipeline in use, and who can access this system." />
      <div className="tabs" role="tablist">
        {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setParams({ tab: t.id }, { replace: true })}>{t.label}</button>)}
      </div>
      {tab === 'users' ? <UsersPanel /> : settings.isPending ? <LoadingState label="Loading settings..." /> : settings.error ? (
        <ErrorState error={settings.error} message="The settings could not be loaded. Please try again." onRetry={() => settings.refetch()} />
      ) : tab === 'pipeline' ? (
        <PipelinePanel pipeline={settings.data.pipeline} />
      ) : (
        <RulesPanel rules={settings.data.rules} canEdit={settings.data.canEdit} section={tab as 'attendance' | 'registration'} />
      )}
    </>
  )
}

function RulesPanel({ rules, canEdit, section }: { rules: Rules; canEdit: boolean; section: 'attendance' | 'registration' }) {
  const [draft, setDraft] = useState<Rules>(rules)
  const save = useSaveRules()
  const toast = useToast()
  useEffect(() => setDraft(rules), [rules])
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules)
  const errors = fieldErrors(save.error)
  const setA = <K extends keyof Rules['attendance']>(k: K, v: Rules['attendance'][K]) => setDraft((d) => ({ ...d, attendance: { ...d.attendance, [k]: v } }))
  const setR = <K extends keyof Rules['registration']>(k: K, v: Rules['registration'][K]) => setDraft((d) => ({ ...d, registration: { ...d.registration, [k]: v } }))
  const a = draft.attendance
  const r = draft.registration

  return (
    <form className="card form-card" onSubmit={(e) => { e.preventDefault(); save.mutate(draft, { onSuccess: () => toast('success', 'Settings were saved. They apply to footage analysed from now on.') }) }}>
      {section === 'attendance' ? (
        <>
          <div className="form-section">
            <h3>Site</h3>
            <p>All dates and times in this application, and the capture times of imported footage, use this time zone.</p>
            <div className="form-grid">
              <Field label="Site time zone" required error={errors.siteTimezone} htmlFor="set-tz">
                {TIMEZONES.length ? (
                  <select id="set-tz" className="select" value={draft.siteTimezone} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, siteTimezone: e.target.value })}>
                    {!TIMEZONES.includes(draft.siteTimezone) ? <option value={draft.siteTimezone}>{draft.siteTimezone}</option> : null}
                    {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                ) : (
                  <input id="set-tz" className="input" value={draft.siteTimezone} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, siteTimezone: e.target.value })} />
                )}
              </Field>
            </div>
          </div>
          <div className="form-section">
            <h3>Entry and exit detection</h3>
            <p>Which cameras record IN and OUT is set once, per camera, under <Link to="/cameras">Camera Configuration</Link>, and applies to every employee. An employee recognised on an entry camera is recorded IN at the moment first seen; on an exit camera, OUT at the moment last seen. On an Entry & Exit camera the direction follows the employee’s last confirmed event.</p>
            <div className="stack">
              <Field label="Uncertain identities" htmlFor="set-review" hint="How pipeline decisions in the review band (similar to a registered face but not certain) are handled.">
                <select id="set-review" className="select" style={{ maxWidth: 420 }} value={a.reviewDecisionHandling} disabled={!canEdit}
                        onChange={(e) => setA('reviewDecisionHandling', e.target.value as Rules['attendance']['reviewDecisionHandling'])}>
                  <option value="queue_for_review">Record as “Needs Review” for a person to confirm</option>
                  <option value="ignore">Ignore; only certain identities create events</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="form-section">
            <h3>Duplicate events and sessions</h3>
            <p>Several sightings of the same person at an entrance produce one event.</p>
            <div className="form-grid">
              <Field label="Minimum event interval (minutes)" required error={errors['attendance.minEventIntervalMinutes']} htmlFor="set-interval"
                     hint="A second IN (or OUT) of the same employee within this interval is recorded as a duplicate.">
                <input id="set-interval" className="input" type="number" min={0} max={240} value={a.minEventIntervalMinutes} disabled={!canEdit}
                       onChange={(e) => setA('minEventIntervalMinutes', Number(e.target.value))} />
              </Field>
              <Field label="Maximum session length (hours)" required error={errors['attendance.maxSessionHours']} htmlFor="set-session"
                     hint="An OUT more than this long after the IN starts a new session instead of closing the open one.">
                <input id="set-session" className="input" type="number" min={1} max={36} value={a.maxSessionHours} disabled={!canEdit}
                       onChange={(e) => setA('maxSessionHours', Number(e.target.value))} />
              </Field>
            </div>
          </div>
        </>
      ) : (
        <div className="form-section">
          <h3>Face registration requirements</h3>
          <p>Applied after the recognition pipeline has accepted an image (one face, detection score at or above the pipeline’s minimum).</p>
          <div className="form-grid">
            <Field label="Minimum face size (pixels)" required error={errors['registration.minFaceSizePx']} htmlFor="set-face"
                   hint="The shorter side of the detected face. Larger faces give more reliable embeddings.">
              <input id="set-face" className="input" type="number" min={40} max={1000} value={r.minFaceSizePx} disabled={!canEdit}
                     onChange={(e) => setR('minFaceSizePx', Number(e.target.value))} />
            </Field>
            <Field label="Duplicate face threshold" required error={errors['registration.duplicateSimilarityThreshold']} htmlFor="set-dup"
                   hint="A new face this similar (cosine) to another employee’s registered face is refused. The pipeline’s own unknown-merge threshold is 0.55.">
              <input id="set-dup" className="input" type="number" min={0.3} max={0.95} step={0.01} value={r.duplicateSimilarityThreshold} disabled={!canEdit}
                     onChange={(e) => setR('duplicateSimilarityThreshold', Number(e.target.value))} />
            </Field>
            <Field label="Side image match to front" required error={errors['registration.sideMatchMinSimilarity']} htmlFor="set-side"
                   hint="A left or right image must be at least this similar (cosine) to the employee’s own front image, so a different person cannot be added as a side image.">
              <input id="set-side" className="input" type="number" min={0} max={0.9} step={0.01} value={r.sideMatchMinSimilarity} disabled={!canEdit}
                     onChange={(e) => setR('sideMatchMinSimilarity', Number(e.target.value))} />
            </Field>
            <div className="field" style={{ justifyContent: 'center' }}>
              <label className="check">
                <input type="checkbox" checked={r.requireFrontalFace} disabled={!canEdit} onChange={(e) => setR('requireFrontalFace', e.target.checked)} />
                <span><b>Require a frontal face for the front image.</b> Front images the pipeline classifies as turned are refused. Left and right images must always be turned.</span>
              </label>
            </div>
          </div>
        </div>
      )}
      {save.error && !Object.keys(errors).length ? <div className="form-section"><Alert tone="crit">{errorMessage(save.error, 'The settings could not be saved.')}</Alert></div> : null}
      {canEdit ? (
        <div className="form-footer">
          <Button variant="secondary" disabled={!dirty} onClick={() => { setDraft(rules); save.reset() }}>Discard changes</Button>
          <Button type="submit" disabled={!dirty} loading={save.isPending}>Save settings</Button>
        </div>
      ) : (
        <div className="form-footer"><span className="cell-sub">Only administrators can change these settings.</span></div>
      )}
    </form>
  )
}

function PipelinePanel({ pipeline }: { pipeline?: PipelineStatus }) {
  if (!pipeline) return null
  const profile = pipeline.thresholdProfile
  return (
    <div className="stack">
      {pipeline.available ? (
        <Alert tone="good" title="The recognition pipeline is configured">Face registration and footage analysis run through the existing SafeSpace recognition pipeline on the recognition worker.</Alert>
      ) : (
        <Alert tone="crit" title="The recognition pipeline is not available">
          {pipeline.problems.join(' ')} Face registration and footage analysis will fail until this is resolved on the server (see README, “Existing pipeline integration”).
        </Alert>
      )}
      <div className="grid-2">
        <Card title="Pipeline" eyebrow="Existing recognition pipeline" lead="Read-only. The pipeline and its models are managed in the existing compute environment and are not changed by this application.">
          <dl className="facts">
            <div style={{ gridColumn: '1 / -1' }}><dt>Compute package</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{pipeline.computeRoot ?? 'Not configured'}</dd></div>
            <div><dt>Person detection</dt><dd>{pipeline.personDetector}</dd></div>
            <div><dt>Tracking</dt><dd>{pipeline.tracker}</dd></div>
            <div><dt>Inference device</dt><dd>{pipeline.allowCpuInference ? 'GPU, CPU fallback allowed' : 'GPU required'}</dd></div>
            <div style={{ gridColumn: '1 / -1' }}><dt>Model fingerprint</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{pipeline.modelFingerprint ?? 'Unavailable'}</dd></div>
          </dl>
        </Card>
        <Card title="Face models" eyebrow="InsightFace buffalo_l" lead="A change of these files marks existing registrations as requiring re-registration.">
          <div className="list">
            {pipeline.faceModels.map((m) => (
              <div className="list-row" key={m.role}>
                {m.present ? <CheckCircle2 size={18} color="var(--good)" /> : <XCircle size={18} color="var(--crit)" />}
                <div className="grow"><strong>{m.name}</strong><span className="mono">{m.sha256 ? `sha256 ${m.sha256.slice(0, 16)}…` : 'File not found'}</span></div>
                <Badge tone="neutral" plain>{m.role === 'face_detector' ? 'Detector' : 'Embedder'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Identity thresholds" eyebrow={profile ? String(profile.name) : 'Threshold profile'} lead="Applied by the pipeline when it matches faces against registered employees.">
        {profile ? (
          <dl className="facts">
            <div><dt>Automatic match (per frame)</dt><dd>≥ {profile.frameAutoMin}</dd></div>
            <div><dt>Review band (per frame)</dt><dd>≥ {profile.frameReviewMin}</dd></div>
            <div><dt>Near-tie margin</dt><dd>{profile.nearTieMargin}</dd></div>
            <div><dt>Pooled match</dt><dd>≥ {profile.pooledMin}</dd></div>
            <div><dt>Minimum frames for pooling</dt><dd>{profile.minFramesForPooling}</dd></div>
            <div><dt>Minimum face detection score</dt><dd>{profile.minFaceDetScore}</dd></div>
          </dl>
        ) : <EmptyState compact title="The threshold profile could not be read from the pipeline" />}
      </Card>
    </div>
  )
}

function UsersPanel() {
  const { session } = useSession()
  const users = useUsers()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const { timezone } = useSession()
  if (users.isPending) return <LoadingState label="Loading user accounts..." />
  if (users.error) return <ErrorState error={users.error} message="The user accounts could not be loaded. Please try again." onRetry={() => users.refetch()} />
  return (
    <>
      <Card title="User accounts" lead="People who can sign in. Administrators manage everything; HR Managers manage employees, faces and shifts and review events; Attendance Viewers can only view (without face images)."
            actions={<Button onClick={() => setCreating(true)}><Plus size={15} /> Add user</Button>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th className="col-md">Email</th><th>Role</th><th className="col-lg">Last sign-in</th><th>Status</th><th className="actions"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {users.data.items.map((u) => (
                <tr key={u.id}>
                  <td><span className="cell-strong">{u.fullName}</span>{u.id === session?.user.id ? <span className="cell-sub">You</span> : null}</td>
                  <td className="col-md">{u.email}</td>
                  <td>{u.roleLabel}</td>
                  <td className="col-lg">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, timezone) : <span className="cell-muted">Never</span>}</td>
                  <td><Badge tone={u.isActive ? 'good' : 'neutral'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge></td>
                  <td className="actions">
                    <div className="row-actions">
                      <button className="icon-btn" title="Edit account" aria-label={`Edit ${u.fullName}`} onClick={() => setEditing(u)}><UserCog size={16} /></button>
                      <button className="icon-btn" title="Reset password" aria-label={`Reset password of ${u.fullName}`} onClick={() => setResetting(u)}><KeyRound size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {creating ? <UserModal roles={users.data.roles} onClose={() => setCreating(false)} /> : null}
      {editing ? <UserModal roles={users.data.roles} user={editing} onClose={() => setEditing(null)} /> : null}
      {resetting ? <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} /> : null}
    </>
  )
}

function UserModal({ user, roles, onClose }: { user?: User; roles: { value: string; label: string }[]; onClose: () => void }) {
  const create = useCreateUser()
  const update = useUpdateUser()
  const toast = useToast()
  const [form, setForm] = useState({ email: user?.email ?? '', fullName: user?.fullName ?? '', role: user?.role ?? 'viewer', password: '', isActive: user?.isActive ?? true })
  const mutation = user ? update : create
  const errors = fieldErrors(mutation.error)
  const submit = () => {
    if (user) {
      update.mutate({ id: user.id, fullName: form.fullName, role: form.role, isActive: form.isActive }, { onSuccess: () => { toast('success', `${form.fullName}'s account was updated.`); onClose() } })
    } else {
      create.mutate({ email: form.email, fullName: form.fullName, role: form.role, password: form.password }, { onSuccess: () => { toast('success', `Account created for ${form.fullName}.`); onClose() } })
    }
  }
  const roleHelp = useMemo(() => ({
    administrator: 'Full access, including cameras, footage, settings and user accounts.',
    hr_manager: 'Manages employees, face registration, shifts and event review.',
    viewer: 'Views employees, cameras, activity and attendance. Cannot see face images.',
  } as Record<string, string>), [])
  return (
    <Modal title={user ? `Edit ${user.fullName}` : 'Add user'} onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={mutation.isPending} onClick={submit}>{user ? 'Save account' : 'Create account'}</Button></>}>
      <div className="stack">
        {!user ? (
          <Field label="Email" required error={errors.email} htmlFor="usr-email">
            <input id="usr-email" className="input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        ) : null}
        <Field label="Full name" required error={errors.fullName} htmlFor="usr-name">
          <input id="usr-name" className="input" value={form.fullName} maxLength={120} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="Role" required error={errors.role} htmlFor="usr-role" hint={roleHelp[form.role]}>
          <select id="usr-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}>
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
        {!user ? (
          <Field label="Initial password" required error={errors.password} htmlFor="usr-pw" hint="At least 12 characters with a letter and a number. Share it securely; the user can change it after signing in.">
            <input id="usr-pw" className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        ) : (
          <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Account active (deactivating signs the user out everywhere)</label>
        )}
        {mutation.error && !Object.keys(errors).length ? <Alert tone="crit">{errorMessage(mutation.error, 'The account could not be saved.')}</Alert> : null}
      </div>
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const reset = useResetPassword()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const errors = fieldErrors(reset.error)
  return (
    <Modal title={`Reset password of ${user.fullName}`} lead="The user is signed out everywhere and must use the new password." onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
             <Button loading={reset.isPending} onClick={() => reset.mutate({ id: user.id, newPassword: password }, { onSuccess: () => { toast('success', `Password of ${user.fullName} was reset.`); onClose() } })}>Reset password</Button></>}>
      <div className="stack">
        <Field label="New password" required error={errors.newPassword} htmlFor="reset-pw" hint="At least 12 characters with a letter and a number.">
          <input id="reset-pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {reset.error && !Object.keys(errors).length ? <Alert tone="crit">{errorMessage(reset.error, 'The password could not be reset.')}</Alert> : null}
      </div>
    </Modal>
  )
}
