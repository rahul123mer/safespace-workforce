import { useState, type FormEvent } from 'react'
import { useSaveCamera, type CameraInput } from '../api/queries'
import type { Camera, CameraDirection, CameraType } from '../api/types'
import { CAMERA_TYPES, DIRECTIONS } from '../utils/format'
import { useToast } from './toast'
import { Alert, Button, Field, Modal, errorMessage, fieldErrors } from './ui'

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
const SOURCE_RE = /^(rtsp|rtsps|http|https):\/\//i

export function CameraFormModal({ camera, onClose, onSaved }: { camera?: Camera; onClose: () => void; onSaved?: (c: Camera) => void }) {
  const save = useSaveCamera(camera?.id)
  const toast = useToast()
  const [form, setForm] = useState<CameraInput>(() => camera
    ? { cameraCode: camera.cameraCode, name: camera.name, location: camera.location, cameraType: camera.cameraType, direction: camera.direction, sourceUrl: '' }
    : { cameraCode: '', name: '', location: '', cameraType: 'dome', direction: 'entry', sourceUrl: '' })
  const [replaceSource, setReplaceSource] = useState(!camera)
  const [local, setLocal] = useState<Record<string, string>>({})
  const errors = { ...fieldErrors(save.error), ...local }
  const set = <K extends keyof CameraInput>(k: K, v: CameraInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const p: Record<string, string> = {}
    if (!CODE_RE.test(form.cameraCode.trim())) p.cameraCode = 'Enter a Camera ID using letters, numbers, dots, slashes or hyphens.'
    if (form.name.trim().length < 2) p.name = 'Enter the camera name.'
    if (form.location.trim().length < 2) p.location = 'Enter where the camera is installed.'
    if (replaceSource && form.sourceUrl && !SOURCE_RE.test(form.sourceUrl.trim())) p.sourceUrl = 'Enter a stream address starting with rtsp://, rtsps://, http:// or https://.'
    setLocal(p)
    if (Object.keys(p).length) return
    const body: CameraInput = {
      ...form, cameraCode: form.cameraCode.trim(), name: form.name.trim(), location: form.location.trim(),
      sourceUrl: replaceSource ? (form.sourceUrl?.trim() || null) : null,
      ...(camera ? { replaceSource } : {}),
    }
    save.mutate(body, {
      onSuccess: (c) => {
        toast('success', camera ? `Camera ${c.name} was updated.` : `Camera ${c.name} was added.`)
        onSaved?.(c)
        onClose()
      },
    })
  }

  return (
    <Modal title={camera ? `Edit ${camera.name}` : 'Add camera'} lead="Direction decides whether a recognised employee is recorded as entering (IN) or leaving (OUT)." onClose={onClose} wide>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Camera ID" required error={errors.cameraCode} htmlFor="cam-code" hint="The identifier used on site or in the NVR, for example CAM-ENT-01.">
            <input id="cam-code" className="input" value={form.cameraCode} maxLength={40} onChange={(e) => set('cameraCode', e.target.value)} aria-invalid={Boolean(errors.cameraCode)} />
          </Field>
          <Field label="Camera name" required error={errors.name} htmlFor="cam-name" className="span-2">
            <input id="cam-name" className="input" value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="For example: Main Entrance Camera" aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Location" required error={errors.location} htmlFor="cam-location" className="span-2">
            <input id="cam-location" className="input" value={form.location} maxLength={160} onChange={(e) => set('location', e.target.value)} placeholder="For example: Ground floor, main lobby turnstiles" aria-invalid={Boolean(errors.location)} />
          </Field>
          <Field label="Camera type" required htmlFor="cam-type">
            <select id="cam-type" className="select" value={form.cameraType} onChange={(e) => set('cameraType', e.target.value as CameraType)}>
              {Object.entries(CAMERA_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Direction" required error={errors.direction} htmlFor="cam-direction"
                 hint={form.direction === 'entry_exit' ? 'IN or OUT is decided from the employee’s last confirmed event.' : undefined}>
            <select id="cam-direction" className="select" value={form.direction} onChange={(e) => set('direction', e.target.value as CameraDirection)}>
              {Object.entries(DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div className="field span-2">
            <label htmlFor="cam-source">Stream / source address</label>
            {camera && !replaceSource ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="chip" style={{ height: 38, padding: '0 12px' }}>{camera.sourceDisplay ?? 'No stream address configured'}</span>
                <Button variant="secondary" size="sm" onClick={() => setReplaceSource(true)}>{camera.sourceConfigured ? 'Replace address' : 'Add address'}</Button>
              </div>
            ) : (
              <input id="cam-source" className="input" value={form.sourceUrl ?? ''} maxLength={1000} onChange={(e) => set('sourceUrl', e.target.value)}
                     placeholder="rtsp://username:password@10.0.4.21:554/stream1" autoComplete="off" aria-invalid={Boolean(errors.sourceUrl)} />
            )}
            {errors.sourceUrl ? <span className="error">{errors.sourceUrl}</span> : (
              <span className="hint">RTSP or HTTP address of the camera or NVR channel. Credentials are visible to administrators only. Leave empty if footage is only imported as files.</span>
            )}
          </div>
        </div>
        {save.error && !Object.keys(fieldErrors(save.error)).length ? <Alert tone="crit">{errorMessage(save.error, 'The camera configuration could not be saved.')}</Alert> : null}
        {save.error && fieldErrors(save.error).direction ? <Alert tone="crit">{errorMessage(save.error, '')}</Alert> : null}
        <div className="modal-foot" style={{ padding: 0 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{save.isPending ? 'Saving camera configuration...' : camera ? 'Save camera' : 'Add camera'}</Button>
        </div>
      </form>
    </Modal>
  )
}
