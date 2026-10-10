import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { createStore, del, get, set } from 'idb-keyval'
import type { Lesson, LessonMeta, Stroke } from '../types'
import type { Backend, LinkStatus, Pipe, User } from './index'

const BUCKET = 'lessons'

interface LessonRow {
  id: string
  title: string
  layout: Lesson['layout']
  doc: Lesson['doc']
  pages: Lesson['pages']
  pods: Lesson['pods']
  settings: Lesson['settings']
  thumb: string | null
  created_at: string
  updated_at: string
}

function fromRow(r: LessonRow): Lesson {
  return {
    id: r.id,
    title: r.title,
    layout: r.layout,
    doc: r.doc,
    pages: r.pages ?? [],
    pods: r.pods ?? [],
    settings: r.settings ?? { podWidth: 0.3, showPods: true },
    thumb: r.thumb,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function toRow(l: Partial<Lesson>): Partial<LessonRow> {
  const r: Partial<LessonRow> = {}
  if (l.id !== undefined) r.id = l.id
  if (l.title !== undefined) r.title = l.title
  if (l.layout !== undefined) r.layout = l.layout
  if (l.doc !== undefined) r.doc = l.doc
  if (l.pages !== undefined) r.pages = l.pages
  if (l.pods !== undefined) r.pods = l.pods
  if (l.settings !== undefined) r.settings = l.settings
  if (l.thumb !== undefined) r.thumb = l.thumb
  return r
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendly(res.error.message))
  return res.data
}

function friendly(msg: string): string {
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Can't reach Supabase. Check the Wi-Fi. If you haven't used the app in over a week, the free project may be paused: open supabase.com, pick the project, and press Restore."
  }
  return msg
}

// Uploaded files never change once written (new uploads get new names), so
// they can be cached on the device forever. Keeps lesson loading quick on
// slow school Wi-Fi.
const cache = createStore('overhead-cache', 'files')
const CACHE_MAX = 25

async function cachePut(path: string, blob: Blob) {
  try {
    await set(path, { type: blob.type, bytes: await blob.arrayBuffer(), t: Date.now() }, cache)
    const index = ((await get('__index', cache)) as string[] | undefined) ?? []
    const next = [path, ...index.filter((p) => p !== path)]
    for (const old of next.slice(CACHE_MAX)) await del(old, cache)
    await set('__index', next.slice(0, CACHE_MAX), cache)
  } catch {
    /* cache is best-effort */
  }
}

async function cacheGet(path: string): Promise<Blob | null> {
  try {
    const v = (await get(path, cache)) as { type: string; bytes: ArrayBuffer } | undefined
    return v ? new Blob([v.bytes], { type: v.type }) : null
  } catch {
    return null
  }
}

