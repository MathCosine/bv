import type { Paper } from '../lib/types'

// Blank page patterns, drawn in page units. `k` is device pixels per unit so
// hairlines stay one physical pixel crisp at any zoom.

const GRID = 25 // 40 squares across a page

export function drawPaper(ctx: CanvasRenderingContext2D, paper: Paper, w: number, h: number, k: number, clip: { x0: number; y0: number; x1: number; y1: number }) {
  ctx.fillStyle = '#fffefa'
  ctx.fillRect(0, 0, w, h)
  const hair = 1 / k
  const x0 = Math.max(0, clip.x0), x1 = Math.min(w, clip.x1)
  const y0 = Math.max(0, clip.y0), y1 = Math.min(h, clip.y1)

  if (paper === 'grid') {
    const minor = new Path2D()
    const major = new Path2D()
    for (let i = Math.ceil(x0 / GRID); i * GRID <= x1; i++) {
      const x = i * GRID
      const p = i % 5 === 0 ? major : minor
      p.moveTo(x, y0)
      p.lineTo(x, y1)
    }
    for (let i = Math.ceil(y0 / GRID); i * GRID <= y1; i++) {
      const y = i * GRID
      const p = i % 5 === 0 ? major : minor
      p.moveTo(x0, y)
      p.lineTo(x1, y)
    }
    ctx.lineWidth = Math.max(hair, 0.6)
    ctx.strokeStyle = 'rgba(70, 120, 170, 0.22)'
    ctx.stroke(minor)
    ctx.lineWidth = Math.max(hair * 1.5, 1)
    ctx.strokeStyle = 'rgba(70, 120, 170, 0.42)'
    ctx.stroke(major)
  } else if (paper === 'lines') {
    const gap = 34
    const top = 90
    const lines = new Path2D()
    for (let y = top; y <= h - 20; y += gap) {
      if (y < y0 - 2 || y > y1 + 2) continue
      lines.moveTo(x0, y)
      lines.lineTo(x1, y)
    }
    ctx.lineWidth = Math.max(hair, 0.8)
    ctx.strokeStyle = 'rgba(70, 120, 170, 0.38)'
    ctx.stroke(lines)
    ctx.beginPath()
    ctx.moveTo(90, y0)
    ctx.lineTo(90, y1)
    ctx.lineWidth = Math.max(hair, 1.1)
    ctx.strokeStyle = 'rgba(200, 70, 60, 0.5)'
    ctx.stroke()
  } else if (paper === 'dots') {
    ctx.fillStyle = 'rgba(60, 60, 70, 0.35)'
    const r = Math.max(1.1, 1.6 / k)
    for (let x = Math.ceil(x0 / GRID) * GRID; x <= x1; x += GRID) {
      for (let y = Math.ceil(y0 / GRID) * GRID; y <= y1; y += GRID) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

export const PAPER_LABELS: Record<Paper, string> = {
  plain: 'Plain',
  grid: 'Graph',
  lines: 'Lined',
  dots: 'Dots',
}
