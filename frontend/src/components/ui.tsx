import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, Search, X, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'

type Tone = 'good' | 'warn' | 'crit' | 'info' | 'neutral' | 'dark'

export function PageHeading({ title, lead, actions, crumb }: {
  title: string
  lead?: ReactNode
  actions?: ReactNode
  crumb?: { to: string; label: string }
}) {
  useEffect(() => {
    document.title = `${title} · SafeSpace Workforce`
  }, [title])
  return (
    <>
      {crumb ? (
        <Link className="breadcrumb" to={crumb.to}>
          <ChevronLeft size={14} /> {crumb.label}
        </Link>
      ) : null}
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          {lead ? <p>{lead}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </>
  )
}

export function Button({ variant = 'primary', size, loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-solid' | 'ghost'
  size?: 'sm'
  loading?: boolean
}) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${rest.className ?? ''}`} disabled={rest.disabled || loading}>
      {loading ? <Loader2 size={15} className="spin" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function Badge({ tone, children, plain, title }: { tone: Tone; children: ReactNode; plain?: boolean; title?: string }) {
  return <span className={`badge ${tone}${plain ? ' plain' : ''}`} title={title}>{children}</span>
}

export function Stat({ label, value, note, tone, to, icon }: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: 'good' | 'warn' | 'info'
  to?: string
  icon?: ReactNode
}) {
  const body = (
    <>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
      {note ? <em>{note}</em> : null}
    </>
  )
  const cls = `stat${tone ? ` ${tone}` : ''}`
  return to ? <Link className={cls} to={to}>{body}</Link> : <div className={cls}>{body}</div>
}

export function Card({ title, lead, actions, eyebrow, children, className }: {
  title?: ReactNode
  lead?: ReactNode
  actions?: ReactNode
  eyebrow?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {title || actions ? (
        <div className="card-head">
          <div>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            {title ? <h2>{title}</h2> : null}
            {lead ? <p>{lead}</p> : null}
          </div>
          {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function EmptyState({ icon, title, children, action, compact }: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`empty${compact ? ' compact' : ''}`} role="status">
      {icon}
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  )
}

export function LoadingState({ label, compact, page }: { label: string; compact?: boolean; page?: boolean }) {
  return (
    <div className={`loading${compact ? ' compact' : ''}${page ? ' page-loading' : ''}`} role="status" aria-live="polite">
      <span className="ring" aria-hidden /> {label}
    </div>
  )
}

export function ErrorState({ error, message, onRetry }: { error?: unknown; message: string; onRetry?: () => void }) {
  const detail = error instanceof ApiError && error.status !== 0 && error.status < 500 ? error.message : null
  return (
    <div className="alert crit" role="alert">
      <XCircle size={18} />
      <div>
        <strong>{message}</strong>
        {detail && detail !== message ? <p>{detail}</p> : null}
      </div>
      {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : null}
    </div>
  )
}

export function Alert({ tone, title, children, action }: { tone: 'crit' | 'warn' | 'info' | 'good'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle
  return (
    <div className={`alert ${tone}`} role={tone === 'crit' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <p>{children}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Field({ label, required, hint, error, children, className, htmlFor }: {
  label: string
  required?: boolean
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={htmlFor}>{label}{required ? <span className="req" aria-hidden>*</span> : null}</label>
      {children}
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const id = useId()
  return (
    <div className="search">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search size={15} />
      <input id={id} className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage, noun }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="pagination">
      <span>Showing {from}–{to} of {total} {noun}</span>
      <div className="pages">
        <button className="icon-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
        <span>Page {page} of {pages}</span>
        <button className="icon-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

export function Modal({ title, lead, onClose, children, footer, wide }: {
  title: string
  lead?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {lead ? <p>{lead}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, children, confirmLabel, danger, loading, error, onConfirm, onClose }: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  loading?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="stack">
        <div style={{ fontSize: 13.5, color: 'var(--ink-700)', lineHeight: 1.55 }}>{children}</div>
        {error ? <Alert tone="crit">{error}</Alert> : null}
      </div>
    </Modal>
  )
}

export function Avatar({ name, src, large }: { name: string; src?: string | null; large?: boolean }) {
  const text = name.trim().split(/\s+/).map((p) => p[0]).filter(Boolean)
  const letters = ((text[0] ?? '') + (text.length > 1 ? text[text.length - 1] : '')).toUpperCase()
  return (
    <span className={`avatar${large ? ' lg' : ''}`} aria-hidden>
      {src ? <img src={src} alt="" /> : letters}
    </span>
  )
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  return fallback
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {}
}
