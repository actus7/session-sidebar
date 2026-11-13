// MCP servers switched off from the sidebar: kept in $.store by the name /mcp
// lists, so the next session holds them back at its start.
export const MCP_OFF_KEY = 'mcpOff'

export function asNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

// The engine's tool-name spelling of a server: `claude.ai Gmail` → `claude_ai_Gmail`.
export function wireName(server: string): string {
  return server.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function isOffServer(off: string[], server: string): boolean {
  const wire = wireName(server)
  return off.some(name => name === server || wireName(name) === wire)
}

// The switched-off server an `mcp__<server>__<tool>` call goes to, if any.
export function offServerOfTool(off: string[], tool: string): string | undefined {
  return off.find(name => tool.startsWith(`mcp__${wireName(name)}__`))
}

export function switchServer(off: string[], server: string, isOff: boolean): string[] {
  const rest = off.filter(name => name !== server)
  return isOff ? [...rest, server] : rest
}
