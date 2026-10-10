import type { Lesson, LessonMeta, Stroke } from '../types'

export type LinkStatus = 'connecting' | 'live' | 'offline'

/** A raw broadcast pipe between this user's devices. */
export interface Pipe {
  send(payload: unknown): void
  onMessage(fn: (payload: unknown) => void): () => void
  onStatus(fn: (s: LinkStatus) => void): () => void
  close(): void
}

export interface User {
  id: string
  email?: string
}

export interface Backend {
  kind: 'supabase' | 'local'
  user(): Promise<User | null>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>

  listLessons(): Promise<LessonMeta[]>
  getLesson(id: string): Promise<Lesson | null>
  createLesson(l: Lesson): Promise<void>
  updateLesson(id: string, patch: Partial<Lesson>): Promise<void>
  deleteLesson(id: string): Promise<void>

  /** Paths are relative to this user's folder, e.g. `<lessonId>/doc.pdf`. */
  putFile(path: string, data: Blob): Promise<void>
  getFile(path: string): Promise<Blob>
  deleteFolder(prefix: string): Promise<void>

  loadInk(lessonId: string): Promise<Record<string, Stroke[]>>
  saveInk(lessonId: string, page: string, strokes: Stroke[]): Promise<void>
  copyInk(fromLesson: string, toLesson: string): Promise<void>

  pipe(user: User): Pipe
}

export function toMeta(l: Lesson): LessonMeta {
  return {
    id: l.id,
    title: l.title,
    layout: l.layout,
    thumb: l.thumb,
    updatedAt: l.updatedAt,
    createdAt: l.createdAt,
    pageCount: l.pages.length,
  }
}
