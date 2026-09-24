import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useDirectory, useEmployee, useSaveEmployee, useShifts, type EmployeeInput } from '../api/queries'
import type { EmploymentType, Shift } from '../api/types'
import { ShiftFormModal } from '../components/ShiftFormModal'
import { useToast } from '../components/toast'
import { Alert, Button, ErrorState, Field, LoadingState, PageHeading, errorMessage, fieldErrors } from '../components/ui'
import { EMPLOYMENT_TYPES, formatClock, workingDaysLabel } from '../utils/format'

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/

const EMPTY: EmployeeInput = {
  employeeCode: '', fullName: '', email: '', phone: '', department: '', designation: '',
  employmentType: 'full_time', joiningDate: '', status: 'active', shiftId: null,
}

function validate(f: EmployeeInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.employeeCode.trim()) e.employeeCode = 'Enter the Employee ID.'
  else if (!CODE_RE.test(f.employeeCode.trim())) e.employeeCode = 'Use letters, numbers, dots, slashes or hyphens, starting with a letter or number.'
  if (f.fullName.trim().length < 2) e.fullName = 'Enter the full name.'
  if (f.email && !EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address.'
  if (f.phone && !PHONE_RE.test(f.phone.trim())) e.phone = 'Enter a phone number with 7 to 20 digits, optionally starting with +.'
  if (f.department.trim().length < 2) e.department = 'Enter the department.'
  if (f.designation.trim().length < 2) e.designation = 'Enter the designation.'
  if (!f.joiningDate) e.joiningDate = 'Enter the joining date.'
  return e
}

