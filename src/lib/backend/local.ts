import { createStore, del, delMany, entries, get, keys, set } from 'idb-keyval'
import type { Lesson, LessonMeta, Stroke } from '../types'
import { toMeta, type Backend, type LinkStatus, type Pipe, type User } from './index'

// "This device only" mode: everything lives in IndexedDB and the "live"
// connection is a BroadcastChannel, so two tabs or windows in the same
// browser stay in sync. Good for trying things out and for testing.

const store = createStore('overhead-local', 'kv')
const LOCAL_USER: User = { id: 'local', email: 'this device' }

export class LocalBackend implements Backend {
  kind = 'local' as const

  async user() {
    return LOCAL_USER
  }
  async signIn() {}
  async signOut() {}

  async listLessons(): Promise<LessonMeta[]> {
    const all = await entries<string, unknown>(store)
    return all
      .filter(([k]) => k.startsWith('lesson:'))
      .map(([, v]) => toMeta(v as Lesson))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getLesson(id: string) {
    return ((await get(`lesson:${id}`, store)) as Lesson | undefined) ?? null
  }

  async createLesson(l: Lesson) {
    await set(`lesson:${l.id}`, l, store)
  }

  async updateLesson(id: string, patch: Partial<Lesson>) {
    const cur = await this.getLesson(id)
    if (!cur) return
    await set(`lesson:${id}`, { ...cur, ...patch, updatedAt: new Date().toISOString() }, store)
  }

  async deleteLesson(id: string) {
    const ks = (await keys<string>(store)).filter((k) => k.startsWith(`ink:${id}:`) || k.startsWith(`file:${id}/`))
    await delMany([...ks, `lesson:${id}`], store)
  }

  async putFile(path: string, data: Blob) {
    // Store bytes rather than the Blob: Safari has been flaky with Blobs in IndexedDB.
    await set(`file:${path}`, { type: data.type, bytes: await data.arrayBuffer() }, store)
  }

  async getFile(path: string): Promise<Blob> {
    const v = (await get(`file:${path}`, store)) as { type: string; bytes: ArrayBuffer } | undefined
    if (!v) throw new Error(`Missing file ${path}`)
    return new Blob([v.bytes], { type: v.type })
  }

  async deleteFolder(prefix: string) {
    const ks = (await keys<string>(store)).filter((k) => k.startsWith(`file:${prefix}`))
    await delMany(ks, store)
  }

  async loadInk(lessonId: string) {
    const out: Record<string, Stroke[]> = {}
    const prefix = `ink:${lessonId}:`
    for (const [k, v] of await entries<string, Stroke[]>(store)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
    }
    return out
  }

  async saveInk(lessonId: string, page: string, strokes: Stroke[]) {
    if (strokes.length) await set(`ink:${lessonId}:${page}`, strokes, store)
    else await del(`ink:${lessonId}:${page}`, store)
  }

  async copyInk(from: string, to: string) {
    const ink = await this.loadInk(from)
    for (const [page, strokes] of Object.entries(ink)) await this.saveInk(to, page, strokes)
  }

  pipe(): Pipe {
    const ch = new BroadcastChannel('overhead-live')
    const statusFns = new Set<(s: LinkStatus) => void>()
    let open = true
    return {
      send: (payload) => {
        if (open) ch.postMessage(payload)
      },
      onMessage: (fn) => {
        const h = (e: MessageEvent) => fn(e.data)
        ch.addEventListener('message', h)
        return () => ch.removeEventListener('message', h)
      },
      onStatus: (fn) => {
        statusFns.add(fn)
        queueMicrotask(() => open && fn('live'))
        return () => statusFns.delete(fn)
      },
      close: () => {
        open = false
        ch.close()
      },
    }
  }
}
