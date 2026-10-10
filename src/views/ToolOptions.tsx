import { useMemo } from 'react'
import { outline, outlineToSvg } from '../ink/stroke'
import {
  ERASER_SIZES, HIGHLIGHT_MAX, HIGHLIGHT_MIN, HIGHLIGHT_PALETTE, PEN_MAX, PEN_MIN, PEN_PALETTE,
  type ToolState,
} from '../ink/tools'
import type { PenStyle } from '../lib/types'

interface Props {
  tools: ToolState
  onChange: (t: ToolState) => void
}

/** A sample squiggle drawn with the current pen, so you can see what you'll get. */
function Preview({ tools }: { tools: ToolState }) {
  const d = useMemo(() => {
    const hl = tools.tool === 'highlighter'
    const pts: number[] = []
    for (let i = 0; i <= 60; i++) {
      const t = i / 60
      const x = 12 + t * 216
      const y = hl ? 30 : 30 + Math.sin(t * Math.PI * 2.2) * 13
      // press harder in the middle of the stroke, like a real one
      const p = 0.25 + 0.6 * Math.sin(t * Math.PI)
      pts.push(x, y, p)
    }
    const size = (hl ? tools.hlSize : tools.penSize) * 1.15
    return outlineToSvg(outline({ tool: hl ? 'highlighter' : 'pen', size, style: tools.penStyle, pts }))
  }, [tools.tool, tools.penSize, tools.hlSize, tools.penStyle])
  const color = tools.tool === 'highlighter' ? tools.hlColor : tools.penColor
  return (
    <svg className="tool-preview" viewBox="0 0 240 60" aria-hidden>
      <path d={d} fill={color} style={tools.tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined} />
    </svg>
  )
}

function Palette({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  const custom = !colors.includes(value)
  return (
    <div className="palette">
      {colors.map((c) => (
        <button key={c} className={`sw${c === value ? ' on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} aria-label={c} />
      ))}
      <label className={`sw sw-custom${custom ? ' on' : ''}`} style={custom ? { background: value } : undefined} title="Any colour">
        <input type="color" value={value} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

export function ToolOptions({ tools, onChange }: Props) {
  const t = tools
  const set = (p: Partial<ToolState>) => onChange({ ...t, ...p })
  if (t.tool === 'pen') {
    const styles: { id: PenStyle; label: string }[] = [
      { id: 'fountain', label: 'Fountain' },
      { id: 'felt', label: 'Felt tip' },
    ]
    return (
      <div className="tool-opts">
        <Preview tools={t} />
        <div className="seg small full">
          {styles.map((s) => (
            <button key={s.id} className={t.penStyle === s.id ? 'on' : ''} onClick={() => set({ penStyle: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
        <label className="slider">
          <span>Thickness</span>
          <input type="range" min={PEN_MIN} max={PEN_MAX} step={0.1} value={t.penSize} onChange={(e) => set({ penSize: Number(e.target.value) })} />
        </label>
        <Palette colors={PEN_PALETTE} value={t.penColor} onPick={(c) => set({ penColor: c })} />
      </div>
    )
  }
  if (t.tool === 'highlighter') {
    return (
      <div className="tool-opts">
        <Preview tools={t} />
        <label className="slider">
          <span>Thickness</span>
          <input type="range" min={HIGHLIGHT_MIN} max={HIGHLIGHT_MAX} step={1} value={t.hlSize} onChange={(e) => set({ hlSize: Number(e.target.value) })} />
        </label>
        <Palette colors={HIGHLIGHT_PALETTE} value={t.hlColor} onPick={(c) => set({ hlColor: c })} />
        <label className="check-row tight">
          <input type="checkbox" checked={t.hlStraight} onChange={(e) => set({ hlStraight: e.target.checked })} />
          Straighten when I let go
        </label>
      </div>
    )
  }
  if (t.tool === 'eraser') {
    return (
      <div className="tool-opts">
        <div className="seg small full">
          <button className={t.eraserMode === 'stroke' ? 'on' : ''} onClick={() => set({ eraserMode: 'stroke' })}>Whole stroke</button>
          <button className={t.eraserMode === 'precise' ? 'on' : ''} onClick={() => set({ eraserMode: 'precise' })}>Just what I rub</button>
        </div>
        <div className="seg small full">
          {ERASER_SIZES.map((s, i) => (
            <button key={s} className={t.eraserSize === s ? 'on' : ''} onClick={() => set({ eraserSize: s })}>
              {['Small', 'Medium', 'Large'][i]}
            </button>
          ))}
        </div>
        <label className="check-row tight">
          <input type="checkbox" checked={t.eraserHighlightOnly} onChange={(e) => set({ eraserHighlightOnly: e.target.checked })} />
          Only erase highlighter
        </label>
      </div>
    )
  }
  if (t.tool === 'lasso') {
    return (
      <div className="tool-opts hint-only">
        Circle some writing to pick it up, or tap one stroke. Drag it to move. The round handles resize and turn it.
      </div>
    )
  }
  return <div className="tool-opts hint-only">Point with the Pencil. The class sees a red dot that fades away. Nothing is saved.</div>
}
