import type { Limit, Usage } from '../types'
import { formatTokens } from './text'

// The status bar the collapsed sidebar leaves above the prompt: a dark label
// ("contexto") followed by a coloured pill whose text is made of coloured parts.
export type PillPart = { text: string; color: string }
export type Pill = { label: string; background: string; parts: PillPart[] }

// What the session had used when the last prompt was sent: the "(+7,7k)" is the growth since.
export type TurnBase = { tokens: number | null; usd: number | null }

const WARN_PERCENT = 70
const ERROR_PERCENT = 90
const BAR_CELLS = 8
const BAR_CHAR = '━'
const MIN_COST_DELTA = 0.005
const INK = '#0b0f14'
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const RED = '#f87171'
const CYAN = '#22d3ee'
const PURPLE = '#c4b5fd'
// The empty part of the bar: the pill's colour, darker.
const TRACK: Record<string, string> = { [GREEN]: '#1f7a5c', [AMBER]: '#8a6a12', [RED]: '#9c3b3b' }

// Brazilian decimals: 214,3k and 2,04.
const decimal = (value: string): string => value.replace('.', ',')

function level(percent: number): string {
  if (percent >= ERROR_PERCENT) return RED
  if (percent >= WARN_PERCENT) return AMBER
  return GREEN
}

function bar(percent: number, background: string): PillPart[] {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * BAR_CELLS)
  return [
    { text: BAR_CHAR.repeat(filled), color: INK },
    { text: BAR_CHAR.repeat(BAR_CELLS - filled), color: TRACK[background] ?? INK },
  ]
}

function tokenDelta(usage: Usage, base: TurnBase | null): string {
  if (usage.tokens === null || base?.tokens == null) return ''
  const delta = usage.tokens - base.tokens
  return delta > 0 ? ` (+${decimal(formatTokens(delta))})` : ''
}

function contextPill(usage: Usage, base: TurnBase | null): Pill {
  const percent = Math.round(usage.percent ?? 0)
  const background = level(percent)
  const tokens = usage.tokens === null ? '' : ` ${decimal(formatTokens(usage.tokens))}${tokenDelta(usage, base)}`
  return {
    label: 'contexto',
    background,
    parts: [{ text: ` ${percent}% `, color: INK }, ...bar(percent, background), { text: `${tokens} `, color: INK }],
  }
}

function costPill(usage: Usage, base: TurnBase | null): Pill | undefined {
  if (usage.usd === null) return undefined
  const delta = base?.usd == null ? 0 : usage.usd - base.usd
  const added = delta > MIN_COST_DELTA ? ` (+${decimal(delta.toFixed(2))})` : ''
  return {
    label: 'custo',
    background: CYAN,
    parts: [{ text: ` US$ ${decimal(usage.usd.toFixed(2))}${added} `, color: INK }],
  }
}

function limitPill(limits: Limit[]): Pill | undefined {
  const five = limits.find(limit => limit.kind === 'five_hour')
  const week = limits.find(limit => limit.kind === 'seven_day')
  const parts = [
    five === undefined ? undefined : `5h ${Math.round(five.percentUsed)}%`,
    week === undefined ? undefined : `7d ${Math.round(week.percentUsed)}%`,
  ].filter((part): part is string => part !== undefined)
  if (parts.length === 0) return undefined
  const worst = Math.max(five?.percentUsed ?? 0, week?.percentUsed ?? 0)
  const background = worst >= WARN_PERCENT ? level(worst) : PURPLE
  return { label: 'limite', background, parts: [{ text: ` ${parts.join(' · ')} `, color: INK }] }
}

// Context fill, session cost and rate limits; a pill whose figure is unknown is left out.
export function statusPills(usage: Usage | null, limits: Limit[], base: TurnBase | null = null): Pill[] {
  const pills = [
    usage === null ? undefined : contextPill(usage, base),
    usage === null ? undefined : costPill(usage, base),
    limitPill(limits),
  ]
  return pills.filter((pill): pill is Pill => pill !== undefined)
}

// A pill as plain text, for tests and logs.
export const pillText = (pill: Pill): string => `${pill.label} ${pill.parts.map(part => part.text).join('').trim()}`
