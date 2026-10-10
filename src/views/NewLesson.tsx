import { useEffect, useState } from 'react'
import type { Backend } from '../lib/backend'
import { createLesson, guessLayout, inspectPdf, type PdfInfo } from '../lib/lessons'
import type { Layout, Lesson, Paper } from '../lib/types'
import { PAPER_LABELS } from '../board/paper'

export function LayoutPick({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  return (
    <div className="layout-pick">
      <button type="button" className={value === 'slides' ? 'on' : ''} onClick={() => onChange('slides')}>
        <svg width="56" height="30" viewBox="0 0 56 30" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="1" y="3" width="36" height="24" />
          <path d="M44 15h10M50 11l4 4-4 4" />
        </svg>
        <b>Slides</b>
        <span>One page at a time. Swipe to go on.</span>
      </button>
      <button type="button" className={value === 'scroll' ? 'on' : ''} onClick={() => onChange('scroll')}>
        <svg width="56" height="30" viewBox="0 0 56 30" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="1" y="1" width="20" height="13" />
          <rect x="1" y="17" width="20" height="13" />
          <path d="M32 6v18M28 20l4 4 4-4" />
        </svg>
        <b>Scroll</b>
        <span>Pages stacked. Good for worksheets.</span>
      </button>
    </div>
  )
}

export function PaperPick({ value, onChange }: { value: Paper; onChange: (p: Paper) => void }) {
  return (
    <div className="paper-pick">
      {(Object.keys(PAPER_LABELS) as Paper[]).map((p) => (
        <button type="button" key={p} className={value === p ? 'on' : ''} onClick={() => onChange(p)}>
          <span className={`swatch paper-${p}`} />
          {PAPER_LABELS[p]}
        </button>
      ))}
    </div>
  )
}

export function NewLesson({ backend, onClose, onCreated, initialFile }: { backend: Backend; onClose: () => void; onCreated: (l: Lesson) => void; initialFile?: File | null }) {
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<PdfInfo | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [layout, setLayout] = useState<Layout>('slides')
  const [paper, setPaper] = useState<Paper>('grid')
  const [step, setStep] = useState('')
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)

  const pick = async (f: File | null | undefined) => {
    if (!f) return
    setErr('')
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setErr('That isn’t a PDF. From PowerPoint, Keynote or Google Slides, use File → Export / Download → PDF first.')
      return
    }
    setFile(f)
    setStep('Reading the PDF…')
    try {
      const i = await inspectPdf(f)
      setInfo(i)
      setLayout(guessLayout(i.sizes))
      if (!title) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '))
      setPreview(URL.createObjectURL(i.thumb))
    } catch (e) {
      setFile(null)
      setErr(`Couldn’t open that PDF. ${(e as Error).message}`)
    } finally {
      setStep('')
    }
  }

  useEffect(() => {
    if (initialFile) void pick(initialFile)
  }, [initialFile]) // pick is stable enough; only re-run for a new file

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const create = async () => {
    setErr('')
    try {
      const lesson = await createLesson(
        backend,
        { title: title || (file ? file.name : 'Whiteboard'), layout, pdf: file && info ? { info, name: file.name } : undefined, paper },
        setStep,
      )
      onCreated(lesson)
    } catch (e) {
      setErr((e as Error).message)
      setStep('')
    }
  }

  const busy = !!step
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="card dialog">
        <h1>New lesson</h1>
        <label
          className={`drop${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            void pick(e.dataTransfer.files[0])
          }}
        >
          {preview ? (
            <>
              <img src={preview} alt="" />
              <span className="small">
                {file?.name} &middot; {info?.sizes.length} page{info?.sizes.length === 1 ? '' : 's'} &middot; tap to change
              </span>
            </>
          ) : (
            <>
              <b>Choose a PDF</b>
              <span className="small">or drop one here. Slides from PowerPoint, Keynote or Google Slides: export as PDF first.</span>
              <span className="small">Skip this for a blank whiteboard.</span>
            </>
          )}
          <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        </label>

        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file ? '' : 'Whiteboard'} />
        </label>

        <div className="field">
          <span>Show it as</span>
          <LayoutPick value={layout} onChange={setLayout} />
        </div>

        {!file && (
          <div className="field">
            <span>Paper</span>
            <PaperPick value={paper} onChange={setPaper} />
          </div>
        )}

        {err && <p className="error">{err}</p>}
        <div className="card-actions">
          <button className="btn red" disabled={busy || (!!file && !info)} onClick={create}>
            {step || 'Create lesson'}
          </button>
          <button className="text-btn" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
