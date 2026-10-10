// Shared data shapes. Everything that gets saved or sent between devices
// lives here so both ends agree on it.

export type Layout = 'slides' | 'scroll'
export type Paper = 'plain' | 'grid' | 'lines' | 'dots'

/** Every page is laid out 1000 units wide; height keeps the aspect ratio. */
export const PAGE_W = 1000

export type PageRef =
  | { id: string; kind: 'pdf'; n: number; w: number; h: number }
  | { id: string; kind: 'paper'; paper: Paper; w: number; h: number }
  /** a photo or picture added from the iPad (camera, photo library, files) */
  | { id: string; kind: 'image'; path: string; w: number; h: number }

export interface DocInfo {
  path: string
  name: string
  pageCount: number
}

export type Accent = 'graphite' | 'red' | 'blue' | 'green'
export type PodSize = 'S' | 'M' | 'L' | 'XL'
/** the colour of the card a pod sits on */
export type CardColor = 'paper' | 'yellow' | 'blue' | 'green' | 'pink'

interface PodBase {
  id: string
  title: string
  showTitle: boolean
  size: PodSize
  accent: Accent
  card?: CardColor
  hidden: boolean
}

export interface NotesPod extends PodBase {
  type: 'notes'
  /** 'lesson' keeps the same notes all lesson, 'page' gives each page its own (wipes on page change). */
  scope: 'lesson' | 'page'
  text: string
  perPage: Record<string, string>
  hideWhenEmpty: boolean
  align: 'left' | 'center'
}

export type TimerState =
  | { status: 'idle' }
  | { status: 'running'; endsAt: number }
  | { status: 'paused'; remaining: number }
  | { status: 'done' }

export interface TimerPod extends PodBase {
  type: 'timer'
  duration: number // ms
  state: TimerState
  chime: boolean
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface ChecklistPod extends PodBase {
  type: 'checklist'
  items: ChecklistItem[]
}

export interface ImagePod extends PodBase {
  type: 'image'
  path: string | null
  caption: string
}

export type Pod = NotesPod | TimerPod | ChecklistPod | ImagePod
export type PodType = Pod['type']

export interface LessonSettings {
  podWidth: number // fraction of screen width given to pods on the projector
  showPods: boolean
}

export interface Lesson {
  id: string
  title: string
  layout: Layout
  doc: DocInfo | null
  pages: PageRef[]
  pods: Pod[]
  settings: LessonSettings
  thumb: string | null
  createdAt: string
  updatedAt: string
}

export type LessonMeta = Pick<Lesson, 'id' | 'title' | 'layout' | 'thumb' | 'updatedAt' | 'createdAt'> & {
  pageCount: number
}

export type InkTool = 'pen' | 'highlighter'
/** fountain: thickens with pressure. felt: an even line, like a felt-tip marker. */
export type PenStyle = 'fountain' | 'felt'

export interface Stroke {
  id: string
  tool: InkTool
  color: string
  size: number
  /** flat [x, y, pressure, x, y, pressure, ...] in page units */
  pts: number[]
  /** pressure was simulated (finger / mouse) */
  sim?: boolean
  /** snapped shape: drawn with even width */
  shape?: boolean
  /** pen style; missing means fountain */
  style?: PenStyle
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
