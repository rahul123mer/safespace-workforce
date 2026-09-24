import { useState, type FormEvent } from 'react'
import { useSaveShift, type ShiftInput } from '../api/queries'
import type { Shift, ShiftType } from '../api/types'
import { SHIFT_TYPES, WEEKDAYS } from '../utils/format'
import { useToast } from './toast'
import { Alert, Button, Field, Modal, errorMessage, fieldErrors } from './ui'

const TYPE_DEFAULTS: Record<ShiftType, Pick<ShiftInput, 'startTime' | 'endTime'>> = {
  morning: { startTime: '06:00', endTime: '14:00' },
  general: { startTime: '09:00', endTime: '18:00' },
  evening: { startTime: '14:00', endTime: '22:00' },
  night: { startTime: '22:00', endTime: '06:00' },
  custom: { startTime: '', endTime: '' },
}

export function ShiftFormModal({ shift, onClose, onSaved }: { shift?: Shift; onClose: () => void; onSaved?: (s: Shift) => void }) {
  const save = useSaveShift(shift?.id)
  const toast = useToast()
  const [form, setForm] = useState<ShiftInput>(() => shift
    ? { name: shift.name, shiftType: shift.shiftType, startTime: shift.startTime, endTime: shift.endTime, gracePeriodMinutes: shift.gracePeriodMinutes, workingDays: shift.workingDays }
    : { name: '', shiftType: 'general', ...TYPE_DEFAULTS.general, gracePeriodMinutes: 10, workingDays: [1, 2, 3, 4, 5] })
  const [local, setLocal] = useState<Record<string, string>>({})
  const errors = { ...fieldErrors(save.error), ...local }

  const set = <K extends keyof ShiftInput>(key: K, value: ShiftInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const chooseType = (t: ShiftType) => {
    setForm((f) => ({ ...f, shiftType: t, ...(shift || t === 'custom' ? {} : TYPE_DEFAULTS[t]) }))
  }
  const toggleDay = (d: number) => set('workingDays', form.workingDays.includes(d) ? form.workingDays.filter((x) => x !== d) : [...form.workingDays, d].sort())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const problems: Record<string, string> = {}
    if (form.name.trim().length < 2) problems.name = 'Enter a shift name of at least 2 characters.'
    if (!form.startTime) problems.startTime = 'Enter the start time.'
    if (!form.endTime) problems.endTime = 'Enter the end time.'
    if (form.startTime && form.startTime === form.endTime) problems.endTime = 'Start and end times must differ.'
    if (form.gracePeriodMinutes < 0 || form.gracePeriodMinutes > 240) problems.gracePeriodMinutes = 'Enter a grace period between 0 and 240 minutes.'
    if (!form.workingDays.length) problems.workingDays = 'Select at least one working day.'
    setLocal(problems)
    if (Object.keys(problems).length) return
    save.mutate({ ...form, name: form.name.trim() }, {
      onSuccess: (saved) => {
        toast('success', shift ? `Shift ${saved.name} was updated.` : `Shift ${saved.name} was created.`)
        onSaved?.(saved)
        onClose()
      },
    })
  }
  const crossesMidnight = form.startTime && form.endTime && form.endTime <= form.startTime

  return (
    <Modal title={shift ? `Edit ${shift.name}` : 'Create shift'} lead="Shift start and grace period decide when an entry counts as a late arrival." onClose={onClose} wide>
      <form onSubmit={submit} className="stack" noValidate>
        <div className="form-grid">
          <Field label="Shift name" required error={errors.name} htmlFor="shift-name" className="span-2">
            <input id="shift-name" className="input" value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="For example: General Day, Night Security" aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Shift type" required htmlFor="shift-type">
            <select id="shift-type" className="select" value={form.shiftType} onChange={(e) => chooseType(e.target.value as ShiftType)}>
              {Object.entries(SHIFT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Shift start time" required error={errors.startTime} htmlFor="shift-start">
            <input id="shift-start" className="input" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} aria-invalid={Boolean(errors.startTime)} />
          </Field>
          <Field label="Shift end time" required error={errors.endTime} htmlFor="shift-end" hint={crossesMidnight ? 'Ends on the following day.' : undefined}>
            <input id="shift-end" className="input" type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} aria-invalid={Boolean(errors.endTime)} />
          </Field>
          <Field label="Grace period (minutes)" required error={errors.gracePeriodMinutes} htmlFor="shift-grace" hint="Arrivals within this many minutes after the start are on time.">
            <input id="shift-grace" className="input" type="number" min={0} max={240} value={form.gracePeriodMinutes}
                   onChange={(e) => set('gracePeriodMinutes', Number(e.target.value))} aria-invalid={Boolean(errors.gracePeriodMinutes)} />
          </Field>
          <div className="field span-all">
            <span className="label">Working days<span className="req" aria-hidden>*</span></span>
            <div className="day-picker" role="group" aria-label="Working days">
              {WEEKDAYS.map((d) => (
                <button key={d.value} type="button" aria-pressed={form.workingDays.includes(d.value)} onClick={() => toggleDay(d.value)} title={d.long}>{d.short}</button>
              ))}
            </div>
            {errors.workingDays ? <span className="error">{errors.workingDays}</span> : null}
          </div>
        </div>
        {save.error && !Object.keys(fieldErrors(save.error)).length ? <Alert tone="crit">{errorMessage(save.error, 'The shift could not be saved.')}</Alert> : null}
        <div className="modal-foot" style={{ padding: 0 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{shift ? 'Save shift' : 'Create shift'}</Button>
        </div>
      </form>
    </Modal>
  )
}
