import type { Backend } from './backend'
import { LocalBackend } from './backend/local'
import { SupabaseBackend } from './backend/supabase'

// Supabase details come from the build (GitHub repo variables) when they're
// set, otherwise from what was pasted into the setup screen on this device.
// Both values are safe to be public: access is locked down by row-level
// security in supabase/setup.sql.

const KEY = 'overhead.backend'

export type BackendChoice = { kind: 'supabase'; url: string; key: string } | { kind: 'local' }

const BUILT_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const BUILT_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export function builtInSupabase(): boolean {
  return !!(BUILT_URL && BUILT_KEY)
}

export function readChoice(): BackendChoice | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as BackendChoice
  } catch {
    /* ignore */
  }
  if (BUILT_URL && BUILT_KEY) return { kind: 'supabase', url: BUILT_URL, key: BUILT_KEY }
  return null
}

export function saveChoice(c: BackendChoice | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

let cached: { choice: string; backend: Backend } | null = null

export function backendFor(c: BackendChoice): Backend {
  const sig = JSON.stringify(c)
  if (cached?.choice === sig) return cached.backend
  const backend = c.kind === 'local' ? new LocalBackend() : new SupabaseBackend(c.url, c.key)
  cached = { choice: sig, backend }
  return backend
}

export type Role = 'pad' | 'projector'
const ROLE_KEY = 'overhead.role'

export function readRole(): Role | null {
  try {
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
    const r = params.get('role')
    if (r === 'pad' || r === 'projector') return r
    const v = localStorage.getItem(ROLE_KEY)
    return v === 'pad' || v === 'projector' ? v : null
  } catch {
    return null
  }
}

export function saveRole(r: Role) {
  try {
    localStorage.setItem(ROLE_KEY, r)
  } catch {
    /* ignore */
  }
}

export function guessRole(): Role {
  const touch = navigator.maxTouchPoints > 1
  const ipadish = /iPad|Macintosh/.test(navigator.userAgent) && touch
  return ipadish || (touch && Math.min(screen.width, screen.height) >= 600) ? 'pad' : 'projector'
}

export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`overhead.${key}`)
    return v == null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function setPref(key: string, v: unknown) {
  try {
    localStorage.setItem(`overhead.${key}`, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}
