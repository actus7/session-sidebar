import type { EngineInterface } from 'claude-code'

import type { Breakdown, Limit, Usage } from '../types'
import { groupMcps } from './view-mcps'

// The category breakdown is the costly read (a summary estimate), so it runs
// once per turn, not on every measurement. Undefined means the read failed.
export async function readBreakdown($: EngineInterface): Promise<Breakdown | null | undefined> {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const breakdown = context.breakdown
    if (breakdown === undefined) return null
    return {
      mcps: groupMcps(breakdown.mcpTools),
      segments: breakdown.categories.map(category => ({
        name: category.name,
        tokens: category.tokens,
        color: category.color,
        kind: category.kind,
      })),
      maxTokens: breakdown.maxTokens,
      autoCompactThreshold: breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
    }
  } catch (error) {
    $.ui.log(`session-sidebar: context breakdown unavailable: ${String(error)}`)
    return undefined
  }
}

// Each read answers undefined when it failed, so the caller keeps the last
// good value on screen. A missing figure is a log line, never a crash.
export function toUsage(
  context: { tokens?: number; window: number; percent?: number },
  cost?: { usd: number },
): Usage {
  return {
    tokens: context.tokens ?? null,
    window: context.window,
    percent: context.percent ?? null,
    usd: cost?.usd ?? null,
  }
}

export async function readUsage($: EngineInterface): Promise<{ usage: Usage; limits: Limit[] } | undefined> {
  try {
    const { context, cost, rateLimits } = await $.session.usage()
    return { usage: toUsage(context, cost), limits: rateLimits }
  } catch (error) {
    $.ui.log(`session-sidebar: usage unavailable: ${String(error)}`)
    return undefined
  }
}

export async function readModel($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.model()
  } catch (error) {
    $.ui.log(`session-sidebar: model unavailable: ${String(error)}`)
    return undefined
  }
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_ROW = /effort/i

export function asEffort(value: unknown): string | undefined {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value) ? value : undefined
}

// The level the session is set to, before its first request says what is sent:
// the /config row when the engine lists one, else CLAUDE_EFFORT. Undefined
// when neither names a level.
export async function readConfiguredEffort($: EngineInterface): Promise<string | undefined> {
  try {
    const row = (await $.config.list()).find(item => EFFORT_ROW.test(item.key))
    const fromConfig = asEffort(row?.value)
    if (fromConfig !== undefined) return fromConfig
    return asEffort(await $.env.get('CLAUDE_EFFORT'))
  } catch (error) {
    $.ui.log(`session-sidebar: effort setting unavailable: ${String(error)}`)
    return undefined
  }
}
