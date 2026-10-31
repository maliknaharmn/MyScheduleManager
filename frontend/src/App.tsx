import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, fetchMe, type ServerStatus } from './api/client'
import { ThemeProvider } from './theme'
import { forgetCalendar } from './week-cache'
import { Welcome, SessionLoading } from './Welcome'
import { CookiePrivacy } from './CookiePrivacy'

const Workspace = lazy(() => import('./Workspace'))

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
  const queryClient = useQueryClient()
  // Revalidate identity on focus; only resource data gets a short freshness window.
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 0 })
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<ServerStatus>('/status'), enabled: !me.isPending && !me.data, staleTime: 30_000, refetchInterval: 30_000 })
  useEffect(() => {
    if (me.isSuccess && !me.data) void forgetCalendar(queryClient)
  }, [me.isSuccess, me.data, queryClient])
  if (me.data) return <WorkspaceBoundary><Suspense fallback={<SessionLoading />}><Workspace me={me.data} /></Suspense></WorkspaceBoundary>
  // Public information never depends on the API. Private routes still require me.data.
  return <Welcome status={status.data} error={me.error ?? status.error} pending={me.isPending || me.isFetching || status.isFetching} retry={() => { void me.refetch(); void status.refetch() }} />
}
