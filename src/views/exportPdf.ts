import { outline, outlineToSvg } from '../ink/stroke'
import type { Session } from '../lib/session'
import { PAGE_W, type Stroke } from '../lib/types'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Build a PDF of the lesson with the ink drawn on as real vector paths. */
export async function exportPdf(session: Session, getFile: (path: string) => Promise<Blob>) {
  const { PDFDocument, rgb, BlendMode } = await import('pdf-lib')
  const lesson = session.lesson
  const out = await PDFDocument.create()
  let src: Awaited<ReturnType<typeof PDFDocument.load>> | null = null
  if (lesson.doc && session.pdf) {
    const bytes = await session.pdf.doc.getData()
    src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  }

  for (const p of lesson.pages) {
    let page
    if (p.kind === 'pdf' && src) {
      ;[page] = await out.copyPages(src, [p.n - 1])
      out.addPage(page)
    } else if (p.kind === 'image') {
      page = out.addPage([p.w, p.h])
      const bytes = new Uint8Array(await (await getFile(p.path)).arrayBuffer())
      const img = bytes[0] === 0x89 ? await out.embedPng(bytes) : await out.embedJpg(bytes)
      page.drawImage(img, { x: 0, y: 0, width: p.w, height: p.h })
    } else {
      page = out.addPage([p.w, p.h])
      if (p.kind === 'paper' && p.paper !== 'plain') {
        const s = p.w / PAGE_W
        const hUnits = (PAGE_W * p.h) / p.w
        const light = rgb(0.6, 0.72, 0.84)
        if (p.paper === 'grid') {
          for (let x = 0; x <= PAGE_W; x += 25) page.drawLine({ start: { x: x * s, y: 0 }, end: { x: x * s, y: p.h }, thickness: x % 125 ? 0.3 : 0.6, color: light })
          for (let y = 0; y <= hUnits; y += 25) page.drawLine({ start: { x: 0, y: p.h - y * s }, end: { x: p.w, y: p.h - y * s }, thickness: y % 125 ? 0.3 : 0.6, color: light })
        } else if (p.paper === 'lines') {
          for (let y = 90; y <= hUnits - 20; y += 34) page.drawLine({ start: { x: 0, y: p.h - y * s }, end: { x: p.w, y: p.h - y * s }, thickness: 0.5, color: light })
          page.drawLine({ start: { x: 90 * s, y: 0 }, end: { x: 90 * s, y: p.h }, thickness: 0.6, color: rgb(0.85, 0.45, 0.4) })
        } else if (p.paper === 'dots') {
          for (let x = 25; x < PAGE_W; x += 25) for (let y = 25; y < hUnits; y += 25) page.drawCircle({ x: x * s, y: p.h - y * s, size: 0.6, color: rgb(0.45, 0.45, 0.5) })
        }
      }
    }
    const strokes = session.ink.get(p.id)
    if (!strokes.length) continue
    const box = page.getCropBox()
    const scale = box.width / PAGE_W
    const draw = (s: Stroke, hl: boolean) => {
      const d = outlineToSvg(outline(s))
      if (!d) return
      const [r, g, b] = hexToRgb(s.color)
      page.drawSvgPath(d, {
        x: box.x,
        y: box.y + box.height,
        scale,
        color: rgb(r, g, b),
        borderWidth: 0,
        ...(hl ? { blendMode: BlendMode.Multiply } : {}),
      })
    }
    for (const s of strokes) if (s.tool === 'highlighter') draw(s, true)
    for (const s of strokes) if (s.tool === 'pen') draw(s, false)
  }

  const bytes = await out.save()
  const name = `${lesson.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'lesson'}.pdf`
  const file = new File([bytes as BlobPart], name, { type: 'application/pdf' })
  // On the iPad the share sheet is the nicest way out (Files, AirDrop, Mail).
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] }) && navigator.maxTouchPoints > 0) {
    try {
      await navigator.share({ files: [file], title: lesson.title })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
