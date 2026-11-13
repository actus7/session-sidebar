import type {
  AgentDefs,
  AgentRow,
  Breakdown,
  Check,
  ChangedFile,
  Extensions,
  FileChange,
  Limit,
  Todo,
  Usage,
} from '../types'
import { cardInnerWidth, type Card } from './cards'
import { checkRows } from './checks'
import { formatReset, limitLabel, limitTone } from './limits'
import {
  barParts,
  baseName,
  cap,
  charCount,
  dimLine,
  effortLabel,
  fit,
  formatTokens,
  NO_VALUE,
  padEnd,
  padStart,
  shortModel,
  toggleLine,
  type Line,
} from './text'
import { contextBar, contextDetailRows } from './view-context'
import { fileRows } from './view-files'
import { agentRows, definitionRows, isActive } from './view-agents'
import { extensionRows, totalSkills } from './view-extensions'
import { mcpList, mcpRows } from './view-mcps'
import type { UsageLog } from './usage'

export type PaneData = {
  cwd: string
  model: string | null
  effort: string | null
  branch: string | null
  isRunning: boolean
  usage: Usage | null
  limits: Limit[]
  breakdown: Breakdown | null
  git: ChangedFile[] | null
  sessionFiles: FileChange[]
  todos: Todo[]
  agents: AgentRow[]
  defs: AgentDefs
  checks: Check[]
  version: string | null
  extensions: Extensions
  usageLog: UsageLog
  collapsed: string[]
  expanded: string[]
  mcpOff: string[]
  selectedRow: string | null
  now: number
  width: number
}

export const MIN_WIDTH = 34
const LABEL_WIDTH = 9
const PCT_WIDTH = 4
const MIN_BAR_CELLS = 6
const MINI_BAR_CELLS = 12
const MAX_TODO_ROWS = 6
const NO_LIMITS = 'sem limites: uso por API, sem assinatura'
const TODO_MARK: Record<Todo['status'], string> = { pending: '○', in_progress: '▸', completed: '✔' }
const TODO_TONE: Record<Todo['status'], 'plain' | 'accent' | 'dim'> = {
  pending: 'plain',
  in_progress: 'accent',
  completed: 'dim',
}

// A card's title row: dim caps on the left, an optional value on the right.
function titleRow(title: string, right: string, width: number, rightTone: 'accent' | 'dim' = 'dim'): Line {
  const room = right === '' ? width : width - right.length - 1
  return {
    left: [{ text: fit(title, room), tone: 'title' }],
    right: right === '' ? undefined : [{ text: right, tone: rightTone }],
  }
}

// The mod's version, centred: tells at a glance which copy is loaded.
function versionRow(version: string | null, width: number): Line {
  const text = fit(version === null ? 'session-sidebar' : `session-sidebar v${version}`, width)
  const pad = Math.floor((width - charCount(text)) / 2)
  return { left: [{ text: `${' '.repeat(pad)}${text}`, tone: 'dim' }] }
}

function headerRows(data: PaneData, width: number): Line[] {
  const model = data.model === null ? 'modelo indisponível' : `● ${shortModel(data.model)}`
  const status = data.isRunning ? 'ativo' : 'ocioso'
  const folder = baseName(data.cwd) || 'projeto'
  // The model keeps its room first; the reasoning level fits what is left.
  const room = width - status.length - 1
  const modelText = fit(model, room)
  const effort = data.effort === null || data.model === null ? '' : ` · ${effortLabel(data.effort)}`
  const effortText = fit(effort, room - charCount(modelText))
  return [
    versionRow(data.version, width),
    {
      left: [
        { text: modelText, tone: 'accent' },
        ...(effortText === '' ? [] : [{ text: effortText, tone: 'strong' as const }]),
      ],
      right: [{ text: status, tone: data.isRunning ? 'success' : 'dim' }],
    },
    dimLine(fit(`${folder} · ⎇ ${data.branch ?? 'sem git'}`, width), width),
  ]
}

