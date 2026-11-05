import type { Breakdown, Segment } from '../types'
import { dimLine, formatTokens, padStart, type Line, type Part } from './text'

const PERCENT_WIDTH = 4
const TOKEN_WIDTH = 6
const SEGMENT_CHAR = '█'
const BUFFER_CHAR = '▒'
const FREE_CHAR = '░'
const SQUARE = '■ '
const KIND_RANK: Record<Segment['kind'], number> = { used: 0, deferred: 1, buffer: 2, free: 3 }

// Splits `cells` across `values` in proportion, largest remainder first, so the
// parts always add up to exactly `cells` (no gap, no overflow).
export function segmentCells(values: number[], cells: number): number[] {
  const sum = values.reduce((total, value) => total + value, 0)
  if (sum <= 0 || cells <= 0) return values.map(() => 0)
  const exact = values.map(value => (value / sum) * cells)
  const whole = exact.map(Math.floor)
  let leftover = cells - whole.reduce((total, value) => total + value, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((left, right) => right.rest - left.rest)
  for (const { index } of byRemainder) {
    if (leftover <= 0) break
    whole[index] = (whole[index] ?? 0) + 1
    leftover -= 1
  }
  return whole
}

export function orderSegments(segments: Segment[]): Segment[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .sort((left, right) => KIND_RANK[left.segment.kind] - KIND_RANK[right.segment.kind] || left.index - right.index)
    .map(item => item.segment)
}

function charFor(kind: Segment['kind']): string {
  if (kind === 'free') return FREE_CHAR
  if (kind === 'buffer') return BUFFER_CHAR
  return SEGMENT_CHAR
}

// Our own palette, not the engine's theme keys (most of which are the same grey):
// one hue per category, muted for the deferred ones, greys only for buffer and free.
const PALETTE: Record<string, string> = {
  'system prompt': '#60a5fa',
  'system tools': '#22d3ee',
  'mcp tools': '#f472b6',
  'mcp server instructions': '#a3e635',
  'custom agents': '#c084fc',
  'memory files': '#fb923c',
  skills: '#facc15',
  messages: '#34d399',
  'mcp tools (deferred)': '#a35c86',
  'system tools (deferred)': '#3a8fa0',
}
const FALLBACK = ['#60a5fa', '#22d3ee', '#f472b6', '#a3e635', '#c084fc', '#fb923c', '#facc15', '#34d399']
const BUFFER_COLOR = '#6b7280'
const FREE_COLOR = '#3f4652'

function colorOf(segment: Segment, index: number): string {
  if (segment.kind === 'free') return FREE_COLOR
  if (segment.kind === 'buffer') return BUFFER_COLOR
  return PALETTE[segment.name.toLowerCase()] ?? FALLBACK[index % FALLBACK.length] ?? BUFFER_COLOR
}

function barParts(segments: Segment[], cells: number[]): Part[] {
  return segments.flatMap((segment, index) => {
    const count = cells[index] ?? 0
    if (count === 0) return []
    return [{ text: charFor(segment.kind).repeat(count), tone: 'plain', color: colorOf(segment, index) }]
  })
}

// The whole breakdown as one segmented bar of `cells` columns.
export function contextBar(breakdown: Breakdown, cells: number): Part[] {
  const segments = orderSegments(breakdown.segments)
  return barParts(
    segments,
    segmentCells(
      segments.map(segment => segment.tokens),
      cells,
    ),
  )
}

// The legend of every category, then the auto-compact threshold.
export function contextDetailRows(breakdown: Breakdown, width: number): Line[] {
  const segments = orderSegments(breakdown.segments)
  return [...segments.map((segment, index) => legendLine(segment, breakdown.maxTokens, width, index)), autoCompactLine(breakdown, width)]
}

function legendLine(segment: Segment, maxTokens: number, width: number, index: number): Line {
  const percent = maxTokens > 0 ? Math.round((segment.tokens / maxTokens) * 100) : 0
  const isMuted = segment.kind !== 'used'
  const right = `${padStart(formatTokens(segment.tokens), TOKEN_WIDTH)} ${padStart(`${percent}%`, PERCENT_WIDTH)}`
  const nameWidth = width - SQUARE.length - right.length - 1
  const name = segment.name.length > nameWidth ? `${segment.name.slice(0, Math.max(nameWidth - 1, 1))}…` : segment.name
  return {
    left: [
      { text: SQUARE, tone: 'plain', color: colorOf(segment, index) },
      { text: name, tone: isMuted ? 'dim' : 'plain' },
    ],
    right: [{ text: right, tone: isMuted ? 'dim' : 'plain' }],
  }
}

function autoCompactLine(breakdown: Breakdown, width: number): Line {
  const threshold = breakdown.autoCompactThreshold
  const text = threshold === null ? 'auto-compact desligado' : `auto-compact em ${formatTokens(threshold)}`
  return dimLine(text, width)
}
