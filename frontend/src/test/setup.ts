import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  document.cookie = 'myschedule_storage=; Path=/; Max-Age=0'
  document.cookie = 'myschedule_theme=; Path=/; Max-Age=0'
})