export class SupabaseBackend implements Backend {
  kind = 'supabase' as const
  client: SupabaseClient
  private uid: string | null = null

  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'overhead-auth' },
    })
  }

  async user(): Promise<User | null> {
    const { data } = await this.client.auth.getSession()
    const u = data.session?.user
    this.uid = u?.id ?? null
    return u ? { id: u.id, email: u.email } : null
  }

  async signIn(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : friendly(error.message))
    await this.user()
  }

  async signOut() {
    await this.client.auth.signOut()
    this.uid = null
  }

  private prefix(path: string) {
    if (!this.uid) throw new Error('Not signed in')
    return `${this.uid}/${path}`
  }

  async listLessons(): Promise<LessonMeta[]> {
    const rows = check(
      await this.client
        .from('lessons')
        .select('id,title,layout,thumb,pages,created_at,updated_at')
        .order('updated_at', { ascending: false }),
    ) as Pick<LessonRow, 'id' | 'title' | 'layout' | 'thumb' | 'pages' | 'created_at' | 'updated_at'>[]
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      layout: r.layout,
      thumb: r.thumb,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      pageCount: r.pages?.length ?? 0,
    }))
  }

  async getLesson(id: string) {
    const row = check(await this.client.from('lessons').select('*').eq('id', id).maybeSingle()) as LessonRow | null
    return row ? fromRow(row) : null
  }

  async createLesson(l: Lesson) {
    check(await this.client.from('lessons').insert({ ...toRow(l), created_at: l.createdAt, updated_at: l.updatedAt }))
  }

  async updateLesson(id: string, patch: Partial<Lesson>) {
    check(await this.client.from('lessons').update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq('id', id))
  }

  async deleteLesson(id: string) {
    await this.deleteFolder(`${id}/`)
    check(await this.client.from('lessons').delete().eq('id', id))
  }

  async putFile(path: string, data: Blob) {
    check(await this.client.storage.from(BUCKET).upload(this.prefix(path), data, { upsert: true, contentType: data.type || 'application/octet-stream' }))
    cachePut(path, data)
  }

  async getFile(path: string): Promise<Blob> {
    const hit = await cacheGet(path)
    if (hit) return hit
    const blob = check(await this.client.storage.from(BUCKET).download(this.prefix(path))) as Blob
    cachePut(path, blob)
    return blob
  }

  async deleteFolder(prefix: string) {
    const folder = this.prefix(prefix).replace(/\/$/, '')
    const list = check(await this.client.storage.from(BUCKET).list(folder, { limit: 1000 })) as { name: string }[]
    if (list.length) check(await this.client.storage.from(BUCKET).remove(list.map((f) => `${folder}/${f.name}`)))
  }

  async loadInk(lessonId: string) {
    const rows = check(await this.client.from('ink').select('page_id,strokes').eq('lesson_id', lessonId)) as { page_id: string; strokes: Stroke[] }[]
    const out: Record<string, Stroke[]> = {}
    for (const r of rows) out[r.page_id] = r.strokes ?? []
    return out
  }

  async saveInk(lessonId: string, page: string, strokes: Stroke[]) {
    if (!strokes.length) {
      check(await this.client.from('ink').delete().eq('lesson_id', lessonId).eq('page_id', page))
      return
    }
    check(
      await this.client
        .from('ink')
        .upsert({ lesson_id: lessonId, page_id: page, strokes, updated_at: new Date().toISOString() }, { onConflict: 'lesson_id,page_id' }),
    )
  }

  async copyInk(from: string, to: string) {
    const ink = await this.loadInk(from)
    const rows = Object.entries(ink).map(([page_id, strokes]) => ({ lesson_id: to, page_id, strokes }))
    if (rows.length) check(await this.client.from('ink').insert(rows))
  }

  pipe(user: User): Pipe {
    const msgFns = new Set<(p: unknown) => void>()
    const statusFns = new Set<(s: LinkStatus) => void>()
    let status: LinkStatus = 'connecting'
    let ch: RealtimeChannel | null = null
    let closed = false
    let retry = 0

    const setStatus = (s: LinkStatus) => {
      if (s === status) return
      status = s
      for (const f of statusFns) f(s)
    }

    const join = () => {
      if (closed) return
      const old = ch
      ch = null
      if (old) this.client.removeChannel(old)
      setStatus('connecting')
      // The topic includes the user's id, which nobody else knows, so only
      // your own devices end up on it.
      const mine = this.client.channel(`overhead:${user.id}`, { config: { broadcast: { self: false, ack: false } } })
      ch = mine
      mine.on('broadcast', { event: 'm' }, (msg) => {
        for (const f of msgFns) f(msg.payload)
      })
      mine.subscribe((s) => {
        // Ignore the CLOSED that removing an old channel fires.
        if (ch !== mine) return
        if (s === 'SUBSCRIBED') {
          retry = 0
          setStatus('live')
        } else if (s === 'CLOSED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          setStatus('offline')
          if (!closed) {
            retry++
            window.setTimeout(join, Math.min(15000, 1000 * 2 ** Math.min(retry, 4)))
          }
        }
      })
    }

    // iPads drop sockets when the screen sleeps; rejoin as soon as we're back.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && status !== 'live') join()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    join()

    return {
      send: (payload) => {
        if (ch && status === 'live') ch.send({ type: 'broadcast', event: 'm', payload })
      },
      onMessage: (fn) => {
        msgFns.add(fn)
        return () => msgFns.delete(fn)
      },
      onStatus: (fn) => {
        statusFns.add(fn)
        queueMicrotask(() => fn(status))
        return () => statusFns.delete(fn)
      },
      close: () => {
        closed = true
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('online', onVisible)
        const old = ch
        ch = null
        if (old) this.client.removeChannel(old)
      },
    }
  }
}
