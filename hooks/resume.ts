// Auto-resume after a rate-limit stop: when to send, and the stored settings.
import type { Limit } from '../types'

export const RESUME_QUOTA = 2
export const RESUME_TEXT = 'continue'
export const AUTO_RESUME_KEY = 'autoResume'
export const RESUME_QUOTA_KEY = 'resumeQuota'
// A little past the reset, so the first request lands in the new window.
const RESUME_MARGIN_MS = 30_000
const FULL_PERCENT = 100
const PAD_LENGTH = 2

// The latest reset among the full windows; none full (the reading can lag the
// stop), the earliest reset ahead. No reset ahead: nothing to wait for.
export function resumeAt(limits: Limit[], now: number): number | undefined {
  const ahead = limits.flatMap(limit => {
    const at = Date.parse(limit.resetsAt ?? '')
    return Number.isNaN(at) || at <= now ? [] : [{ at, isFull: limit.percentUsed >= FULL_PERCENT }]
  })
  if (ahead.length === 0) return undefined
  const full = ahead.filter(window => window.isFull)
  const at = full.length > 0 ? Math.max(...full.map(w => w.at)) : Math.min(...ahead.map(w => w.at))
  return at + RESUME_MARGIN_MS
}

// A turn that died on an API error while a window is full stopped on the limit.
export function isLimitFull(limits: Limit[]): boolean {
  return limits.some(limit => limit.percentUsed >= FULL_PERCENT)
}

export function asQuota(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : RESUME_QUOTA
}

export function asFlag(value: unknown): boolean {
  return value === true
}

export function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(PAD_LENGTH, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
