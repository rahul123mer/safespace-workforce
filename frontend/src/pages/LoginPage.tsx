import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useLogin, useSession } from '../auth/session'
import { errorMessage } from '../components/ui'

export function LoginPage() {
  const { session } = useSession()
  const login = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  useEffect(() => {
    document.title = 'Sign in · SafeSpace Workforce'
  }, [])

  if (session) return <Navigate to={from} replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ email, password }, { onSuccess: () => navigate(from, { replace: true }) })
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <img src="/brand/safespace.webp" alt="SafeSpace" />
        <span>Workforce</span>
      </div>
      <form className="login-panel" onSubmit={submit} noValidate>
        <h1>Welcome to SafeSpace Workforce</h1>
        <p>Sign in to manage employees, face registration and attendance.</p>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" className="input" type="email" autoComplete="username" placeholder="name@safespaceglobal.ai"
                 value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <div className="password-wrap">
            <input id="login-password" className="input" type={show ? 'text' : 'password'} autoComplete="current-password"
                   placeholder="Enter password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        {login.error ? <div className="login-error" role="alert">{errorMessage(login.error, 'Sign-in failed. Try again.')}</div> : null}
        <div className="login-actions">
          <small>Forgotten your password? Ask an administrator to reset it.</small>
          <button className="btn btn-primary" type="submit" disabled={login.isPending || !email || !password}>
            {login.isPending ? <Loader2 size={15} className="spin" /> : null} Login
          </button>
        </div>
      </form>
    </div>
  )
}
