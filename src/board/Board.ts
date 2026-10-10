import type { InkStore, Patch } from '../ink/store'
import {
  eraseFrom, lassoContains, outline, outlineToPath, pointInPolygon, round1, strokeHit, strokePath,
  transformStroke, unionBounds,
} from '../ink/stroke'
import { recognize, scaleShape, shapeCenter, shapePoints, snapLineEnd, straighten, type Shape } from '../ink/shapes'
import { DEFAULT_TOOLS, type ToolState } from '../ink/tools'
import type { PdfPainter } from '../lib/pdf'
import { uid } from '../lib/ids'
import { PAGE_W, type Layout, type PageRef, type PenStyle, type Rect, type Stroke } from '../lib/types'
import { drawPaper } from './paper'

export interface PageBox {
  ref: PageRef
  index: number
  x: number
  y: number
  w: number
  h: number
}

export interface ViewInfo {
  page: string
  index: number
  /** visible area in document units */
  rect: Rect
  /** true when sitting at the default "whole page / page width" zoom */
  fit: boolean
}

export type LiveEvent =
  | { k: 'begin'; id: string; page: string; tool: Stroke['tool']; color: string; size: number; sim: boolean; style?: PenStyle; pts: number[] }
  | { k: 'pts'; id: string; pts: number[] }
  | { k: 'replace'; id: string; pts: number[]; shape: boolean }
  | { k: 'end'; id: string }

export interface LaserPoint {
  page: string
  x: number
  y: number
}

export interface SelMove {
  page: string
  ids: string[]
  m: number[]
}

export interface BoardHooks {
  onView?(v: ViewInfo): void
  onLive?(e: LiveEvent): void
  onLaser?(p: LaserPoint | null): void
  onSelMove?(s: SelMove | null): void
  onSelection?(screen: Rect | null): void
  onSwipe?(dir: 1 | -1): void
  onUndoGesture?(): void
  onRedoGesture?(): void
}

interface RemoteLive {
  page: string
  tool: Stroke['tool']
  color: string
  size: number
  sim: boolean
  style?: PenStyle
  shape: boolean
  pts: number[]
  shown: number
}

interface Selection {
  page: string
  strokes: Stroke[]
  ids: Set<string>
  bbox: Rect
  m: number[]
}

type Action =
  | {
      kind: 'draw'
      pointerId: number
      stroke: Stroke
      box: PageBox
      predicted: number[]
      anchor: [number, number]
      holdTimer: number
      snapped: Shape | null
      /** shape as first recognised, and where the pencil was, for resizing it after */
      snapBase: { shape: Shape; at: [number, number] } | null
      /** smoothed pencil pressure */
      ema: number
    }
  | { kind: 'erase'; pointerId: number; last: [number, number] | null; perPage: Map<string, { originals: Map<string, Stroke>; created: Set<string> }> }
  | { kind: 'lasso'; pointerId: number; box: PageBox; poly: number[]; travel: number }
  | { kind: 'move'; pointerId: number; start: [number, number]; mode: 'move' | 'scale' | 'rotate'; m0: number[] }
  | { kind: 'laser'; pointerId: number }
  | { kind: 'none'; pointerId: number }

interface Touch {
  x: number
  y: number
  x0: number
  y0: number
  t0: number
}

const IDENTITY = [1, 0, 0, 1, 0, 0]
const HOLD_MS = 520
const GAP = 36 // units between pages in scroll layout
const LASER_LIFE = 650

export class Board {
  readonly el: HTMLDivElement
  private bg: HTMLCanvasElement
  private inkC: HTMLCanvasElement
  private live: HTMLCanvasElement
  private bgx: CanvasRenderingContext2D
  private inkx: CanvasRenderingContext2D
  private livex: CanvasRenderingContext2D

  private W = 0
  private H = 0
  private dpr = 1
  private margin: number

  private mode: Layout = 'slides'
  private pages: PageRef[] = []
  private index = 0
  private boxes: PageBox[] = []
  private docH = 0
  cam = { x: 0, y: 0, z: 1 }
  private atFit = true

  private pdf: PdfPainter | null = null
  tools: ToolState = { ...DEFAULT_TOOLS }
  fingerDraw = false
  followZoom = true

  private dirty = { bg: true, ink: true, live: true }
  private raf = 0
  private destroyed = false
  private unsubInk: () => void
  private ro: ResizeObserver
  private rect: DOMRect | null = null

  // input
  private action: Action | null = null
  private touches = new Map<number, Touch>()
  private gesture: {
    kind: 'pan' | 'pinch' | 'swipe' | 'pending'
    cam0: { x: number; y: number; z: number }
    mid0: [number, number]
    dist0: number
    maxTouches: number
    moved: number
    t0: number
    samples: { t: number; x: number; y: number }[]
  } | null = null
  private inertia: { vx: number; vy: number; t: number } | null = null
  private lastTap = { t: 0, x: 0, y: 0 }
  private hover: { x: number; y: number } | null = null
  private sel: Selection | null = null
  private swipeDx = 0
  private fingerTouch: { id: number; x: number; y: number; t: number } | null = null
  /** new pen strokes waiting to be painted on top of the ink layer (no full redraw needed) */
  private pendingInk: { page: string; s: Stroke }[] = []
  private images = new Map<string, CanvasImageSource | 'loading' | 'error'>()
  private imageLoader: ((path: string) => Promise<CanvasImageSource>) | null = null

  // remote (things the other device is doing)
  private remoteLive = new Map<string, RemoteLive>()
  private remoteSel: { page: string; ids: Set<string>; m: number[] } | null = null
  private laserTrail: (LaserPoint & { t: number })[] = []
  private laserOn = false
  private projectorAspect: number | null = null
  private followView: ViewInfo | null = null

  constructor(
    host: HTMLElement,
    private ink: InkStore,
    private interactive: boolean,
    private hooks: BoardHooks = {},
  ) {
    this.margin = interactive ? 14 : 18
    this.el = document.createElement('div')
    this.el.className = 'board'
    this.bg = document.createElement('canvas')
    this.inkC = document.createElement('canvas')
    this.live = document.createElement('canvas')
    for (const c of [this.bg, this.inkC, this.live]) this.el.appendChild(c)
    host.appendChild(this.el)
    this.bgx = this.bg.getContext('2d')!
    this.inkx = this.inkC.getContext('2d')!
    // `desynchronized` lets Chrome skip the compositor for lower pen latency.
    this.livex = (this.live.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings) ??
      this.live.getContext('2d'))!

