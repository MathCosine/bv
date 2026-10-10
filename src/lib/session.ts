import type { ViewInfo } from '../board/Board'
import { InkStore, type Patch } from '../ink/store'
import type { Backend } from './backend'
import type { Role } from './config'
import type { Hub, Msg } from './hub'
import { openPdf, PdfPainter } from './pdf'
import type { Lesson, LessonSettings, PageRef, Pod } from './types'

export type SaveState = 'saved' | 'saving' | 'error'

/**
 * Everything about one open lesson on this device: the lesson record, its ink,
 * the PDF, and keeping all of that saved and in step with the other device.
 */
export class Session {
  ink = new InkStore()
  pdf: PdfPainter | null = null
  saveState: SaveState = 'saved'
  saveError = ''
  padView: ViewInfo | null = null
  cover = false
  loadError = ''

  private fns = new Set<() => void>()
  private remoteFns = new Set<(m: Msg) => void>()
  private dirtyInk = new Set<string>()
  private inkTimer = 0
  private inkSaving: Promise<void> | null = null
  private lessonDirty: Partial<Lesson> = {}
  private lessonTimer = 0
  private reloading: Patch[] | null = null
  private off: () => void
  private closed = false

  constructor(
    private backend: Backend,
    private hub: Hub,
    public lesson: Lesson,
    public role: Role,
  ) {
    this.ink.onLocalPatch = (p) => {
      hub.send({ t: 'patch', lesson: lesson.id, p })
      this.markInk(p.page)
    }
    this.off = hub.on((m, _from, role) => this.receive(m, role))
    window.addEventListener('pagehide', this.flushAll)
    document.addEventListener('visibilitychange', this.onHide)
  }

  async load() {
    const [ink] = await Promise.all([
      this.backend.loadInk(this.lesson.id).catch((e) => {
        this.loadError = String(e?.message ?? e)
        return {}
      }),
      this.loadPdf(),
    ])
    if (this.closed) return
    for (const [page, strokes] of Object.entries(ink)) this.ink.load(page, strokes)
    this.hub.setLesson(this.lesson.id)
    this.emit()
  }

