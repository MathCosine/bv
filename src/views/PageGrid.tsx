import { useEffect, useRef } from 'react'
import { renderThumb } from '../board/thumbs'
import type { Session } from '../lib/session'
import type { PageRef } from '../lib/types'
import { IconClose, IconTrash } from '../ui/icons'

interface Props {
  session: Session
  image: (path: string) => Promise<CanvasImageSource>
  current: number
  onPick: (index: number) => void
  onDelete: (page: PageRef) => void
  onClose: () => void
}

export function PageGrid({ session, image, current, onPick, onDelete, onClose }: Props) {
  const pages = session.lesson.pages
  return (
    <div className="page-grid">
      <header>
        <h2>Pages</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </header>
      <div className="grid">
        {pages.map((p, i) => (
          <div key={p.id} className={`thumb${i === current ? ' on' : ''}`}>
            <button style={{ display: 'block', width: '100%' }} onClick={() => onPick(i)}>
              <Thumb session={session} page={p} image={image} />
              {i + 1}
              {p.kind === 'paper' ? ' · blank' : p.kind === 'image' ? ' · photo' : ''}
            </button>
            {p.kind !== 'pdf' && pages.length > 1 && (
              <button className="del" aria-label="Delete page" onClick={() => onDelete(p)}>
                <IconTrash width={16} height={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// One at a time, so a 40-page PDF doesn't lock up the iPad.
let chain: Promise<unknown> = Promise.resolve()

function Thumb({ session, page, image }: { session: Session; page: PageRef; image: (path: string) => Promise<CanvasImageSource> }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    const el = ref.current
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return
      io.disconnect()
      chain = chain.then(async () => {
        if (!live || !el) return
        const c = await renderThumb(page, session.pdf?.doc ?? null, session.ink.get(page.id), 220, image).catch(() => null)
        if (c && live) el.replaceChildren(c)
      })
    })
    if (el) io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [session, page, image])
  return <div ref={ref} className="thumb-ph" style={{ aspectRatio: `${page.w} / ${page.h}` }} />
}
