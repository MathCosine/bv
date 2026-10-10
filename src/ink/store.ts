import type { Stroke } from '../lib/types'

export interface Patch {
  page: string
  remove: string[]
  add: Stroke[]
}

type Listener = (page: string, origin: 'local' | 'remote' | 'load', patch?: Patch) => void

/**
 * Holds every page's strokes. Patches are idempotent (adding a stroke that's
 * already there or removing one that's gone is a no-op) so it is always safe
 * to replay messages that might have arrived twice or out of order.
 */
export class InkStore {
  private pages = new Map<string, Stroke[]>()
  private listeners = new Set<Listener>()
  private undoStack: Patch[] = []
  private redoStack: Patch[] = []
  /** called for every local change; used for syncing + saving */
  onLocalPatch: ((p: Patch) => void) | null = null

  get(page: string): Stroke[] {
    return this.pages.get(page) ?? EMPTY
  }

  allPages(): string[] {
    return [...this.pages.keys()]
  }

  load(page: string, strokes: Stroke[]) {
    this.pages.set(page, strokes.slice())
    this.emit(page, 'load')
  }

  clearAll() {
    this.pages.clear()
    this.undoStack = []
    this.redoStack = []
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(page: string, origin: 'local' | 'remote' | 'load', patch?: Patch) {
    for (const l of this.listeners) l(page, origin, patch)
  }

  /** Apply a patch; returns what actually changed, or null if nothing did. */
  private applyRaw(p: Patch): Patch | null {
    const cur = this.pages.get(p.page) ?? []
    let next = cur
    let removed: string[] = []
    if (p.remove.length) {
      const rm = new Set(p.remove)
      next = next.filter((s) => !rm.has(s.id))
      if (next.length !== cur.length) removed = p.remove.filter((id) => cur.some((s) => s.id === id))
    }
    let fresh: Stroke[] = []
    if (p.add.length) {
      const have = new Set(next.map((s) => s.id))
      fresh = p.add.filter((s) => !have.has(s.id))
      if (fresh.length) next = next === cur ? next.concat(fresh) : (next.push(...fresh), next)
    }
    if (next === cur) return null
    this.pages.set(p.page, next)
    return { page: p.page, remove: removed, add: fresh }
  }

  /** A change made on this device. Recorded for undo unless `history` is false. */
  commit(p: Patch, history = true) {
    if (!p.remove.length && !p.add.length) return
    const removed = this.get(p.page).filter((s) => p.remove.includes(s.id))
    const real: Patch = { page: p.page, remove: removed.map((s) => s.id), add: p.add }
    const done = this.applyRaw(real)
    if (!done) return
    if (history) {
      this.undoStack.push({ page: p.page, remove: p.add.map((s) => s.id), add: removed })
      if (this.undoStack.length > 300) this.undoStack.shift()
      this.redoStack = []
    }
    this.emit(p.page, 'local', done)
    this.onLocalPatch?.(real)
  }

  /** A change that came from the other device. */
  applyRemote(p: Patch) {
    const done = this.applyRaw(p)
    if (done) this.emit(p.page, 'remote', done)
  }

  /** Record a hand-built undo step (for gestures made of many small commits, like erasing). */
  record(undo: Patch) {
    if (!undo.remove.length && !undo.add.length) return
    this.undoStack.push(undo)
    if (this.undoStack.length > 300) this.undoStack.shift()
    this.redoStack = []
  }

  canUndo(page?: string) {
    return page ? this.undoStack.some((u) => u.page === page) : this.undoStack.length > 0
  }
  canRedo(page?: string) {
    return page ? this.redoStack.some((u) => u.page === page) : this.redoStack.length > 0
  }

  /** Undo the latest change (on `page` if given). Returns the page it touched. */
  undo(page?: string): string | null {
    return this.step(this.undoStack, this.redoStack, page)
  }
  redo(page?: string): string | null {
    return this.step(this.redoStack, this.undoStack, page)
  }

  private step(from: Patch[], to: Patch[], page?: string): string | null {
    let idx = from.length - 1
    if (page) while (idx >= 0 && from[idx].page !== page) idx--
    if (idx < 0) return null
    const [inv] = from.splice(idx, 1)
    const removed = this.get(inv.page).filter((s) => inv.remove.includes(s.id))
    to.push({ page: inv.page, remove: inv.add.map((s) => s.id), add: removed })
    if (this.applyRaw(inv)) {
      this.emit(inv.page, 'local')
      this.onLocalPatch?.(inv)
    }
    return inv.page
  }
}

const EMPTY: Stroke[] = []
