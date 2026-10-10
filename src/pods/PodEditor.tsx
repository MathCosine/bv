import { useRef, useState } from 'react'
import { uid } from '../lib/ids'
import type { Accent, CardColor, ChecklistPod, ImagePod, NotesPod, Pod, PodSize, TimerPod } from '../lib/types'
import { IconClose, IconLeft, IconRight, IconTrash, IconUpload } from '../ui/icons'
import { MATH_SNIPPETS, renderInline } from './markdown'
import { POD_TYPE_LABEL } from './defaults'

interface Props {
  pod: Pod
  pageId: string
  pageNumber: number
  pageCount: number
  onChange: (p: Pod) => void
  onClose: () => void
  onDelete: () => void
  onPage: (dir: -1 | 1) => void
  onUploadImage: (file: File) => Promise<string>
}

const SIZES: PodSize[] = ['S', 'M', 'L', 'XL']
const CARDS: { id: CardColor; label: string }[] = [
  { id: 'paper', label: 'Plain paper' },
  { id: 'yellow', label: 'Yellow sticky note' },
  { id: 'blue', label: 'Blue card' },
  { id: 'green', label: 'Green card' },
  { id: 'pink', label: 'Pink card' },
]
const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'graphite', label: 'Graphite' },
  { id: 'red', label: 'Red pencil' },
  { id: 'blue', label: 'Blue pencil' },
  { id: 'green', label: 'Green pencil' },
]

export function PodEditor(props: Props) {
  const { pod, onChange, onClose, onDelete } = props
  return (
    <aside className="editor" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header className="editor-head">
        <span className="editor-kind">{POD_TYPE_LABEL[pod.type]}</span>
        <button className="icon-btn" onClick={onClose} title="Done (Esc)">
          <IconClose />
        </button>
      </header>

      <label className="field">
        <span>Title</span>
        <input value={pod.title} onChange={(e) => onChange({ ...pod, title: e.target.value })} placeholder="No title" />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={pod.showTitle} onChange={(e) => onChange({ ...pod, showTitle: e.target.checked })} />
        Show the title
      </label>

      {pod.type === 'notes' && <NotesEditor {...props} pod={pod} />}
      {pod.type === 'timer' && <TimerEditor pod={pod} onChange={onChange} />}
      {pod.type === 'checklist' && <ChecklistEditor pod={pod} onChange={onChange} />}
      {pod.type === 'image' && <ImageEditor pod={pod} onChange={onChange} onUpload={props.onUploadImage} />}

      <div className="field">
        <span>Text size</span>
        <div className="seg">
          {SIZES.map((s) => (
            <button key={s} className={pod.size === s ? 'on' : ''} onClick={() => onChange({ ...pod, size: s })}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Card</span>
        <div className="seg swatches">
          {CARDS.map((c) => (
            <button
              key={c.id}
              title={c.label}
              className={`card-sw card-sw-${c.id}${(pod.card ?? 'paper') === c.id ? ' on' : ''}`}
              onClick={() => onChange({ ...pod, card: c.id })}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span>Title colour</span>
        <div className="seg swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              title={a.label}
              className={`sw sw-${a.id}${pod.accent === a.id ? ' on' : ''}`}
              onClick={() => onChange({ ...pod, accent: a.id })}
            />
          ))}
        </div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={pod.hidden} onChange={(e) => onChange({ ...pod, hidden: e.target.checked })} />
        Hide from the class for now
      </label>

      <footer className="editor-foot">
        <button className="text-btn danger" onClick={onDelete}>
          <IconTrash width={18} height={18} /> Remove pod
        </button>
        <button className="btn" onClick={onClose}>Done</button>
      </footer>
    </aside>
  )
}

function NotesEditor({ pod, pageId, pageNumber, pageCount, onChange, onPage }: Props & { pod: NotesPod }) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const text = pod.scope === 'page' ? pod.perPage[pageId] ?? '' : pod.text
  const setText = (t: string) => {
    if (pod.scope === 'page') {
      const perPage = { ...pod.perPage }
      if (t) perPage[pageId] = t
      else delete perPage[pageId]
      onChange({ ...pod, perPage })
    } else {
      onChange({ ...pod, text: t })
    }
  }
  const insert = (snippet: string) => {
    const el = ta.current
    if (!el) return
    const start = el.selectionStart, end = el.selectionEnd
    const selected = text.slice(start, end)
    let ins = snippet
    let caret = ins.indexOf('|')
    if (caret >= 0) {
      ins = ins.slice(0, caret) + selected + ins.slice(caret + 1)
      caret += selected.length
    } else {
      caret = ins.length
    }
    setText(text.slice(0, start) + ins + text.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + caret, start + caret)
    })
  }
  return (
    <>
      <div className="field">
        <span>When the page changes</span>
        <div className="radio-stack">
          <label>
            <input type="radio" checked={pod.scope === 'lesson'} onChange={() => onChange({ ...pod, scope: 'lesson', hideWhenEmpty: false })} />
            <b>Keep</b> &mdash; same notes all lesson
          </label>
          <label>
            <input type="radio" checked={pod.scope === 'page'} onChange={() => onChange({ ...pod, scope: 'page', hideWhenEmpty: true })} />
            <b>Wipe</b> &mdash; each page gets its own notes
          </label>
        </div>
      </div>
      {pod.scope === 'page' && (
        <div className="page-stepper">
          <button className="icon-btn" disabled={pageNumber <= 1} onClick={() => onPage(-1)} title="Previous page">
            <IconLeft />
          </button>
          <span>
            Notes for page <b>{pageNumber}</b> of {pageCount}
          </span>
          <button className="icon-btn" disabled={pageNumber >= pageCount} onClick={() => onPage(1)} title="Next page">
            <IconRight />
          </button>
        </div>
      )}
      <div className="snippets">
        {MATH_SNIPPETS.map((s) => (
          <button key={s.label} title={s.label} onClick={() => insert(s.insert)} dangerouslySetInnerHTML={{ __html: renderInline(`$${s.tex}$`) }} />
        ))}
      </div>
      <textarea
        ref={ta}
        className="notes-input"
        value={text}
        autoFocus
        spellCheck
        onChange={(e) => setText(e.target.value)}
        placeholder={'Type notes here.\n\nMath goes between dollar signs: $3 \\times 4 = 12$\nA big centred equation goes between double dollars: $$\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}$$\n**bold**, *italic*, and - lists work too.'}
      />
      <div className="row-opts">
        <div className="seg small">
          <button className={pod.align === 'left' ? 'on' : ''} onClick={() => onChange({ ...pod, align: 'left' })}>Left</button>
          <button className={pod.align === 'center' ? 'on' : ''} onClick={() => onChange({ ...pod, align: 'center' })}>Centre</button>
        </div>
        <label className="check-row tight">
          <input type="checkbox" checked={pod.hideWhenEmpty} onChange={(e) => onChange({ ...pod, hideWhenEmpty: e.target.checked })} />
          Hide when empty
        </label>
      </div>
    </>
  )
}

