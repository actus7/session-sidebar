import type { EngineInterface } from 'claude-code'

import type { AgentDef, AgentRow } from '../types'
import { parseFrontmatter } from './frontmatter'

// The ecc plugin ships 67 agent files; the cap sits above that, with room.
const MAX_DEFINITION_FILES = 100
const DEFINITIONS_DIR = '.claude/agents'
const MARKDOWN = '.md'

export type FileEntry = { name: string; kind: string }

// The two file calls a definition read needs, so tests can pass a fake.
export type FileReader = {
  read(path: string): Promise<string>
  list(path: string): Promise<FileEntry[]>
}

export function fileReaderOf($: EngineInterface): FileReader {
  return {
    read: path => $.fs.read(path),
    list: path => $.fs.list(path),
  }
}

// The engine's agents that are running now (or finished recently).
export async function readAgents($: EngineInterface): Promise<AgentRow[] | undefined> {
  try {
    const list = await $.agent.list()
    return list.map(agent => ({
      id: agent.id,
      type: agent.type,
      description: agent.description,
      status: agent.status,
    }))
  } catch (error) {
    $.ui.log(`session-sidebar: agents unavailable: ${String(error)}`)
    return undefined
  }
}

// Definitions in one folder. Only each file's frontmatter is kept; the body is
// never shown.
export async function readDefinitions(reader: FileReader, dir: string): Promise<AgentDef[]> {
  let entries: FileEntry[]
  try {
    entries = await reader.list(dir)
  } catch {
    // A missing folder is the usual case: this scope defines no agents.
    return []
  }
  const files = entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith(MARKDOWN))
    .slice(0, MAX_DEFINITION_FILES)
  const defs = await Promise.all(files.map(entry => readDefinition(reader, `${dir}/${entry.name}`, entry.name)))
  return defs
    .filter((def): def is AgentDef => def !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))
}

async function readDefinition(reader: FileReader, path: string, fileName: string): Promise<AgentDef | undefined> {
  try {
    const fields = parseFrontmatter(await reader.read(path))
    return {
      name: fields.name ?? fileName.slice(0, -MARKDOWN.length),
      model: fields.model ?? null,
      description: fields.description ?? '',
    }
  } catch {
    // Logged by name only is not possible without the engine; the file is skipped.
    return undefined
  }
}

// The user's and the project's definitions. Each folder is read on its own.
export async function readScopedDefinitions(
  reader: FileReader,
  configDir: string | undefined,
  cwd: string,
): Promise<{ user: AgentDef[]; project: AgentDef[] }> {
  const user = configDir ? await readDefinitions(reader, `${configDir}/agents`) : []
  const project = cwd ? await readDefinitions(reader, `${cwd}/${DEFINITIONS_DIR}`) : []
  return { user, project }
}