export function EmployeeFormPage() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const existing = useEmployee(id)
  const shifts = useShifts()
  const directory = useDirectory()
  const save = useSaveEmployee(id)
  const [form, setForm] = useState<EmployeeInput>(EMPTY)
  const [local, setLocal] = useState<Record<string, string>>({})
  const [creatingShift, setCreatingShift] = useState(false)
  const [loaded, setLoaded] = useState(!editing)

  useEffect(() => {
    if (editing && existing.data && !loaded) {
      const e = existing.data
      setForm({ employeeCode: e.employeeCode, fullName: e.fullName, email: e.email ?? '', phone: e.phone ?? '', department: e.department,
                designation: e.designation, employmentType: e.employmentType, joiningDate: e.joiningDate, status: e.status, shiftId: e.shift?.id ?? null })
      setLoaded(true)
    }
  }, [editing, existing.data, loaded])

  if (editing && existing.isPending) return <><PageHeading title="Edit employee" crumb={{ to: '/employees', label: 'Employees' }} /><LoadingState label="Loading employee details..." /></>
  if (editing && existing.error) {
    return (
      <>
        <PageHeading title="Edit employee" crumb={{ to: '/employees', label: 'Employees' }} />
        <ErrorState error={existing.error} message="The employee information could not be loaded. Please try again." onRetry={() => existing.refetch()} />
      </>
    )
  }

  const serverErrors = fieldErrors(save.error)
  const errors = { ...serverErrors, ...local }
  const set = <K extends keyof EmployeeInput>(key: K, value: EmployeeInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (local[key]) setLocal(({ [key]: _, ...rest }) => rest)
  }
  const selectableShifts = (shifts.data?.items ?? []).filter((s) => s.status === 'active' || s.id === form.shiftId)
  const selectedShift: Shift | undefined = shifts.data?.items.find((s) => s.id === form.shiftId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const problems = validate(form)
    setLocal(problems)
    if (Object.keys(problems).length) {
      document.getElementById(`emp-${Object.keys(problems)[0]}`)?.focus()
      return
    }
    const body: EmployeeInput = {
      ...form,
      employeeCode: form.employeeCode.trim(), fullName: form.fullName.trim(), department: form.department.trim(),
      designation: form.designation.trim(), email: form.email?.trim() || null, phone: form.phone?.trim() || null,
    }
    save.mutate(body, {
      onSuccess: (saved) => {
        toast('success', editing ? `${saved.fullName}'s details were saved.` : `${saved.fullName} was registered. Register their face next.`)
        navigate(`/employees/${saved.id}`)
      },
    })
  }

  const input = (key: keyof EmployeeInput, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`emp-${key}`} className="input" value={(form[key] as string) ?? ''} onChange={(e) => set(key, e.target.value as never)}
           aria-invalid={Boolean(errors[key])} {...props} />
  )

  return (
    <>
      <PageHeading
        title={editing ? `Edit ${existing.data?.fullName}` : 'Add employee'}
        lead={editing ? 'Update the employee record. Changes are recorded in the configuration history.' : 'Register the employee first, then register their face. Every enabled camera recognises employees with a registered face.'}
        crumb={editing ? { to: `/employees/${id}`, label: existing.data?.fullName ?? 'Employee' } : { to: '/employees', label: 'Employees' }}
      />
      <form className="card form-card" onSubmit={submit} noValidate>
        <div className="form-section">
          <h3>Employee information</h3>
          <p>Identity and employment details. Fields marked * are required.</p>
          <div className="form-grid">
            <Field label="Employee ID" required error={errors.employeeCode} htmlFor="emp-employeeCode" hint="Your HR or payroll identifier, for example SSG-1042.">
              {input('employeeCode', { maxLength: 40, autoComplete: 'off' })}
            </Field>
            <Field label="Full name" required error={errors.fullName} htmlFor="emp-fullName" className="span-2">
              {input('fullName', { maxLength: 120, autoComplete: 'off' })}
            </Field>
            <Field label="Email" error={errors.email} htmlFor="emp-email">
              {input('email', { type: 'email', maxLength: 254, autoComplete: 'off' })}
            </Field>
            <Field label="Phone number" error={errors.phone} htmlFor="emp-phone">
              {input('phone', { type: 'tel', maxLength: 32, autoComplete: 'off' })}
            </Field>
            <Field label="Employment type" required htmlFor="emp-employmentType" error={errors.employmentType}>
              <select id="emp-employmentType" className="select" value={form.employmentType} onChange={(e) => set('employmentType', e.target.value as EmploymentType)}>
                {Object.entries(EMPLOYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Department" required error={errors.department} htmlFor="emp-department">
              {input('department', { maxLength: 80, list: 'department-options', autoComplete: 'off' })}
            </Field>
            <Field label="Designation" required error={errors.designation} htmlFor="emp-designation">
              {input('designation', { maxLength: 80, list: 'designation-options', autoComplete: 'off' })}
            </Field>
            <Field label="Joining date" required error={errors.joiningDate} htmlFor="emp-joiningDate">
              {input('joiningDate', { type: 'date' })}
            </Field>
            {!editing ? (
              <Field label="Employee status" required htmlFor="emp-status" hint="Inactive employees are kept but not recognised.">
                <select id="emp-status" className="select" value={form.status} onChange={(e) => set('status', e.target.value as 'active' | 'inactive')}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            ) : null}
          </div>
          <datalist id="department-options">{directory.data?.departments.map((d) => <option key={d} value={d} />)}</datalist>
          <datalist id="designation-options">{directory.data?.designations.map((d) => <option key={d} value={d} />)}</datalist>
        </div>

        <div className="form-section">
          <h3>Shift information</h3>
          <p>The shift sets the expected start time, grace period and working days used to evaluate late arrivals.</p>
          <div className="form-grid">
            <Field label="Shift" htmlFor="emp-shiftId" error={errors.shiftId} hint={shifts.data && !shifts.data.items.length ? 'No shifts exist yet. Create one here.' : undefined}>
              <select id="emp-shiftId" className="select" value={form.shiftId ?? ''} onChange={(e) => set('shiftId', e.target.value || null)} disabled={shifts.isPending}>
                <option value="">No shift assigned</option>
                {selectableShifts.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'inactive' ? ' (inactive)' : ''}</option>)}
              </select>
            </Field>
            <div className="field" style={{ justifyContent: 'flex-end', alignItems: 'flex-start' }}>
              <Button variant="secondary" onClick={() => setCreatingShift(true)}><Plus size={15} /> Create new shift</Button>
            </div>
          </div>
          {selectedShift ? (
            <dl className="facts" style={{ marginTop: 16 }}>
              <div><dt>Shift name</dt><dd>{selectedShift.name}</dd></div>
              <div><dt>Shift start time</dt><dd>{formatClock(selectedShift.startTime)}</dd></div>
              <div><dt>Shift end time</dt><dd>{formatClock(selectedShift.endTime)}{selectedShift.crossesMidnight ? ' (next day)' : ''}</dd></div>
              <div><dt>Grace period</dt><dd>{selectedShift.gracePeriodMinutes} minutes</dd></div>
              <div><dt>Working days</dt><dd>{workingDaysLabel(selectedShift.workingDays)}</dd></div>
            </dl>
          ) : null}
        </div>

        {save.error && !Object.keys(serverErrors).length ? (
          <div className="form-section"><Alert tone="crit">{errorMessage(save.error, 'The employee could not be saved. Please try again.')}</Alert></div>
        ) : save.error ? (
          <div className="form-section"><Alert tone="crit">{errorMessage(save.error, '')}</Alert></div>
        ) : null}

        <div className="form-footer">
          <Button variant="secondary" onClick={() => navigate(editing ? `/employees/${id}` : '/employees')}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Register employee'}</Button>
        </div>
      </form>
      {creatingShift ? <ShiftFormModal onClose={() => setCreatingShift(false)} onSaved={(s) => set('shiftId', s.id)} /> : null}
    </>
  )
}
