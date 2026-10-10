import type { LaserPoint, LiveEvent, SelMove, ViewInfo } from '../board/Board'
import type { Patch } from '../ink/store'
import type { LinkStatus, Pipe } from './backend'
import type { Role } from './config'
import { uid } from './ids'
import type { Lesson, Pod } from './types'

export interface ScreenInfo {
  w: number
  h: number
  m: number
}

export type Msg =
  | { t: 'hello'; lesson: string | null }
  | { t: 'here'; lesson: string | null; screen?: ScreenInfo | null }
  | { t: 'open'; lesson: string | null }
  | { t: 'view'; lesson: string; v: ViewInfo }
  | { t: 'goto'; lesson: string; index: number }
  | { t: 'live'; lesson: string; e: LiveEvent }
  | { t: 'patch'; lesson: string; p: Patch }
  | { t: 'laser'; lesson: string; p: LaserPoint | null }
  | { t: 'sel'; lesson: string; s: SelMove | null }
  | { t: 'pods'; lesson: string; pods: Pod[] }
  | { t: 'lesson'; lesson: string; patch: Partial<Lesson> }
  | { t: 'saved'; lesson: string }
  | { t: 'cover'; lesson: string; on: boolean }
  | { t: 'deleted'; lesson: string }

interface Envelope {
  from: string
  role: Role
  m: Msg[]
}

export interface Peer {
  role: Role
  lesson: string | null
  seen: number
  screen?: ScreenInfo | null
}

type Handler = (m: Msg, from: string, role: Role) => void

const FLUSH_MS = 50 // ≤20 messages a second, well inside Supabase's free limits
const BEAT_MS = 4000
const PEER_TTL = 12000
const MAX_BYTES = 180_000

/**
 * The live link between this person's devices. Messages are queued and sent
 * in small batches; fast-changing things (view position, stroke points) are
 * merged so a busy pencil never floods the connection.
 */
export class Hub {
  readonly id = uid(8)
  status: LinkStatus = 'connecting'
  peers = new Map<string, Peer>()
  lesson: string | null = null
  screen: ScreenInfo | null = null
  private queue: Msg[] = []
  private handlers = new Set<Handler>()
  private changeFns = new Set<() => void>()
  private timers: number[] = []
  private offs: (() => void)[] = []
  private dead = false

  constructor(private pipe: Pipe, public role: Role) {
    this.offs.push(
      pipe.onMessage((p) => this.receive(p as Envelope)),
      pipe.onStatus((s) => {
        if (this.dead) return
        const was = this.status
        this.status = s
        if (s === 'live' && was !== 'live') this.sendNow({ t: 'hello', lesson: this.lesson })
        if (s !== 'live') this.peers.clear()
        this.changed()
      }),
    )
    this.timers.push(
      window.setInterval(() => this.flush(), FLUSH_MS),
      window.setInterval(() => {
        this.send({ t: 'here', lesson: this.lesson, screen: this.screen })
        const now = Date.now()
        let gone = false
        for (const [id, p] of this.peers) {
          if (now - p.seen > PEER_TTL) {
            this.peers.delete(id)
            gone = true
          }
        }
        if (gone) this.changed()
      }, BEAT_MS),
    )
  }

  destroy() {
    this.dead = true
    for (const t of this.timers) clearInterval(t)
    for (const o of this.offs) o()
    this.pipe.close()
  }

  on(fn: Handler): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  onChange(fn: () => void): () => void {
    this.changeFns.add(fn)
    return () => this.changeFns.delete(fn)
  }

  private changed() {
    for (const f of this.changeFns) f()
  }

  /** Is a device with this role connected (optionally: looking at this lesson)? */
  peer(role: Role, lesson?: string): Peer | null {
    for (const p of this.peers.values()) {
      if (p.role === role && (lesson === undefined || p.lesson === lesson)) return p
    }
    return null
  }

  setLesson(lesson: string | null) {
    this.lesson = lesson
    this.sendNow({ t: 'hello', lesson })
  }

  setScreen(s: ScreenInfo | null) {
    const same = s && this.screen && s.w === this.screen.w && s.h === this.screen.h && s.m === this.screen.m
    if (same) return
    this.screen = s
    this.send({ t: 'here', lesson: this.lesson, screen: s })
  }

  send(m: Msg) {
    const q = this.queue
    switch (m.t) {
      case 'view':
      case 'sel':
      case 'here':
        this.queue = q.filter((x) => x.t !== m.t)
        break
      case 'live': {
        const e = m.e
        if (e.k === 'pts') {
          const last = q[q.length - 1]
          if (last?.t === 'live' && last.e.k === 'pts' && last.e.id === e.id) {
            last.e = { ...last.e, pts: last.e.pts.concat(e.pts) }
            return
          }
        } else if (e.k === 'replace') {
          this.queue = q.filter((x) => !(x.t === 'live' && x.e.id === e.id && (x.e.k === 'pts' || x.e.k === 'replace')))
        }
        break
      }
    }
    this.queue.push(m)
  }

  sendNow(m: Msg) {
    this.send(m)
    this.flush()
  }

  flush() {
    if (!this.queue.length) return
    const msgs = this.queue
    this.queue = []
    if (this.status !== 'live' || this.dead) return
    let batch: Msg[] = []
    let size = 0
    const out = (b: Msg[]) => this.pipe.send({ from: this.id, role: this.role, m: b } satisfies Envelope)
    for (const m of msgs) {
      for (const piece of splitBig(m)) {
        const n = JSON.stringify(piece).length
        if (size + n > MAX_BYTES && batch.length) {
          out(batch)
          batch = []
          size = 0
        }
        batch.push(piece)
        size += n
      }
    }
    if (batch.length) out(batch)
  }

  private receive(env: Envelope) {
    if (!env || env.from === this.id || !Array.isArray(env.m)) return
    let peer = this.peers.get(env.from)
    const isNew = !peer
    if (!peer) {
      peer = { role: env.role, lesson: null, seen: Date.now() }
      this.peers.set(env.from, peer)
    }
    peer.seen = Date.now()
    let changed = isNew
    for (const m of env.m) {
      if (m.t === 'hello' || m.t === 'here') {
        if (peer.lesson !== m.lesson) changed = true
        peer.lesson = m.lesson
        if (m.t === 'here' && m.screen !== undefined) {
          changed ||= JSON.stringify(peer.screen) !== JSON.stringify(m.screen)
          peer.screen = m.screen
        }
        // Say hi back so the newcomer knows we're here straight away.
        if (m.t === 'hello') this.sendNow({ t: 'here', lesson: this.lesson, screen: this.screen })
      }
      for (const h of this.handlers) h(m, env.from, env.role)
    }
    if (changed) this.changed()
  }
}

/** Break up a message that would be too big for one broadcast. */
function splitBig(m: Msg): Msg[] {
  if (m.t !== 'patch' || JSON.stringify(m).length < MAX_BYTES) return [m]
  const { p } = m
  if (p.add.length <= 1) return [m]
  const half = Math.ceil(p.add.length / 2)
  return [
    ...splitBig({ ...m, p: { page: p.page, remove: p.remove, add: p.add.slice(0, half) } }),
    ...splitBig({ ...m, p: { page: p.page, remove: [], add: p.add.slice(half) } }),
  ]
}
