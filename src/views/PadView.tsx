import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Board, type ViewInfo } from '../board/Board'
import { PAPER_LABELS } from '../board/paper'
import {
  DEFAULT_TOOLS, ERASER_SIZES, HIGHLIGHT_COLORS, HIGHLIGHT_SIZES, PEN_COLORS, PEN_SIZES,
  type ToolName, type ToolState,
} from '../ink/tools'
import type { Backend } from '../lib/backend'
import { pref, setPref } from '../lib/config'
import type { Hub } from '../lib/hub'
import { blankPage, fileUrl } from '../lib/lessons'
import type { Session } from '../lib/session'
import type { PageRef, Paper, Rect } from '../lib/types'
import { PodColumn, type PodContext } from '../pods/Pods'
import {
  IconBack, IconCopy, IconLeft, IconMore, IconPages, IconPlus, IconRedo, IconRight, IconSidebar, IconTrash,
  IconUndo, ToolEraser, ToolHighlighter, ToolLaser, ToolLasso, ToolPen,
} from '../ui/icons'
import { useOutside, useSubscribe, useToast } from '../ui/hooks'
import { PageGrid } from './PageGrid'
import { exportPdf } from './exportPdf'

interface Props {
  session: Session
  hub: Hub
  backend: Backend
  onExit: () => void
}

const TOOL_KEYS: Record<string, ToolName> = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', k: 'laser' }

