import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board, type ViewInfo } from '../board/Board'
import type { Backend } from '../lib/backend'
import { pref, setPref } from '../lib/config'
import type { Hub } from '../lib/hub'
import { uid } from '../lib/ids'
import { fileUrl } from '../lib/lessons'
import type { Session } from '../lib/session'
import type { PodType } from '../lib/types'
import { newPod, POD_TYPE_LABEL } from '../pods/defaults'
import { PodEditor } from '../pods/PodEditor'
import { PodColumn, type PodContext } from '../pods/Pods'
import { IconBack, IconExpand, IconEyeOff, IconSidebar, IconSliders } from '../ui/icons'
import { useOutside, useSubscribe } from '../ui/hooks'

interface Props {
  session: Session
  hub: Hub
  backend: Backend
  onExit: () => void
}

export function ProjectorView({ session, hub, backend, onExit }: Props) {
  useSubscribe(useCallback((fn) => session.subscribe(fn), [session]))
  useSubscribe(useCallback((fn) => hub.onChange(fn), [hub]))
  const lesson = session.lesson
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<Board | null>(null)
  const [view, setView] = useState<ViewInfo | null>(null)
  const [editing, setEditing] = useState(false)
  const [openPod, setOpenPod] = useState<string | null>(null)
  const [idle, setIdle] = useState(false)
  const [dragW, setDragW] = useState<number | null>(null)
  const [addMenu, setAddMenu] = useState(false)

  const padHere = !!hub.peer('pad', lesson.id)
  const index = view?.index ?? 0
  const pageId = lesson.pages[index]?.id ?? ''

  // ------------------------------------------------------------ board
  useEffect(() => {
    const id = session.lesson.id
    const b = new Board(hostRef.current!, session.ink, false, {
      onView: (v) => {
        setView(v)
        setPref(`page.${id}`, v.index)
      },
    })
    boardRef.current = b
    b.setPdf(session.pdf)
    b.setDocument(session.lesson.pages, session.lesson.layout, session.padView?.index ?? pref(`page.${id}`, 0))
    if (session.padView) b.follow(session.padView)
    // tell the iPad how big we are so it can show what the class sees
    const ro = new ResizeObserver(() => hub.setScreen(b.screen()))
    ro.observe(hostRef.current!)
    const off = session.onRemote((m) => {
      if (m.t === 'view') b.follow(m.v)
      else if (m.t === 'live') b.remote(m.e)
      else if (m.t === 'laser') b.remoteLaser(m.p)
      else if (m.t === 'sel') b.remoteSelMove(m.s)
    })
    return () => {
      off()
      ro.disconnect()
      hub.setScreen(null)
      b.destroy()
      boardRef.current = null
    }
  }, [session, hub])

  useEffect(() => {
    boardRef.current?.setDocument(lesson.pages, lesson.layout)
    if (session.padView) boardRef.current?.follow(session.padView)
  }, [lesson.pages, lesson.layout, session])

  // iPad went away mid-stroke: don't leave half a line hanging
  useEffect(() => {
    if (!padHere) boardRef.current?.clearRemote()
  }, [padHere])

  // ------------------------------------------------------------ navigation
  const navigate = useCallback(
    (dir: number | 'first' | 'last') => {
      const b = boardRef.current
      if (!b) return
      const n = session.lesson.pages.length
      const i = dir === 'first' ? 0 : dir === 'last' ? n - 1 : b.getIndex() + dir
      if (i < 0 || i >= n) return
      b.goTo(i)
      if (hub.peer('pad', session.lesson.id)) hub.send({ t: 'goto', lesson: session.lesson.id, index: i })
    },
    [session, hub],
  )

  // ------------------------------------------------------------ keyboard + idle mouse
  const editingRef = useRef(editing)
  editingRef.current = editing || !!openPod
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) {
        if (e.key === 'Escape') setOpenPod(null)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          e.preventDefault()
          navigate(1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault()
          navigate(-1)
          break
        case 'Home':
          navigate('first')
          break
        case 'End':
          navigate('last')
          break
        case 'e':
        case 'E':
          setEditing((v) => !v)
          setOpenPod(null)
          break
        case 'p':
        case 'P':
          session.setSettings({ showPods: !session.lesson.settings.showPods })
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'b':
        case 'B':
          session.setCover(!session.cover)
          break
        case 'Escape':
          if (openPod) setOpenPod(null)
          else setEditing(false)
          break
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [navigate, session, openPod])

  useEffect(() => {
    let t = 0
    const wake = () => {
      setIdle(false)
      clearTimeout(t)
      t = window.setTimeout(() => !editingRef.current && setIdle(true), 2500)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [])

  // ------------------------------------------------------------ pods
  const pods = lesson.pods
  const setPods = session.setPods.bind(session)
  const image = useCallback((path: string) => fileUrl(backend, path), [backend])
  const podCtx: PodContext = useMemo(
    () => ({
      pageId,
      pageNumber: index + 1,
      editing,
      controls: true,
      chime: true,
      image,
      onChange: (p) => session.updatePod(p.id, () => p),
      onOpen: (id) => setOpenPod(id),
      onMove: (id, dir) => {
        const list = [...session.lesson.pods]
        const i = list.findIndex((p) => p.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return
        ;[list[i], list[j]] = [list[j], list[i]]
        session.setPods(list)
      },
      onDelete: (id) => {
        const p = session.lesson.pods.find((x) => x.id === id)
        if (!p) return
        const hasStuff =
          (p.type === 'notes' && (p.text.trim() || Object.keys(p.perPage).length)) ||
          (p.type === 'checklist' && p.items.length) ||
          (p.type === 'image' && p.path)
        if (hasStuff && !confirm(`Remove the “${p.title || POD_TYPE_LABEL[p.type]}” pod?`)) return
        if (openPod === id) setOpenPod(null)
        session.setPods(session.lesson.pods.filter((x) => x.id !== id))
      },
      onAdd: () => setAddMenu(true),
    }),
    [pageId, index, editing, image, session, openPod],
  )

  const addPod = (type: PodType) => {
    const p = newPod(type, lesson.layout)
    setPods([...pods, p])
    setAddMenu(false)
    setOpenPod(p.id)
  }

  const uploadImage = async (file: File) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${lesson.id}/img-${uid(6)}.${ext}`
    await backend.putFile(path, file)
    return path
  }

  const editPod = pods.find((p) => p.id === openPod) ?? null
  const showPods = lesson.settings.showPods
  const podWidth = dragW ?? lesson.settings.podWidth

  // ------------------------------------------------------------ resize pods column
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => setDragW(Math.max(0.16, Math.min(0.55, (window.innerWidth - ev.clientX) / window.innerWidth)))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const w = Math.max(0.16, Math.min(0.55, (window.innerWidth - ev.clientX) / window.innerWidth))
      setDragW(null)
      session.setSettings({ podWidth: Math.round(w * 1000) / 1000 })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const addRef = useRef<HTMLDivElement>(null)
  useOutside(addRef, addMenu, useCallback(() => setAddMenu(false), []))

  return (
    <div className={`projector${idle && !editing && !openPod ? ' idle' : ''}`}>
      <div className="board-host" ref={hostRef}>
        {session.loadError && <div className="loading-note">{session.loadError}</div>}
        {editPod && (
          <PodEditor
            key={editPod.id}
            pod={editPod}
            pageId={pageId}
            pageNumber={index + 1}
            pageCount={lesson.pages.length}
            onChange={(p) => session.updatePod(p.id, () => p)}
            onClose={() => setOpenPod(null)}
            onDelete={() => podCtx.onDelete?.(editPod.id)}
            onPage={(d) => navigate(d)}
            onUploadImage={uploadImage}
          />
        )}
      </div>

      {showPods && (
        <div className="pods-panel" style={{ width: `${podWidth * 100}vw` }}>
          <PodColumn pods={pods} ctx={podCtx} />
          {addMenu && (
            <div className="menu" ref={addRef} style={{ left: 30, bottom: 20 }}>
              <div className="menu-label">Add a pod</div>
              {(['notes', 'timer', 'checklist', 'image'] as PodType[]).map((t) => (
                <button key={t} onClick={() => addPod(t)}>{POD_TYPE_LABEL[t]}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {showPods && (
        <div
          className={`resize-handle${dragW != null ? ' dragging' : ''}`}
          style={{ right: `${podWidth * 100}vw`, transform: 'translateX(50%)' }}
          onPointerDown={startResize}
          title="Drag to resize"
        />
      )}

      {session.cover && (
        <div className="cover">
          <p>
            Eyes up here!
            <svg viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden>
              <path d="M2 6C22 3 40 8 62 5s40-3 56 1" />
            </svg>
          </p>
        </div>
      )}

      <div className={`chrome${idle && !editing && !openPod ? ' hide' : ''}`}>
        <button onClick={onExit} title="Back to lessons">
          <IconBack width={16} height={16} /> lessons
        </button>
        <button className={editing ? 'on' : ''} onClick={() => { setEditing(!editing); setOpenPod(null) }}>
          <IconSliders width={16} height={16} /> {editing ? 'done editing' : 'edit pods'} <kbd>E</kbd>
        </button>
        <button onClick={() => session.setSettings({ showPods: !showPods })}>
          <IconSidebar width={16} height={16} /> {showPods ? 'hide pods' : 'show pods'} <kbd>P</kbd>
        </button>
        <button className={session.cover ? 'on' : ''} onClick={() => session.setCover(!session.cover)}>
          <IconEyeOff width={16} height={16} /> cover <kbd>B</kbd>
        </button>
        <button onClick={toggleFullscreen}>
          <IconExpand width={16} height={16} /> full screen <kbd>F</kbd>
        </button>
        <span className="status">
          <i className={`dot ${hub.status !== 'live' ? 'bad' : padHere ? 'live' : 'warn'}`} />
          {hub.status !== 'live' ? 'offline' : padHere ? 'iPad connected' : 'iPad not here · ← → change page'}
          {' · '}
          {index + 1}/{lesson.pages.length}
        </span>
      </div>
    </div>
  )
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.().catch(() => {})
}
