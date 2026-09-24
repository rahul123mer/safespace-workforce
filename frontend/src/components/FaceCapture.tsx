import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImageUp, RefreshCw } from 'lucide-react'
import { Alert, Button } from './ui'

export interface CapturedImage {
  blob: Blob
  url: string
  width: number
  height: number
  method: 'upload' | 'camera'
  name: string
}

const ACCEPTED = ['image/jpeg', 'image/png']
const MIN_EDGE = 40
const RECOMMENDED_EDGE = 300

function readDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('unreadable'))
    img.src = url
  })
}

function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (!window.isSecureContext) return 'Camera capture needs a secure (HTTPS) connection. Open the application over HTTPS, or upload an image instead.'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow camera access for this site in the browser, or upload an image instead.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this computer. Connect a camera or upload an image instead.'
  if (name === 'NotReadableError') return 'The camera is in use by another application. Close it and try again, or upload an image instead.'
  return 'The camera could not be started. Upload an image instead.'
}

export function FaceCapture({ maxBytes, onCaptured }: { maxBytes: number; onCaptured: (image: CapturedImage) => void }) {
  const [mode, setMode] = useState<'upload' | 'camera'>('upload')
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const acceptFile = useCallback(async (file: File) => {
    setError(null)
    if (!ACCEPTED.includes(file.type)) {
      setError('Unsupported file type. Upload a JPEG or PNG image.')
      return
    }
    if (file.size > maxBytes) {
      setError(`The image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB. Upload a smaller JPEG or PNG image.`)
      return
    }
    const url = URL.createObjectURL(file)
    try {
      const dims = await readDimensions(url)
      if (Math.min(dims.width, dims.height) < MIN_EDGE) {
        URL.revokeObjectURL(url)
        setError(`The image is only ${dims.width}×${dims.height} px. Upload an image at least ${MIN_EDGE} px on each side.`)
        return
      }
      onCaptured({ blob: file, url, ...dims, method: 'upload', name: file.name })
    } catch {
      URL.revokeObjectURL(url)
      setError('The image could not be read. Upload a valid JPEG or PNG file.')
    }
  }, [maxBytes, onCaptured])

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Image source">
        <button type="button" aria-pressed={mode === 'upload'} onClick={() => { setMode('upload'); setError(null) }}><ImageUp size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Upload image</button>
        <button type="button" aria-pressed={mode === 'camera'} onClick={() => { setMode('camera'); setError(null) }}><Camera size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Capture with camera</button>
      </div>
      {mode === 'upload' ? (
        <div
          className={`dropzone${drag ? ' drag' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void acceptFile(f) }}
        >
          <ImageUp size={28} color="#64748b" />
          <strong>Drop a face photo here or click to browse</strong>
          <span>JPEG or PNG, up to {Math.round(maxBytes / (1024 * 1024))} MB. One person, facing the camera, well lit.</span>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void acceptFile(f); e.target.value = '' }} />
        </div>
      ) : (
        <CameraCapture onCaptured={onCaptured} onError={setError} />
      )}
      {error ? <Alert tone="crit">{error}</Alert> : null}
    </div>
  )
}

function CameraCapture({ onCaptured, onError }: { onCaptured: (image: CapturedImage) => void; onError: (m: string | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [state, setState] = useState<'starting' | 'live' | 'failed'>('starting')
  const [attempt, setAttempt] = useState(0)

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    let cancelled = false
    async function start() {
      setState('starting')
      onError(null)
      stop()
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: window.isSecureContext ? 'NotFoundError' : 'SecurityError' })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } } : { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        const all = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'))
        setState('live')
      } catch (err) {
        if (!cancelled) {
          setState('failed')
          onError(cameraErrorMessage(err))
        }
      }
    }
    void start()
    return () => { cancelled = true; stop() }
  }, [deviceId, attempt, onError])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return onError('The frame could not be captured. Try again.')
      stop()
      onCaptured({ blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, method: 'camera', name: 'camera-capture.jpg' })
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="stack">
      <div className="capture-frame">
        <video ref={videoRef} playsInline muted aria-label="Live camera preview" />
        {state === 'live' ? <div className="capture-guide" aria-hidden /> : null}
        <div className="capture-note">{state === 'starting' ? 'Starting camera...' : state === 'live' ? 'Centre the face inside the outline and look straight at the camera.' : 'Camera unavailable'}</div>
      </div>
      <div className="page-actions">
        {devices.length > 1 ? (
          <select className="select" style={{ width: 'auto' }} aria-label="Camera device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Default camera</option>
            {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select>
        ) : null}
        {state === 'failed' ? <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={15} /> Retry camera</Button> : null}
        <Button onClick={capture} disabled={state !== 'live'}><Camera size={15} /> Capture photo</Button>
      </div>
    </div>
  )
}

export { RECOMMENDED_EDGE }
