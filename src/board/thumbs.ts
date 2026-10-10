import { strokePath } from '../ink/stroke'
import { renderPageToCanvas, type PDFDocumentProxy } from '../lib/pdf'
import { PAGE_W, type PageRef, type Stroke } from '../lib/types'
import { drawPaper } from './paper'

/** A small picture of one page with its ink, for the page grid. */
export async function renderThumb(
  page: PageRef,
  doc: PDFDocumentProxy | null,
  strokes: Stroke[],
  width: number,
  image?: (path: string) => Promise<CanvasImageSource>,
): Promise<HTMLCanvasElement> {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const px = Math.round(width * dpr)
  const h = (PAGE_W * page.h) / page.w
  const k = px / PAGE_W
  let c: HTMLCanvasElement
  if (page.kind === 'pdf' && doc) {
    c = await renderPageToCanvas(doc, page.n, px)
  } else if (page.kind === 'image' && image) {
    c = document.createElement('canvas')
    c.width = px
    c.height = Math.round(h * k)
    const ctx = c.getContext('2d')!
    ctx.drawImage(await image(page.path), 0, 0, c.width, c.height)
  } else {
    c = document.createElement('canvas')
    c.width = px
    c.height = Math.round(h * k)
    const ctx = c.getContext('2d')!
    ctx.setTransform(k, 0, 0, k, 0, 0)
    drawPaper(ctx, page.kind === 'paper' ? page.paper : 'plain', PAGE_W, h, k, { x0: 0, y0: 0, x1: PAGE_W, y1: h })
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(c.width / PAGE_W, 0, 0, c.width / PAGE_W, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  for (const s of strokes) {
    if (s.tool !== 'highlighter') continue
    ctx.fillStyle = s.color
    ctx.fill(strokePath(s))
  }
  ctx.globalCompositeOperation = 'source-over'
  for (const s of strokes) {
    if (s.tool !== 'pen') continue
    ctx.fillStyle = s.color
    ctx.fill(strokePath(s))
  }
  return c
}
