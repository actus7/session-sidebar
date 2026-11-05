import type { Tone } from './text'

const WARN_PERCENT = 70
const ERROR_PERCENT = 90
const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const DAY_MS = 24 * 60 * MINUTE_MS
const PAD_LENGTH = 2
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const LIMIT_LABELS: Record<string, string> = {
  five_hour: 'Sessão 5h',
  seven_day: 'Semana',
  spend_limit: 'Gasto',
}

export function limitLabel(kind: string): string {
  return LIMIT_LABELS[kind] ?? kind
}

// Under 70 is normal; 70 to 90 warns; 90 and over is critical.
export function limitTone(percent: number): Tone {
  if (percent >= ERROR_PERCENT) return 'error'
  if (percent >= WARN_PERCENT) return 'warning'
  return 'plain'
}

function twoDigits(value: number): string {
  return String(value).padStart(PAD_LENGTH, '0')
}

// Under a day: a countdown ("reseta em 2h14"). A day or more: the weekday and
// the local time ("reseta seg 09:00").
export function formatReset(resetsAt: string | undefined, now: number): string {
  if (resetsAt === undefined) return ''
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  const remaining = at - now
  if (remaining <= 0) return 'reseta agora'
  if (remaining < DAY_MS) {
    const minutes = Math.round(remaining / MINUTE_MS)
    if (minutes < HOUR_MINUTES) return `reseta em ${minutes}min`
    return `reseta em ${Math.floor(minutes / HOUR_MINUTES)}h${twoDigits(minutes % HOUR_MINUTES)}`
  }
  const date = new Date(at)
  return `reseta ${WEEKDAYS[date.getDay()]} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}
