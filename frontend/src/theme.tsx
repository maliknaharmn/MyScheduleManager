import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { allowsStorage, persistTheme } from './storage-consent'
import './welcome-theme-toggle.css'

type Theme = 'light' | 'dark'
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} })
export function useTheme() { return useContext(ThemeContext) }
export function readTheme(): Theme {
  try { return allowsStorage('preferences') && document.cookie.split(';').some((cookie) => cookie.trim() === 'myschedule_theme=dark') ? 'dark' : 'light' }
  catch { return 'light' }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => { applyTheme(theme) }, [theme])
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    persistTheme(next)
    applyTheme(next)
    setTheme(next)
  }
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function ThemeSwitch({ compact = false, welcomeVisual = false }: { compact?: boolean; welcomeVisual?: boolean }) {
  const { theme, toggle } = useContext(ThemeContext)
  if (welcomeVisual) return <button className="app-theme-switch welcome-theme-switch" type="button" role="switch" aria-checked={theme === 'dark'} aria-label="Mode gelap" onClick={toggle}>
    <span className="welcome-theme-rail" aria-hidden="true"><span className="welcome-theme-thumb" /><Sun className="welcome-theme-sun" size={18} strokeWidth={2.2} /><Moon className="welcome-theme-moon" size={18} strokeWidth={2.2} /></span>
  </button>
  const Icon = theme === 'dark' ? Moon : Sun
  return <button className="app-theme-switch" type="button" role="switch" aria-checked={theme === 'dark'} aria-label="Mode gelap" onClick={toggle}>
    <Icon size={20} aria-hidden /><span>{compact ? 'Tema' : 'Mode gelap'}</span>{!compact && <span className="app-theme-track" aria-hidden><span /></span>}
  </button>
}
