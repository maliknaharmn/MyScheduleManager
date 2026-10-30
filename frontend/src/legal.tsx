import { createRoot } from 'react-dom/client'
import { CookiePrivacy, CookieSettingsButton } from './CookiePrivacy'
import { allowsStorage } from './storage-consent'
import { applyTheme, readTheme } from './theme'
import './privacy.css'

// Only enhance the controls. Policy text is static HTML and needs no API/session.
applyTheme(allowsStorage('preferences') ? readTheme() : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const controls = Array.from(document.querySelectorAll('[data-cookie-settings]'))
// Keep dialog typography independent of article/footer rules on every document.
const controller = document.createElement('div')
document.body.append(controller)
createRoot(controller).render(<CookiePrivacy />)
controls.forEach(element => createRoot(element).render(<CookieSettingsButton />))
