import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ChecklistPod, ImagePod, NotesPod, Pod, TimerPod, TimerState } from '../lib/types'
import { IconClose, IconDown, IconPause, IconPlay, IconPlus, IconReset, IconSliders, IconUp } from '../ui/icons'
import { renderInline, renderNotes } from './markdown'

export interface PodContext {
  pageId: string
  pageNumber: number
  /** laptop edit mode */
  editing: boolean
  /** can tick checklists / run the timer from here */
  controls: boolean
  /** play the chime when a timer runs out (projector only) */
  chime: boolean
  image: (path: string) => Promise<string>
  onChange?: (pod: Pod) => void
  onOpen?: (id: string) => void
  onMove?: (id: string, dir: -1 | 1) => void
  onDelete?: (id: string) => void
  onAdd?: () => void
}

export function notesText(p: NotesPod, pageId: string): string {
  return p.scope === 'page' ? p.perPage[pageId] ?? '' : p.text
}

export function PodColumn({ pods, ctx }: { pods: Pod[]; ctx: PodContext }) {
  const visible = pods.filter((p) => {
    if (ctx.editing) return true
    if (p.hidden) return false
    if (p.type === 'notes' && p.hideWhenEmpty && !notesText(p, ctx.pageId).trim()) return false
    return true
  })
  return (
    <div className={`pods${ctx.editing ? ' is-editing' : ''}`}>
      {visible.map((p, i) => (
        <PodFrame key={p.id} pod={p} ctx={ctx} first={i === 0} last={i === visible.length - 1} />
      ))}
      {ctx.editing && ctx.onAdd && (
        <button className="pod-add" onClick={ctx.onAdd}>
          <IconPlus width={18} height={18} /> add a pod
        </button>
      )}
      {!ctx.editing && !visible.length && <div className="pods-empty" />}
    </div>
  )
}

const ACCENTS: Record<Pod['accent'], string> = {
  graphite: 'var(--ink)',
  red: 'var(--red)',
  blue: 'var(--blue)',
  green: 'var(--green)',
}

function PodFrame({ pod, ctx, first, last }: { pod: Pod; ctx: PodContext; first: boolean; last: boolean }) {
  const style = { '--accent': ACCENTS[pod.accent] } as CSSProperties
  const open = () => ctx.editing && ctx.onOpen?.(pod.id)
  return (
    <section
      className={`pod pod-${pod.type} size-${pod.size}${pod.hidden ? ' is-hidden' : ''}`}
      style={style}
      onClick={ctx.editing ? open : undefined}
    >
      {ctx.editing && (
        <div className="pod-tools" onClick={(e) => e.stopPropagation()}>
          {pod.hidden && <span className="pod-tag">hidden</span>}
          <button title="Move up" disabled={first} onClick={() => ctx.onMove?.(pod.id, -1)}><IconUp width={16} height={16} /></button>
          <button title="Move down" disabled={last} onClick={() => ctx.onMove?.(pod.id, 1)}><IconDown width={16} height={16} /></button>
          <button title="Edit" onClick={open}><IconSliders width={16} height={16} /></button>
          <button title="Remove" onClick={() => ctx.onDelete?.(pod.id)}><IconClose width={16} height={16} /></button>
        </div>
      )}
      {pod.showTitle && pod.title && (
        <h2 className="pod-title">
          <span>{pod.title}</span>
          <svg className="squiggle" viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden>
            <path d="M2 5.5C18 2.5 30 6.5 46 4.2S78 2 92 4.6 112 5.5 118 3.6" />
          </svg>
        </h2>
      )}
      {pod.type === 'notes' && <NotesBody pod={pod} ctx={ctx} />}
      {pod.type === 'timer' && <TimerBody pod={pod} ctx={ctx} />}
      {pod.type === 'checklist' && <ChecklistBody pod={pod} ctx={ctx} />}
      {pod.type === 'image' && <ImageBody pod={pod} ctx={ctx} />}
    </section>
  )
}

function NotesBody({ pod, ctx }: { pod: NotesPod; ctx: PodContext }) {
  const text = notesText(pod, ctx.pageId)
  const html = useMemo(() => renderNotes(text), [text])
  if (!text.trim()) {
    return ctx.editing ? (
      <p className="pod-hint">
        {pod.scope === 'page' ? `Nothing for page ${ctx.pageNumber} yet. Click to write.` : 'Empty. Click to write.'}
      </p>
    ) : null
  }
  return <div className={`notes align-${pod.align}`} dangerouslySetInnerHTML={{ __html: html }} />
}

// ---------------------------------------------------------------- timer

export function timerRemaining(s: TimerState, duration: number, now = Date.now()): number {
  switch (s.status) {
    case 'idle':
      return duration
    case 'running':
      return Math.max(0, s.endsAt - now)
    case 'paused':
      return s.remaining
    case 'done':
      return 0
  }
}

