// What this mod counts as using a plugin or a skill, and the log it keeps of it
// across sessions in $.store. Only names, counts and times are kept.
export type UseEntry = { count: number; last: number }
export type UsageLog = { plugins: Record<string, UseEntry>; skills: Record<string, UseEntry> }
export type Use = { plugin?: string; skill?: string }

export const USAGE_KEY = 'usage'
export const EMPTY_LOG: UsageLog = { plugins: {}, skills: {} }
const MCP_PLUGIN = /^mcp__plugin_([^_]+)_/
const SLASH_COMMAND = /^\/([\w.:-]+)/

function pluginPrefix(name: string): string | undefined {
  const index = name.indexOf(':')
  return index > 0 ? name.slice(0, index) : undefined
}

// A tool call that uses a plugin: its skill, its subagent type, or its MCP tool.
export function useOfToolCall(tool: string, input: Record<string, unknown>): Use | undefined {
  if (tool === 'Skill' && typeof input.skill === 'string') {
    return { skill: input.skill, plugin: pluginPrefix(input.skill) }
  }
  if (tool === 'Agent' && typeof input.subagent_type === 'string') {
    const plugin = pluginPrefix(input.subagent_type)
    return plugin === undefined ? undefined : { plugin }
  }
  const mcp = MCP_PLUGIN.exec(tool)
  return mcp?.[1] === undefined ? undefined : { plugin: mcp[1] }
}

// A prompt that starts with a slash command naming a known skill uses it.
export function useOfPrompt(text: string, isKnownSkill: (name: string) => boolean): Use | undefined {
  const name = SLASH_COMMAND.exec(text.trim())?.[1]
  if (name === undefined || !isKnownSkill(name)) return undefined
  return { skill: name, plugin: pluginPrefix(name) }
}

function bump(entries: Record<string, UseEntry>, name: string | undefined, now: number): Record<string, UseEntry> {
  if (name === undefined) return entries
  return { ...entries, [name]: { count: (entries[name]?.count ?? 0) + 1, last: now } }
}

export function recordUse(log: UsageLog, use: Use, now: number): UsageLog {
  return { plugins: bump(log.plugins, use.plugin, now), skills: bump(log.skills, use.skill, now) }
}

// A stored value from an older version, or none, reads as an empty log.
export function asUsageLog(value: unknown): UsageLog {
  const log = value as Partial<UsageLog> | undefined
  return { plugins: log?.plugins ?? {}, skills: log?.skills ?? {} }
}

// Most recently used first, then most used, then by name; unused last.
export function byRecentUse<T>(items: T[], nameOf: (item: T) => string, entries: Record<string, UseEntry>): T[] {
  return [...items].sort((left, right) => {
    const a = entries[nameOf(left)]
    const b = entries[nameOf(right)]
    return (
      (b?.last ?? 0) - (a?.last ?? 0) ||
      (b?.count ?? 0) - (a?.count ?? 0) ||
      nameOf(left).localeCompare(nameOf(right))
    )
  })
}
