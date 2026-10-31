import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Welcome } from './Welcome'

// Build only public, anonymous content. No API requests, sessions or account data.
// The client mounts afresh (not hydration) to apply live session/theme/consent state.
export function renderHomepage() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/']}><Welcome error={null} pending retry={() => {}} staticPage /></MemoryRouter>)
}
