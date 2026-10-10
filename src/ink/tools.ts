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

export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#ffe14d' },
  { name: 'Green', value: '#9be38a' },
  { name: 'Pink', value: '#ff9ccf' },
  { name: 'Blue', value: '#8fd3ff' },
]

/** Widths in page units (a page is 1000 units across). */
export const PEN_SIZES = [2.6, 4.2, 7.5]
export const HIGHLIGHT_SIZES = [14, 22, 34]
/** Eraser radius in screen pixels, so it feels the same at any zoom. */
export const ERASER_SIZES = [8, 16, 30]

export interface ToolState {
  tool: ToolName
  penColor: string
  penSize: number
  hlColor: string
  hlSize: number
  eraserMode: EraserMode
  eraserSize: number
}

export const DEFAULT_TOOLS: ToolState = {
  tool: 'pen',
  penColor: PEN_COLORS[0].value,
  penSize: PEN_SIZES[1],
  hlColor: HIGHLIGHT_COLORS[0].value,
  hlSize: HIGHLIGHT_SIZES[1],
  eraserMode: 'stroke',
  eraserSize: ERASER_SIZES[1],
}
