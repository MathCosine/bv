import { getStroke, type StrokeOptions } from 'perfect-freehand'
import type { Rect, Stroke } from '../lib/types'

// Pen feel. These numbers were tuned by hand against an Apple Pencil:
// a little pressure response, quick to follow the tip, smooth but not mushy.
const PEN: StrokeOptions = {
  thinning: 0.5,
  smoothing: 0.62,
  streamline: 0.32,
  easing: (t) => t,
  start: { taper: 0, cap: true },
  end: { taper: 0, cap: true },
}

const HIGHLIGHTER: StrokeOptions = {
  thinning: 0,
  smoothing: 0.7,
  streamline: 0.5,
  simulatePressure: false,
  start: { cap: true },
  end: { cap: true },
}

export function strokeOptions(s: Pick<Stroke, 'tool' | 'size' | 'sim' | 'shape'>, last: boolean): StrokeOptions {
  if (s.tool === 'highlighter') return { ...HIGHLIGHTER, size: s.size, last }
  if (s.shape) return { ...PEN, thinning: 0, smoothing: 0.3, streamline: 0, simulatePressure: false, size: s.size, last }
  return { ...PEN, simulatePressure: !!s.sim, size: s.size, last }
}

export function toTriples(pts: number[]): number[][] {
  const out: number[][] = new Array(pts.length / 3)
  for (let i = 0, j = 0; i < pts.length; i += 3, j++) out[j] = [pts[i], pts[i + 1], pts[i + 2]]
  return out
}

export function outline(s: Pick<Stroke, 'tool' | 'size' | 'sim' | 'shape' | 'pts'>, last = true): number[][] {
  const pts = s.shape ? toTriples(s.pts).map((p) => [p[0], p[1], 0.5]) : toTriples(s.pts)
  return getStroke(pts, strokeOptions(s, last))
}

export function outlineToPath(o: number[][]): Path2D {
  const p = new Path2D()
  const n = o.length
  if (n === 0) return p
  if (n < 3) {
    p.arc(o[0][0], o[0][1], 1, 0, Math.PI * 2)
    return p
  }
  p.moveTo(o[0][0], o[0][1])
  for (let i = 1; i < n; i++) {
    const a = o[i]
    const b = o[(i + 1) % n]
    p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  }
  p.closePath()
  return p
}

/** SVG path data for an outline (used when exporting). */
export function outlineToSvg(o: number[][]): string {
  const n = o.length
  if (n < 3) return ''
  const f = (v: number) => (Math.round(v * 100) / 100).toString()
  let d = `M${f(o[0][0])} ${f(o[0][1])}`
  for (let i = 1; i < n; i++) {
    const a = o[i]
    const b = o[(i + 1) % n]
    d += `Q${f(a[0])} ${f(a[1])} ${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`
  }
  return d + 'Z'
}

// Path2D objects are expensive to build and cheap to fill, so keep one per
// stroke. Strokes are never mutated in place (edits make new objects), so a
// WeakMap keyed on the object is always correct.
const pathCache = new WeakMap<Stroke, Path2D>()
const boundsCache = new WeakMap<Stroke, Rect>()

export function strokePath(s: Stroke): Path2D {
  let p = pathCache.get(s)
  if (!p) {
    p = outlineToPath(outline(s))
    pathCache.set(s, p)
  }
  return p
}

export function strokeBounds(s: Stroke): Rect {
  let b = boundsCache.get(s)
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < s.pts.length; i += 3) {
      const x = s.pts[i], y = s.pts[i + 1]
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
    const pad = s.size / 2 + 1
    b = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }
    boundsCache.set(s, b)
  }
  return b
}

export function rectsTouch(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = ax + t * dx - px, cy = ay + t * dy - py
  return Math.sqrt(cx * cx + cy * cy)
}

/** Does a circle at (x, y) with radius r touch the stroke? */
export function strokeHit(s: Stroke, x: number, y: number, r: number): boolean {
  const b = strokeBounds(s)
  if (x + r < b.x || x - r > b.x + b.w || y + r < b.y || y - r > b.y + b.h) return false
  const reach = r + s.size / 2
  const p = s.pts
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= reach
  for (let i = 0; i + 3 < p.length; i += 3) {
    if (distToSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= reach) return true
  }
  return false
}

/**
 * Precise erase: cut the parts of a stroke inside the eraser circle.
 * Returns null when the stroke is untouched, otherwise the leftover pieces.
 */
export function eraseFrom(s: Stroke, x: number, y: number, r: number, mkId: () => string): Stroke[] | null {
  if (!strokeHit(s, x, y, r)) return null
  const reach = r + s.size * 0.35
  // Densify first so a long straight segment can be cut in the middle.
  const dense = densify(s.pts, Math.max(1.5, r / 3))
  const pieces: number[][] = []
  let cur: number[] = []
  for (let i = 0; i < dense.length; i += 3) {
    const inside = Math.hypot(dense[i] - x, dense[i + 1] - y) <= reach
    if (inside) {
      if (cur.length) pieces.push(cur)
      cur = []
    } else {
      cur.push(dense[i], dense[i + 1], dense[i + 2])
    }
  }
  if (cur.length) pieces.push(cur)
  return pieces
    .filter((pp) => pp.length >= 6 || (pp.length === 3 && s.pts.length === 3))
    .map((pts) => ({ ...s, id: mkId(), pts }))
}

export function densify(pts: number[], step: number): number[] {
  if (pts.length <= 3) return pts.slice()
  const out: number[] = [pts[0], pts[1], pts[2]]
  for (let i = 3; i < pts.length; i += 3) {
    const ax = pts[i - 3], ay = pts[i - 2], ap = pts[i - 1]
    const bx = pts[i], by = pts[i + 1], bp = pts[i + 2]
    const d = Math.hypot(bx - ax, by - ay)
    const n = Math.floor(d / step)
    for (let k = 1; k < n; k++) {
      const t = k / n
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t)
    }
    out.push(bx, by, bp)
  }
  return out
}

/** Apply an affine map [a, b, c, d, e, f] (canvas order) to a stroke. */
export function transformStroke(s: Stroke, m: number[], id: string): Stroke {
  const [a, b, c, d, e, f] = m
  const pts = s.pts.slice()
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1]
    pts[i] = round1(a * x + c * y + e)
    pts[i + 1] = round1(b * x + d * y + f)
  }
  const scale = Math.sqrt(Math.abs(a * d - b * c))
  return { ...s, id, pts, size: round1(s.size * scale) }
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A stroke counts as lassoed when most of its points are inside. */
export function lassoContains(s: Stroke, poly: number[]): boolean {
  let n = 0, inside = 0
  for (let i = 0; i < s.pts.length; i += 3) {
    n++
    if (pointInPolygon(s.pts[i], s.pts[i + 1], poly)) inside++
  }
  return n > 0 && inside / n >= 0.55
}

export function unionBounds(strokes: Stroke[]): Rect | null {
  if (!strokes.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of strokes) {
    const b = strokeBounds(s)
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
