import type { PenStyle } from '../lib/types'

export type ToolName = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'laser'
export type EraserMode = 'stroke' | 'precise'

// Ink colours chosen to read well on a washed-out projector, not just on a
// retina screen. Graphite first because that's what you reach for 90% of the time.
export const PEN_COLORS = [
  { name: 'Graphite', value: '#24221f' },
  { name: 'Blue', value: '#1f4fa3' },
  { name: 'Red', value: '#c2361f' },
  { name: 'Green', value: '#2b7a3d' },
  { name: 'Orange', value: '#d9731a' },
  { name: 'Purple', value: '#6b3fa0' },
]

/** The full box of pens, shown when you tap the pen again. */
export const PEN_PALETTE = [
  '#24221f', '#5b5750', '#8f8a80', '#1f4fa3', '#2f86c9', '#1b8a8f',
  '#c2361f', '#e0572e', '#d9731a', '#e8a317', '#2b7a3d', '#6aa339',
  '#6b3fa0', '#b04a9c', '#d64f7e', '#7a4b2a', '#0f5e4a', '#ffffff',
]

export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#ffe14d' },
  { name: 'Green', value: '#9be38a' },
  { name: 'Pink', value: '#ff9ccf' },
  { name: 'Blue', value: '#8fd3ff' },
]

export const HIGHLIGHT_PALETTE = ['#ffe14d', '#ffc266', '#9be38a', '#7fe0c7', '#8fd3ff', '#b9a6ff', '#ff9ccf', '#ff8a80']

/** Widths in page units (a page is 1000 units across). */
export const PEN_SIZES = [2.6, 4.2, 7.5]
export const PEN_MIN = 1.2
export const PEN_MAX = 16
export const HIGHLIGHT_SIZES = [14, 22, 34]
export const HIGHLIGHT_MIN = 8
export const HIGHLIGHT_MAX = 60
/** Eraser radius in screen pixels, so it feels the same at any zoom. */
export const ERASER_SIZES = [8, 16, 30]

export interface ToolState {
  tool: ToolName
  penColor: string
  penSize: number
  penStyle: PenStyle
  hlColor: string
  hlSize: number
  /** highlighter strokes straighten themselves when you let go */
  hlStraight: boolean
  eraserMode: EraserMode
  eraserSize: number
  /** only rub out highlighter, leave writing alone */
  eraserHighlightOnly: boolean
  /** draw-and-hold turns a stroke into a clean line or shape */
  snap: boolean
}

export const DEFAULT_TOOLS: ToolState = {
  tool: 'pen',
  penColor: PEN_COLORS[0].value,
  penSize: PEN_SIZES[1],
  penStyle: 'fountain',
  hlColor: HIGHLIGHT_COLORS[0].value,
  hlSize: HIGHLIGHT_SIZES[1],
  hlStraight: true,
  eraserMode: 'stroke',
  eraserSize: ERASER_SIZES[1],
  eraserHighlightOnly: false,
  snap: true,
}
