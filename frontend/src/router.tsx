import { createBrowserRouter, Link, useRouteError } from 'react-router-dom'
import { RequirePermission, RequireSession } from './components/AppShell'
import { Button, EmptyState, PageHeading } from './components/ui'
import { ActivityPage } from './pages/ActivityPage'
import { AttendancePage } from './pages/AttendancePage'
import { CameraDetailPage } from './pages/CameraDetailPage'
import { CamerasPage } from './pages/CamerasPage'
import { DashboardPage } from './pages/DashboardPage'
import { EmployeeDetailPage } from './pages/EmployeeDetailPage'
import { EmployeeFormPage } from './pages/EmployeeFormPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { FaceRegistrationPage } from './pages/FaceRegistrationPage'
import { FootagePage } from './pages/FootagePage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShiftsPage } from './pages/ShiftsPage'

const guard = (permission: string, element: JSX.Element) => <RequirePermission permission={permission}>{element}</RequirePermission>

function NotFound() {
  return (
    <>
      <PageHeading title="Page not found" />
      <div className="card">
        <EmptyState title="This page does not exist" action={<Link className="btn btn-primary btn-sm" to="/">Go to the dashboard</Link>}>
          The address may be mistyped, or the record may have been removed.
        </EmptyState>
      </div>
    </>
  )
}

function RouteError() {
  const error = useRouteError()
  if (error) console.error(error)
  return (
    <>
      <PageHeading title="Something went wrong" />
      <div className="card">
        <EmptyState title="This page could not be displayed"
                    action={<><Button size="sm" onClick={() => window.location.reload()}>Reload page</Button> <Link className="btn btn-secondary btn-sm" to="/">Go to the dashboard</Link></>}>
          An unexpected error occurred while showing this page. Reload to try again; if it keeps happening, contact an administrator.
        </EmptyState>
      </div>
    </>
  )
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <RequireSession />,
    errorElement: <RouteError />,
    children: [{ errorElement: <RouteError />, children: [
      { index: true, element: guard('dashboard.view', <DashboardPage />) },
      { path: 'employees', element: guard('employees.view', <EmployeesPage />) },
      { path: 'employees/new', element: guard('employees.manage', <EmployeeFormPage />) },
      { path: 'employees/:id', element: guard('employees.view', <EmployeeDetailPage />) },
      { path: 'employees/:id/edit', element: guard('employees.manage', <EmployeeFormPage />) },
      { path: 'face-registration', element: guard('faces.manage', <FaceRegistrationPage />) },
      { path: 'face-registration/:employeeId', element: guard('faces.manage', <FaceRegistrationPage />) },
      { path: 'shifts', element: guard('shifts.view', <ShiftsPage />) },
      { path: 'cameras', element: guard('cameras.view', <CamerasPage />) },
      { path: 'cameras/:id', element: guard('cameras.view', <CameraDetailPage />) },
      { path: 'footage', element: guard('footage.view', <FootagePage />) },
      { path: 'activity', element: guard('events.view', <ActivityPage />) },
      { path: 'attendance', element: guard('attendance.view', <AttendancePage />) },
      { path: 'settings', element: guard('settings.view', <SettingsPage />) },
      { path: '*', element: <NotFound /> },
    ] }],
  },
])
