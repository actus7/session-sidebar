// Text helpers and the line model the pane is laid out with. Widths are counted
// in characters, which is what a terminal column is for the glyphs used here.

export type Tone = 'plain' | 'dim' | 'title' | 'strong' | 'accent' | 'warning' | 'error' | 'success'
export type Part = { text: string; tone: Tone; color?: string }
// A `toggle` line is a card's "Ver mais" / "Ver menos" button, drawn as one.
export type Line = { left: Part[]; right?: Part[]; toggle?: 'more' | 'less' }

// A list's row cap: lifted while its card is expanded to "Ver mais".
export function cap(max: number, isMore: boolean): number {
  return isMore ? Number.POSITIVE_INFINITY : max
}

export function toggleLine(kind: 'more' | 'less'): Line {
  return { left: [{ text: kind === 'more' ? 'Ver mais' : 'Ver menos', tone: 'accent' }], toggle: kind }
}

export const ELLIPSIS = '…'
export const NO_VALUE = '—'
const THOUSAND = 1000
const BAR_FILLED = '█'
const BAR_EMPTY = '░'
const MIN_MIDDLE_WIDTH = 1

export function charCount(text: string): number {
  return Array.from(text).length
}

export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (charCount(text) <= width) return text
  if (width === MIN_MIDDLE_WIDTH) return ELLIPSIS
  return `${Array.from(text).slice(0, width - 1).join('')}${ELLIPSIS}`
}

export function padEnd(text: string, width: number): string {
  const fitted = fit(text, width)
  return fitted + ' '.repeat(Math.max(0, width - charCount(fitted)))
}

export function padStart(text: string, width: number): string {
  const fitted = fit(text, width)
  return ' '.repeat(Math.max(0, width - charCount(fitted))) + fitted
}

// Keeps the first directory and the file name, drops middle directories from
// the left of the tail until the path fits: src/…/nested/file.ts.
export function middleElide(path: string, width: number): string {
  if (charCount(path) <= width) return path
  const segments = path.split('/')
  const name = segments[segments.length - 1] ?? path
  const dirs = segments.slice(0, -1)
  const head = dirs[0] ? `${dirs[0]}/` : ''
  const rest = dirs.slice(1)
  for (let keep = rest.length - 1; keep >= 0; keep -= 1) {
    const tail = [...rest.slice(rest.length - keep), name].join('/')
    const candidate = `${head}${ELLIPSIS}/${tail}`
    if (charCount(candidate) <= width) return candidate
  }
  return fit(name, width)
}

export function barParts(percent: number, cells: number, tone: Tone): Part[] {
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * Math.max(0, cells))
  return [
    { text: BAR_FILLED.repeat(filled), tone },
    { text: BAR_EMPTY.repeat(Math.max(0, cells) - filled), tone: 'dim' },
  ]
}

export function formatTokens(tokens: number): string {
  return tokens >= THOUSAND ? `${Number((tokens / THOUSAND).toFixed(1))}k` : String(tokens)
}

export function shortModel(name: string): string {
  return name.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

// The reasoning level the engine sends, in the pane's language; a level it
// does not name (a number on an internal build) is shown as given.
const EFFORT_LABELS: Record<string, string> = {
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
  xhigh: 'extra alto',
  max: 'máximo',
}

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export function countLines(text: string): number {
  if (text.length === 0) return 0
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length
}

export function dimLine(text: string, width: number): Line {
  return { left: [{ text: fit(text, width), tone: 'dim' }] }
}

export function overflowLine(count: number, unit: string, width: number): Line[] {
  return count > 0 ? [dimLine(`+${count} ${unit}`, width)] : []
}

// A left label and a right value on one row; the value keeps at most half.
export function pairLine(left: string, right: string, width: number, rightTone: Tone = 'plain'): Line {
  if (right === '') return { left: [{ text: fit(left, width), tone: 'plain' }] }
  const rightWidth = Math.min(charCount(right), Math.floor(width / 2))
  return {
    left: [{ text: fit(left, width - rightWidth - 1), tone: 'plain' }],
    right: [{ text: fit(right, rightWidth), tone: rightTone }],
  }
}

// The lines as plain text, one string per line at `width` columns.
export function toPlain(lines: Line[], width: number): string[] {
  return lines.map(line => {
    const left = line.left.map(part => part.text).join('')
    const right = (line.right ?? []).map(part => part.text).join('')
    if (right === '') return left
    const gap = Math.max(1, width - charCount(left) - charCount(right))
    return left + ' '.repeat(gap) + right
  })
}
