import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock3, Pencil, Plus, Power, UserPlus } from 'lucide-react'
import { useAssignShift, useEmployeeOptions, useSetShiftStatus, useShifts } from '../api/queries'
import type { Shift } from '../api/types'
import { useSession } from '../auth/session'
import { ShiftFormModal } from '../components/ShiftFormModal'
import { useToast } from '../components/toast'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, PageHeading, SearchInput, errorMessage } from '../components/ui'
import { SHIFT_TYPES, formatClock, workingDaysLabel } from '../utils/format'

export function ShiftsPage() {
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const { data, isPending, error, refetch } = useShifts()
  const [editing, setEditing] = useState<Shift | null>(null)
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [toggling, setToggling] = useState<Shift | null>(null)
  const [assigning, setAssigning] = useState<Shift | null>(null)
  const setStatus = useSetShiftStatus()
  const toast = useToast()
  const manage = can('shifts.manage')

  return (
    <>
      <PageHeading
        title="Shifts"
        lead="Working schedules. A shift's start time and grace period decide whether an entry is a late arrival; night shifts that end the next day are supported."
        actions={manage ? <Button onClick={() => setCreating(true)}><Plus size={16} /> Create shift</Button> : null}
      />
      {error ? <ErrorState error={error} message="The shifts could not be loaded. Please try again." onRetry={() => refetch()} /> : (
        <section className="card table-card">
          {isPending ? <LoadingState label="Loading shifts..." /> : data.items.length === 0 ? (
            <EmptyState icon={<Clock3 size={30} />} title="No shifts have been configured."
                        action={manage ? <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} /> Create shift</Button> : undefined}>
              Create the shifts your organisation works, such as Morning, General, Evening or Night, then assign employees to them.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Shift</th><th>Hours</th><th className="col-md">Grace Period</th><th className="col-lg">Working Days</th>
                    <th className="num">Active Employees</th><th>Status</th><th className="actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id}>
                      <td><span className="cell-strong">{s.name}</span><span className="cell-sub">{SHIFT_TYPES[s.shiftType]}</span></td>
                      <td>{formatClock(s.startTime)} – {formatClock(s.endTime)}{s.crossesMidnight ? <span className="cell-sub">Ends the next day</span> : null}</td>
                      <td className="col-md">{s.gracePeriodMinutes} min</td>
                      <td className="col-lg">{workingDaysLabel(s.workingDays)}</td>
                      <td className="num">{s.employeeCount}</td>
                      <td><Badge tone={s.status === 'active' ? 'good' : 'neutral'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="actions">
                        {manage ? (
                          <div className="row-actions">
                            {s.status === 'active' ? <button className="icon-btn" title="Assign employees" aria-label={`Assign employees to ${s.name}`} onClick={() => setAssigning(s)}><UserPlus size={16} /></button> : null}
                            <button className="icon-btn" title="Edit shift" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil size={16} /></button>
                            <button className="icon-btn" title={s.status === 'active' ? 'Deactivate shift' : 'Activate shift'} aria-label={`${s.status === 'active' ? 'Deactivate' : 'Activate'} ${s.name}`} onClick={() => setToggling(s)}><Power size={16} /></button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {creating ? <ShiftFormModal onClose={() => { setCreating(false); if (params.get('new')) setParams({}, { replace: true }) }} /> : null}
      {editing ? <ShiftFormModal shift={editing} onClose={() => setEditing(null)} /> : null}
      {assigning ? <AssignEmployeesModal shift={assigning} onClose={() => setAssigning(null)} /> : null}
      {toggling ? (
        <ConfirmDialog
          title={toggling.status === 'active' ? `Deactivate ${toggling.name}?` : `Activate ${toggling.name}?`}
          confirmLabel={toggling.status === 'active' ? 'Deactivate shift' : 'Activate shift'}
          danger={toggling.status === 'active'}
          loading={setStatus.isPending}
          error={setStatus.error ? errorMessage(setStatus.error, 'The shift status could not be changed.') : null}
          onClose={() => { setToggling(null); setStatus.reset() }}
          onConfirm={() => setStatus.mutate({ id: toggling.id, status: toggling.status === 'active' ? 'inactive' : 'active' }, {
            onSuccess: (s) => { toast('success', `Shift ${s.name} is now ${s.status}.`); setToggling(null) },
          })}
        >
          {toggling.status === 'active'
            ? `An inactive shift cannot be assigned to more employees and is not used to evaluate late arrivals. ${toggling.employeeCount ? `${toggling.employeeCount} active employees keep it until they are reassigned.` : ''}`
            : 'The shift can be assigned again and is used to evaluate late arrivals.'}
        </ConfirmDialog>
      ) : null}
    </>
  )
}

function AssignEmployeesModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const options = useEmployeeOptions('active')
  const assign = useAssignShift(shift.id)
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (options.data?.items ?? [])
      .filter((e) => e.shiftId !== shift.id)
      .filter((e) => !q || e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || e.department.toLowerCase().includes(q))
  }, [options.data, search, shift.id])
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <Modal title={`Assign employees to ${shift.name}`} lead={`${formatClock(shift.startTime)} – ${formatClock(shift.endTime)} · ${workingDaysLabel(shift.workingDays)}. Employees already on another shift are moved to this one.`}
           onClose={onClose} wide
           footer={<>
             <Button variant="secondary" onClick={onClose}>Cancel</Button>
             <Button disabled={!selected.size} loading={assign.isPending}
                     onClick={() => assign.mutate([...selected], { onSuccess: () => { toast('success', `${selected.size} employees assigned to ${shift.name}.`); onClose() } })}>
               Assign {selected.size || ''} {selected.size === 1 ? 'employee' : 'employees'}
             </Button>
           </>}>
      <div className="stack">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, Employee ID or department" label="Search employees" />
        {options.isPending ? <LoadingState compact label="Loading employees..." /> : options.error ? (
          <ErrorState error={options.error} message="The employee information could not be loaded. Please try again." onRetry={() => options.refetch()} />
        ) : candidates.length === 0 ? (
          <EmptyState compact title={search ? 'No employee matches this search' : 'Every active employee is already on this shift'} />
        ) : (
          <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {candidates.map((e) => (
              <label className="list-row" key={e.id} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
                <div className="grow"><strong>{e.fullName}</strong><span>{e.employeeCode} · {e.department}{e.shiftId ? ' · currently on another shift' : ' · no shift'}</span></div>
              </label>
            ))}
          </div>
        )}
        {assign.error ? <Alert tone="crit">{errorMessage(assign.error, 'The employees could not be assigned.')}</Alert> : null}
      </div>
    </Modal>
  )
}
