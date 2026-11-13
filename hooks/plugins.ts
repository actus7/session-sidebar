// Agents shipped by installed and enabled plugins. The installed list and the
// enabled flags are read from the user's own files; only their keys and install
// paths are used, and each agent file is read for its frontmatter alone.
import type { Extensions, PluginAgents } from '../types'
import { readDefinitions, type FileReader } from './agents'

const INSTALLED_FILE = '/plugins/installed_plugins.json'
const SETTINGS_FILE = '/settings.json'
const AGENTS_DIR = 'agents'
const SKILLS_DIR = 'skills'
const USER_SKILLS_DIR = '/skills'
const MAX_PLUGINS = 40

type InstalledEntry = { installPath?: unknown }

// installed_plugins.json: { plugins: { "name@market": [{ installPath }] } }.
// Returns each plugin key with its first install path.
export function parseInstalled(text: string): Map<string, string> {
  const installs = new Map<string, string>()
  const parsed: unknown = JSON.parse(text)
  const plugins = (parsed as { plugins?: Record<string, InstalledEntry[]> }).plugins ?? {}
  for (const [key, entries] of Object.entries(plugins)) {
    const path = entries.find(entry => typeof entry.installPath === 'string')?.installPath
    if (typeof path === 'string') installs.set(key, path)
  }
  return installs
}

// settings.json: only the enabledPlugins map is read; its values are booleans.
export function parseEnabled(text: string): Set<string> {
  const parsed: unknown = JSON.parse(text)
  const enabled = (parsed as { enabledPlugins?: Record<string, unknown> }).enabledPlugins ?? {}
  return new Set(Object.keys(enabled).filter(key => enabled[key] === true))
}

// The installed plugins the settings turn off (`false`): listed so they can be turned back on.
export function parseDisabled(text: string): Set<string> {
  const parsed: unknown = JSON.parse(text)
  const enabled = (parsed as { enabledPlugins?: Record<string, unknown> }).enabledPlugins ?? {}
  return new Set(Object.keys(enabled).filter(key => enabled[key] === false))
}

function pluginName(key: string): string {
  return key.split('@')[0] ?? key
}

async function readOrEmpty(reader: FileReader, path: string): Promise<string | undefined> {
  try {
    return await reader.read(path)
  } catch {
    // A missing file means nothing is installed or enabled: not an error here.
    return undefined
  }
}

// Installed and enabled plugins that ship agents, sorted by plugin name.
export async function readPluginAgents(reader: FileReader, configDir: string): Promise<PluginAgents[]> {
  const installedText = await readOrEmpty(reader, `${configDir}${INSTALLED_FILE}`)
  const settingsText = await readOrEmpty(reader, `${configDir}${SETTINGS_FILE}`)
  if (installedText === undefined || settingsText === undefined) return []

  const installed = parseInstalled(installedText)
  const enabled = parseEnabled(settingsText)
  const keys = [...enabled].filter(key => installed.has(key)).slice(0, MAX_PLUGINS)
  const groups = await Promise.all(
    keys.map(async key => ({
      plugin: pluginName(key),
      agents: await readDefinitions(reader, `${installed.get(key) ?? ''}/${AGENTS_DIR}`),
    })),
  )
  return groups
    .filter(group => group.agents.length > 0)
    .sort((left, right) => left.plugin.localeCompare(right.plugin))
}

// Skill folders in one directory; hidden ones (.trash) are not skills.
async function skillNames(reader: FileReader, dir: string): Promise<string[]> {
  try {
    const entries = await reader.list(dir)
    return entries
      .filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    // No skills folder: the plugin ships none.
    return []
  }
}

// Installed and enabled plugins with their skill counts, and the user's skills.
export async function readExtensions(reader: FileReader, configDir: string): Promise<Extensions> {
  const userSkills = await skillNames(reader, `${configDir}${USER_SKILLS_DIR}`)
  const installedText = await readOrEmpty(reader, `${configDir}${INSTALLED_FILE}`)
  const settingsText = await readOrEmpty(reader, `${configDir}${SETTINGS_FILE}`)
  if (installedText === undefined || settingsText === undefined) return { plugins: [], userSkills }

  const installed = parseInstalled(installedText)
  const keys = [...parseEnabled(settingsText)].filter(key => installed.has(key)).slice(0, MAX_PLUGINS)
  const plugins = await Promise.all(
    keys.map(async key => ({
      name: pluginName(key),
      key,
      skills: (await skillNames(reader, `${installed.get(key) ?? ''}/${SKILLS_DIR}`)).length,
    })),
  )
  const off = [...parseDisabled(settingsText)]
    .filter(key => installed.has(key))
    .slice(0, MAX_PLUGINS)
    .map(key => ({ name: pluginName(key), key, skills: 0, isOff: true }))
  const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name)
  return { plugins: [...plugins.sort(byName), ...off.sort(byName)], userSkills }
}
