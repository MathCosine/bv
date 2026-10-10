import { useCallback, useEffect, useRef, useState } from 'react'
import type { Backend, User } from '../lib/backend'
import type { Role } from '../lib/config'
import type { Hub } from '../lib/hub'
import { duplicateLesson, fileUrl } from '../lib/lessons'
import type { LessonMeta } from '../lib/types'
import { IconMore, IconPlus } from '../ui/icons'
import { useOutside, useSubscribe, useToast } from '../ui/hooks'
import { NewLesson } from './NewLesson'

interface Props {
  backend: Backend
  user: User
  hub: Hub
  role: Role
  onOpen: (id: string) => void
  onSwitchRole: () => void
  onSignOut: () => void
  onReset: () => void
}

function ago(iso: string) {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Library({ backend, user, hub, role, onOpen, onSwitchRole, onSignOut, onReset }: Props) {
  const [lessons, setLessons] = useState<LessonMeta[] | null>(null)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [acctOpen, setAcctOpen] = useState(false)
  const [toast, setToast] = useToast()
  useSubscribe(useCallback((fn) => hub.onChange(fn), [hub]))

  const load = useCallback(() => {
    backend
      .listLessons()
      .then((l) => {
        setLessons(l)
        setErr('')
      })
      .catch((e) => setErr((e as Error).message))
  }, [backend])

  useEffect(() => {
    load()
    const onFocus = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onFocus)
    // the other device made or renamed something
    const off = hub.on((m) => {
      if (m.t === 'open' || m.t === 'deleted' || (m.t === 'lesson' && ('title' in m.patch || 'pages' in m.patch))) load()
    })
    return () => {
      document.removeEventListener('visibilitychange', onFocus)
      off()
    }
  }, [load, hub])

  const other = role === 'pad' ? 'projector' : 'pad'
  const otherOnline = hub.peer(other)
  const statusText =
    hub.status !== 'live'
      ? hub.status === 'connecting'
        ? 'connecting…'
        : 'offline'
      : otherOnline
        ? `${other === 'pad' ? 'iPad' : 'projector'} connected`
        : `${other === 'pad' ? 'iPad' : 'projector'} not connected`
  const dot = hub.status !== 'live' ? 'bad' : otherOnline ? 'live' : 'warn'

  const acct = useRef<HTMLDivElement>(null)
  useOutside(acct, acctOpen, useCallback(() => setAcctOpen(false), []))

  return (
    <div className={`library${navigator.maxTouchPoints > 0 ? ' touch' : ''}`}>
      <header className="lib-head">
        <h1 className="wordmark">
          Overhead
          <svg viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden>
            <path d="M2 6C22 3 40 8 62 5s40-3 56 1" />
          </svg>
        </h1>
        <div className="grow" />
        <div className="lib-meta">
          <span>
            <i className={`dot ${dot}`} />
            {statusText}
          </span>
          <span>this is the {role === 'pad' ? 'iPad' : 'projector'}</span>
          <div style={{ position: 'relative' }} ref={acct}>
            <button className="text-btn" onClick={() => setAcctOpen((o) => !o)}>
              {backend.kind === 'local' ? 'this device only' : user.email}
            </button>
            {acctOpen && (
              <div className="menu" style={{ right: 0, top: '100%' }}>
                <button onClick={onSwitchRole}>This device is the {role === 'pad' ? 'projector' : 'iPad'} instead</button>
                <hr />
                {backend.kind === 'supabase' && <button onClick={onSignOut}>Sign out</button>}
                <button onClick={onReset}>{backend.kind === 'local' ? 'Connect Supabase instead' : 'Use a different project'}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {role === 'projector' && (
        <div className="waiting">
          <b>Open a lesson on your iPad</b> and it&rsquo;ll appear here by itself. Or click one below to get pods ready before class.
        </div>
      )}

      <div className="lessons">
        <button className="lesson-card new-card" onClick={() => setCreating(true)}>
          <div className="sheet">
            <IconPlus width={28} height={28} />
            New lesson
          </div>
        </button>
        {lessons?.map((l) => (
          <LessonCard
            key={l.id}
            lesson={l}
            backend={backend}
            menuOpen={menu === l.id}
            onMenu={(o) => setMenu(o ? l.id : null)}
            onOpen={() => onOpen(l.id)}
            onChanged={load}
            toast={setToast}
            hub={hub}
          />
        ))}
        {lessons && !lessons.length && (
          <p className="empty-lib">No lessons yet. Make one from a PDF of your slides or worksheet, or start with blank graph paper.</p>
        )}
        {err && <p className="error empty-lib">{err}</p>}
        {!lessons && !err && <p className="hint empty-lib">Loading&hellip;</p>}
      </div>

      {creating && (
        <NewLesson
          backend={backend}
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setCreating(false)
            onOpen(l.id)
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function LessonCard({
  lesson, backend, menuOpen, onMenu, onOpen, onChanged, toast, hub,
}: {
  lesson: LessonMeta
  backend: Backend
  menuOpen: boolean
  onMenu: (open: boolean) => void
  onOpen: () => void
  onChanged: () => void
  toast: (m: string) => void
  hub: Hub
}) {
  const [thumb, setThumb] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, menuOpen, useCallback(() => onMenu(false), [onMenu]))
  useEffect(() => {
    if (lesson.thumb) fileUrl(backend, lesson.thumb).then(setThumb).catch(() => {})
  }, [backend, lesson.thumb])

  const rename = async () => {
    onMenu(false)
    const t = prompt('Lesson name', lesson.title)
    if (!t?.trim()) return
    await backend.updateLesson(lesson.id, { title: t.trim() })
    hub.send({ t: 'lesson', lesson: lesson.id, patch: { title: t.trim() } })
    onChanged()
  }
  const dup = async (withInk: boolean) => {
    onMenu(false)
    toast('Copying…')
    try {
      const full = await backend.getLesson(lesson.id)
      if (full) await duplicateLesson(backend, full, withInk)
      toast(withInk ? 'Copied, with your ink' : 'Made a fresh copy without ink')
      onChanged()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const remove = async () => {
    onMenu(false)
    if (!confirm(`Delete “${lesson.title}” and all its ink? This can’t be undone.`)) return
    try {
      await backend.deleteLesson(lesson.id)
      hub.send({ t: 'deleted', lesson: lesson.id })
      onChanged()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <div className="lesson-card" ref={ref}>
      <button style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={onOpen}>
        <div className="sheet-wrap">
          <div className={`sheet${lesson.pageCount > 1 ? ' stack' : ''}`}>
            {lesson.thumb ? thumb ? <img src={thumb} alt="" /> : null : <div className="blank" />}
          </div>
        </div>
        <h3>{lesson.title}</h3>
        <div className="meta">
          {lesson.pageCount} page{lesson.pageCount === 1 ? '' : 's'} &middot; {lesson.layout} &middot; {ago(lesson.updatedAt)}
        </div>
      </button>
      <button className="card-menu icon-btn" aria-label="Lesson options" onClick={() => onMenu(!menuOpen)}>
        <IconMore width={18} height={18} />
      </button>
      {menuOpen && (
        <div className="menu" style={{ top: 42, right: 0 }}>
          <button onClick={rename}>Rename</button>
          <button onClick={() => dup(false)}>Fresh copy for another class</button>
          <button onClick={() => dup(true)}>Duplicate with ink</button>
          <hr />
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      )}
    </div>
  )
}
