import { useEffect, useReducer, useState, type RefObject } from 'react'

/**
 * Close something when a pointer goes down outside it. With `swallow`, that
 * tap only closes it (so tapping the page to dismiss a menu doesn't draw a dot).
 */
export function useOutside(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, swallow = false) {
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
        if (swallow && (e.target as HTMLElement).closest?.('.board')) {
          e.stopPropagation()
          e.preventDefault()
        }
      }
    }
    // next tick, so the click that opened it doesn't close it
    const t = window.setTimeout(() => document.addEventListener('pointerdown', h, true))
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', h, true)
    }
  }, [ref, open, onClose, swallow])
}

/** Re-render whenever a subscribe-style source says something changed. */
export function useSubscribe(subscribe: (fn: () => void) => () => void) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribe(bump), [subscribe])
}

export function useHashRoute(): [string, (to: string) => void] {
  const read = () => location.hash.replace(/^#/, '').split('?')[0] || '/'
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const h = () => setRoute(read())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const go = (to: string) => {
    if (read() !== to) location.hash = to
  }
  return [route, go]
}

export function useToast(): [string, (msg: string) => void] {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(''), 3200)
    return () => clearTimeout(t)
  }, [msg])
  return [msg, setMsg]
}
