// Draw-and-hold shape cleanup. When the pencil pauses at the end of a stroke
// we try to read it as a line, circle/ellipse, or polygon and redraw it
// cleanly. Tuned to be forgiving of shaky hands but not to eat handwriting
// (it only ever runs on a deliberate hold).

export type ShapeKind = 'line' | 'ellipse' | 'polygon' | 'polyline'

export interface Shape {
  kind: ShapeKind
  /** Vertices for line/polygon/polyline, or [cx, cy, rx, ry] for ellipse. */
  v: number[]
}

type P = [number, number]

function toPoints(pts: number[]): P[] {
  const out: P[] = []
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i], pts[i + 1]])
  return out
}

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1])

function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (!l2) return dist(p, a)
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice()
  let maxD = 0, idx = 0
  const a = pts[0], b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b)
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= eps) return [a, b]
  const left = rdp(pts.slice(0, idx + 1), eps)
  const right = rdp(pts.slice(idx), eps)
  return left.slice(0, -1).concat(right)
}

function turnAngle(a: P, b: P, c: P): number {
  const v1 = Math.atan2(b[1] - a[1], b[0] - a[0])
  const v2 = Math.atan2(c[1] - b[1], c[0] - b[0])
  let d = Math.abs(v2 - v1)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d // 0 = straight on
}

function snapAngle(a: P, b: P): P {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const len = dist(a, b)
  const step = Math.PI / 2
  const nearest = Math.round(ang / step) * step
  if (Math.abs(ang - nearest) < (6 * Math.PI) / 180) {
    return [a[0] + Math.cos(nearest) * len, a[1] + Math.sin(nearest) * len]
  }
  return b
}

export function snapLineEnd(a: P, b: P): P {
  return snapAngle(a, b)
}

export function recognize(flat: number[]): Shape | null {
  const pts = toPoints(flat)
  if (pts.length < 4) return null
  let L = 0
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  const w = x1 - x0, h = y1 - y0
  const diag = Math.hypot(w, h)
  if (L < 14 || diag < 10) return null

  const first = pts[0], last = pts[pts.length - 1]

  // Straight line: nothing strays far from the chord.
  const chord = dist(first, last)
  if (chord > 0.75 * L) {
    let maxDev = 0
    for (const p of pts) maxDev = Math.max(maxDev, segDist(p, first, last))
    if (maxDev < Math.max(3, chord * 0.07)) {
      const end = snapAngle(first, last)
      return { kind: 'line', v: [first[0], first[1], end[0], end[1]] }
    }
  }

  // Closed? The end comes back near the start.
  const headN = Math.max(2, Math.floor(pts.length * 0.15))
  let closeGap = Infinity
  for (let i = 0; i < headN; i++) closeGap = Math.min(closeGap, dist(last, pts[i]))
  const closed = closeGap < Math.max(12, diag * 0.22)

  if (closed) {
    // Ellipse fit against the bounding box.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const rx = w / 2, ry = h / 2
    if (rx > 3 && ry > 3) {
      let err = 0
      for (const [x, y] of pts) err += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1)
      err /= pts.length
      if (err < 0.085) {
        if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.14) {
          const r = (rx + ry) / 2
          return { kind: 'ellipse', v: [cx, cy, r, r] }
        }
        return { kind: 'ellipse', v: [cx, cy, rx, ry] }
      }
    }

    // Polygon: simplify, then drop corners that are really just wobble.
    let v = rdp(pts, diag * 0.07)
    if (dist(v[0], v[v.length - 1]) < diag * 0.25) v = v.slice(0, -1)
    let changed = true
    while (changed && v.length > 3) {
      changed = false
      for (let i = 0; i < v.length; i++) {
        const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length]
        if (turnAngle(a, b, c) < (24 * Math.PI) / 180 || dist(a, b) < diag * 0.09) {
          v.splice(i, 1)
          changed = true
          break
        }
      }
    }
    if (v.length < 3 || v.length > 8) return null

    // Check the polygon actually follows the ink.
    let maxDev = 0
    for (const p of pts) {
      let d = Infinity
      for (let i = 0; i < v.length; i++) d = Math.min(d, segDist(p, v[i], v[(i + 1) % v.length]))
      maxDev = Math.max(maxDev, d)
    }
    if (maxDev > diag * 0.12) return null

    if (v.length === 4) {
      const right = v.every((b, i) => {
        const a = v[(i + 3) % 4], c = v[(i + 1) % 4]
        return Math.abs(turnAngle(a, b, c) - Math.PI / 2) < (14 * Math.PI) / 180
      })
      const e = Math.atan2(v[1][1] - v[0][1], v[1][0] - v[0][0])
      const axisOff = Math.abs(e - Math.round(e / (Math.PI / 2)) * (Math.PI / 2))
      if (right && axisOff < (10 * Math.PI) / 180) {
        let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity
        for (const [x, y] of v) { a0 = Math.min(a0, x); b0 = Math.min(b0, y); a1 = Math.max(a1, x); b1 = Math.max(b1, y) }
        v = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]
      }
    }
    return { kind: 'polygon', v: v.flat() }
  }

  // Open polyline (an angle, a tick, a zig-zag of a few segments).
  let v = rdp(pts, Math.max(4, diag * 0.06))
  let changed = true
  while (changed && v.length > 2) {
    changed = false
    for (let i = 1; i < v.length - 1; i++) {
      if (turnAngle(v[i - 1], v[i], v[i + 1]) < (20 * Math.PI) / 180 || dist(v[i - 1], v[i]) < diag * 0.08) {
        v.splice(i, 1)
        changed = true
        break
      }
    }
  }
  if (v.length >= 3 && v.length <= 4) {
    let maxDev = 0
    for (const p of pts) {
      let d = Infinity
      for (let i = 0; i + 1 < v.length; i++) d = Math.min(d, segDist(p, v[i], v[i + 1]))
      maxDev = Math.max(maxDev, d)
    }
    if (maxDev < diag * 0.1) return { kind: 'polyline', v: v.flat() }
  }
  return null
}

/** Turn a recognised shape back into evenly spaced stroke points. */
export function shapePoints(s: Shape, pressure = 0.5): number[] {
  const out: number[] = []
  const push = (x: number, y: number) => out.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, pressure)
  const seg = (ax: number, ay: number, bx: number, by: number, includeStart: boolean) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4))
    for (let k = includeStart ? 0 : 1; k <= n; k++) push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)
  }
  if (s.kind === 'ellipse') {
    const [cx, cy, rx, ry] = s.v
    const n = Math.max(48, Math.ceil((Math.PI * 2 * Math.max(rx, ry)) / 4))
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * Math.PI * 2 - Math.PI / 2
      push(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry)
    }
    return out
  }
  const v = s.v
  const count = v.length / 2
  for (let i = 0; i + 1 < count; i++) seg(v[i * 2], v[i * 2 + 1], v[i * 2 + 2], v[i * 2 + 3], i === 0)
  if (s.kind === 'polygon') seg(v[(count - 1) * 2], v[(count - 1) * 2 + 1], v[0], v[1], false)
  return out
}