  private async loadPdf() {
    if (!this.lesson.doc) return
    try {
      const blob = await this.backend.getFile(this.lesson.doc.path)
      const doc = await openPdf(await blob.arrayBuffer())
      if (this.closed) {
        void doc.loadingTask.destroy()
        return
      }
      this.pdf = new PdfPainter(doc)
    } catch (e) {
      this.loadError = `Couldn't load the PDF. ${(e as Error)?.message ?? ''}`
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.flushAll()
    this.off()
    window.removeEventListener('pagehide', this.flushAll)
    document.removeEventListener('visibilitychange', this.onHide)
    this.pdf?.destroy()
    this.pdf = null
  }

  subscribe(fn: () => void): () => void {
    this.fns.add(fn)
    return () => this.fns.delete(fn)
  }

  /** Raw messages for this lesson (live strokes, laser, view...). */
  onRemote(fn: (m: Msg) => void): () => void {
    this.remoteFns.add(fn)
    return () => this.remoteFns.delete(fn)
  }

  private emit() {
    for (const f of this.fns) f()
  }

  // ------------------------------------------------------------ lesson edits

  private patchLesson(patch: Partial<Lesson>, msg: Msg) {
    this.lesson = { ...this.lesson, ...patch }
    this.hub.send(msg)
    Object.assign(this.lessonDirty, patch)
    clearTimeout(this.lessonTimer)
    this.lessonTimer = window.setTimeout(() => this.saveLesson(), 600)
    this.emit()
  }

  setPods(pods: Pod[]) {
    this.patchLesson({ pods }, { t: 'pods', lesson: this.lesson.id, pods })
  }

  updatePod(id: string, fn: (p: Pod) => Pod) {
    this.setPods(this.lesson.pods.map((p) => (p.id === id ? fn(p) : p)))
  }

  setSettings(s: Partial<LessonSettings>) {
    const settings = { ...this.lesson.settings, ...s }
    this.patchLesson({ settings }, { t: 'lesson', lesson: this.lesson.id, patch: { settings } })
  }

  setPages(pages: PageRef[]) {
    this.patchLesson({ pages }, { t: 'lesson', lesson: this.lesson.id, patch: { pages } })
  }

  setMeta(patch: Partial<Pick<Lesson, 'title' | 'layout'>>) {
    this.patchLesson(patch, { t: 'lesson', lesson: this.lesson.id, patch })
  }

  setCover(on: boolean) {
    this.cover = on
    this.hub.sendNow({ t: 'cover', lesson: this.lesson.id, on })
    this.emit()
  }

  private async saveLesson() {
    const patch = this.lessonDirty
    this.lessonDirty = {}
    if (!Object.keys(patch).length) return
    try {
      await this.backend.updateLesson(this.lesson.id, patch)
    } catch (e) {
      // put it back and try again shortly
      this.lessonDirty = { ...patch, ...this.lessonDirty }
      this.setSave('error', (e as Error).message)
      clearTimeout(this.lessonTimer)
      this.lessonTimer = window.setTimeout(() => this.saveLesson(), 4000)
    }
  }

  // ------------------------------------------------------------ ink saving

  private markInk(page: string) {
    this.dirtyInk.add(page)
    if (this.saveState !== 'error') this.setSave('saving')
    clearTimeout(this.inkTimer)
    this.inkTimer = window.setTimeout(() => this.saveInk(), 900)
  }

  private setSave(s: SaveState, err = '') {
    if (this.saveState === s && this.saveError === err) return
    this.saveState = s
    this.saveError = err
    this.emit()
  }

  private async saveInk(): Promise<void> {
    if (this.inkSaving) {
      await this.inkSaving
      if (this.dirtyInk.size) return this.saveInk()
      return
    }
    const pages = [...this.dirtyInk]
    this.dirtyInk.clear()
    if (!pages.length) return
    this.inkSaving = (async () => {
      const failed: string[] = []
      let err = ''
      for (const page of pages) {
        try {
          await this.backend.saveInk(this.lesson.id, page, this.ink.get(page))
        } catch (e) {
          failed.push(page)
          err = (e as Error).message
        }
      }
      if (failed.length) {
        for (const p of failed) this.dirtyInk.add(p)
        this.setSave('error', err)
        clearTimeout(this.inkTimer)
        this.inkTimer = window.setTimeout(() => this.saveInk(), 4000)
      } else if (!this.dirtyInk.size) {
        this.setSave('saved')
      }
    })()
    try {
      await this.inkSaving
    } finally {
      this.inkSaving = null
    }
  }

  /** Save everything now (leaving the page, or the other device asked). */
  flushAll = () => {
    clearTimeout(this.inkTimer)
    clearTimeout(this.lessonTimer)
    void this.saveLesson()
    return this.saveInk()
  }

  private onHide = () => {
    if (document.visibilityState === 'hidden') void this.flushAll()
  }

  // ------------------------------------------------------------ remote

  private receive(m: Msg, role: Role) {
    if ('lesson' in m && m.lesson !== this.lesson.id && m.t !== 'hello' && m.t !== 'here' && m.t !== 'open') return
    switch (m.t) {
      case 'hello':
        if (m.lesson !== this.lesson.id) return
        // The other device just opened this lesson: make sure it sees our latest.
        if (this.role === 'pad') {
          void this.flushAll().then(() => {
            this.hub.send({ t: 'saved', lesson: this.lesson.id })
            this.hub.send({ t: 'lesson', lesson: this.lesson.id, patch: { pages: this.lesson.pages } })
            if (this.cover) this.hub.send({ t: 'cover', lesson: this.lesson.id, on: true })
          })
        } else {
          this.hub.send({ t: 'pods', lesson: this.lesson.id, pods: this.lesson.pods })
        }
        break
      case 'patch':
        if (this.reloading) this.reloading.push(m.p)
        this.ink.applyRemote(m.p)
        break
      case 'saved':
        if (role === 'pad' && this.role === 'projector') void this.reloadInk()
        break
      case 'pods':
        this.lesson = { ...this.lesson, pods: m.pods }
        this.emit()
        break
      case 'lesson':
        this.lesson = { ...this.lesson, ...m.patch }
        this.emit()
        break
      case 'view':
        this.padView = m.v
        break
      case 'cover':
        this.cover = m.on
        this.emit()
        break
    }
    for (const f of this.remoteFns) f(m)
  }

  private async reloadInk() {
    if (this.reloading) return
    this.reloading = []
    try {
      const ink = await this.backend.loadInk(this.lesson.id)
      const seen = new Set(Object.keys(ink))
      for (const [page, strokes] of Object.entries(ink)) this.ink.load(page, strokes)
      for (const page of this.ink.allPages()) if (!seen.has(page)) this.ink.load(page, [])
      // Anything that arrived while we were loading goes back on top.
      for (const p of this.reloading) this.ink.applyRemote(p)
    } catch {
      /* keep what we have */
    } finally {
      this.reloading = null
    }
  }
}
