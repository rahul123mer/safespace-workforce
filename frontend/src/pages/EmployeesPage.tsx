import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, ScanFace, UserCheck, UserX, Users } from 'lucide-react'
import { useDirectory, useEmployees, useSetEmployeeStatus, useShifts } from '../api/queries'
import type { Employee } from '../api/types'
import { useSession } from '../auth/session'
import { EmployeeStatusBadge, FaceBadge, PresenceBadge } from '../components/badges'
import { useToast } from '../components/toast'
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, LoadingState, PageHeading, Pagination, SearchInput, errorMessage } from '../components/ui'
import { useDebounced } from '../utils/hooks'
import { FACE_STATUS, formatDateTime } from '../utils/format'

const SORTABLE: Record<string, string> = { name: 'Employee Name', employeeCode: 'Employee ID', department: 'Department', designation: 'Designation' }

export function EmployeesPage() {
  const [params, setParams] = useSearchParams()
  const { can, timezone } = useSession()
  const navigate = useNavigate()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const debounced = useDebounced(search, 300)
  const [statusTarget, setStatusTarget] = useState<Employee | null>(null)
  const [reason, setReason] = useState('')
  const toast = useToast()
  const setStatus = useSetEmployeeStatus()
  const shifts = useShifts()
  const directory = useDirectory()

  const filters = {
    search: debounced || undefined,
    status: params.get('status') ?? undefined,
    faceStatus: params.get('faceStatus') ?? undefined,
    shiftId: params.get('shiftId') ?? undefined,
    department: params.get('department') ?? undefined,
    sort: params.get('sort') ?? 'name',
    order: params.get('order') ?? 'asc',
    page: Number(params.get('page') ?? 1),
    pageSize: 25,
  }
  const { data, isPending, error, refetch, isFetching } = useEmployees(filters)

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }
  const sortBy = (key: string) => {
    const next = new URLSearchParams(params)
    const same = (params.get('sort') ?? 'name') === key
    next.set('sort', key)
    next.set('order', same && (params.get('order') ?? 'asc') === 'asc' ? 'desc' : 'asc')
    setParams(next, { replace: true })
  }
  const sortHeader = (key: string) => {
    const active = filters.sort === key
    return (
      <button onClick={() => sortBy(key)} aria-label={`Sort by ${SORTABLE[key]}`}>
        {SORTABLE[key]} {active ? (filters.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
      </button>
    )
  }
  const hasFilters = Boolean(debounced || filters.status || filters.faceStatus || filters.shiftId || filters.department)

  const confirmStatus = () => {
    if (!statusTarget) return
    const nextStatus = statusTarget.status === 'active' ? 'inactive' : 'active'
    setStatus.mutate({ id: statusTarget.id, status: nextStatus, reason }, {
      onSuccess: () => {
        toast('success', `${statusTarget.fullName} is now ${nextStatus === 'active' ? 'active' : 'inactive'}.`)
        setStatusTarget(null)
        setReason('')
      },
    })
  }

  return (
    <>
      <PageHeading
        title="Employees"
        lead="Everyone the recognition pipeline can identify, with their shift, face registration and entry/exit cameras."
        actions={can('employees.manage') ? <Link className="btn btn-primary" to="/employees/new"><Plus size={16} /> Add employee</Link> : null}
      />

      <div className="toolbar">
        <SearchInput value={search} onChange={(v) => { setSearch(v); update('search', v || null) }} placeholder="Name, Employee ID, email or department" label="Search employees" />
        <select className="select" aria-label="Employee status" value={filters.status ?? ''} onChange={(e) => update('status', e.target.value || null)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="select" aria-label="Face registration status" value={filters.faceStatus ?? ''} onChange={(e) => update('faceStatus', e.target.value || null)}>
          <option value="">All face statuses</option>
          {Object.entries(FACE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select" aria-label="Shift" value={filters.shiftId ?? ''} onChange={(e) => update('shiftId', e.target.value || null)}>
          <option value="">All shifts</option>
          <option value="none">No shift assigned</option>
          {shifts.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'inactive' ? ' (inactive)' : ''}</option>)}
        </select>
        <select className="select" aria-label="Department" value={filters.department ?? ''} onChange={(e) => update('department', e.target.value || null)}>
          <option value="">All departments</option>
          {directory.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="spacer" />
        {data ? <span className="result-count">{isFetching ? 'Updating...' : `${data.total} ${data.total === 1 ? 'employee' : 'employees'}`}</span> : null}
      </div>

      {error ? (
        <ErrorState error={error} message="The employee information could not be loaded. Please try again." onRetry={() => refetch()} />
      ) : (
        <section className="card table-card">
          {isPending ? (
            <LoadingState label="Loading employees..." />
          ) : data.items.length === 0 ? (
            hasFilters ? (
              <EmptyState icon={<Users size={30} />} title="No employees match these filters"
                          action={<Button variant="secondary" size="sm" onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>Clear filters</Button>}>
                Change the search text or filters to see more employees.
              </EmptyState>
            ) : (
              <EmptyState icon={<Users size={30} />} title="No employees have been registered yet."
                          action={can('employees.manage') ? <Link className="btn btn-primary btn-sm" to="/employees/new"><Plus size={15} /> Add employee</Link> : undefined}>
                Register employees, then capture their faces so the recognition pipeline can identify them.
              </EmptyState>
            )
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{sortHeader('name')}</th>
                      <th className="col-xxl">{sortHeader('employeeCode')}</th>
                      <th className="col-md">{sortHeader('department')}</th>
                      <th className="col-xxl">{sortHeader('designation')}</th>
                      <th className="col-lg">Shift</th>
                      <th>Face Status</th>
                      <th className="col-md">Current Status</th>
                      <th className="col-lg">Last Detected</th>
                      <th className="col-xxl">Status</th>
                      <th className="actions"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <Link to={`/employees/${e.id}`} className="cell-strong">{e.fullName}</Link>
                          {e.status === 'inactive' ? <span className="hide-xxl"> <EmployeeStatusBadge status={e.status} /></span> : null}
                          <span className="cell-sub">{e.employeeCode}<span className="hide-lg"> · {e.department}</span></span>
                        </td>
                        <td className="col-xxl mono">{e.employeeCode}</td>
                        <td className="col-md">{e.department}<span className="cell-sub hide-xxl">{e.designation}</span></td>
                        <td className="col-xxl">{e.designation}</td>
                        <td className="col-lg">{e.shift ? e.shift.name : <span className="cell-muted">Not assigned</span>}</td>
                        <td><FaceBadge status={e.faceStatus} title={e.reregistrationReason} /></td>
                        <td className="col-md"><PresenceBadge presence={e.presence} /></td>
                        <td className="col-lg">
                          {e.lastDetected ? (
                            <>
                              <span className="nowrap">{formatDateTime(e.lastDetected.at, timezone)}</span>
                              <span className="cell-sub">{e.lastDetected.eventType.toUpperCase()} · {e.lastDetected.camera.name}</span>
                            </>
                          ) : <span className="cell-muted">Never</span>}
                        </td>
                        <td className="col-xxl"><EmployeeStatusBadge status={e.status} /></td>
                        <td className="actions">
                          <div className="row-actions">
                            <button className="icon-btn" title="View employee" aria-label={`View ${e.fullName}`} onClick={() => navigate(`/employees/${e.id}`)}><Eye size={16} /></button>
                            {can('employees.manage') ? (
                              <button className="icon-btn" title="Edit employee" aria-label={`Edit ${e.fullName}`} onClick={() => navigate(`/employees/${e.id}/edit`)}><Pencil size={16} /></button>
                            ) : null}
                            {can('faces.manage') && e.status === 'active' ? (
                              <button className="icon-btn" title={e.faceStatus === 'not_registered' ? 'Register face' : 'Update face registration'}
                                      aria-label={`Face registration for ${e.fullName}`} onClick={() => navigate(`/face-registration/${e.id}`)}><ScanFace size={16} /></button>
                            ) : null}
                            {can('employees.manage') ? (
                              <button className="icon-btn" title={e.status === 'active' ? 'Deactivate employee' : 'Activate employee'}
                                      aria-label={`${e.status === 'active' ? 'Deactivate' : 'Activate'} ${e.fullName}`} onClick={() => setStatusTarget(e)}>
                                {e.status === 'active' ? <UserX size={16} /> : <UserCheck size={16} />}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="employees" onPage={(p) => update('page', String(p))} />
            </>
          )}
        </section>
      )}

      {statusTarget ? (
        <ConfirmDialog
          title={statusTarget.status === 'active' ? `Deactivate ${statusTarget.fullName}?` : `Activate ${statusTarget.fullName}?`}
          confirmLabel={statusTarget.status === 'active' ? 'Deactivate employee' : 'Activate employee'}
          danger={statusTarget.status === 'active'}
          loading={setStatus.isPending}
          error={setStatus.error ? errorMessage(setStatus.error, 'The status could not be changed.') : null}
          onConfirm={confirmStatus}
          onClose={() => { setStatusTarget(null); setReason(''); setStatus.reset() }}
        >
          {statusTarget.status === 'active' ? (
            <div className="stack">
              <span>The employee will no longer be recognised in newly analysed footage. Their attendance history, face registration and configuration are kept, and they can be activated again at any time.</span>
              <Field label="Reason (optional)" htmlFor="deactivate-reason" hint="Recorded in the employee's configuration history.">
                <input id="deactivate-reason" className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: resigned, transferred to another site" />
              </Field>
            </div>
          ) : (
            <span>The employee becomes recognisable again in newly analysed footage, using their existing face registration.</span>
          )}
        </ConfirmDialog>
      ) : null}
    </>
  )
}
