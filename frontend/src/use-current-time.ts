import { useEffect, useState } from 'react'

// One clock for Home's greeting, current date, week and default selection.
// Browser focus/pageshow also catch sleeping devices and iOS back-forward cache.
export function useCurrentTime() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const update = () => {
      clearTimeout(timer)
      setNow(new Date())
      timer = setTimeout(update, 60_000 - Date.now() % 60_000)
    }
    const visible = () => { if (document.visibilityState === 'visible') update() }
    update()
    window.addEventListener('focus', update)
    window.addEventListener('pageshow', update)
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', update)
      window.removeEventListener('pageshow', update)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return now
}
