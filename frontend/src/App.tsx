import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, fetchMe, type ServerStatus } from './api/client'
import { ThemeProvider } from './theme'
import { forgetCalendar } from './week-cache'
import { Welcome, SessionLoading } from './Welcome'
import { CookiePrivacy } from './CookiePrivacy'
import { useLocation } from 'react-router-dom'
import { accountMode } from './account-access'

const Workspace = lazy(() => import('./Workspace'))
const AccountAccess = lazy(() => import('./AccountAccess'))

class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="welcome-session"><h1>Ruang pribadi belum dapat dimuat</h1><p role="alert">Periksa koneksi lalu muat ulang halaman.</p><button className="welcome-google" onClick={() => window.location.reload()}>Muat ulang</button></main>
    return this.props.children
  }
}

export function App() {
  return <ThemeProvider><CookiePrivacy /><AppContent /></ThemeProvider>
}

function AppContent() {
  const location = useLocation()
  const queryClient = useQueryClient()
  // Revalidate identity on focus; only resource data gets a short freshness window.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => fetchMe(signal), staleTime: 0 })
  // Public status can start alongside identity, but can never authorize a workspace.
  const status = useQuery({ queryKey: ['status'], queryFn: ({ signal }) => api<ServerStatus>('/status', { signal }), enabled: !me.data, staleTime: 30_000, refetchInterval: 30_000 })
  useEffect(() => {
    if (me.isSuccess && !me.data) void forgetCalendar(queryClient)
  }, [me.isSuccess, me.data, queryClient])
  const mode = accountMode(location.pathname)
  if (mode) return <Suspense fallback={<SessionLoading />}><AccountAccess key={`${location.key}:${me.data?.user.id ?? 'public'}`} mode={mode} me={me.data} status={status.data} pending={me.isPending || (!me.error && status.isPending)} sessionPending={me.isPending} error={me.error ?? status.error} retry={() => { void me.refetch(); void status.refetch() }} /></Suspense>
  if (me.data) return <WorkspaceBoundary><Suspense fallback={<SessionLoading />}><Workspace me={me.data} /></Suspense></WorkspaceBoundary>
  // Public information never depends on the API. Private routes still require me.data.
  return <Welcome status={status.data} error={me.error ?? status.error} pending={me.isPending || (!me.error && status.isPending)} retry={() => { void me.refetch(); void status.refetch() }} />
}
