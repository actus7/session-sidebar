import type { EngineInterface } from 'claude-code'

import type { Breakdown, Limit, Usage } from '../types'
import { GIT_TIMEOUT_MS } from './git'
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

export type StatusRead = {
  usage?: Usage | null
  limits?: Limit[]
  branch?: string | null
  model?: string | null
}

// Each figure is set only when its read worked, so a failed read keeps the
// last good value on screen. A missing figure is a log line, never a crash.
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

async function readUsage($: EngineInterface): Promise<Pick<StatusRead, 'usage' | 'limits'> | undefined> {
  try {
    const { context, cost, rateLimits } = await $.session.usage()
    return { usage: toUsage(context, cost), limits: rateLimits }
  } catch (error) {
    $.ui.log(`session-sidebar: usage unavailable: ${String(error)}`)
    return undefined
  }
}

async function readBranch($: EngineInterface): Promise<string | null | undefined> {
  try {
    const result = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS })
    return result.exitCode === 0 ? result.stdout.trim() : null
  } catch (error) {
    $.ui.log(`session-sidebar: git branch unavailable: ${String(error)}`)
    return undefined
  }
}

async function readModel($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.model()
  } catch (error) {
    $.ui.log(`session-sidebar: model unavailable: ${String(error)}`)
    return undefined
  }
}

export async function readStatus($: EngineInterface): Promise<StatusRead> {
  const usage = await readUsage($)
  const branch = await readBranch($)
  const model = await readModel($)
  return { ...usage, branch, model }
}
