export const accountRoutes = {
  '/login': 'login',
  '/signup': 'signup',
  '/forgot-password': 'forgot',
  '/activate-password': 'activate',
  '/reset-password': 'reset',
  '/settings/security': 'change',
} as const

export type AccountMode = typeof accountRoutes[keyof typeof accountRoutes]
export function accountMode(path: string): AccountMode | undefined {
  return accountRoutes[path.replace(/\/$/, '') as keyof typeof accountRoutes]
}

// Presentation feedback only. The backend independently enforces this policy,
// common-password screening, persistent limits and immutable account ownership.
export function passwordRules(value: string) {
  return [
    { key: 'length', label: 'Minimal 8 karakter', met: [...value].length >= 8 },
    { key: 'capital', label: 'Setidaknya satu huruf kapital (A-Z)', met: /[A-Z]/.test(value) },
    { key: 'number', label: 'Setidaknya satu angka (0-9)', met: /[0-9]/.test(value) },
  ]
}

export function validUsername(value: string) { return /^[a-zA-Z0-9_.]{3,30}$/.test(value) }

export function passwordLink(hash: string): string {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? ''
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''
}