    this.unsubInk = ink.subscribe((page, _origin, patch) => {
      // Plain new pen strokes are painted straight on top of the ink layer;
      // anything else (erasing, moving, highlighter) redraws properly.
      const simple = patch && !patch.remove.length && patch.add.every((st) => st.tool === 'pen')
      if (simple && !this.dirty.ink && !this.hiddenIds(page) && !this.swipeDx) {
        for (const st of patch.add) this.pendingInk.push({ page, s: st })
      } else {
        this.invalidate('ink')
      }
      if (!simple) this.invalidate('bg')
      this.invalidate('live')
    })
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.el)
    this.resize()

    if (interactive) {
      this.el.addEventListener('pointerdown', this.onDown)
      this.el.addEventListener('pointermove', this.onMove)
      this.el.addEventListener('pointerup', this.onUp)
      this.el.addEventListener('pointercancel', this.onCancel)
      this.el.addEventListener('pointerleave', this.onLeave)
      // iPad Safari: stop the long-press magnifier, text selection and
      // double-tap zoom from ever kicking in on the drawing surface.
      const stop = (e: Event) => e.preventDefault()
      this.el.addEventListener('touchstart', stop, { passive: false })
      this.el.addEventListener('touchmove', stop, { passive: false })
      this.el.addEventListener('selectstart', stop)
    }
    this.el.addEventListener('wheel', this.onWheel, { passive: false })
    this.el.addEventListener('contextmenu', (e) => e.preventDefault())
    this.loop()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.unsubInk()
    this.ro.disconnect()
    this.el.remove()
    for (const c of [this.bg, this.inkC, this.live]) {
      c.width = 0
      c.height = 0
    }
  }

  // ---------------------------------------------------------------- layout

  setDocument(pages: PageRef[], mode: Layout, index = this.index) {
    const modeChanged = mode !== this.mode
    this.pages = pages
    this.mode = mode
    this.index = Math.max(0, Math.min(index, pages.length - 1))
    this.layout()
    if (modeChanged || this.atFit) this.fit()
    else this.clampCam()
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }

  setPdf(p: PdfPainter | null) {
    this.pdf = p
    if (p) p.onReady = () => this.invalidate('bg')
    this.invalidate('bg')
  }

  /** How to fetch photo pages (they're stored as files). */
  setImageLoader(fn: ((path: string) => Promise<CanvasImageSource>) | null) {
    this.imageLoader = fn
    this.invalidate('bg')
  }

  private image(path: string): CanvasImageSource | null {
    const got = this.images.get(path)
    if (got === 'loading' || got === 'error') return null
    if (got) return got
    if (!this.imageLoader) return null
    this.images.set(path, 'loading')
    this.imageLoader(path)
      .then((img) => {
        this.images.set(path, img)
        this.invalidate('bg')
      })
      .catch(() => this.images.set(path, 'error'))
    return null
  }

  getIndex() {
    return this.index
  }

  getMode() {
    return this.mode
  }

  private layout() {
    if (this.mode === 'slides') {
      const ref = this.pages[this.index]
      this.boxes = ref ? [{ ref, index: this.index, x: 0, y: 0, w: PAGE_W, h: (PAGE_W * ref.h) / ref.w }] : []
      this.docH = this.boxes[0]?.h ?? 0
    } else {
      let y = 0
      this.boxes = this.pages.map((ref, index) => {
        const h = (PAGE_W * ref.h) / ref.w
        const b = { ref, index, x: 0, y, w: PAGE_W, h }
        y += h + GAP
        return b
      })
      this.docH = Math.max(0, y - GAP)
    }
  }

  /** Go to a page. In slides mode this swaps the page; in scroll mode it scrolls to it. */
  goTo(index: number) {
    index = Math.max(0, Math.min(index, this.pages.length - 1))
    this.clearSelection()
    if (this.mode === 'slides') {
      this.index = index
      this.layout()
      this.fit()
    } else {
      const b = this.boxes[index]
      if (!b) return
      this.index = index
      this.cam.y = b.y - this.margin / this.cam.z
      this.clampCam()
      this.atFit = this.isFit()
    }
    this.inertia = null
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }

  private fitZoom(): number {
    const m = this.margin * 2
    if (!this.W || !this.H) return 1
    if (this.mode === 'slides') {
      const b = this.boxes[0]
      if (!b) return 1
      return Math.max(0.05, Math.min((this.W - m) / b.w, (this.H - m) / b.h))
    }
    return Math.max(0.05, (this.W - m) / PAGE_W)
  }

  fit() {
    const z = this.fitZoom()
    this.cam.z = z
    if (this.mode === 'slides') {
      const b = this.boxes[0]
      if (b) {
        this.cam.x = b.x + b.w / 2 - this.W / 2 / z
        this.cam.y = b.y + b.h / 2 - this.H / 2 / z
      }
    } else {
      this.cam.x = PAGE_W / 2 - this.W / 2 / z
      this.clampCam()
    }
    this.atFit = true
    this.invalidate('bg', 'ink', 'live')
  }

  private isFit() {
    return Math.abs(this.cam.z / this.fitZoom() - 1) < 0.01
  }

  private clampCam() {
    const z = this.cam.z
    const vw = this.W / z, vh = this.H / z
    const m = this.margin / z
    let x0 = 0, x1 = PAGE_W, y0 = 0, y1 = this.docH
    if (this.mode === 'slides' && this.boxes[0]) {
      const b = this.boxes[0]
      x0 = b.x; x1 = b.x + b.w; y0 = b.y; y1 = b.y + b.h
    }
    const fitAxis = (lo: number, hi: number, view: number, cur: number) => {
      const size = hi - lo + 2 * m
      if (size <= view) return (lo + hi) / 2 - view / 2
      return Math.max(lo - m, Math.min(cur, hi + m - view))
    }
    this.cam.x = fitAxis(x0, x1, vw, this.cam.x)
    this.cam.y = fitAxis(y0, y1, vh, this.cam.y)
  }

  private resize() {
    const r = this.el.getBoundingClientRect()
    this.rect = r
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const W = Math.round(r.width), H = Math.round(r.height)
    if (W === this.W && H === this.H && dpr === this.dpr) return
    // Keep whatever was in the middle of the screen in the middle.
    const cx = this.cam.x + this.W / 2 / this.cam.z
    const cy = this.cam.y + this.H / 2 / this.cam.z
    const wasFit = this.atFit || !this.W
    this.W = W
    this.H = H
    this.dpr = dpr
    for (const c of [this.bg, this.inkC, this.live]) {
      c.width = Math.max(1, Math.round(W * dpr))
      c.height = Math.max(1, Math.round(H * dpr))
    }
    if (wasFit) {
      const keepY = this.mode === 'scroll' && this.W ? cy : null
      this.fit()
      if (keepY != null && this.boxes.length) {
        this.cam.y = keepY - this.H / 2 / this.cam.z
        this.clampCam()
      }
    } else {
      this.cam.x = cx - W / 2 / this.cam.z
      this.cam.y = cy - H / 2 / this.cam.z
      this.clampCam()
    }
    if (this.followView) this.follow(this.followView)
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }

  /** Size of this board in CSS px (the projector tells the iPad so it can show what's visible). */
  screen() {
    return { w: this.W, h: this.H, m: this.margin }
  }

  // ---------------------------------------------------------------- view sync

  viewInfo(): ViewInfo {
    const z = this.cam.z
    const rect = { x: this.cam.x, y: this.cam.y, w: this.W / z, h: this.H / z }
    let index = this.index
    if (this.mode === 'scroll' && this.boxes.length) {
      const cy = rect.y + rect.h / 2
      index = this.boxes.length - 1
      for (const b of this.boxes) {
        if (cy < b.y + b.h + GAP / 2) {
          index = b.index
          break
        }
      }
      this.index = index
    }
    return { page: this.pages[index]?.id ?? '', index, rect, fit: this.atFit }
  }

  private lastViewKey = ''
  private emitView() {
    if (!this.hooks.onView || !this.W) return
    const v = this.viewInfo()
    const key = `${v.index}:${v.rect.x.toFixed(1)}:${v.rect.y.toFixed(1)}:${v.rect.w.toFixed(1)}:${v.fit}`
    if (key === this.lastViewKey) return
    this.lastViewKey = key
    this.hooks.onView(v)
    if (this.sel) this.emitSelection()
  }

  /** Projector: show what the iPad is looking at. */
  follow(v: ViewInfo) {
    this.followView = v
    if (!this.W || !this.pages.length) return
    if (this.mode === 'slides') {
      const idx = this.pages.findIndex((p) => p.id === v.page)
      const target = idx >= 0 ? idx : Math.min(v.index, this.pages.length - 1)
      if (target !== this.index || !this.boxes.length) {
        this.index = target
        this.layout()
      }
      if (v.fit || !this.followZoom) {
        this.fit()
      } else {
        this.containRect(v.rect)
      }
    } else {
      if (v.fit || !this.followZoom) {
        const cy = v.rect.y + v.rect.h / 2
        this.cam.z = this.fitZoom()
        this.cam.x = PAGE_W / 2 - this.W / 2 / this.cam.z
        this.cam.y = cy - this.H / 2 / this.cam.z
        this.clampCam()
        this.atFit = true
      } else {
        this.containRect(v.rect)
      }
    }
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }

  private containRect(r: Rect) {
    const z = Math.min(this.W / r.w, this.H / r.h)
    this.cam.z = z
    this.cam.x = r.x + r.w / 2 - this.W / 2 / z
    this.cam.y = r.y + r.h / 2 - this.H / 2 / z
    this.atFit = false
  }

  /** iPad: the projector's board size, so we can mark what's visible up there. */
  setProjectorScreen(s: { w: number; h: number; m: number } | null) {
    this.projectorAspect = s && s.w > 0 ? s.h / (s.w - 2 * s.m) : null
    this.invalidate('live')
  }

  // ---------------------------------------------------------------- remote input

  remote(e: LiveEvent) {
    if (e.k === 'begin') {
      this.remoteLive.set(e.id, { page: e.page, tool: e.tool, color: e.color, size: e.size, sim: e.sim, style: e.style, shape: false, pts: e.pts.slice(), shown: 0 })
    } else if (e.k === 'pts') {
      const l = this.remoteLive.get(e.id)
      if (l) l.pts.push(...e.pts)
    } else if (e.k === 'replace') {
      const l = this.remoteLive.get(e.id)
      if (l) {
        l.pts = e.pts.slice()
        l.shape = e.shape
        l.shown = l.pts.length
      }
    } else if (e.k === 'end') {
      this.remoteLive.delete(e.id)
    }
    this.invalidate('live', 'bg')
  }

  remoteLaser(p: LaserPoint | null) {
    if (p) {
      this.laserTrail.push({ ...p, t: performance.now() })
      this.laserOn = true
    } else {
      this.laserOn = false
    }
    this.invalidate('live')
  }

  remoteSelMove(s: SelMove | null) {
    this.remoteSel = s ? { page: s.page, ids: new Set(s.ids), m: s.m } : null
    this.invalidate('ink', 'live')
  }

  clearRemote() {
    this.remoteLive.clear()
    this.remoteSel = null
    this.laserOn = false
    this.invalidate('ink', 'live', 'bg')
  }

  // ---------------------------------------------------------------- selection API

  hasSelection() {
    return !!this.sel
  }

  clearSelection() {
    if (!this.sel) return
    this.sel = null
    this.hooks.onSelection?.(null)
    this.hooks.onSelMove?.(null)
    this.invalidate('ink', 'live')
  }

  deleteSelection() {
    const s = this.sel
    if (!s) return
    this.sel = null
    this.ink.commit({ page: s.page, remove: [...s.ids], add: [] })
    this.hooks.onSelection?.(null)
    this.hooks.onSelMove?.(null)
  }

  duplicateSelection() {
    const s = this.sel
    if (!s) return
    const off = 24
    const copies = s.strokes.map((st) => transformStroke(st, [1, 0, 0, 1, off, off], uid()))
    this.ink.commit({ page: s.page, remove: [], add: copies })
    this.select(s.page, copies)
  }

  recolorSelection(color: string) {
    const s = this.sel
    if (!s) return
    const next = s.strokes.map((st) => (st.tool === 'pen' && st.color !== color ? { ...st, id: uid(), color } : st))
    const added = next.filter((n, i) => n !== s.strokes[i])
    if (!added.length) return
    const oldIds = s.strokes.filter((st, i) => next[i] !== st).map((st) => st.id)
    this.ink.commit({ page: s.page, remove: oldIds, add: added })
    this.select(s.page, next)
  }

  private select(page: string, strokes: Stroke[]) {
    const bbox = unionBounds(strokes)
    if (!bbox) {
      this.clearSelection()
      return
    }
    this.sel = { page, strokes, ids: new Set(strokes.map((s) => s.id)), bbox, m: IDENTITY.slice() }
    this.emitSelection()
    this.invalidate('ink', 'live')
  }

  private emitSelection() {
    const c = this.selectionCorners()
    if (!c) return
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    this.hooks.onSelection?.({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y })
  }

  // ---------------------------------------------------------------- render loop

  invalidate(...layers: ('bg' | 'ink' | 'live')[]) {
    for (const l of layers) this.dirty[l] = true
  }

  private loop = () => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    this.stepInertia(now)
    // Remote strokes are revealed a few points per frame so they glide in
    // smoothly instead of jumping each time a network batch lands.
    for (const l of this.remoteLive.values()) {
      if (l.shown < l.pts.length) {
        const pending = (l.pts.length - l.shown) / 3
        l.shown = Math.min(l.pts.length, l.shown + Math.max(1, Math.ceil(pending / 3)) * 3)
        this.dirty.live = true
        if (l.tool === 'highlighter') this.dirty.bg = true
      }
    }
    if (this.laserTrail.length) {
      this.laserTrail = this.laserTrail.filter((p) => now - p.t < LASER_LIFE)
      if (!this.laserOn && this.laserTrail.length && now - this.laserTrail[this.laserTrail.length - 1].t > LASER_LIFE) this.laserTrail = []
      this.dirty.live = true
    }
    if (this.dirty.bg) this.renderBg()
    if (this.dirty.ink) this.renderInk()
    else if (this.pendingInk.length) this.paintPending()
    if (this.dirty.live) this.renderLive(now)
  }

  private visibleBoxes(): PageBox[] {
    const z = this.cam.z
    const x0 = this.cam.x, y0 = this.cam.y, x1 = x0 + this.W / z, y1 = y0 + this.H / z
    return this.boxes.filter((b) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0)
  }

  /** Set a transform so drawing happens in this page's units. */
  private pageTransform(ctx: CanvasRenderingContext2D, b: PageBox, extra?: number[]) {
    const k = this.cam.z * this.dpr
    const ox = (b.x - this.cam.x) * k, oy = (b.y - this.cam.y) * k
    ctx.setTransform(k, 0, 0, k, ox, oy)
    if (extra) ctx.transform(extra[0], extra[1], extra[2], extra[3], extra[4], extra[5])
  }

  private clipPage(ctx: CanvasRenderingContext2D, b: PageBox) {
    ctx.beginPath()
    ctx.rect(0, 0, b.w, b.h)
    ctx.clip()
  }

  private renderBg() {
    this.dirty.bg = false
    const ctx = this.bgx
    const dpr = this.dpr, z = this.cam.z, k = z * dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.bg.width, this.bg.height)
    const vis = this.visibleBoxes()
    const keep = new Set<number>()
    for (const b of vis) {
      const sx = (b.x - this.cam.x) * k + this.swipeDx * dpr, sy = (b.y - this.cam.y) * k
      const sw = b.w * k, sh = b.h * k
      // A sheet of paper sitting on the desk: a hard offset edge, no blur.
      ctx.fillStyle = 'rgba(70, 58, 40, 0.16)'
      ctx.fillRect(sx + 2 * dpr, sy + 3 * dpr, sw, sh)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(sx, sy, sw, sh)

      if (b.ref.kind === 'pdf' && this.pdf) {
        keep.add(b.ref.n)
        const vr = {
          x: Math.max(0, this.cam.x - b.x),
          y: Math.max(0, this.cam.y - b.y),
          w: 0,
          h: 0,
        }
        vr.w = Math.min(b.w, this.cam.x + this.W / z - b.x) - vr.x
        vr.h = Math.min(b.h, this.cam.y + this.H / z - b.y) - vr.y
        const { base, detail } = this.pdf.get(b.ref.n, b.h, k, this.gesture || this.inertia ? null : vr, this.fitZoom() * PAGE_W * dpr)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        if (base) ctx.drawImage(base.canvas, sx, sy, sw, sh)
        if (detail) {
          const r = detail.rect
          ctx.drawImage(detail.canvas, sx + r.x * k, sy + r.y * k, r.w * k, r.h * k)
        }
      } else if (b.ref.kind === 'image') {
        const img = this.image(b.ref.path)
        if (img) {
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, sx, sy, sw, sh)
        }
      } else if (b.ref.kind === 'paper') {
        ctx.save()
        this.pageTransform(ctx, b)
        if (this.swipeDx) ctx.translate(this.swipeDx / z, 0)
        this.clipPage(ctx, b)
        const x0 = this.cam.x - b.x, y0 = this.cam.y - b.y
        drawPaper(ctx, b.ref.paper, b.w, b.h, k, { x0, y0, x1: x0 + this.W / z, y1: y0 + this.H / z })
        ctx.restore()
      }

      // Highlighter goes under the ink and multiplies with the page so the
      // printed text stays crisp and black underneath it.
      const hl = this.ink.get(b.ref.id).filter((s) => s.tool === 'highlighter')
      const liveHL = this.liveHighlights(b.ref.id)
      if (hl.length || liveHL.length) {
        ctx.save()
        this.pageTransform(ctx, b)
        if (this.swipeDx) ctx.translate(this.swipeDx / z, 0)
        this.clipPage(ctx, b)
        ctx.globalCompositeOperation = 'multiply'
        const hidden = this.hiddenIds(b.ref.id)
        for (const s of hl) {
          if (hidden?.has(s.id)) continue
          ctx.fillStyle = s.color
          ctx.fill(strokePath(s))
        }
        for (const [color, path] of liveHL) {
          ctx.fillStyle = color
          ctx.fill(path)
        }
        ctx.restore()
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.strokeStyle = 'rgba(40, 32, 20, 0.22)'
      ctx.lineWidth = 1
      ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(sw) - 1, Math.round(sh) - 1)
    }
    this.pdf?.dropDetailsExcept(keep)
  }

  private liveHighlights(page: string): [string, Path2D][] {
    const out: [string, Path2D][] = []
    const a = this.action
    if (a?.kind === 'draw' && a.stroke.tool === 'highlighter' && a.box.ref.id === page && a.stroke.pts.length) {
      out.push([a.stroke.color, outlineToPath(outline(a.stroke))])
    }
    for (const l of this.remoteLive.values()) {
      if (l.tool !== 'highlighter' || l.page !== page || !l.shown) continue
      out.push([l.color, outlineToPath(outline({ tool: l.tool, size: l.size, sim: l.sim, shape: l.shape, pts: l.pts.slice(0, l.shown) }))])
    }
    return out
  }

  private hiddenIds(page: string): Set<string> | null {
    if (this.sel?.page === page) return this.sel.ids
    if (this.remoteSel?.page === page) return this.remoteSel.ids
    return null
  }

  private paintPending() {
    const ctx = this.inkx
    const vis = this.visibleBoxes()
    for (const { page, s } of this.pendingInk) {
      const b = vis.find((x) => x.ref.id === page)
      if (!b) continue
      ctx.save()
      this.pageTransform(ctx, b)
      this.clipPage(ctx, b)
      ctx.fillStyle = s.color
      ctx.fill(strokePath(s))
      ctx.restore()
    }
    this.pendingInk = []
  }

  private renderInk() {
    this.dirty.ink = false
    this.pendingInk = []
    const ctx = this.inkx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.inkC.width, this.inkC.height)
    for (const b of this.visibleBoxes()) {
      const strokes = this.ink.get(b.ref.id)
      if (!strokes.length) continue
      ctx.save()
      this.pageTransform(ctx, b)
      if (this.swipeDx) ctx.translate(this.swipeDx / this.cam.z, 0)
      this.clipPage(ctx, b)
      const hidden = this.hiddenIds(b.ref.id)
      for (const s of strokes) {
        if (s.tool !== 'pen' || hidden?.has(s.id)) continue
        ctx.fillStyle = s.color
        ctx.fill(strokePath(s))
      }
      ctx.restore()
    }
  }

  private renderLive(now: number) {
    this.dirty.live = false
    const ctx = this.livex
    const dpr = this.dpr, z = this.cam.z
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.live.width, this.live.height)
    const boxOf = (id: string) => this.boxes.find((b) => b.ref.id === id)

    // what the projector can see (iPad, scroll mode, when it's cropping)
    if (this.interactive && this.mode === 'scroll' && this.projectorAspect && this.atFit) {
      const visH = PAGE_W * this.projectorAspect
      const viewH = this.H / z
      if (visH < viewH - 4) {
        const top = ((viewH - visH) / 2) * z * dpr
        const bot = top + visH * z * dpr
        ctx.fillStyle = 'rgba(60, 50, 30, 0.07)'
        ctx.fillRect(0, 0, this.live.width, top)
        ctx.fillRect(0, bot, this.live.width, this.live.height - bot)
        ctx.strokeStyle = 'rgba(194, 54, 31, 0.35)'
        ctx.setLineDash([6 * dpr, 6 * dpr])
        ctx.lineWidth = dpr
        ctx.beginPath()
        ctx.moveTo(0, top); ctx.lineTo(this.live.width, top)
        ctx.moveTo(0, bot); ctx.lineTo(this.live.width, bot)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // stroke being drawn here
    const a = this.action
    if (a?.kind === 'draw' && a.stroke.tool === 'pen' && a.stroke.pts.length) {
      ctx.save()
      this.pageTransform(ctx, a.box)
      this.clipPage(ctx, a.box)
      ctx.fillStyle = a.stroke.color
      const pts = a.predicted.length ? a.stroke.pts.concat(a.predicted) : a.stroke.pts
      ctx.fill(outlineToPath(outline({ ...a.stroke, pts })))
      ctx.restore()
    }
    if (a?.kind === 'draw' && a.stroke.tool === 'highlighter') this.dirty.bg = true

    // strokes being drawn on the other device
    for (const l of this.remoteLive.values()) {
      if (l.tool !== 'pen' || !l.shown) continue
      const b = boxOf(l.page)
      if (!b) continue
      ctx.save()
      this.pageTransform(ctx, b)
      this.clipPage(ctx, b)
      ctx.fillStyle = l.color
      ctx.fill(outlineToPath(outline({ tool: l.tool, size: l.size, sim: l.sim, style: l.style, shape: l.shape, pts: l.pts.slice(0, l.shown) })))
      ctx.restore()
    }

    // selection being moved (local or remote)
    const moving = this.sel ? { page: this.sel.page, ids: this.sel.ids, m: this.sel.m } : this.remoteSel
    if (moving) {
      const b = boxOf(moving.page)
      if (b) {
        const strokes = this.ink.get(moving.page).filter((s) => moving.ids.has(s.id))
        ctx.save()
        this.pageTransform(ctx, b, moving.m)
        for (const s of strokes) {
          ctx.globalCompositeOperation = s.tool === 'highlighter' ? 'multiply' : 'source-over'
          ctx.fillStyle = s.color
          ctx.fill(strokePath(s))
        }
        ctx.restore()
      }
    }
    if (this.sel) {
      const c = this.selectionCorners()
      if (c) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.strokeStyle = '#2f5d8a'
        ctx.lineWidth = 1.5 * dpr
        ctx.setLineDash([5 * dpr, 4 * dpr])
        ctx.beginPath()
        c.forEach(([x, y], i) => (i ? ctx.lineTo(x * dpr, y * dpr) : ctx.moveTo(x * dpr, y * dpr)))
        ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])
        // rotate handle on a little stem, resize handle bottom right
        const [rx, ry] = this.rotateHandle(c)
        const mx = (c[0][0] + c[1][0]) / 2, my = (c[0][1] + c[1][1]) / 2
        ctx.beginPath()
        ctx.moveTo(mx * dpr, my * dpr)
        ctx.lineTo(rx * dpr, ry * dpr)
        ctx.stroke()
        ctx.fillStyle = '#fffefa'
        for (const [hx, hy] of [[rx, ry], c[2]]) {
          ctx.beginPath()
          ctx.arc(hx * dpr, hy * dpr, 7 * dpr, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
        // a tiny turning arrow inside the rotate handle
        ctx.beginPath()
        ctx.arc(rx * dpr, ry * dpr, 3.2 * dpr, -Math.PI * 0.9, Math.PI * 0.5)
        ctx.lineWidth = 1.2 * dpr
        ctx.stroke()
      }
    }

    // lasso path
    if (a?.kind === 'lasso' && a.poly.length > 2) {
      ctx.save()
      this.pageTransform(ctx, a.box)
      ctx.beginPath()
      ctx.moveTo(a.poly[0], a.poly[1])
      for (let i = 2; i < a.poly.length; i += 2) ctx.lineTo(a.poly[i], a.poly[i + 1])
      ctx.lineWidth = 1.5 / z
      ctx.setLineDash([6 / z, 5 / z])
      ctx.strokeStyle = '#2f5d8a'
      ctx.stroke()
      ctx.fillStyle = 'rgba(47, 93, 138, 0.06)'
      ctx.fill()
      ctx.restore()
    }

    // laser pointer: a fading tail drawn in a few chunks (one path each, so
    // overlapping segments don't show up as beads), then a glowing dot
    if (this.laserTrail.length) {
      const pts = this.laserTrail
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const CHUNKS = 5
      const per = Math.max(2, Math.ceil(pts.length / CHUNKS))
      for (let c = 0; c * per < pts.length - 1; c++) {
        const from = c * per, to = Math.min(pts.length - 1, from + per)
        const age = Math.min(1, (now - pts[to].t) / LASER_LIFE)
        ctx.beginPath()
        let started = false
        for (let i = from; i <= to; i++) {
          const p = pts[i]
          const b = boxOf(p.page)
          if (!b) continue
          const [x, y] = this.screenOf(b, p.x, p.y)
          if (!started || pts[i - 1]?.page !== p.page) ctx.moveTo(x * dpr, y * dpr)
          else ctx.lineTo(x * dpr, y * dpr)
          started = true
        }
        ctx.strokeStyle = `rgba(235, 45, 30, ${0.5 * (1 - age)})`
        ctx.lineWidth = (4 + 4 * (1 - age)) * dpr
        ctx.stroke()
      }
      const last = pts[pts.length - 1]
      const b = boxOf(last.page)
      if (b && (this.laserOn || now - last.t < LASER_LIFE)) {
        const fade = this.laserOn ? 1 : 1 - (now - last.t) / LASER_LIFE
        const [x, y] = this.screenOf(b, last.x, last.y)
        const g = ctx.createRadialGradient(x * dpr, y * dpr, 0, x * dpr, y * dpr, 16 * dpr)
        g.addColorStop(0, `rgba(255, 70, 50, ${0.9 * fade})`)
        g.addColorStop(0.35, `rgba(240, 40, 25, ${0.55 * fade})`)
        g.addColorStop(1, 'rgba(240, 40, 25, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x * dpr, y * dpr, 16 * dpr, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(255, 245, 240, ${fade})`
        ctx.beginPath()
        ctx.arc(x * dpr, y * dpr, 2.5 * dpr, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // pencil hover / eraser ring
    if (this.hover && this.interactive) {
      const { x, y } = this.hover
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const t = this.tools
      if (t.tool === 'eraser' || a?.kind === 'erase') {
        ctx.strokeStyle = 'rgba(40, 32, 20, 0.55)'
        ctx.lineWidth = dpr
        ctx.beginPath()
        ctx.arc(x * dpr, y * dpr, t.eraserSize * dpr, 0, Math.PI * 2)
        ctx.stroke()
      } else if (!a && (t.tool === 'pen' || t.tool === 'highlighter')) {
        const size = (t.tool === 'pen' ? t.penSize * (t.penStyle === 'felt' ? 0.85 : 1) : t.hlSize) * z
        ctx.fillStyle = t.tool === 'pen' ? t.penColor : t.hlColor
        ctx.globalAlpha = t.tool === 'pen' ? 0.55 : 0.5
        ctx.beginPath()
        ctx.arc(x * dpr, y * dpr, Math.max(1.5, size / 2) * dpr, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }
  }

  private screenOf(b: PageBox, x: number, y: number): [number, number] {
    return [(b.x + x - this.cam.x) * this.cam.z, (b.y + y - this.cam.y) * this.cam.z]
  }

  // ---------------------------------------------------------------- input

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.rect ?? this.el.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  private toDoc(sx: number, sy: number): [number, number] {
    return [sx / this.cam.z + this.cam.x, sy / this.cam.z + this.cam.y]
  }

  private boxAt(dx: number, dy: number, slack = 0): PageBox | null {
    for (const b of this.boxes) {
      if (dx >= b.x - slack && dx <= b.x + b.w + slack && dy >= b.y - slack && dy <= b.y + b.h + slack) return b
    }
    return null
  }

  private onDown = (e: PointerEvent) => {
    this.rect = this.el.getBoundingClientRect()
    this.inertia = null
    const [sx, sy] = this.local(e)
    if (e.pointerType === 'touch') {
      const a = this.action
      if (a) {
        // A second finger right after a finger stroke began means "gesture", not "draw".
        const ft = this.fingerTouch
        if (ft && a.pointerId === ft.id && performance.now() - ft.t < 250) {
          this.finishAction(true)
          this.fingerTouch = null
          this.touches.set(ft.id, { x: ft.x, y: ft.y, x0: ft.x, y0: ft.y, t0: ft.t })
          this.touchDown(e)
        }
        // Otherwise it's a palm resting while the pencil writes: ignore it.
        return
      }
      // A finger on the selection moves it, like the pencil does.
      if (this.sel && !this.touches.size && !this.gesture && this.selectionHit(sx, sy)) {
        try {
          this.el.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        this.startAction(e, sx, sy)
        return
      }
      if (!this.fingerDraw || this.touches.size || this.gesture) {
        this.touchDown(e)
        return
      }
      this.fingerTouch = { id: e.pointerId, x: sx, y: sy, t: performance.now() }
    } else if (e.pointerType === 'mouse' && e.button !== 0) {
      return
    }
    if (this.action) return
    e.preventDefault()
    // The pencil always wins over a gesture that a resting palm started.
    if (this.gesture && e.pointerType === 'pen') {
      this.gesture = null
      this.touches.clear()
      if (this.swipeDx) {
        this.swipeDx = 0
        this.invalidate('bg', 'ink')
      }
    }
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events can't be captured */
    }
    this.hover = e.pointerType === 'touch' ? null : { x: sx, y: sy }
    this.startAction(e, sx, sy)
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touchMove(e)
      return
    }
    const [sx, sy] = this.local(e)
    if (e.pointerType !== 'touch') {
      this.hover = { x: sx, y: sy }
      if (!this.action) this.invalidate('live')
    }
    const a = this.action
    if (!a || a.pointerId !== e.pointerId) return
    e.preventDefault()
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    const list = events.length ? events : [e]
    this.continueAction(e, list)
  }

  private onUp = (e: PointerEvent) => {
    if (this.touches.has(e.pointerId)) {
      this.touchUp(e)
      return
    }
    const a = this.action
    if (!a || a.pointerId !== e.pointerId) return
    this.finishAction(false)
    this.fingerTouch = null
    // Pencils that can hover will send a fresh hover move; the rest won't,
    // so don't leave a stale dot behind.
    if (e.pointerType !== 'mouse') this.hover = null
    this.invalidate('live')
  }

  private onCancel = (e: PointerEvent) => {
    if (this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId)
      if (!this.touches.size) this.endGesture(true)
      return
    }
    if (this.action?.pointerId === e.pointerId) this.finishAction(true)
  }

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && !this.action) {
      this.hover = null
      this.invalidate('live')
    }
  }

  private pressure(e: PointerEvent): number {
    if (e.pointerType !== 'pen') return 0.5
    const p = e.pressure || 0.5
    // Apple Pencil reports fairly low pressure for normal writing; lift it a little.
    return Math.min(1, Math.max(0.08, Math.pow(p, 0.8)))
  }

  private startAction(e: PointerEvent, sx: number, sy: number) {
    const [dx, dy] = this.toDoc(sx, sy)
    const t = this.tools
    // Barrel button on styluses that have one = temporary eraser.
    const tool = e.buttons & 32 ? 'eraser' : t.tool

    if (this.sel && (tool === 'lasso' || e.pointerType === 'touch')) {
      const hit = this.selectionHit(sx, sy)
      if (hit) {
        this.action = { kind: 'move', pointerId: e.pointerId, start: [sx, sy], mode: hit === 'body' ? 'move' : hit, m0: this.sel.m.slice() }
        return
      }
    }
    if (this.sel) this.clearSelection()

    if (tool === 'pen' || tool === 'highlighter') {
      const box = this.boxAt(dx, dy)
      if (!box) {
        this.action = { kind: 'none', pointerId: e.pointerId }
        return
      }
      const p0 = this.pressure(e)
      const stroke: Stroke = {
        id: uid(),
        tool,
        color: tool === 'pen' ? t.penColor : t.hlColor,
        size: tool === 'pen' ? t.penSize : t.hlSize,
        pts: [round1(dx - box.x), round1(dy - box.y), Math.round(p0 * 100) / 100],
        sim: e.pointerType !== 'pen' || undefined,
        style: tool === 'pen' && t.penStyle === 'felt' ? 'felt' : undefined,
      }
      const a: Action = { kind: 'draw', pointerId: e.pointerId, stroke, box, predicted: [], anchor: [sx, sy], holdTimer: 0, snapped: null, snapBase: null, ema: p0 }
      this.action = a
      if (t.snap) a.holdTimer = window.setTimeout(() => this.trySnap(), HOLD_MS)
      this.hooks.onLive?.({ k: 'begin', id: stroke.id, page: box.ref.id, tool, color: stroke.color, size: stroke.size, sim: !!stroke.sim, style: stroke.style, pts: stroke.pts.slice() })
      this.invalidate('live')
      if (tool === 'highlighter') this.invalidate('bg')
    } else if (tool === 'eraser') {
      this.action = { kind: 'erase', pointerId: e.pointerId, last: null, perPage: new Map() }
      this.eraseAt(sx, sy)
    } else if (tool === 'lasso') {
      const box = this.boxAt(dx, dy, 40)
      if (!box) {
        this.action = { kind: 'none', pointerId: e.pointerId }
        return
      }
      this.action = { kind: 'lasso', pointerId: e.pointerId, box, poly: [dx - box.x, dy - box.y], travel: 0 }
    } else if (tool === 'laser') {
      this.action = { kind: 'laser', pointerId: e.pointerId }
      this.laserAt(dx, dy)
    }
  }

  private continueAction(e: PointerEvent, list: PointerEvent[]) {
    const a = this.action!
    const [sx, sy] = this.local(e)
    if (a.kind === 'draw') {
      if (a.snapped) {
        const [dx, dy] = this.toDoc(sx, sy)
        const at: [number, number] = [dx - a.box.x, dy - a.box.y]
        if (a.snapped.kind === 'line') {
          // keep dragging to swing the end of the line around
          const v = a.snapped.v
          const end = snapLineEnd([v[0], v[1]], at)
          a.snapped = { kind: 'line', v: [v[0], v[1], end[0], end[1]] }
        } else if (a.snapBase) {
          // keep dragging to make the shape bigger or smaller
          const c = shapeCenter(a.snapBase.shape)
          const d0 = Math.hypot(a.snapBase.at[0] - c[0], a.snapBase.at[1] - c[1])
          if (d0 < 4) return
          const k = Math.max(0.2, Math.min(6, Math.hypot(at[0] - c[0], at[1] - c[1]) / d0))
          a.snapped = scaleShape(a.snapBase.shape, k, c)
        }
        a.stroke = { ...a.stroke, pts: shapePoints(a.snapped) }
        this.hooks.onLive?.({ k: 'replace', id: a.stroke.id, pts: a.stroke.pts, shape: true })
        this.invalidate('live')
        if (a.stroke.tool === 'highlighter') this.invalidate('bg')
        return
      }
      const added: number[] = []
      const pts = a.stroke.pts
      const pen = e.pointerType === 'pen'
      for (const ev of list) {
        const [lx, ly] = this.local(ev)
        const [dx, dy] = this.toDoc(lx, ly)
        const x = round1(dx - a.box.x), y = round1(dy - a.box.y)
        const n = pts.length
        // Skip duplicate samples; they make perfect-freehand wobble.
        if (Math.abs(pts[n - 3] - x) < 0.15 && Math.abs(pts[n - 2] - y) < 0.15) continue
        // Smooth the pressure: raw Pencil pressure jitters, which shows up
        // as lumpy line width.
        const raw = this.pressure(ev)
        a.ema = pen ? a.ema * 0.55 + raw * 0.45 : raw
        const p = Math.round(a.ema * 100) / 100
        // The very first sample's pressure is often off; borrow the second's.
        if (n === 3) pts[2] = p
        pts.push(x, y, p)
        added.push(x, y, p)
      }
      a.predicted = []
      if (typeof e.getPredictedEvents === 'function') {
        for (const ev of e.getPredictedEvents().slice(0, 2)) {
          const [lx, ly] = this.local(ev)
          const [dx, dy] = this.toDoc(lx, ly)
          a.predicted.push(dx - a.box.x, dy - a.box.y, Math.round(a.ema * 100) / 100)
        }
      }
      if (added.length) this.hooks.onLive?.({ k: 'pts', id: a.stroke.id, pts: added })
      // Restart the hold timer whenever the pencil really moves.
      if (this.tools.snap && Math.hypot(sx - a.anchor[0], sy - a.anchor[1]) > 3) {
        a.anchor = [sx, sy]
        clearTimeout(a.holdTimer)
        a.holdTimer = window.setTimeout(() => this.trySnap(), HOLD_MS)
      }
      this.invalidate('live')
    } else if (a.kind === 'erase') {
      for (const ev of list) {
        const [lx, ly] = this.local(ev)
        this.eraseAt(lx, ly)
      }
    } else if (a.kind === 'lasso') {
      const [dx, dy] = this.toDoc(sx, sy)
      const n = a.poly.length
      const x = dx - a.box.x, y = dy - a.box.y
      const step = Math.hypot(a.poly[n - 2] - x, a.poly[n - 1] - y) * this.cam.z
      if (step > 2) {
        a.poly.push(x, y)
        a.travel += step
      }
      this.invalidate('live')
    } else if (a.kind === 'move' && this.sel) {
      this.sel.m = this.dragTransform(a, sx, sy)
      this.hooks.onSelMove?.({ page: this.sel.page, ids: [...this.sel.ids], m: this.sel.m })
      this.emitSelection()
      this.invalidate('live')
    } else if (a.kind === 'laser') {
      for (const ev of list) {
        const [lx, ly] = this.local(ev)
        const [dx, dy] = this.toDoc(lx, ly)
        this.laserAt(dx, dy)
      }
    }
  }

  /** The selection's new transform for a drag from `a.start` to (sx, sy). */
  private dragTransform(a: Extract<Action, { kind: 'move' }>, sx: number, sy: number): number[] {
    const sel = this.sel!
    const b = this.boxes.find((x) => x.ref.id === sel.page)!
    const z = this.cam.z
    const [m0a, m0b, m0c, m0d, m0e, m0f] = a.m0
    const toPage = (px: number, py: number): [number, number] => [px / z + this.cam.x - b.x, py / z + this.cam.y - b.y]
    const [x0, y0] = toPage(a.start[0], a.start[1])
    const [x1, y1] = toPage(sx, sy)
    if (a.mode === 'move') return [m0a, m0b, m0c, m0d, m0e + x1 - x0, m0f + y1 - y0]

    const bb = sel.bbox
    if (a.mode === 'scale') {
      // grow from the opposite (top-left) corner
      const [px, py] = apply(a.m0, bb.x, bb.y)
      const d0 = Math.hypot(x0 - px, y0 - py)
      if (d0 < 1) return a.m0
      const k = Math.max(0.15, Math.min(8, Math.hypot(x1 - px, y1 - py) / d0))
      return [k * m0a, k * m0b, k * m0c, k * m0d, k * m0e + (1 - k) * px, k * m0f + (1 - k) * py]
    }
    // rotate around the middle, clicking into place at right angles
    const [cx, cy] = apply(a.m0, bb.x + bb.w / 2, bb.y + bb.h / 2)
    let th = Math.atan2(y1 - cy, x1 - cx) - Math.atan2(y0 - cy, x0 - cx)
    const total = Math.atan2(m0b, m0a) + th
    const right = Math.round(total / (Math.PI / 2)) * (Math.PI / 2)
    if (Math.abs(total - right) < (5 * Math.PI) / 180) th += right - total
    const cos = Math.cos(th), sin = Math.sin(th)
    return [
      cos * m0a - sin * m0b,
      sin * m0a + cos * m0b,
      cos * m0c - sin * m0d,
      sin * m0c + cos * m0d,
      cos * (m0e - cx) - sin * (m0f - cy) + cx,
      sin * (m0e - cx) + cos * (m0f - cy) + cy,
    ]
  }

  private trySnap() {
    const a = this.action
    if (!a || a.kind !== 'draw' || a.snapped) return
    const shape = recognize(a.stroke.pts)
    if (!shape) return
    if (a.stroke.tool === 'highlighter' && shape.kind !== 'line') return
    const n = a.stroke.pts.length
    a.snapped = shape
    a.snapBase = { shape, at: [a.stroke.pts[n - 3], a.stroke.pts[n - 2]] }
    a.stroke = { ...a.stroke, pts: shapePoints(shape), shape: true }
    a.predicted = []
    this.hooks.onLive?.({ k: 'replace', id: a.stroke.id, pts: a.stroke.pts, shape: true })
    this.invalidate('live', 'bg')
  }

  private finishAction(cancel: boolean) {
    const a = this.action
    this.action = null
    if (!a) return
    if (a.kind === 'draw') {
      clearTimeout(a.holdTimer)
      if (!cancel && a.stroke.pts.length >= 3) {
        let stroke = a.stroke
        // Highlighting a line of text: straighten it out.
        if (stroke.tool === 'highlighter' && !a.snapped && this.tools.hlStraight) {
          const line = straighten(stroke.pts)
          if (line) stroke = { ...stroke, pts: shapePoints(line), shape: true }
        }
        this.ink.commit({ page: a.box.ref.id, remove: [], add: [stroke] })
      }
      this.hooks.onLive?.({ k: 'end', id: a.stroke.id })
      this.invalidate('live', 'bg')
    } else if (a.kind === 'erase') {
      for (const [page, rec] of a.perPage) {
        this.ink.record({ page, remove: [...rec.created], add: [...rec.originals.values()] })
      }
    } else if (a.kind === 'lasso') {
      if (!cancel) {
        const page = a.box.ref.id
        if (a.travel < 10) {
          // a tap with the lasso picks up just the stroke under it
          const [x, y] = [a.poly[0], a.poly[1]]
          const r = 10 / this.cam.z
          const strokes = this.ink.get(page)
          for (let i = strokes.length - 1; i >= 0; i--) {
            if (strokeHit(strokes[i], x, y, r)) {
              this.select(page, [strokes[i]])
              break
            }
          }
        } else if (a.poly.length >= 6) {
          const strokes = this.ink.get(page).filter((st) => lassoContains(st, a.poly))
          if (strokes.length) this.select(page, strokes)
        }
      }
      this.invalidate('live')
    } else if (a.kind === 'move') {
      const s = this.sel
      if (s && !isIdentity(s.m)) {
        const moved = s.strokes.map((st) => transformStroke(st, s.m, uid()))
        this.ink.commit({ page: s.page, remove: [...s.ids], add: moved })
        this.hooks.onSelMove?.(null)
        this.select(s.page, moved)
      }
    } else if (a.kind === 'laser') {
      this.laserOn = false
      this.hooks.onLaser?.(null)
    }
  }

  /** Corners of the selection box on screen (CSS px), padded a little, after its transform. */
  private selectionCorners(): [number, number][] | null {
    const s = this.sel
    if (!s) return null
    const b = this.boxes.find((x) => x.ref.id === s.page)
    if (!b) return null
    const z = this.cam.z
    const pad = 6 / z
    const { x, y, w, h } = s.bbox
    return ([
      [x - pad, y - pad],
      [x + w + pad, y - pad],
      [x + w + pad, y + h + pad],
      [x - pad, y + h + pad],
    ] as [number, number][]).map(([px, py]) => {
      const [tx, ty] = apply(s.m, px, py)
      return [(b.x + tx - this.cam.x) * z, (b.y + ty - this.cam.y) * z]
    })
  }

  /** Where the rotate handle sits: a little way out from the middle of the top edge. */
  private rotateHandle(c: [number, number][]): [number, number] {
    const mx = (c[0][0] + c[1][0]) / 2, my = (c[0][1] + c[1][1]) / 2
    const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2
    const d = Math.hypot(mx - cx, my - cy) || 1
    return [mx + ((mx - cx) / d) * 26, my + ((my - cy) / d) * 26]
  }

  private selectionHit(sx: number, sy: number): 'scale' | 'rotate' | 'body' | null {
    const c = this.selectionCorners()
    if (!c) return null
    if (Math.hypot(sx - c[2][0], sy - c[2][1]) < 22) return 'scale'
    const [rx, ry] = this.rotateHandle(c)
    if (Math.hypot(sx - rx, sy - ry) < 22) return 'rotate'
    if (pointInPolygon(sx, sy, c.flat())) return 'body'
    // a little slack around the edges
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4]
      if (segDistance(sx, sy, ax, ay, bx, by) < 10) return 'body'
    }
    return null
  }

  private eraseAt(sx: number, sy: number) {
    const a = this.action
    if (!a || a.kind !== 'erase') return
    this.hover = { x: sx, y: sy }
    const z = this.cam.z
    const r = this.tools.eraserSize / z
    // Fill in the gaps between samples so fast swipes don't skip strokes.
    const samples: [number, number][] = []
    const [dx, dy] = this.toDoc(sx, sy)
    if (a.last) {
      const [lx, ly] = a.last
      const d = Math.hypot(dx - lx, dy - ly)
      const n = Math.ceil(d / (r * 0.5))
      for (let i = 1; i <= n; i++) samples.push([lx + ((dx - lx) * i) / n, ly + ((dy - ly) * i) / n])
    } else {
      samples.push([dx, dy])
    }
    a.last = [dx, dy]
    const precise = this.tools.eraserMode === 'precise'
    for (const [x, y] of samples) {
      const box = this.boxAt(x, y, r)
      if (!box) continue
      const page = box.ref.id
      const px = x - box.x, py = y - box.y
      let rec = a.perPage.get(page)
      if (!rec) {
        rec = { originals: new Map(), created: new Set() }
        a.perPage.set(page, rec)
      }
      const patch: Patch = { page, remove: [], add: [] }
      const hlOnly = this.tools.eraserHighlightOnly
      for (const s of this.ink.get(page)) {
        if (hlOnly && s.tool !== 'highlighter') continue
        if (precise) {
          const pieces = eraseFrom(s, px, py, r, uid)
          if (!pieces) continue
          patch.remove.push(s.id)
          patch.add.push(...pieces)
          if (rec.created.has(s.id)) rec.created.delete(s.id)
          else rec.originals.set(s.id, s)
          for (const p of pieces) rec.created.add(p.id)
        } else if (strokeHit(s, px, py, r)) {
          patch.remove.push(s.id)
          if (rec.created.has(s.id)) rec.created.delete(s.id)
          else rec.originals.set(s.id, s)
        }
      }
      if (patch.remove.length) this.ink.commit(patch, false)
    }
    this.invalidate('live')
  }

  private laserAt(dx: number, dy: number) {
    const box = this.boxAt(dx, dy, 30)
    if (!box) return
    const p = { page: box.ref.id, x: round1(dx - box.x), y: round1(dy - box.y) }
    this.laserTrail.push({ ...p, t: performance.now() })
    this.laserOn = true
    this.hooks.onLaser?.(p)
    this.invalidate('live')
  }

  // ---------------------------------------------------------------- touch gestures

  private touchDown(e: PointerEvent) {
    const [x, y] = this.local(e)
    this.touches.set(e.pointerId, { x, y, x0: x, y0: y, t0: performance.now() })
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this.startGesture()
  }

  private startGesture() {
    const pts = [...this.touches.values()]
    const mid = centroid(pts)
    const prev = this.gesture
    this.gesture = {
      kind: pts.length >= 2 ? 'pinch' : 'pending',
      cam0: { ...this.cam },
      mid0: mid,
      dist0: pts.length >= 2 ? Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) : 0,
      maxTouches: Math.max(prev?.maxTouches ?? 0, pts.length),
      moved: prev?.moved ?? 0,
      t0: prev?.t0 ?? performance.now(),
      samples: [],
    }
    if (this.swipeDx && pts.length >= 2) {
      this.swipeDx = 0
      this.invalidate('bg', 'ink')
    }
  }

  private touchMove(e: PointerEvent) {
    const t = this.touches.get(e.pointerId)!
    const [x, y] = this.local(e)
    t.x = x
    t.y = y
    const g = this.gesture
    if (!g) return
    const pts = [...this.touches.values()]
    const mid = centroid(pts)
    g.moved = Math.max(g.moved, Math.hypot(mid[0] - g.mid0[0], mid[1] - g.mid0[1]))
    const now = performance.now()

    if (g.kind === 'pending') {
      if (g.moved < 8) return
      const zoomed = !this.atFit
      g.kind = this.mode === 'slides' && !zoomed ? 'swipe' : 'pan'
      // re-anchor so the slop distance doesn't cause a jump
      g.mid0 = mid
      g.cam0 = { ...this.cam }
    }

    if (g.kind === 'swipe') {
      this.swipeDx = mid[0] - g.mid0[0]
      this.invalidate('bg', 'ink', 'live')
      return
    }

    let z = g.cam0.z
    if (g.kind === 'pinch' && pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const fz = this.fitZoom()
      z = Math.max(fz * 0.75, Math.min(fz * 8, g.cam0.z * (d / g.dist0)))
    }
    const docX = g.cam0.x + g.mid0[0] / g.cam0.z
    const docY = g.cam0.y + g.mid0[1] / g.cam0.z
    this.cam.z = z
    this.cam.x = docX - mid[0] / z
    this.cam.y = docY - mid[1] / z
    this.atFit = false
    if (g.kind === 'pinch') this.softClamp()
    else this.clampCam()
    g.samples.push({ t: now, x: mid[0], y: mid[1] })
    if (g.samples.length > 6) g.samples.shift()
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }

  /** During a pinch, allow a little overscroll so it doesn't feel stuck. */
  private softClamp() {
    const save = { ...this.cam }
    this.clampCam()
    this.cam.x = save.x + (this.cam.x - save.x) * 0.6
    this.cam.y = save.y + (this.cam.y - save.y) * 0.6
  }

  private touchUp(e: PointerEvent) {
    this.touches.delete(e.pointerId)
    if (this.touches.size) {
      // one finger lifted from a pinch: carry on panning with what's left
      this.startGesture()
      if (this.gesture) this.gesture.kind = 'pan'
      return
    }
    this.endGesture(false)
  }

  private endGesture(cancel: boolean) {
    const g = this.gesture
    this.gesture = null
    if (!g) return
    const now = performance.now()
    const quick = now - g.t0 < 320 && g.moved < 12
    if (!cancel && quick) {
      if (g.maxTouches === 2) this.hooks.onUndoGesture?.()
      else if (g.maxTouches === 3) this.hooks.onRedoGesture?.()
      else if (g.maxTouches === 1) this.handleTap(g.mid0[0], g.mid0[1], now)
    }
    if (g.kind === 'swipe') {
      const dx = this.swipeDx
      this.swipeDx = 0
      if (!cancel && Math.abs(dx) > Math.min(120, this.W * 0.12)) this.hooks.onSwipe?.(dx < 0 ? 1 : -1)
      this.invalidate('bg', 'ink', 'live')
      return
    }
    // settle zoom back into range
    const fz = this.fitZoom()
    if (this.cam.z < fz * 1.02) {
      const cy = this.cam.y + this.H / 2 / this.cam.z
      this.fit()
      if (this.mode === 'scroll') {
        // keep the vertical position when snapping back to page width
        this.cam.y = cy - this.H / 2 / this.cam.z
        this.clampCam()
      }
    } else {
      this.clampCam()
    }
    this.atFit = this.isFit()
    if (!cancel && g.kind === 'pan' && g.samples.length >= 2) {
      const s0 = g.samples[0], s1 = g.samples[g.samples.length - 1]
      const dt = s1.t - s0.t
      if (dt > 0 && now - s1.t < 80) {
        const vx = (s1.x - s0.x) / dt, vy = (s1.y - s0.y) / dt
        if (Math.hypot(vx, vy) > 0.25) this.inertia = { vx, vy, t: now }
      }
    }
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }

  private handleTap(x: number, y: number, now: number) {
    const lt = this.lastTap
    if (now - lt.t < 320 && Math.hypot(x - lt.x, y - lt.y) < 30) {
      // double tap: zoom in on that spot, or back out to fit
      this.lastTap = { t: 0, x: 0, y: 0 }
      if (this.atFit) {
        const [dx, dy] = this.toDoc(x, y)
        const z = this.fitZoom() * 2
        this.cam.z = z
        this.cam.x = dx - x / z
        this.cam.y = dy - y / z
        this.clampCam()
        this.atFit = false
      } else if (this.mode === 'scroll') {
        const [, dy] = this.toDoc(x, y)
        this.fit()
        this.cam.y = dy - y / this.cam.z
        this.clampCam()
      } else {
        this.fit()
      }
      this.invalidate('bg', 'ink', 'live')
      this.emitView()
      return
    }
    this.lastTap = { t: now, x, y }
  }

  private stepInertia(now: number) {
    const it = this.inertia
    if (!it) return
    const dt = Math.min(40, now - it.t)
    it.t = now
    this.cam.x -= (it.vx * dt) / this.cam.z
    this.cam.y -= (it.vy * dt) / this.cam.z
    const before = { ...this.cam }
    this.clampCam()
    if (before.x !== this.cam.x) it.vx = 0
    if (before.y !== this.cam.y) it.vy = 0
    const decay = Math.pow(0.94, dt / 16)
    it.vx *= decay
    it.vy *= decay
    if (Math.hypot(it.vx, it.vy) < 0.02) {
      this.inertia = null
      this.invalidate('bg') // final sharp render
    }
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (!this.interactive && this.followView) return
    const [sx, sy] = this.local(e)
    if (e.ctrlKey || e.metaKey) {
      const [dx, dy] = this.toDoc(sx, sy)
      const fz = this.fitZoom()
      const z = Math.max(fz, Math.min(fz * 8, this.cam.z * Math.exp(-e.deltaY * 0.01)))
      this.cam.z = z
      this.cam.x = dx - sx / z
      this.cam.y = dy - sy / z
      this.clampCam()
      this.atFit = this.isFit()
    } else if (this.mode === 'scroll' || !this.atFit) {
      this.cam.x += e.deltaX / this.cam.z
      this.cam.y += e.deltaY / this.cam.z
      this.clampCam()
      this.atFit = this.isFit()
    } else {
      return
    }
    this.invalidate('bg', 'ink', 'live')
    this.emitView()
  }
}

function centroid(pts: { x: number; y: number }[]): [number, number] {
  let x = 0, y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  return [x / pts.length, y / pts.length]
}

function apply(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(ax + t * dx - px, ay + t * dy - py)
}

function isIdentity(m: number[]) {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-6)
}

