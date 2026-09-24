import { useState, type FormEvent } from 'react'
import { useChangePassword } from '../auth/session'
import { useToast } from './toast'
import { Alert, Button, Field, Modal, errorMessage, fieldErrors } from './ui'

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const change = useChangePassword()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const errors = fieldErrors(change.error)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (next !== repeat) return setMismatch(true)
    setMismatch(false)
    change.mutate({ currentPassword: current, newPassword: next }, {
      onSuccess: () => {
        toast('success', 'Your password was changed. Other signed-in sessions were ended.')
        onClose()
      },
    })
  }

  return (
    <Modal title="Change password" lead="Use at least 12 characters, including a letter and a number." onClose={onClose}>
      <form className="stack" onSubmit={submit} id="password-form">
        <Field label="Current password" required error={errors.currentPassword} htmlFor="pw-current">
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" required error={errors.newPassword} htmlFor="pw-new">
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Repeat new password" required error={mismatch ? 'The new passwords do not match.' : undefined} htmlFor="pw-repeat">
          <input id="pw-repeat" className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
        {change.error && !Object.keys(errors).length ? <Alert tone="crit">{errorMessage(change.error, 'The password could not be changed.')}</Alert> : null}
        <div className="modal-foot" style={{ padding: 0 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={change.isPending}>Change password</Button>
        </div>
      </form>
    </Modal>
  )
}
