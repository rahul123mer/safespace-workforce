import { useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Film, Upload, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadWithProgress } from '../api/client'
import { useCameras, useSettings } from '../api/queries'
import type { Footage } from '../api/types'
import { useSession } from '../auth/session'
import { FootageList } from '../components/FootageList'
import { useToast } from '../components/toast'
import { Alert, Button, Card, EmptyState, Field, LoadingState, PageHeading, errorMessage, fieldErrors } from '../components/ui'
import { DIRECTIONS, FOOTAGE_STATUS, formatBytes } from '../utils/format'

const VIDEO_EXT = /\.(mp4|mov|mkv|avi|m4v)$/i

export function FootagePage() {
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const cameraId = params.get('cameraId') ?? ''
  const status = params.get('status') ?? ''
  const cameras = useCameras()
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params)
    if (v) n.set(k, v)
    else n.delete(k)
    setParams(n, { replace: true })
  }

  return (
    <>
      <PageHeading title="Footage Analysis"
                   lead="Recordings exported from entry and exit cameras are analysed by the existing SafeSpace recognition pipeline. Every recognised employee becomes an IN or OUT event." />
      <div className="grid-main" style={{ marginBottom: 16 }}>
        {can('footage.manage') ? <ImportForm defaultCameraId={cameraId} /> : (
          <Alert tone="info">Your role can view analysis results. An administrator imports footage.</Alert>
        )}
        <Card title="Processing pipeline" eyebrow="What happens next">
          <ol className="guidance" style={{ lineHeight: 1.6 }}>
            <li><b>Upload</b>: the file is stored on the server and checked as a video container.</li>
            <li><b>Detect and track</b>: RF-DETR person detection with ByteTrack tracking, exactly as in the existing pipeline.</li>
            <li><b>Recognise</b>: InsightFace buffalo_l faces are matched against the registered faces of active employees.</li>
            <li><b>IN / OUT</b>: each identified employee becomes an IN (entry camera) or OUT (exit camera) event at the time they were seen, using the first-frame time you enter.</li>
            <li><b>Attendance</b>: confirmed events are paired into attendance sessions.</li>
          </ol>
        </Card>
      </div>
      <section className="card table-card">
        <div className="toolbar" style={{ border: 0, borderBottom: '1px solid var(--divider)', borderRadius: 0, margin: 0 }}>
          <strong style={{ fontSize: 15 }}>Analysis history</strong>
          <span className="spacer" />
          <select className="select" aria-label="Camera" value={cameraId} onChange={(e) => set('cameraId', e.target.value)}>
            <option value="">All cameras</option>
            {cameras.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" aria-label="Analysis status" value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(FOOTAGE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <FootageList cameraId={cameraId || undefined} status={status || undefined} />
      </section>
    </>
  )
}

function ImportForm({ defaultCameraId }: { defaultCameraId: string }) {
  const cameras = useCameras()
  const settings = useSettings()
  const { timezone } = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [cameraId, setCameraId] = useState(defaultCameraId)
  const [startedAt, setStartedAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [local, setLocal] = useState<Record<string, string>>({})
  const enabled = (cameras.data?.items ?? []).filter((c) => c.enabled)
  const maxBytes = settings.data?.limits.maxFootageBytes ?? 0
  const errors = { ...fieldErrors(error), ...local }

  const choose = (f: File | undefined) => {
    if (!f) return
    setError(null)
    if (!VIDEO_EXT.test(f.name)) return setLocal({ file: 'Unsupported file type. Import an MP4, MOV, MKV or AVI camera export.' })
    if (maxBytes && f.size > maxBytes) return setLocal({ file: `The file is larger than ${formatBytes(maxBytes)}. Split the export into shorter files.` })
    setLocal({})
    setFile(f)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p: Record<string, string> = {}
    if (!cameraId) p.cameraId = 'Choose the camera that recorded this footage.'
    if (!startedAt) p.captureStartedAt = 'Enter the date and time of the first frame.'
    if (!file) p.file = 'Choose a recording to import.'
    setLocal(p)
    if (Object.keys(p).length || !file) return
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('captureStartedAt', startedAt)
    setError(null)
    setProgress(0)
    try {
      const rec = await uploadWithProgress<Footage>(`/cameras/${cameraId}/footage`, form, setProgress)
      toast('success', `${rec.originalFilename} was imported and queued for analysis.`)
      setFile(null)
      setStartedAt('')
      await qc.invalidateQueries({ queryKey: ['footage'] })
      await qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) {
      setError(err)
    } finally {
      setProgress(null)
    }
  }

  if (cameras.isPending) return <Card><LoadingState compact label="Loading cameras..." /></Card>
  if (!enabled.length) {
    return <Card><EmptyState compact icon={<Film size={26} />} title="No cameras have been configured.">Add and enable an entry or exit camera before importing footage.</EmptyState></Card>
  }
  const uploading = progress !== null
  return (
    <Card title="Import a camera recording" eyebrow="Upload" lead="One export per camera. The first-frame time anchors every event, so enter it exactly as shown on the recording.">
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid two">
          <Field label="Camera" required error={errors.cameraId} htmlFor="fx-camera">
            <select id="fx-camera" className="select" value={cameraId} onChange={(e) => setCameraId(e.target.value)} disabled={uploading}>
              <option value="">Choose a camera</option>
              {enabled.map((c) => <option key={c.id} value={c.id}>{c.name} · {DIRECTIONS[c.direction]}</option>)}
            </select>
          </Field>
          <Field label={`Date and time of first frame (${timezone})`} required error={errors.captureStartedAt} htmlFor="fx-start">
            <input id="fx-start" className="input" type="datetime-local" step={1} value={startedAt} onChange={(e) => setStartedAt(e.target.value)} disabled={uploading} />
          </Field>
        </div>
        {file ? (
          <div className="list-row" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
            <Film size={20} color="#64748b" />
            <div className="grow"><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div>
            {!uploading ? <button type="button" className="icon-btn" aria-label="Remove file" onClick={() => setFile(null)}><X size={16} /></button> : null}
          </div>
        ) : (
          <div className="dropzone" style={{ minHeight: 140 }} role="button" tabIndex={0}
               onClick={() => fileRef.current?.click()}
               onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files[0]) }}>
            <Upload size={24} color="#64748b" />
            <strong>Drop an NVR export or click to browse</strong>
            <span>MP4, MOV, MKV or AVI{maxBytes ? `, up to ${formatBytes(maxBytes)}` : ''}</span>
            <input ref={fileRef} type="file" hidden accept=".mp4,.mov,.mkv,.avi,.m4v,video/*" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        )}
        {errors.file ? <span className="error" style={{ color: 'var(--crit)', fontSize: 12.5 }}>{errors.file}</span> : null}
        {uploading ? (
          <div>
            <div className="bar" aria-label="Upload progress" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${(progress ?? 0) * 100}%`, background: 'var(--blue)' }} />
            </div>
            <span className="cell-sub">Uploading {Math.round((progress ?? 0) * 100)}%...</span>
          </div>
        ) : null}
        {error && !Object.keys(fieldErrors(error)).length ? <Alert tone="crit">{errorMessage(error, 'The footage could not be imported. Please try again.')}</Alert> : null}
        <div className="page-actions" style={{ justifyContent: 'flex-end' }}>
          <Button type="submit" loading={uploading}><Upload size={15} /> Import and analyse</Button>
        </div>
      </form>
    </Card>
  )
}
