import type { Check, CheckKind } from '../types'
import { dimLine, fit, pairLine, type Line, type Tone } from './text'

const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_HOURS = 24
const MAX_CHECKS = 4
const JUST_NOW_MS = 60_000
const LABEL: Record<CheckKind, string> = { testes: 'testes', 'type-check': 'type-check', lint: 'lint', build: 'build' }
const ORDER: CheckKind[] = ['testes', 'type-check', 'lint', 'build']

// The first matching rule wins: type-check before build, since a build script
// often runs tsc. Commands with a -F filter (pnpm -F pkg test) still match.
const RULES: { kind: CheckKind; pattern: RegExp }[] = [
  { kind: 'type-check', pattern: /(^|[\s;&|(])(tsc|vue-tsc)(\s|$)|type-?check|\btypecheck\b|\bmypy\b|\bpyright\b/i },
  { kind: 'lint', pattern: /\beslint\b|\blint\b|\bruff\b|\bbiome\b/i },
  {
    kind: 'testes',
    pattern: /\bvitest\b|\bjest\b|\bpytest\b|\bmocha\b|playwright test|cargo test|go test|\b(pnpm|npm|yarn|bun)\b[^|;&]*\s(run\s+)?test(\s|$)/i,
  },
  {
    kind: 'build',
    pattern: /\b(pnpm|npm|yarn|bun)\b[^|;&]*\s(run\s+)?build(\s|$)|vite build|cargo build|go build|(^|\s)make(\s|$)/i,
  },
]

export function classifyCommand(command: string): CheckKind | undefined {
  return RULES.find(rule => rule.pattern.test(command))?.kind
}

// The latest state per kind: a rerun replaces the earlier result for that kind.
export function applyCheck(checks: Check[], next: Check): Check[] {
  const others = checks.filter(check => check.kind !== next.kind)
  return [next, ...others].slice(0, MAX_CHECKS)
}

export function relativeAge(at: number, now: number): string {
  const elapsed = Math.max(now - at, 0)
  if (elapsed < JUST_NOW_MS) return 'agora'
  const minutes = Math.floor(elapsed / MINUTE_MS)
  if (minutes < HOUR_MINUTES) return `${minutes}m`
  const hours = Math.floor(minutes / HOUR_MINUTES)
  if (hours < DAY_HOURS) return `${hours}h`
  return `${Math.floor(hours / DAY_HOURS)}d`
}

const STATE: Record<Check['status'], { mark: string; word: string; tone: Tone }> = {
  passed: { mark: '✓', word: 'passou', tone: 'success' },
  failed: { mark: '✗', word: 'falhou', tone: 'error' },
  running: { mark: '⟳', word: 'rodando', tone: 'accent' },
}

// One row per kind that ran, in a fixed order; a dim line when none did.
export function checkRows(checks: Check[], now: number, width: number): Line[] {
  if (checks.length === 0) return [dimLine('nenhuma verificação nesta sessão', width)]
  return ORDER.flatMap(kind => {
    const check = checks.find(item => item.kind === kind)
    if (check === undefined) return []
    const state = STATE[check.status]
    const right = check.status === 'running' ? state.word : `${state.word} ${relativeAge(check.at, now)}`
    const label = fit(`${state.mark} ${LABEL[kind]}`, width - right.length - 1)
    return [pairLine(label, right, width, state.tone)]
  })
}