function limitRows(limits: Limit[], now: number, width: number): Line[] {
  if (limits.length === 0) return [dimLine(NO_LIMITS, width)]
  const barCells = Math.max(width - LABEL_WIDTH - 1 - PCT_WIDTH - 1, MIN_BAR_CELLS)
  return limits.flatMap(limit => {
    const percent = Math.round(limit.percentUsed)
    const tone = limitTone(percent)
    const head: Line = {
      left: [
        { text: padEnd(limitLabel(limit.kind), LABEL_WIDTH), tone: 'plain' },
        { text: ' ', tone: 'plain' },
        ...barParts(percent, barCells, tone),
      ],
      right: [{ text: padStart(`${percent}%`, PCT_WIDTH), tone }],
    }
    const reset = formatReset(limit.resetsAt, now)
    return reset === '' ? [head] : [head, dimLine(`${' '.repeat(LABEL_WIDTH + 1)}${reset}`, width)]
  })
}

function taskRows(todos: Todo[], width: number, isMore: boolean): Line[] {
  if (todos.length === 0) return [dimLine('nenhuma tarefa', width)]
  const done = todos.filter(todo => todo.status === 'completed').length
  const percent = (done / todos.length) * 100
  const bar: Line = { left: barParts(percent, MINI_BAR_CELLS, 'success') }
  const max = cap(MAX_TODO_ROWS, isMore)
  const rows = todos.slice(0, max).map(todo => ({
    left: [{ text: fit(`${TODO_MARK[todo.status]} ${todo.content}`, width), tone: TODO_TONE[todo.status] }],
  }))
  const hidden = todos.length - max
  return [bar, ...rows, ...(hidden > 0 ? [dimLine(`+${hidden} tarefas`, width)] : [])]
}

// The context fill as one more row of the limits, drawn like a limit's own;
// "Ver mais" adds the breakdown (bar, categories, auto-compact) under it.
function contextRowsInLimits(data: PaneData, width: number, isMore: boolean): Line[] {
  if (data.usage === null) return [dimLine('contexto indisponível agora', width)]
  const percent = Math.round(data.usage.percent ?? 0)
  const tone = limitTone(percent)
  const barCells = Math.max(width - LABEL_WIDTH - 1 - PCT_WIDTH - 1, MIN_BAR_CELLS)
  // The one bar: each category in its own colour once the breakdown is known.
  const bar = data.breakdown === null ? barParts(percent, barCells, tone) : contextBar(data.breakdown, barCells)
  const head: Line = {
    left: [{ text: padEnd('Contexto', LABEL_WIDTH), tone: 'plain' }, { text: ' ', tone: 'plain' }, ...bar],
    right: [{ text: padStart(`${percent}%`, PCT_WIDTH), tone }],
  }
  const tokens = data.usage.tokens === null ? NO_VALUE : formatTokens(data.usage.tokens)
  const summary = dimLine(`${' '.repeat(LABEL_WIDTH + 1)}${tokens} / ${formatTokens(data.usage.window)}`, width)
  const details = isMore && data.breakdown !== null ? contextDetailRows(data.breakdown, width) : []
  return [head, summary, ...details]
}

function limitsCard(data: PaneData, width: number, isMore: boolean): Card {
  return {
    rows: [
      titleRow('LIMITES', '', width),
      ...limitRows(data.limits, data.now, width),
      ...contextRowsInLimits(data, width, isMore),
    ],
  }
}

function extensionsCard(data: PaneData, width: number, isMore: boolean): Card {
  const skills = `${totalSkills(data.extensions)} skills`
  const full = `${data.extensions.plugins.filter(plugin => !plugin.isOff).length} plugins · ${skills}`
  // Title, its ▾ mark and a gap come first; the plugin count goes when it would cut the title.
  const count = charCount('▾ PLUGINS E SKILLS') + 1 + charCount(full) <= width ? full : skills
  return {
    rows: [
      titleRow('PLUGINS E SKILLS', count, width),
      ...extensionRows(data.extensions, data.usageLog, data.now, width, isMore, data.selectedRow),
    ],
  }
}

