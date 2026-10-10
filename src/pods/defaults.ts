import { uid } from '../lib/ids'
import type { ChecklistPod, ImagePod, Layout, NotesPod, Pod, PodType, TimerPod } from '../lib/types'

export function newPod(type: PodType, layout: Layout): Pod {
  const common = { id: uid(), showTitle: true, size: 'M' as const, accent: 'graphite' as const, hidden: false }
  switch (type) {
    case 'notes':
      return {
        ...common,
        type,
        title: 'Notes',
        scope: layout === 'slides' ? 'page' : 'lesson',
        text: '',
        perPage: {},
        hideWhenEmpty: false,
        align: 'left',
      } satisfies NotesPod
    case 'timer':
      return { ...common, type, title: 'Timer', duration: 3 * 60_000, state: { status: 'idle' }, chime: true, accent: 'red' } satisfies TimerPod
    case 'checklist':
      return { ...common, type, title: 'Today’s plan', items: [], accent: 'blue' } satisfies ChecklistPod
    case 'image':
      return { ...common, type, title: 'Picture', path: null, caption: '', showTitle: false } satisfies ImagePod
  }
}

export function starterPods(layout: Layout): Pod[] {
  const today = newPod('notes', layout) as NotesPod
  today.title = 'We’re learning'
  today.scope = 'lesson'
  today.accent = 'red'
  const key = newPod('notes', layout) as NotesPod
  key.title = layout === 'slides' ? 'On this slide' : 'Notes'
  const timer = newPod('timer', layout)
  return [today, key, timer]
}

export const POD_TYPE_LABEL: Record<PodType, string> = {
  notes: 'Notes',
  timer: 'Timer',
  checklist: 'Checklist',
  image: 'Picture',
}
