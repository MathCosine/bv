import type { Backend } from './backend'
import { uid, uuid } from './ids'
import { openPdf, pdfPageSizes, renderPageToCanvas } from './pdf'
import type { Layout, Lesson, PageRef, Paper } from './types'
import { starterPods } from '../pods/defaults'

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.82): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make image'))), type, q))
}

export function blankPage(paper: Paper, like?: { w: number; h: number }, layout: Layout = 'slides'): PageRef {
  const size = like ?? (layout === 'slides' ? { w: 960, h: 600 } : { w: 612, h: 792 })
  return { id: uid(8), kind: 'paper', paper, w: size.w, h: size.h }
}

export interface PdfInfo {
  bytes: ArrayBuffer
  sizes: [number, number][]
  thumb: Blob
}

/** Read a PDF the person picked: page sizes plus a small cover image. */
export async function inspectPdf(file: File): Promise<PdfInfo> {
  const bytes = await file.arrayBuffer()
  // pdf.js takes ownership of the buffer it's given, so hand it a copy.
  const doc = await openPdf(new Uint8Array(bytes.slice(0)))
  try {
    const sizes = await pdfPageSizes(doc)
    const thumb = await canvasToBlob(await renderPageToCanvas(doc, 1, 420))
    return { bytes, sizes, thumb }
  } finally {
    void doc.loadingTask.destroy()
  }
}

export function guessLayout(sizes: [number, number][]): Layout {
  if (!sizes.length) return 'slides'
  const [w, h] = sizes[0]
  return w > h * 1.05 ? 'slides' : 'scroll'
}

export async function createLesson(
  backend: Backend,
  opts: { title: string; layout: Layout; pdf?: { info: PdfInfo; name: string }; paper?: Paper },
  onStep?: (s: string) => void,
): Promise<Lesson> {
  const id = uuid()
  const now = new Date().toISOString()
  let pages: PageRef[]
  let doc: Lesson['doc'] = null
  let thumb: string | null = null
  if (opts.pdf) {
    const { info, name } = opts.pdf
    pages = info.sizes.map(([w, h], i) => ({ id: uid(8), kind: 'pdf', n: i + 1, w, h }))
    const path = `${id}/doc-${uid(6)}.pdf`
    onStep?.('Uploading the PDF…')
    await backend.putFile(path, new Blob([info.bytes], { type: 'application/pdf' }))
    onStep?.('Saving a preview…')
    thumb = `${id}/thumb.jpg`
    await backend.putFile(thumb, info.thumb)
    doc = { path, name, pageCount: info.sizes.length }
  } else {
    pages = [blankPage(opts.paper ?? 'grid', undefined, opts.layout)]
  }
  const lesson: Lesson = {
    id,
    title: opts.title.trim() || 'Untitled lesson',
    layout: opts.layout,
    doc,
    pages,
    pods: starterPods(opts.layout),
    settings: { podWidth: 0.3, showPods: true },
    thumb,
    createdAt: now,
    updatedAt: now,
  }
  onStep?.('Saving the lesson…')
  await backend.createLesson(lesson)
  return lesson
}

/** Copy a lesson, optionally with its ink. Files are copied too so deleting one never breaks the other. */
export async function duplicateLesson(backend: Backend, src: Lesson, withInk: boolean): Promise<Lesson> {
  const id = uuid()
  const now = new Date().toISOString()
  const move = async (path: string | null) => {
    if (!path) return null
    const next = path.replace(/^[^/]+\//, `${id}/`)
    await backend.putFile(next, await backend.getFile(path))
    return next
  }
  const docPath = src.doc ? await move(src.doc.path) : null
  const thumb = await move(src.thumb).catch(() => null)
  const pods = await Promise.all(
    src.pods.map(async (p) => (p.type === 'image' && p.path ? { ...p, path: await move(p.path).catch(() => null) } : p)),
  )
  const lesson: Lesson = {
    ...src,
    id,
    title: `${src.title} (${withInk ? 'copy' : 'fresh'})`,
    doc: src.doc && docPath ? { ...src.doc, path: docPath } : null,
    thumb,
    pods: pods.map((p) => (p.type === 'timer' ? { ...p, state: { status: 'idle' } } : p.type === 'checklist' ? { ...p, items: p.items.map((i) => ({ ...i, done: false })) } : p)),
    createdAt: now,
    updatedAt: now,
  }
  await backend.createLesson(lesson)
  if (withInk) await backend.copyInk(src.id, id)
  return lesson
}

const urls = new Map<string, Promise<string>>()

/** Object URL for a stored file, cached for the life of the page. */
export function fileUrl(backend: Backend, path: string): Promise<string> {
  let p = urls.get(path)
  if (!p) {
    p = backend.getFile(path).then((b) => URL.createObjectURL(b))
    p.catch(() => urls.delete(path))
    urls.set(path, p)
  }
  return p
}