function agentsCard(data: PaneData, width: number, isMore: boolean): Card {
  const active = data.agents.filter(agent => isActive(agent.status)).length
  const badge = active > 0 ? `${active} ${active === 1 ? 'ativo' : 'ativos'}` : ''
  return {
    rows: [
      titleRow('AGENTES', badge, width, 'accent'),
      ...agentRows(data.agents, width, isMore),
      titleRow('CONFIGURADOS', '', width),
      ...definitionRows(data.defs, width, isMore),
    ],
  }
}

function tasksCard(data: PaneData, width: number, isMore: boolean): Card {
  const done = data.todos.filter(todo => todo.status === 'completed').length
  const count = data.todos.length === 0 ? '' : `${done}/${data.todos.length}`
  return { rows: [titleRow('TAREFAS', count, width), ...taskRows(data.todos, width, isMore)] }
}

function checksCard(data: PaneData, width: number): Card {
  return { rows: [titleRow('VERIFICAÇÕES', '', width), ...checkRows(data.checks, data.now, width)] }
}

function filesCard(data: PaneData, width: number, isMore: boolean): Card {
  return { rows: [titleRow('ARQUIVOS', '', width), ...fileRows(data.git, data.sessionFiles, width, isMore)] }
}

function mcpsCard(data: PaneData, width: number, isMore: boolean): Card {
  const mcps = data.breakdown?.mcps ?? null
  const list = mcpList(mcps, data.mcpOff) ?? []
  const count = list.length === 0 ? '' : `${list.length} ${list.length === 1 ? 'servidor' : 'servidores'}`
  return { rows: [titleRow('MCPs', count, width), ...mcpRows(mcps, width, isMore, data.mcpOff, data.selectedRow)] }
}

// A card whose full list is longer than its short one ends with "Ver mais" (short
// list) or "Ver menos" (full list); one that fits whole has no button.
function withMore(build: (isMore: boolean) => Card, isMore: boolean): Card {
  const short = build(false)
  const full = build(true)
  // Compared by content, not length: one hidden item is swapped for a "+1" line, so both have as many rows.
  if (JSON.stringify(full.rows) === JSON.stringify(short.rows)) return short
  return isMore
    ? { rows: [...full.rows, toggleLine('less')] }
    : { rows: [...short.rows, toggleLine('more')] }
}

const EXPANDED_MARK = '▾'
const COLLAPSED_MARK = '▸'

// Marks the title row with its state; a collapsed card keeps only that row.
function toggleable(id: string, card: Card, isCollapsed: boolean, width: number): Card {
  const [title, ...body] = card.rows
  const first = title?.left[0]
  if (title === undefined || first === undefined) return card
  const rightWidth = (title.right ?? []).reduce((sum, part) => sum + charCount(part.text), 0)
  const room = rightWidth === 0 ? width : width - rightWidth - 1
  const text = fit(`${isCollapsed ? COLLAPSED_MARK : EXPANDED_MARK} ${first.text}`, room)
  const marked: Line = { ...title, left: [{ ...first, text }] }
  return { id, rows: isCollapsed ? [marked] : [marked, ...body] }
}

// The pane's cards in their fixed order. Each card's rows fit its inner width;
// every card but the header expands and collapses from its title row.
export function buildCards(data: PaneData): Card[] {
  const width = cardInnerWidth(Math.max(data.width, MIN_WIDTH))
  const sections: [string, (isMore: boolean) => Card][] = [
    ['limits', isMore => limitsCard(data, width, isMore)],
    ['mcps', isMore => mcpsCard(data, width, isMore)],
    ['extensions', isMore => extensionsCard(data, width, isMore)],
    ['agents', isMore => agentsCard(data, width, isMore)],
    ['tasks', isMore => tasksCard(data, width, isMore)],
    ['checks', () => checksCard(data, width)],
    ['files', isMore => filesCard(data, width, isMore)],
  ]
  return [
    { rows: headerRows(data, width) },
    ...sections.map(([id, build]) =>
      toggleable(id, withMore(build, data.expanded.includes(id)), data.collapsed.includes(id), width),
    ),
  ]
}