const PRESETS = [1, 2, 3, 5, 10, 15]

function TimerEditor({ pod, onChange }: { pod: TimerPod; onChange: (p: Pod) => void }) {
  const mins = Math.round(pod.duration / 60_000)
  return (
    <>
      <div className="field">
        <span>Length</span>
        <div className="seg">
          {PRESETS.map((m) => (
            <button key={m} className={mins === m ? 'on' : ''} onClick={() => onChange({ ...pod, duration: m * 60_000, state: { status: 'idle' } })}>
              {m}m
            </button>
          ))}
        </div>
      </div>
      <label className="field inline">
        <span>or minutes</span>
        <input
          type="number"
          min={1}
          max={99}
          value={mins}
          onChange={(e) => {
            const v = Math.max(1, Math.min(99, Number(e.target.value) || 1))
            onChange({ ...pod, duration: v * 60_000, state: { status: 'idle' } })
          }}
        />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={pod.chime} onChange={(e) => onChange({ ...pod, chime: e.target.checked })} />
        Play a soft chime when time&rsquo;s up
      </label>
    </>
  )
}

function ChecklistEditor({ pod, onChange }: { pod: ChecklistPod; onChange: (p: Pod) => void }) {
  const [draft, setDraft] = useState(() => pod.items.map((i) => i.text).join('\n'))
  const commit = (value: string) => {
    setDraft(value)
    const lines = value.split('\n').map((l) => l.trim()).filter(Boolean)
    const pool = [...pod.items]
    const items = lines.map((text) => {
      const i = pool.findIndex((x) => x.text === text)
      if (i >= 0) return pool.splice(i, 1)[0]
      return { id: uid(), text, done: false }
    })
    onChange({ ...pod, items })
  }
  return (
    <>
      <label className="field">
        <span>One item per line</span>
        <textarea className="notes-input short" value={draft} autoFocus onChange={(e) => commit(e.target.value)} placeholder={'Warm-up\nNumber talk\nPartner practice\nExit ticket'} />
      </label>
      {pod.items.some((i) => i.done) && (
        <button className="text-btn" onClick={() => onChange({ ...pod, items: pod.items.map((i) => ({ ...i, done: false })) })}>
          Untick everything
        </button>
      )}
    </>
  )
}

function ImageEditor({ pod, onChange, onUpload }: { pod: ImagePod; onChange: (p: Pod) => void; onUpload: (f: File) => Promise<string> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <>
      <label className="upload-btn">
        <IconUpload />
        {busy ? 'Uploading\u2026' : pod.path ? 'Replace picture' : 'Choose a picture'}
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            setBusy(true)
            setErr('')
            try {
              const path = await onUpload(f)
              onChange({ ...pod, path })
            } catch (x) {
              setErr((x as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        />
      </label>
      {err && <p className="error">{err}</p>}
      <label className="field">
        <span>Caption</span>
        <input value={pod.caption} onChange={(e) => onChange({ ...pod, caption: e.target.value })} placeholder="Optional, math works: $\frac{1}{2}$" />
      </label>
    </>
  )
}
