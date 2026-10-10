import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import markedKatex from 'marked-katex-extension'

// Notes are Markdown with $math$ and $$display math$$. Single line breaks are
// kept as line breaks because that's how people actually type notes.
// Fractions are always drawn full size: tiny inline fractions are unreadable
// from the back of a classroom.
const md = new Marked(
  { breaks: true, gfm: true },
  markedKatex({ throwOnError: false, nonStandard: true, output: 'html', macros: { '\\frac': '\\dfrac' } }),
)

const cache = new Map<string, string>()

export function renderNotes(text: string): string {
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const html = DOMPurify.sanitize(md.parse(text, { async: false }) as string)
  if (cache.size > 300) cache.clear()
  cache.set(text, html)
  return html
}

/** One line of text with inline math (checklist items, captions). */
export function renderInline(text: string): string {
  const key = '\u0000' + text
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const html = DOMPurify.sanitize(md.parseInline(text, { async: false }) as string)
  cache.set(key, html)
  return html
}

/** Handy snippets for the editor. `|` marks where the cursor goes. */
export const MATH_SNIPPETS: { label: string; tex: string; insert: string }[] = [
  { label: 'fraction', tex: '\\tfrac{a}{b}', insert: '$\\frac{|}{}$' },
  { label: 'times', tex: '\\times', insert: '$\\times$' },
  { label: 'divide', tex: '\\div', insert: '$\\div$' },
  { label: 'power', tex: 'x^{2}', insert: '$^{|}$' },
  { label: 'square root', tex: '\\sqrt{x}', insert: '$\\sqrt{|}$' },
  { label: 'not equal', tex: '\\neq', insert: '$\\neq$' },
  { label: 'less or equal', tex: '\\le', insert: '$\\le$' },
  { label: 'greater or equal', tex: '\\ge', insert: '$\\ge$' },
  { label: 'degrees', tex: '90^\\circ', insert: '$^\\circ$' },
  { label: 'pi', tex: '\\pi', insert: '$\\pi$' },
  { label: 'big equation', tex: '\\text{\\$\\$}', insert: '\n$$\n|\n$$\n' },
]
