import type { AgentDef, AgentDefs, AgentRow, AgentStatus } from '../types'
import { cap, dimLine, fit, overflowLine, pairLine, shortModel, type Line, type Tone } from './text'

const MAX_AGENT_ROWS = 4
const MAX_GROUPS = 4
const MAX_NAMES_PER_GROUP = 2
const DOT = '● '
const SEPARATOR = ' · '
const BADGE: Record<AgentStatus, string> = {
  pending: 'NA FILA',
  running: 'EXECUTANDO',
  waiting: 'AGUARDANDO',
  idle: 'OCIOSO',
  completed: 'CONCLUÍDO',
  failed: 'FALHOU',
  killed: 'PARADO',
}
const BADGE_TONE: Record<AgentStatus, Tone> = {
  pending: 'dim',
  running: 'success',
  waiting: 'warning',
  idle: 'dim',
  completed: 'dim',
  failed: 'error',
  killed: 'dim',
}
const ACTIVE: AgentStatus[] = ['pending', 'running', 'waiting']

export function isActive(status: AgentStatus): boolean {
  return ACTIVE.includes(status)
}

// Two rows per agent: the type in bold with its badge, then what it is doing.
// Finished agents are dimmed, so the running ones stand out.
export function agentRows(agents: AgentRow[], width: number, isMore = false): Line[] {
  if (agents.length === 0) return [dimLine('nenhum agente nesta sessão', width)]
  const max = cap(MAX_AGENT_ROWS, isMore)
  const shown = agents.slice(0, max).flatMap(agent => {
    const tone = BADGE_TONE[agent.status]
    const badge = BADGE[agent.status]
    const nameTone: Tone = isActive(agent.status) ? 'strong' : 'dim'
    const nameWidth = width - DOT.length - badge.length - 1
    const head: Line = {
      left: [
        { text: DOT, tone },
        { text: fit(agent.type, nameWidth), tone: nameTone },
      ],
      right: [{ text: badge, tone }],
    }
    const task = dimLine(`  ${fit(agent.description || '—', width - 2)}`, width)
    return [head, task]
  })
  return [...shown, ...overflowLine(agents.length - max, 'agentes', width)]
}

function groupHeader(label: string, count: number, width: number): Line {
  return pairLine(label, `${count} ${count === 1 ? 'agente' : 'agentes'}`, width, 'dim')
}

function groupNames(defs: AgentDef[], width: number, isMore: boolean): Line[] {
  return defs.slice(0, cap(MAX_NAMES_PER_GROUP, isMore)).map(def => {
    const model = def.model === null ? '' : shortModel(def.model)
    const text = fit(`  ${def.name}${model === '' ? '' : SEPARATOR + model}`, width)
    return dimLine(text, width)
  })
}

// Configured definitions: the user's and the project's, then each plugin that
// is enabled and installed. Long groups show their first names only.
export function definitionRows(defs: AgentDefs, width: number, isMore = false): Line[] {
  const groups = [
    { label: 'usuário', agents: defs.user },
    { label: 'projeto', agents: defs.project },
    ...(defs.plugins ?? []).map(plugin => ({ label: plugin.plugin, agents: plugin.agents })),
  ].filter(group => group.agents.length > 0)
  if (groups.length === 0) return [dimLine('nenhuma definição de agente encontrada', width)]
  const max = cap(MAX_GROUPS, isMore)
  const shown = groups.slice(0, max).flatMap(group => [
    groupHeader(group.label, group.agents.length, width),
    ...groupNames(group.agents, width, isMore),
  ])
  return [...shown, ...overflowLine(groups.length - max, 'grupos', width)]
}