export function PadView({ session, hub, backend, onExit }: Props) {
  useSubscribe(useCallback((fn) => session.subscribe(fn), [session]))
  useSubscribe(useCallback((fn) => session.ink.subscribe(fn), [session]))
  useSubscribe(useCallback((fn) => hub.onChange(fn), [hub]))
  const lesson = session.lesson

  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<Board | null>(null)
  const [tools, setTools] = useState<ToolState>(() => ({ ...DEFAULT_TOOLS, ...pref<Partial<ToolState>>('tools', {}), tool: 'pen' }))
  const [showPods, setShowPods] = useState(() => pref('padPods', false))
  const [fingerDraw, setFingerDraw] = useState(() => pref('fingerDraw', false))
  const [followZoom, setFollowZoom] = useState(() => pref('followZoom', true))
  const [view, setView] = useState<ViewInfo | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const [pop, setPop] = useState<null | 'more' | 'add' | 'colors'>(null)
  const [grid, setGrid] = useState(false)
  const [compact, setCompact] = useState(() => window.innerWidth < 1060)
  const [toast, setToast] = useToast()
  const [, bump] = useReducer((n: number) => n + 1, 0)

  const index = view?.index ?? 0
  const pageId = lesson.pages[index]?.id ?? ''
  const slides = lesson.layout === 'slides'

  // ------------------------------------------------------------ board lifecycle
  useEffect(() => {
    const id = session.lesson.id
    const b = new Board(hostRef.current!, session.ink, true, {
      onView: (v) => {
        setView(v)
        hub.send({ t: 'view', lesson: id, v })
        setPref(`page.${id}`, v.index)
      },
      onLive: (e) => hub.send({ t: 'live', lesson: id, e }),
      onLaser: (p) => hub.send({ t: 'laser', lesson: id, p }),
      onSelMove: (s) => hub.send({ t: 'sel', lesson: id, s }),
      onSelection: setSel,
      onSwipe: (dir) => b.goTo(b.getIndex() + dir),
      onUndoGesture: () => undoRef.current(),
      onRedoGesture: () => redoRef.current(),
    })
    boardRef.current = b
    b.setPdf(session.pdf)
    b.setDocument(session.lesson.pages, session.lesson.layout, pref(`page.${id}`, 0))
    return () => {
      b.destroy()
      boardRef.current = null
    }
  }, [session, hub])

  useEffect(() => {
    boardRef.current?.setDocument(lesson.pages, lesson.layout)
  }, [lesson.pages, lesson.layout])

  useEffect(() => {
    const b = boardRef.current
    if (!b) return
    b.tools = tools
    b.fingerDraw = fingerDraw
    if (tools.tool !== 'lasso') b.clearSelection()
    b.invalidate('live')
    setPref('tools', { ...tools, tool: undefined })
  }, [tools, fingerDraw])

  // the projector tells us its size so we can mark what the class can see
  const projector = hub.peer('projector', lesson.id)
  const projScreen = projector?.screen ?? null
  useEffect(() => {
    boardRef.current?.setProjectorScreen(followZoom ? projScreen : null)
  }, [projScreen?.w, projScreen?.h, projScreen?.m, followZoom])

  // messages from the projector
  useEffect(() => {
    const id = lesson.id
    return session.onRemote((m) => {
      if (m.t === 'goto') boardRef.current?.goTo(m.index)
      if (m.t === 'hello' && m.lesson === id) {
        const v = boardRef.current?.viewInfo()
        if (v) hub.send({ t: 'view', lesson: id, v: { ...v, fit: v.fit || !followZoomRef.current } })
      }
    })
  }, [session, hub, lesson.id])

  const followZoomRef = useRef(followZoom)
  useEffect(() => {
    followZoomRef.current = followZoom
    setPref('followZoom', followZoom)
    const v = boardRef.current?.viewInfo()
    if (v) hub.send({ t: 'view', lesson: lesson.id, v: { ...v, fit: v.fit || !followZoom } })
  }, [followZoom, hub, lesson.id])

  useEffect(() => {
    const r = () => setCompact(window.innerWidth < 1060)
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [])

  // ------------------------------------------------------------ actions
  const goTo = (i: number) => boardRef.current?.goTo(i)

  const undo = () => {
    boardRef.current?.clearSelection()
    session.ink.undo(slides ? pageId : undefined)
    bump()
  }
  const redo = () => {
    session.ink.redo(slides ? pageId : undefined)
    bump()
  }
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  undoRef.current = undo
  redoRef.current = redo

  const pickTool = (tool: ToolName) => {
    if (tool === tools.tool && (tool === 'pen' || tool === 'highlighter')) {
      setPop((p) => (p === 'colors' ? null : 'colors'))
      return
    }
    setTools((t) => ({ ...t, tool }))
    setPop(null)
  }

  const addPage = (paper: Paper) => {
    const cur = lesson.pages[index]
    const page = blankPage(paper, cur ? { w: cur.w, h: cur.h } : undefined, lesson.layout)
    const pages = [...lesson.pages.slice(0, index + 1), page, ...lesson.pages.slice(index + 1)]
    session.setPages(pages)
    setPop(null)
    requestAnimationFrame(() => boardRef.current?.goTo(index + 1))
  }

  const deletePage = (p: PageRef) => {
    if (p.kind !== 'paper' || lesson.pages.length < 2) return
    if (session.ink.get(p.id).length && !confirm('Delete this page and everything written on it?')) return
    const ids = session.ink.get(p.id).map((s) => s.id)
    if (ids.length) session.ink.commit({ page: p.id, remove: ids, add: [] }, false)
    session.setPages(lesson.pages.filter((x) => x.id !== p.id))
  }

  const clearPage = () => {
    setPop(null)
    const ids = session.ink.get(pageId).map((s) => s.id)
    if (!ids.length) return
    session.ink.commit({ page: pageId, remove: ids, add: [] })
    setToast('Page cleared. Two-finger tap to undo.')
  }

  const rename = () => {
    setPop(null)
    const t = prompt('Lesson name', lesson.title)
    if (t?.trim()) session.setMeta({ title: t.trim() })
  }

  const doExport = async () => {
    setPop(null)
    setToast('Making the PDF…')
    try {
      await exportPdf(session)
      setToast('Saved a PDF with your ink')
    } catch (e) {
      setToast(`Couldn’t export: ${(e as Error).message}`)
    }
  }

  // keyboard (for when there's a keyboard attached, or testing on a laptop)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoRef.current()
        else undoRef.current()
        return
      }
      if (mod) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') boardRef.current?.goTo((boardRef.current?.getIndex() ?? 0) + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') boardRef.current?.goTo((boardRef.current?.getIndex() ?? 0) - 1)
      else if ((e.key === 'Backspace' || e.key === 'Delete') && boardRef.current?.hasSelection()) boardRef.current.deleteSelection()
      else if (TOOL_KEYS[e.key]) setTools((t) => ({ ...t, tool: TOOL_KEYS[e.key] }))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const podCtx: PodContext = useMemo(
    () => ({
      pageId,
      pageNumber: index + 1,
      editing: false,
      controls: true,
      chime: false,
      image: (path: string) => fileUrl(backend, path),
      onChange: (p) => session.updatePod(p.id, () => p),
    }),
    [pageId, index, backend, session],
  )

  const moreRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef<HTMLDivElement>(null)
  const closePop = useCallback(() => setPop(null), [])
  useOutside(moreRef, pop === 'more', closePop)
  useOutside(addRef, pop === 'add', closePop)
  useOutside(colorRef, pop === 'colors', closePop)

  const canUndo = session.ink.canUndo(slides ? pageId : undefined)
  const canRedo = session.ink.canRedo(slides ? pageId : undefined)
  const projOnline = !!hub.peer('projector')
  const statusText =
    session.saveState === 'error'
      ? 'not saved · retrying'
      : hub.status !== 'live'
        ? 'offline'
        : projOnline
          ? session.cover
            ? 'projector covered'
            : 'on the projector'
          : 'projector not connected'

  const t = tools
  const colorPicker = (
    <>
      {t.tool === 'pen' && (
        <>
          <div className="swatch-row">
            {PEN_COLORS.map((c) => (
              <button key={c.value} title={c.name} className={`sw${t.penColor === c.value ? ' on' : ''}`} style={{ background: c.value }} onClick={() => setTools({ ...t, penColor: c.value })} />
            ))}
          </div>
          <div className="size-row">
            {PEN_SIZES.map((s, i) => (
              <button key={s} className={t.penSize === s ? 'on' : ''} onClick={() => setTools({ ...t, penSize: s })} aria-label={`Pen size ${i + 1}`}>
                <i style={{ width: 4 + i * 4, height: 4 + i * 4, background: t.penColor }} />
              </button>
            ))}
          </div>
        </>
      )}
      {t.tool === 'highlighter' && (
        <>
          <div className="swatch-row">
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c.value} title={c.name} className={`sw${t.hlColor === c.value ? ' on' : ''}`} style={{ background: c.value }} onClick={() => setTools({ ...t, hlColor: c.value })} />
            ))}
          </div>
          <div className="size-row">
            {HIGHLIGHT_SIZES.map((s, i) => (
              <button key={s} className={t.hlSize === s ? 'on' : ''} onClick={() => setTools({ ...t, hlSize: s })} aria-label={`Highlighter size ${i + 1}`}>
                <i style={{ width: 6 + i * 4, height: 10 + i * 4, borderRadius: 2, background: t.hlColor }} />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )

  return (
    <div className="pad">
      <div className="toolbar">
        <div className="tb-group tb-left">
          <button className="icon-btn" onClick={onExit} aria-label="Back to lessons">
            <IconBack />
          </button>
          <div className="tb-title">
            <b>{lesson.title}</b>
            <small>
              <i className={`dot ${session.saveState === 'error' || hub.status !== 'live' ? 'bad' : projOnline ? 'live' : 'warn'}`} />
              {statusText}
            </small>
          </div>
        </div>

        <div className="tb-group">
          <div className="tray">
            <button className={t.tool === 'pen' ? 'on' : ''} onClick={() => pickTool('pen')} aria-label="Pen (P)">
              <ToolPen color={t.penColor} />
            </button>
            <button className={t.tool === 'highlighter' ? 'on' : ''} onClick={() => pickTool('highlighter')} aria-label="Highlighter (H)">
              <ToolHighlighter color={t.hlColor} />
            </button>
            <button className={t.tool === 'eraser' ? 'on' : ''} onClick={() => pickTool('eraser')} aria-label="Eraser (E)">
              <ToolEraser />
            </button>
            <button className={t.tool === 'lasso' ? 'on' : ''} onClick={() => pickTool('lasso')} aria-label="Lasso (L)">
              <ToolLasso />
            </button>
            <button className={t.tool === 'laser' ? 'on' : ''} onClick={() => pickTool('laser')} aria-label="Laser pointer (K)">
              <ToolLaser />
            </button>
          </div>
          {(t.tool === 'pen' || t.tool === 'highlighter') &&
            (compact ? (
              <div style={{ position: 'relative' }} ref={colorRef}>
                <button
                  className="icon-btn"
                  onClick={() => setPop((p) => (p === 'colors' ? null : 'colors'))}
                  aria-label="Colour and size"
                >
                  <span className="sw" style={{ display: 'block', width: 24, height: 24, borderRadius: '50%', background: t.tool === 'pen' ? t.penColor : t.hlColor, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' }} />
                </button>
                {pop === 'colors' && (
                  <div className="pop" style={{ left: -60, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {colorPicker}
                  </div>
                )}
              </div>
            ) : (
              <>
                <span className="tb-sep" />
                {colorPicker}
              </>
            ))}
          {t.tool === 'eraser' && (
            <>
              <span className="tb-sep" />
              <div className="size-row">
                <button className={`mode${t.eraserMode === 'stroke' ? ' on' : ''}`} onClick={() => setTools({ ...t, eraserMode: 'stroke' })} title="Erase whole strokes">
                  whole
                </button>
                <button className={`mode${t.eraserMode === 'precise' ? ' on' : ''}`} onClick={() => setTools({ ...t, eraserMode: 'precise' })} title="Erase just what you touch">
                  precise
                </button>
                {ERASER_SIZES.map((s, i) => (
                  <button key={s} className={t.eraserSize === s ? 'on' : ''} onClick={() => setTools({ ...t, eraserSize: s })} aria-label={`Eraser size ${i + 1}`}>
                    <i style={{ width: 6 + i * 5, height: 6 + i * 5, background: 'transparent', border: '1.5px solid var(--ink)' }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="tb-group tb-right">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <IconUndo />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <IconRedo />
          </button>
          <span className="tb-sep" />
          <div className="page-nav">
            {slides && (
              <button className="icon-btn" onClick={() => goTo(index - 1)} disabled={index <= 0} aria-label="Previous page">
                <IconLeft />
              </button>
            )}
            <span>
              {index + 1}/{lesson.pages.length}
            </span>
            {slides && (
              <button className="icon-btn" onClick={() => goTo(index + 1)} disabled={index >= lesson.pages.length - 1} aria-label="Next page">
                <IconRight />
              </button>
            )}
          </div>
          <div style={{ position: 'relative' }} ref={addRef}>
            <button className="icon-btn" onClick={() => setPop((p) => (p === 'add' ? null : 'add'))} aria-label="Add a blank page">
              <IconPlus />
            </button>
            {pop === 'add' && (
              <div className="pop" style={{ right: -40 }}>
                <h4>Add a page after this one</h4>
                <div className="paper-pick">
                  {(Object.keys(PAPER_LABELS) as Paper[]).map((p) => (
                    <button key={p} onClick={() => addPage(p)}>
                      <span className={`swatch paper-${p}`} />
                      {PAPER_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={() => setGrid(true)} aria-label="All pages">
            <IconPages />
          </button>
          <button
            className={`icon-btn${showPods ? ' on' : ''}`}
            onClick={() => {
              setShowPods(!showPods)
              setPref('padPods', !showPods)
            }}
            aria-label={showPods ? 'Hide pods' : 'Show pods'}
          >
            <IconSidebar />
          </button>
          <div style={{ position: 'relative' }} ref={moreRef}>
            <button className="icon-btn" onClick={() => setPop((p) => (p === 'more' ? null : 'more'))} aria-label="More">
              <IconMore />
            </button>
            {pop === 'more' && (
              <div className="menu" style={{ right: 0, top: '100%', width: 290 }}>
                <label>
                  <input type="checkbox" checked={session.cover} onChange={() => session.setCover(!session.cover)} />
                  Cover the projector
                </label>
                <label>
                  <input type="checkbox" checked={followZoom} onChange={() => setFollowZoom(!followZoom)} />
                  Projector zooms in when I do
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={fingerDraw}
                    onChange={() => {
                      setFingerDraw(!fingerDraw)
                      setPref('fingerDraw', !fingerDraw)
                    }}
                  />
                  Draw with my finger too
                </label>
                <hr />
                <div className="menu-label">Show as</div>
                <button onClick={() => session.setMeta({ layout: 'slides' })}>{slides ? '✓ ' : ''}Slides, one page at a time</button>
                <button onClick={() => session.setMeta({ layout: 'scroll' })}>{!slides ? '✓ ' : ''}Scroll, pages stacked</button>
                <hr />
                <button onClick={rename}>Rename lesson</button>
                <button onClick={doExport}>Save as PDF with ink</button>
                <button className="danger" onClick={clearPage}>
                  Clear ink on this page
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pad-main">
        <div className="board-host" ref={hostRef}>
          {sel && tools.tool === 'lasso' && (
            <div className="sel-bar" style={{ left: sel.x + sel.w / 2, top: Math.max(56, sel.y - 16) }}>
              {PEN_COLORS.slice(0, 5).map((c) => (
                <button key={c.value} className="sw" style={{ background: c.value }} onClick={() => boardRef.current?.recolorSelection(c.value)} aria-label={c.name} />
              ))}
              <button className="icon-btn" onClick={() => boardRef.current?.duplicateSelection()} aria-label="Duplicate">
                <IconCopy width={20} height={20} />
              </button>
              <button className="icon-btn" onClick={() => boardRef.current?.deleteSelection()} aria-label="Delete">
                <IconTrash width={20} height={20} />
              </button>
            </div>
          )}
          {session.loadError && <div className="loading-note">{session.loadError}</div>}
        </div>
        {showPods && (
          <div className="pods-panel">
            <PodColumn pods={lesson.pods} ctx={podCtx} />
          </div>
        )}
      </div>

      {grid && (
        <PageGrid
          session={session}
          current={index}
          onPick={(i) => {
            setGrid(false)
            requestAnimationFrame(() => goTo(i))
          }}
          onDelete={deletePage}
          onClose={() => setGrid(false)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
