import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, setCsrfToken, setUnauthorizedHandler } from '../api/client'
import type { SessionInfo } from '../api/types'

interface SessionContextValue {
  session: SessionInfo | null
  isLoading: boolean
  error: ApiError | null
  can: (permission: string) => boolean
  timezone: string
  refetch: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api.get<SessionInfo>('/auth/session')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    setCsrfToken(query.data?.csrfToken ?? null)
  }, [query.data])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null)
      qc.setQueryData(['session'], null)
    })
  }, [qc])

  const value = useMemo<SessionContextValue>(() => {
    const permissions = new Set(query.data?.permissions ?? [])
    return {
      session: query.data ?? null,
      isLoading: query.isPending,
      error: query.error instanceof ApiError ? query.error : null,
      can: (p: string) => permissions.has(p),
      timezone: query.data?.siteTimezone ?? 'UTC',
      refetch: () => void query.refetch(),
    }
  }, [query])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<SessionInfo>('/auth/login', body),
    onSuccess: (data) => {
      setCsrfToken(data.csrfToken)
      qc.setQueryData(['session'], data)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      setCsrfToken(null)
      qc.clear()
      qc.setQueryData(['session'], null)
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post<void>('/auth/password', body),
  })
}
