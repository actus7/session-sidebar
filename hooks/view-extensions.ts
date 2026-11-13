import type { Extensions, PluginInfo } from '../types'
import { relativeAge } from './checks'
import { cap, charCount, dimLine, fit, overflowLine, pairLine, type Line } from './text'
import { byRecentUse, type UsageLog, type UseEntry } from './usage'

const MAX_PLUGIN_ROWS = 8
const MAX_RECENT_SKILLS = 5
const MAX_SKILL_LINES = 3
const SEPARATOR = ', '
const INDENT = '  '

function skillCount(count: number): string {
  if (count === 0) return '—'
  return `${count} ${count === 1 ? 'skill' : 'skills'}`
}

function useLabel(entry: UseEntry, now: number): string {
  return `${entry.count}× · ${relativeAge(entry.last, now)}`
}

export function totalSkills(extensions: Extensions): number {
  const on = extensions.plugins.filter(plugin => !plugin.isOff)
  return on.reduce((sum, plugin) => sum + plugin.skills, 0) + extensions.userSkills.length
}

// The names joined with commas, wrapped at the width, at most `maxLines` lines.
export function wrapNames(names: string[], width: number, maxLines: number): Line[] {
  const groups: string[][] = []
  for (const name of names) {
    const last = groups[groups.length - 1]
    if (last !== undefined && charCount([...last, name].join(SEPARATOR)) <= width) last.push(name)
    else groups.push([name])
  }
  const shown = groups.slice(0, maxLines)
  const hidden = names.length - shown.reduce((sum, group) => sum + group.length, 0)
  return [
    ...shown.map(group => dimLine(fit(group.join(SEPARATOR), width), width)),
    ...overflowLine(hidden, 'skills', width),
  ]
}

function indent(line: Line): Line {
  return { ...line, left: [{ text: INDENT, tone: 'plain' }, ...line.left] }
}

// The sidebar's own plugin has no switch: turning it off would remove the switch.
const SELF = 'session-sidebar'

function pluginRow(plugin: PluginInfo, log: UsageLog, now: number, width: number): Line {
  const entry = log.plugins[plugin.name]
  const line = plugin.isOff
    ? pairLine(`○ ${plugin.name}`, 'desligado', width, 'warning')
    : entry === undefined
      ? pairLine(plugin.name, skillCount(plugin.skills), width, 'dim')
      : pairLine(plugin.name, useLabel(entry, now), width, 'accent')
  return plugin.name === SELF || plugin.key === undefined ? line : { ...line, press: `plugin:${plugin.name}` }
}

// Pressed, a plugin opens [Ligar] / [Desligar]; either applies from the next session.
function pluginAction(plugin: PluginInfo): Line {
  const label = plugin.isOff ? { text: '  [Ligar]', tone: 'success' as const } : { text: '  [Desligar]', tone: 'error' as const }
  return {
    left: [label],
    right: [{ text: 'vale na próxima sessão', tone: 'dim' }],
    press: `plugin-${plugin.isOff ? 'on' : 'off'}:${plugin.name}`,
  }
}

// Enabled plugins, most recently used first (a used one shows how often and
// when, the rest their skill count), then the disabled ones by name.
function pluginRows(
  extensions: Extensions,
  log: UsageLog,
  now: number,
  width: number,
  isMore: boolean,
  selected: string | null,
): Line[] {
  const on = extensions.plugins.filter(plugin => !plugin.isOff)
  const off = extensions.plugins.filter(plugin => plugin.isOff)
  if (extensions.plugins.length === 0) return [dimLine('nenhum plugin ativo', width)]
  const sorted = [...byRecentUse(on, plugin => plugin.name, log.plugins), ...off]
  const max = cap(MAX_PLUGIN_ROWS, isMore)
  return [
    ...sorted.slice(0, max).flatMap(plugin => {
      const row = pluginRow(plugin, log, now, width)
      return selected === row.press ? [row, pluginAction(plugin)] : [row]
    }),
    ...overflowLine(sorted.length - max, 'plugins', width),
  ]
}

// The skills used most recently, from any plugin or the user's own.
function recentSkillRows(log: UsageLog, now: number, width: number, isMore: boolean): Line[] {
  const names = byRecentUse(Object.keys(log.skills), name => name, log.skills).slice(
    0,
    cap(MAX_RECENT_SKILLS, isMore),
  )
  if (names.length === 0) return [indent(dimLine('nenhuma skill usada ainda', width - INDENT.length))]
  return names.map(name =>
    indent(pairLine(name, useLabel(log.skills[name] as UseEntry, now), width - INDENT.length, 'accent')),
  )
}

export function extensionRows(
  extensions: Extensions,
  log: UsageLog,
  now: number,
  width: number,
  isMore = false,
  selected: string | null = null,
): Line[] {
  const userSkills = byRecentUse(extensions.userSkills, name => name, log.skills)
  const userLines =
    userSkills.length === 0 ? [] : wrapNames(userSkills, width - INDENT.length, cap(MAX_SKILL_LINES, isMore))
  return [
    ...pluginRows(extensions, log, now, width, isMore, selected),
    pairLine('usadas por último', '', width),
    ...recentSkillRows(log, now, width, isMore),
    pairLine('suas skills', skillCount(userSkills.length), width, 'dim'),
    ...userLines.map(indent),
  ]
}