export function timerAction(p: TimerPod, a: 'toggle' | 'reset' | 'plus' | 'minus'): TimerPod {
  const now = Date.now()
  const s = p.state
  if (a === 'reset') return { ...p, state: { status: 'idle' } }
  if (a === 'toggle') {
    if (s.status === 'running') {
      const rem = s.endsAt - now
      return { ...p, state: rem > 0 ? { status: 'paused', remaining: rem } : { status: 'idle' } }
    }
    if (s.status === 'paused') return { ...p, state: { status: 'running', endsAt: now + s.remaining } }
    return { ...p, state: { status: 'running', endsAt: now + p.duration } }
  }
  const d = a === 'plus' ? 60_000 : -60_000
  if (s.status === 'running') return { ...p, state: { status: 'running', endsAt: Math.max(now + 1000, s.endsAt + d) } }
  if (s.status === 'paused') return { ...p, state: { status: 'paused', remaining: Math.max(1000, s.remaining + d) } }
  return { ...p, duration: Math.max(60_000, Math.min(99 * 60_000, p.duration + d)), state: { status: 'idle' } }
}

function fmt(ms: number) {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function TimerBody({ pod, ctx }: { pod: TimerPod; ctx: PodContext }) {
  const [now, setNow] = useState(Date.now())
  const running = pod.state.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [running])
  const rem = timerRemaining(pod.state, pod.duration, now)
  const done = (running && rem <= 0) || pod.state.status === 'done'
  const total = pod.state.status === 'idle' ? pod.duration : Math.max(pod.duration, rem)
  const frac = Math.max(0, Math.min(1, rem / total))

  // chime once when it crosses zero
  const rang = useRef(false)
  useEffect(() => {
    if (!done) rang.current = false
    else if (!rang.current) {
      rang.current = true
      if (ctx.chime && pod.chime) chime()
    }
  }, [done, ctx.chime, pod.chime])

  const act = (a: Parameters<typeof timerAction>[1]) => ctx.onChange?.(timerAction(pod, a))
  return (
    <div className={`timer${done ? ' is-done' : ''}${rem < 10_000 && running && !done ? ' is-close' : ''}`}>
      {done ? <div className="timer-done">Time&rsquo;s up!</div> : <div className="timer-digits">{fmt(rem)}</div>}
      <div className="timer-line">
        <span style={{ transform: `scaleX(${done ? 0 : frac})` }} />
      </div>
      {ctx.controls && (
        <div className="timer-controls" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => act('minus')} title="One minute less">&minus;1</button>
          <button className="primary" onClick={() => act(done ? 'reset' : 'toggle')} title={running && !done ? 'Pause' : 'Start'}>
            {done ? <IconReset width={18} height={18} /> : running ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} />}
          </button>
          <button onClick={() => act('plus')} title="One minute more">+1</button>
          {pod.state.status !== 'idle' && !done && (
            <button onClick={() => act('reset')} title="Reset"><IconReset width={16} height={16} /></button>
          )}
        </div>
      )}
    </div>
  )
}

let audio: AudioContext | null = null
function chime() {
  try {
    audio ??= new AudioContext()
    const ctx = audio
    void ctx.resume()
    const t0 = ctx.currentTime
    // two soft bell tones, like a kitchen timer that isn't trying to scare anyone
    for (const [freq, at] of [[880, 0], [1318.5, 0.18], [880, 0.6], [1318.5, 0.78]] as const) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + at)
      g.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.9)
      o.connect(g).connect(ctx.destination)
      o.start(t0 + at)
      o.stop(t0 + at + 1)
    }
  } catch {
    /* no audio, no problem */
  }
}

// ---------------------------------------------------------------- checklist

function ChecklistBody({ pod, ctx }: { pod: ChecklistPod; ctx: PodContext }) {
  if (!pod.items.length) return ctx.editing ? <p className="pod-hint">No items yet. Click to add some.</p> : null
  const toggle = (id: string) =>
    ctx.onChange?.({ ...pod, items: pod.items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)) })
  return (
    <ul className="checklist">
      {pod.items.map((it) => (
        <li key={it.id} className={it.done ? 'is-done' : ''}>
          <button
            className="check"
            disabled={!ctx.controls}
            onClick={(e) => {
              e.stopPropagation()
              toggle(it.id)
            }}
            aria-label={it.done ? 'Mark not done' : 'Mark done'}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path className="box" d="M4.2 4.6c5-.5 10.3-.4 15.4.1.4 5 .3 10.1-.1 15.1-5.1.4-10.2.4-15.2 0-.4-5-.5-10.1-.1-15.2z" />
              {it.done && <path className="tick" d="M6.5 12.8c1.6 1.4 2.8 2.9 3.9 4.6 2.4-4.6 5.5-8.4 9.6-11.6" />}
            </svg>
          </button>
          <span className="item" dangerouslySetInnerHTML={{ __html: renderInline(it.text) }} />
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- image

function ImageBody({ pod, ctx }: { pod: ImagePod; ctx: PodContext }) {
  const [src, setSrc] = useState<string | null>(null)
  const getImage = ctx.image
  useEffect(() => {
    let live = true
    setSrc(null)
    if (pod.path) getImage(pod.path).then((u) => live && setSrc(u)).catch(() => {})
    return () => {
      live = false
    }
  }, [pod.path, getImage])
  if (!pod.path) return ctx.editing ? <p className="pod-hint">No picture yet. Click to add one.</p> : null
  return (
    <figure className="pod-figure">
      {src ? <img src={src} alt={pod.caption || pod.title} /> : <div className="img-wait" />}
      {pod.caption && <figcaption dangerouslySetInnerHTML={{ __html: renderInline(pod.caption) }} />}
    </figure>
  )
}
