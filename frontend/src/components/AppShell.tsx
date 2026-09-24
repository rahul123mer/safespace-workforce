import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  CalendarCheck,
  Cctv,
  Clock3,
  Film,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  ScanFace,
  Settings2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useLogout, useSession } from '../auth/session'
import { useDashboard } from '../api/queries'
import { LoadingState } from './ui'
import { ChangePasswordModal } from './ChangePasswordModal'

interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
  permission: string
  end?: boolean
  badge?: 'review'
}

const SECTIONS: { title?: string; items: NavEntry[] }[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view', end: true }] },
  {
    title: 'Workforce',
    items: [
      { to: '/employees', label: 'Employees', icon: Users, permission: 'employees.view' },
      { to: '/face-registration', label: 'Face Registration', icon: ScanFace, permission: 'faces.manage' },
      { to: '/shifts', label: 'Shifts', icon: Clock3, permission: 'shifts.view' },
    ],
  },
  {
    title: 'Cameras',
    items: [
      { to: '/cameras', label: 'Camera Configuration', icon: Cctv, permission: 'cameras.view' },
      { to: '/footage', label: 'Footage Analysis', icon: Film, permission: 'footage.view' },
    ],
  },
  {
    title: 'Attendance',
    items: [
      { to: '/activity', label: 'Recognition Activity', icon: Activity, permission: 'events.view', badge: 'review' },
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck, permission: 'attendance.view' },
    ],
  },
  { title: 'Administration', items: [{ to: '/settings', label: 'Settings', icon: Settings2, permission: 'settings.view' }] },
]

export function RequireSession() {
  const { session, isLoading } = useSession()
  const location = useLocation()
  if (isLoading) return <LoadingState label="Checking your session..." page />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <AppShell />
}

function AppShell() {
  const { session, can } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useLogout()
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const dashboard = useDashboard()
  const reviewCount = dashboard.data?.metrics.eventsNeedingReview ?? 0

  useEffect(() => {
    setNavOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  if (!session) return null
  const user = session.user

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <button className="mobile-nav-button" onClick={() => setNavOpen((v) => !v)} aria-label={navOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={navOpen}>
        {navOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {navOpen ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} /> : null}
      <aside className="sidebar">
        <div className="brand">
          <img src="/brand/safespace.webp" alt="SafeSpace" />
          <span>Workforce</span>
        </div>
        <nav aria-label="Primary navigation">
          {SECTIONS.map((section, i) => {
            const items = section.items.filter((item) => can(item.permission))
            if (!items.length) return null
            return (
              <div key={section.title ?? i}>
                {section.title ? <div className="nav-section">{section.title}</div> : null}
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                    <item.icon size={18} strokeWidth={1.75} />
                    <span>{item.label}</span>
                    {item.badge === 'review' && reviewCount > 0 ? (
                      <i className="nav-count" title={`${reviewCount} recognition events need review`}>{reviewCount > 99 ? '99+' : reviewCount}</i>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-photo" aria-hidden>{user.fullName.trim().charAt(0).toUpperCase()}</div>
            <div className="user-copy">
              <strong>{user.fullName}</strong>
              <span>{user.roleLabel} · {user.email}</span>
            </div>
            <button className="user-more" aria-label="Account menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <MoreHorizontal size={16} />
            </button>
            {menuOpen ? (
              <div className="user-menu" role="menu">
                <button role="menuitem" onClick={() => { setMenuOpen(false); setPasswordOpen(true) }}>
                  <KeyRound size={14} /> Change password
                </button>
                <button role="menuitem" onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}>
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
      <div className="main">
        <main className="main-inner">
          <Outlet />
        </main>
      </div>
      {passwordOpen ? <ChangePasswordModal onClose={() => setPasswordOpen(false)} /> : null}
    </div>
  )
}

export function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can } = useSession()
  if (!can(permission)) {
    return (
      <div className="card">
        <div className="empty">
          <strong>You do not have access to this page</strong>
          <p>Your role does not include this area. Ask an administrator if you need access.</p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
