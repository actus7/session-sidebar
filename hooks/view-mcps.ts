import type { McpServer } from '../types'
import { cap, dimLine, formatTokens, overflowLine, pairLine, type Line } from './text'

const MAX_SERVERS = 8

// Folds the engine's per-tool list into one entry per server, heaviest first.
export function groupMcps(tools: { serverName: string; tokens: number }[]): McpServer[] {
  const byServer = new Map<string, McpServer>()
  for (const tool of tools) {
    const server = byServer.get(tool.serverName) ?? { name: tool.serverName, tools: 0, tokens: 0 }
    byServer.set(tool.serverName, { ...server, tools: server.tools + 1, tokens: server.tokens + tool.tokens })
  }
  return [...byServer.values()].sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name))
}

export function mcpRows(mcps: McpServer[] | null, width: number, isMore = false): Line[] {
  if (mcps === null) return [dimLine('detalhe após o próximo turno', width)]
  if (mcps.length === 0) return [dimLine('nenhum servidor MCP conectado', width)]
  const max = cap(MAX_SERVERS, isMore)
  const rows = mcps
    .slice(0, max)
    .map(server => pairLine(`● ${server.name}`, `${server.tools} tools · ${formatTokens(server.tokens)}`, width))
  return [...rows, ...overflowLine(mcps.length - max, 'servidores', width)]
}
