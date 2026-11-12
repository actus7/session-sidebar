export type FileChange = { path: string; added: number; removed: number }

// A working-tree change: `code` is the git letter (M, A, D, R, ?), or ~ for a
// session's own Edit/Write when the folder is not a git repository.
export type ChangedFile = {
  code: string
  path: string
  added: number | null
  removed: number | null
}

export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type Usage = {
  tokens: number | null
  window: number
  percent: number | null
  usd: number | null
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
export type AgentRow = { id: string; type: string; description: string; status: AgentStatus }

export type AgentDef = { name: string; model: string | null; description: string }
export type PluginAgents = { plugin: string; agents: AgentDef[] }
export type AgentDefs = { user: AgentDef[]; project: AgentDef[]; plugins: PluginAgents[] }

// One context category as the engine breaks the window down (used, free, buffer).
export type Segment = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}
// One MCP server with the tools it exposes and the context their schemas take.
export type McpServer = { name: string; tools: number; tokens: number }
export type Breakdown = {
  mcps: McpServer[]
  segments: Segment[]
  maxTokens: number
  autoCompactThreshold: number | null
}

// Enabled plugins with how many skills each ships, and the user's own skills.
export type PluginInfo = { name: string; skills: number }
export type Extensions = { plugins: PluginInfo[]; userSkills: string[] }

export type CheckKind = 'testes' | 'type-check' | 'lint' | 'build'
export type Check = { kind: CheckKind; status: 'running' | 'passed' | 'failed'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'session-sidebar': {
      cwd: string
      model: string | null
      effort: string | null
      isRunning: boolean
      usage: Usage | null
      limits: Limit[]
      breakdown: Breakdown | null
      branch: string | null
      git: ChangedFile[] | null
      sessionFiles: FileChange[]
      todos: Todo[]
      agents: AgentRow[]
      defs: AgentDefs
      checks: Check[]
      isOpen: boolean
      collapsed: string[]
      expanded: string[]
      turnBase: { tokens: number | null; usd: number | null } | null
      version: string | null
      extensions: Extensions
      autoResume: boolean
      resumeQuota: number
      resumePlan: number | null
      isConfirmingReset: boolean
    }
  }
}
