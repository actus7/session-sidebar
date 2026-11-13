import type { McpServer } from '../types'
import { isOffServer } from './mcp-switch'
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

// The connected servers, then the switched-off ones the session held back.
export function mcpList(mcps: McpServer[] | null, off: string[]): McpServer[] | null {
  const held = off.filter(name => !(mcps ?? []).some(server => isOffServer([name], server.name)))
  if (mcps === null && held.length === 0) return null
  return [...(mcps ?? []), ...held.map(name => ({ name, tools: 0, tokens: 0 }))]
}

// Each server is a button: pressed, a [Ligar] / [Desligar] row opens under it.
export function mcpRows(
  mcps: McpServer[] | null,
  width: number,
  isMore = false,
  off: string[] = [],
  selected: string | null = null,
): Line[] {
  const list = mcpList(mcps, off)
  if (list === null) return [dimLine('detalhe após o próximo turno', width)]
  if (list.length === 0) return [dimLine('nenhum servidor MCP conectado', width)]
  const max = cap(MAX_SERVERS, isMore)
  const rows = list.slice(0, max).flatMap(server => {
    const isOff = isOffServer(off, server.name)
    const row = isOff
      ? { ...pairLine(`○ ${server.name}`, 'desligado', width, 'warning'), press: `mcp:${server.name}` }
      : { ...pairLine(`● ${server.name}`, `${server.tools} tools · ${formatTokens(server.tokens)}`, width), press: `mcp:${server.name}` }
    if (selected !== `mcp:${server.name}`) return [row]
    const action: Line = isOff
      ? { left: [{ text: '  [Ligar]', tone: 'success' }], press: `mcp-on:${server.name}` }
      : { left: [{ text: '  [Desligar]', tone: 'error' }], right: [{ text: 'some na próxima sessão', tone: 'dim' }], press: `mcp-off:${server.name}` }
    return [row, action]
  })
  return [...rows, ...overflowLine(list.length - max, 'servidores', width)]
}
