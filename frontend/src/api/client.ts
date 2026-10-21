export type Envelope<T> = { data: T; meta: { request_id: string } }

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError(0, 'NETWORK_UNAVAILABLE', 'Server belum dapat dijangkau. Periksa koneksi.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'Permintaan belum berhasil. Coba lagi.',
      payload?.error?.details ?? {},
    )
  }
  if (response.status === 204) return undefined as T
  const envelope: Envelope<T> = await response.json()
  return envelope.data
}

export type ServerStatus = components['schemas']['StatusData']
export type Me = components['schemas']['MeData']

export async function fetchMe(): Promise<Me | null> {
  try {
    return await api<Me>('/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}
import type { components } from './generated'
