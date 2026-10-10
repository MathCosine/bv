import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PAGE_W, type Rect } from './types'

// The legacy build runs on older iPad Safari versions too, which matters
// more here than the few extra KB.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy }

export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  return pdfjs.getDocument({ data: bytes }).promise
}

export async function pdfPageSizes(doc: PDFDocumentProxy): Promise<[number, number][]> {
  const out: [number, number][] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i)
    const v = p.getViewport({ scale: 1 })
    out.push([v.width, v.height])
  }
  return out
}

/** Render a page to a canvas `width` px wide (thumbnails, previews). */
export async function renderPageToCanvas(doc: PDFDocumentProxy, n: number, width: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n)
  const v1 = page.getViewport({ scale: 1 })
  const scale = width / v1.width
  const v = page.getViewport({ scale })
  const c = document.createElement('canvas')
  c.width = Math.round(v.width)
  c.height = Math.round(v.height)
  await page.render({ canvas: c, viewport: v }).promise
  return c
}

interface Bitmap {
  canvas: HTMLCanvasElement
  /** pixels per page unit this was rendered at */
  k: number
  /** region of the page it covers, in page units */
  rect: Rect
  used: number
}

interface Job {
  key: string
  n: number
  k: number
  rect: Rect
  kind: 'base' | 'detail'
}

function freeCanvas(c: HTMLCanvasElement) {
  // iOS Safari has a hard cap on total canvas memory; zeroing the size
  // releases it immediately instead of waiting for GC.
  c.width = 0
  c.height = 0
}

/**
 * Renders PDF pages for the board at the right resolution.
 *
 * Each page gets a "base" bitmap (whole page, roughly screen resolution) and,
 * when zoomed in past that, a "detail" bitmap that covers only the visible
 * part at full sharpness. Rendering is queued one page at a time so turning
 * pages quickly doesn't pile up work.
 */
export class PdfPainter {
  private base = new Map<number, Bitmap>()
  private detail = new Map<number, Bitmap>()
  private pageCache = new Map<number, Promise<PDFPageProxy>>()
  private queue: Job[] = []
  private running: { job: Job; task: RenderTask | null } | null = null
  private wanted = new Set<string>()
  private clock = 0
  onReady: (() => void) | null = null
  maxBase = 6

  constructor(public doc: PDFDocumentProxy) {}

  private page(n: number) {
    let p = this.pageCache.get(n)
    if (!p) {
      p = this.doc.getPage(n)
      this.pageCache.set(n, p)
    }
    return p
  }

  /** Best available bitmaps for page n; schedules better ones as needed. */
  get(n: number, pageH: number, k: number, visible: Rect | null, baseWidthPx: number): { base?: Bitmap; detail?: Bitmap } {
    const now = ++this.clock
    const baseK = Math.min(baseWidthPx, 2048) / PAGE_W
    let base = this.base.get(n)
    if (!base || base.k < baseK * 0.8) {
      this.request({ key: `b${n}@${baseK.toFixed(3)}`, n, k: baseK, rect: { x: 0, y: 0, w: PAGE_W, h: pageH }, kind: 'base' })
    }
    if (base) base.used = now

    let detail = this.detail.get(n)
    if (visible && k > baseK * 1.15) {
      // Round the region outward a bit so small pans don't force a re-render.
      const pad = 40 / k
      const r = {
        x: Math.max(0, visible.x - pad),
        y: Math.max(0, visible.y - pad),
        w: 0,
        h: 0,
      }
      r.w = Math.min(PAGE_W, visible.x + visible.w + pad) - r.x
      r.h = Math.min(pageH, visible.y + visible.h + pad) - r.y
      const good =
        detail &&
        Math.abs(detail.k - k) / k < 0.08 &&
        detail.rect.x <= visible.x + 0.5 &&
        detail.rect.y <= visible.y + 0.5 &&
        detail.rect.x + detail.rect.w >= Math.min(PAGE_W, visible.x + visible.w) - 0.5 &&
        detail.rect.y + detail.rect.h >= Math.min(pageH, visible.y + visible.h) - 0.5
      if (!good && r.w > 1 && r.h > 1 && r.w * k * r.h * k < 16e6) {
        this.request({ key: `d${n}@${k.toFixed(3)}:${r.x | 0},${r.y | 0}`, n, k, rect: r, kind: 'detail' }, true)
      }
    }
    if (detail) {
      // A detail bitmap from a different zoom level is still better than nothing
      // only if it's sharper than the base.
      if (detail.k <= baseK * 1.05) detail = undefined
      else detail.used = now
    }
    return { base, detail }
  }

  /** Drop detail renders that aren't for the current zoom. */
  dropDetailsExcept(keep: Set<number>) {
    for (const [n, b] of this.detail) {
      if (!keep.has(n)) {
        freeCanvas(b.canvas)
        this.detail.delete(n)
      }
    }
  }

  private request(job: Job, replace = false) {
    if (this.wanted.has(job.key)) return
    if (this.running?.job.key === job.key) return
    if (replace) {
      // Only the newest detail request per page matters.
      this.queue = this.queue.filter((j) => {
        const stale = j.kind === 'detail' && j.n === job.n
        if (stale) this.wanted.delete(j.key)
        return !stale
      })
      if (this.running && this.running.job.kind === 'detail' && this.running.job.n === job.n) {
        this.running.task?.cancel()
      }
    }
    this.wanted.add(job.key)
    // Base renders first: a blurry page beats a blank one.
    if (job.kind === 'base') this.queue.unshift(job)
    else this.queue.push(job)
    this.pump()
  }

  private async pump() {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    this.running = { job, task: null }
    try {
      const page = await this.page(job.n)
      const v1 = page.getViewport({ scale: 1 })
      const s = (job.k * PAGE_W) / v1.width
      const viewport = page.getViewport({ scale: s, offsetX: -job.rect.x * job.k, offsetY: -job.rect.y * job.k })
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(job.rect.w * job.k))
      c.height = Math.max(1, Math.round(job.rect.h * job.k))
      const task = page.render({ canvas: c, viewport })
      this.running.task = task
      await task.promise
      const bmp: Bitmap = { canvas: c, k: job.k, rect: job.rect, used: ++this.clock }
      const map = job.kind === 'base' ? this.base : this.detail
      const old = map.get(job.n)
      if (old) freeCanvas(old.canvas)
      map.set(job.n, bmp)
      if (job.kind === 'base') this.evictBase()
      this.onReady?.()
    } catch (e) {
      // Cancelled renders land here; anything else is worth a console note.
      if (!(e instanceof Error && e.name === 'RenderingCancelledException')) console.warn('pdf render failed', e)
    } finally {
      this.wanted.delete(job.key)
      this.running = null
      this.pump()
    }
  }

  private evictBase() {
    while (this.base.size > this.maxBase) {
      let oldest: number | null = null
      let t = Infinity
      for (const [n, b] of this.base) if (b.used < t) { t = b.used; oldest = n }
      if (oldest == null) break
      freeCanvas(this.base.get(oldest)!.canvas)
      this.base.delete(oldest)
    }
  }

  destroy() {
    this.queue = []
    this.running?.task?.cancel()
    for (const b of this.base.values()) freeCanvas(b.canvas)
    for (const b of this.detail.values()) freeCanvas(b.canvas)
    this.base.clear()
    this.detail.clear()
    void this.doc.loadingTask.destroy()
  }
}
