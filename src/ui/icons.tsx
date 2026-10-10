import type { SVGProps } from 'react'

// Hand-drawn-ish line icons. Kept deliberately small and a bit uneven rather
// than pulled from an icon pack.

type P = SVGProps<SVGSVGElement>

const base = (p: P) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
})

export const IconUndo = (p: P) => (
  <svg {...base(p)}><path d="M9 14 4.5 9.5 9 5" /><path d="M5 9.5h9.2c3.2 0 5.6 2.4 5.6 5.4S17.4 20 14.2 20H11" /></svg>
)
export const IconRedo = (p: P) => (
  <svg {...base(p)}><path d="m15 14 4.5-4.5L15 5" /><path d="M19 9.5H9.8C6.6 9.5 4.2 11.9 4.2 14.9S6.6 20 9.8 20H13" /></svg>
)
export const IconLeft = (p: P) => (
  <svg {...base(p)}><path d="M14.5 5.5 8 12l6.5 6.5" /></svg>
)
export const IconRight = (p: P) => (
  <svg {...base(p)}><path d="M9.5 5.5 16 12l-6.5 6.5" /></svg>
)
export const IconBack = (p: P) => (
  <svg {...base(p)}><path d="M10 6 4 12l6 6" /><path d="M4.5 12H20" /></svg>
)
export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconPages = (p: P) => (
  <svg {...base(p)}><rect x="4" y="4" width="7" height="9" rx="1" /><rect x="13" y="4" width="7" height="9" rx="1" /><path d="M4 17h16M4 20.5h10" /></svg>
)
export const IconSidebar = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M14.5 4.5v15" /><path d="M16.8 8.5h1.6M16.8 11.5h1.6" /></svg>
)
export const IconMore = (p: P) => (
  <svg {...base(p)}><circle cx="5.5" cy="12" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="18.5" cy="12" r="1.1" fill="currentColor" /></svg>
)
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M5 7h14M10 7V4.8h4V7M7 7l.8 12.2c.1.9.8 1.6 1.7 1.6h5c.9 0 1.6-.7 1.7-1.6L17 7" /></svg>
)
export const IconCopy = (p: P) => (
  <svg {...base(p)}><rect x="8.5" y="8.5" width="11" height="11" rx="1.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="m5 12.5 4.2 4.2L19 7" /></svg>
)
export const IconUp = (p: P) => (
  <svg {...base(p)}><path d="m6 14 6-6 6 6" /></svg>
)
export const IconDown = (p: P) => (
  <svg {...base(p)}><path d="m6 10 6 6 6-6" /></svg>
)
export const IconSliders = (p: P) => (
  <svg {...base(p)}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
)
export const IconExpand = (p: P) => (
  <svg {...base(p)}><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" /></svg>
)
export const IconEyeOff = (p: P) => (
  <svg {...base(p)}><path d="M3 12s3.2-6 9-6c1.5 0 2.8.4 3.9 1M21 12s-3.2 6-9 6c-1.5 0-2.8-.4-3.9-1" /><path d="M4 20 20 4" /></svg>
)
export const IconPlay = (p: P) => (
  <svg {...base(p)}><path d="M8 5.5v13l10.5-6.5z" /></svg>
)
export const IconPause = (p: P) => (
  <svg {...base(p)}><path d="M8.5 5.5v13M15.5 5.5v13" /></svg>
)
export const IconReset = (p: P) => (
  <svg {...base(p)}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></svg>
)
export const IconUpload = (p: P) => (
  <svg {...base(p)}><path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" /><path d="M4.5 15.5v2.8c0 .9.7 1.7 1.7 1.7h11.6c.9 0 1.7-.8 1.7-1.7v-2.8" /></svg>
)
export const IconProjector = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="8" width="17" height="9" rx="2" /><circle cx="15.5" cy="12.5" r="2.3" /><path d="M6.5 11.5h4M7 17v2M17 17v2" /></svg>
)
export const IconTablet = (p: P) => (
  <svg {...base(p)}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M11 17.5h2" /></svg>
)
export const IconCamera = (p: P) => (
  <svg {...base(p)}><path d="M4 8.5c0-1 .8-1.8 1.8-1.8h2.1l1.3-2h5.6l1.3 2h2.1c1 0 1.8.8 1.8 1.8v9c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8z" /><circle cx="12" cy="13" r="3.4" /></svg>
)
export const IconShapes = (p: P) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="3.5" /><rect x="12.5" y="12.5" width="7" height="7" /><path d="M4 20l3.5-6 3.5 6z" /></svg>
)

// ---- tools: little drawings of the actual objects, standing up in the tray

const TOOL_INK = '#2a2723'

export function ToolPen({ color }: { color: string }) {
  return (
    <svg width="26" height="50" viewBox="0 0 26 50" aria-hidden>
      <path d="M8 50V17.5L13 3.5l5 14V50z" fill="#fbf8f1" stroke={TOOL_INK} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10.6 10.6 13 3.5l2.4 7.1z" fill={color} />
      <path d="M8 17.5h10" stroke={TOOL_INK} strokeWidth="1.1" />
      <rect x="8" y="24" width="10" height="6" fill={color} />
      <path d="M8 24h10M8 30h10" stroke={TOOL_INK} strokeWidth="1.1" />
    </svg>
  )
}

export function ToolHighlighter({ color }: { color: string }) {
  return (
    <svg width="28" height="50" viewBox="0 0 28 50" aria-hidden>
      <path d="M6 50V20l3-4h10l3 4v30z" fill="#fbf8f1" stroke={TOOL_INK} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.5 16 10.5 6.5 18 4.5V16z" fill={color} stroke={TOOL_INK} strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="6" y="27" width="16" height="10" fill={color} opacity="0.85" />
      <path d="M6 27h16M6 37h16" stroke={TOOL_INK} strokeWidth="1.1" />
    </svg>
  )
}

export function ToolEraser() {
  return (
    <svg width="26" height="50" viewBox="0 0 26 50" aria-hidden>
      <path d="M6 50V13c0-4.5 2.8-7 7-7s7 2.5 7 7v37z" fill="#f0b4a4" stroke={TOOL_INK} strokeWidth="1.3" />
      <path d="M6 22h14V50H6z" fill="#7d9bb8" stroke={TOOL_INK} strokeWidth="1.3" />
      <path d="M6 26h14" stroke={TOOL_INK} strokeWidth="0.9" opacity=".6" />
    </svg>
  )
}

export function ToolLasso() {
  return (
    <svg width="30" height="50" viewBox="0 0 30 50" aria-hidden>
      <path d="M13 50V27h4v23z" fill="#fbf8f1" stroke={TOOL_INK} strokeWidth="1.3" />
      <ellipse cx="15" cy="14" rx="11" ry="9" fill="none" stroke="#2f5d8a" strokeWidth="1.8" strokeDasharray="3.2 2.6" />
      <path d="M15 23c0 2 1 3 2 4" fill="none" stroke="#2f5d8a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function ToolLaser() {
  return (
    <svg width="26" height="50" viewBox="0 0 26 50" aria-hidden>
      <path d="M9 50V14.5c0-1.7 1.8-3 4-3s4 1.3 4 3V50z" fill="#3a3632" stroke={TOOL_INK} strokeWidth="1.3" />
      <circle cx="13" cy="6.5" r="5.5" fill="#ff4a33" opacity="0.25" />
      <circle cx="13" cy="6.5" r="2.6" fill="#ff3b26" />
      <rect x="11" y="26" width="4" height="7" rx="1" fill="#c9c2b6" />
    </svg>
  )
}
