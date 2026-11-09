import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { readAgents, fileReaderOf, readScopedDefinitions } from './agents'
import { applyCheck, classifyCommand } from './checks'
import { readBranch, readChangedFiles } from './git'
import { buildCards } from './layout'
import { readExtensions, readPluginAgents } from './plugins'
import { renderPane } from './pane'
import { readBreakdown, readModel, readUsage, toUsage } from './status'
import { statusPills } from './view-statusbar'
import { addChange, readBefore } from './track'
import { countLines } from './text'
import { asUsageLog, recordUse, useOfPrompt, useOfToolCall, USAGE_KEY, type Use } from './usage'

const PANE = 'session-sidebar'
const PANE_TITLE = 'Sessão'
const CLOCK_MS = 60_000
// Another plugin may swallow the classic model-switch event, so the model is
// also polled; the read is local and only a change writes.
const MODEL_POLL_MS = 5_000

const cwd = atom({ plugin: 'session-sidebar', key: 'cwd' } as const, '')
const model = atom({ plugin: 'session-sidebar', key: 'model' } as const, null)
const isRunning = atom({ plugin: 'session-sidebar', key: 'isRunning' } as const, false)
const usage = atom({ plugin: 'session-sidebar', key: 'usage' } as const, null)
const limits = atom({ plugin: 'session-sidebar', key: 'limits' } as const, [])
const breakdown = atom({ plugin: 'session-sidebar', key: 'breakdown' } as const, null)
const branch = atom({ plugin: 'session-sidebar', key: 'branch' } as const, null)
const git = atom({ plugin: 'session-sidebar', key: 'git' } as const, null)
const sessionFiles = atom({ plugin: 'session-sidebar', key: 'sessionFiles' } as const, [])
const todos = atom({ plugin: 'session-sidebar', key: 'todos' } as const, [])
const agents = atom({ plugin: 'session-sidebar', key: 'agents' } as const, [])
const defs = atom({ plugin: 'session-sidebar', key: 'defs' } as const, { user: [], project: [], plugins: [] })
const checks = atom({ plugin: 'session-sidebar', key: 'checks' } as const, [])
const version = atom({ plugin: 'session-sidebar', key: 'version' } as const, null)
const extensions = atom({ plugin: 'session-sidebar', key: 'extensions' } as const, { plugins: [], userSkills: [] })
const isOpen = atom({ plugin: 'session-sidebar', key: 'isOpen' } as const, true)
const collapsed = atom({ plugin: 'session-sidebar', key: 'collapsed' } as const, [])
const expanded = atom({ plugin: 'session-sidebar', key: 'expanded' } as const, [])
const turnBase = atom({ plugin: 'session-sidebar', key: 'turnBase' } as const, null)
const LABEL_BACKGROUND = '#2d333b'
const LABEL_COLOR = '#e6edf3'

const flip = (list: string[], id: string) => (list.includes(id) ? list.filter(item => item !== id) : [...list, id])

// The clock redraws the pane each minute so the reset countdowns stay current.
let clockTimer: { cancel: () => void } | undefined
let modelTimer: { cancel: () => void } | undefined

async function refreshUsage($: EngineInterface): Promise<void> {
  const next = await readUsage($)
  if (next === undefined) return
  await update($, usage, () => next.usage)
  await update($, limits, () => next.limits)
}

async function refreshModel($: EngineInterface): Promise<void> {
  const next = await readModel($)
  if (next !== undefined && next !== (await read($, model))) await update($, model, () => next)
}

async function refreshCwd($: EngineInterface): Promise<void> {
  try {
    const next = await $.session.cwd()
    if (next !== (await read($, cwd))) await update($, cwd, () => next)
  } catch (error) {
    $.ui.log(`session-sidebar: cwd unavailable: ${String(error)}`)
  }
}

// Once per turn: the breakdown is the costlier read.
async function refreshBreakdown($: EngineInterface): Promise<void> {
  const next = await readBreakdown($)
  if (next !== undefined) await update($, breakdown, () => next)
}

async function refreshAgents($: EngineInterface): Promise<void> {
  const rows = await readAgents($)
  if (rows !== undefined) await update($, agents, () => rows)
}

async function refreshDefs($: EngineInterface): Promise<void> {
  const folder = await read($, cwd)
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const reader = fileReaderOf($)
  const scoped = await readScopedDefinitions(reader, home, folder)
  let plugins = (await read($, defs)).plugins ?? []
  try {
    plugins = home ? await readPluginAgents(reader, home) : []
  } catch (error) {
    // A malformed installed list keeps the last plugin groups on screen.
    $.ui.log(`session-sidebar: plugin agents unavailable: ${String(error)}`)
  }
  await update($, defs, () => ({ ...scoped, plugins }))
}

// The version comes from the loaded copy's own manifest.
async function refreshVersion($: EngineInterface): Promise<void> {
  try {
    const manifest: unknown = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    const value = (manifest as { version?: unknown }).version
    await update($, version, () => (typeof value === 'string' ? value : null))
  } catch (error) {
    $.ui.log(`session-sidebar: version unavailable: ${String(error)}`)
  }
}

async function refreshExtensions($: EngineInterface): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return
  try {
    const next = await readExtensions(fileReaderOf($), home)
    await update($, extensions, () => next)
  } catch (error) {
    // A malformed settings or installed list keeps the last list on screen.
    $.ui.log(`session-sidebar: plugins unavailable: ${String(error)}`)
  }
}

// Each use goes to $.store, so the order holds across sessions; a drawing that
// read the log redraws on the write.
async function recordUsage($: EngineInterface, use: Use | undefined): Promise<void> {
  if (use === undefined) return
  const now = await $.clock.now()
  const log = asUsageLog(await $.store.get(USAGE_KEY))
  await $.store.set(USAGE_KEY, recordUse(log, use, now))
}

// No log yet, or none readable, draws as no uses.
async function readUsageLog($: EngineInterface) {
  try {
    return asUsageLog(await $.store.get(USAGE_KEY))
  } catch (error) {
    $.ui.log(`session-sidebar: usage log unavailable: ${String(error)}`)
    return asUsageLog(undefined)
  }
}

// A slash command is a skill when it is one of the user's or names an enabled plugin.
async function knownSkill($: EngineInterface): Promise<(name: string) => boolean> {
  const current = await read($, extensions)
  const plugins = new Set((current?.plugins ?? []).map(plugin => plugin.name))
  const user = new Set(current?.userSkills ?? [])
  return name => user.has(name) || plugins.has(name.split(':')[0] ?? '')
}

// Git is the source of truth for changed files and for the branch. A burst of
// tool calls folds into at most two runs: one in flight, and one more if asked
// meanwhile. A failed run keeps the last values on screen and never rejects.
let gitRunning: Promise<void> | null = null
let isGitAgain = false

async function runGitRefresh($: EngineInterface): Promise<void> {
  const [files, nextBranch] = await Promise.all([readChangedFiles($), readBranch($)])
  if (files !== undefined) await update($, git, () => files)
  if (nextBranch !== undefined) await update($, branch, () => nextBranch)
}

async function drainGitRefresh($: EngineInterface): Promise<void> {
  try {
    while (isGitAgain) {
      isGitAgain = false
      await runGitRefresh($)
    }
  } catch (error) {
    $.ui.log(`session-sidebar: git refresh failed: ${String(error)}`)
  } finally {
    gitRunning = null
  }
}

function refreshGitFiles($: EngineInterface): Promise<void> {
  isGitAgain = true
  if (gitRunning === null) gitRunning = drainGitRefresh($)
  return gitRunning
}

// What a turn, a model switch or a compaction can move. The reads are
// independent, so they run together.
async function refreshSession($: EngineInterface): Promise<void> {
  await refreshCwd($)
  await Promise.all([refreshUsage($), refreshModel($), refreshBreakdown($), refreshAgents($), refreshGitFiles($)])
}

// What the user's settings and the plugin folders define.
async function refreshConfigured($: EngineInterface): Promise<void> {
  await Promise.all([refreshDefs($), refreshExtensions($)])
}

// Outside git the files card lists the session's own Edit/Write; inside it git
// answers, and the tally (a whole-file read before each Write) is skipped.
async function isTallyNeeded($: EngineInterface): Promise<boolean> {
  return (await read($, git)) === null
}

function succeeded(ran: { deny?: unknown; isError?: boolean }): boolean {
  return ran.deny === undefined && ran.isError !== true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sidebar',
      description: 'Mostra ou oculta a sidebar da sessão',
    })
    await update($, cwd, () => e.cwd)
    await update($, isRunning, () => false)
    await Promise.all([refreshSession($), refreshConfigured($), refreshVersion($)])
    clockTimer?.cancel()
    clockTimer = $.clock.every(CLOCK_MS, () => $.ui.invalidate('ui.render'))
    modelTimer?.cancel()
    modelTimer = $.clock.every(MODEL_POLL_MS, () => void refreshModel($))
    if (await read($, isOpen)) void $.ui.open({ id: PANE, title: PANE_TITLE })

    return next(e)
  })

  // The engine pushes the rate limits and the context fill as they move.
  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits)
    await update($, usage, () => toUsage(e.context, e.cost))

    return next(e)
  }).catch(($, e, next) => next(e))

  // /model, the picker, fast mode or a fallback: the header names the new model
  // at once, then the window and the breakdown it brings are measured again.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await update($, model, () => e.to_model)
    const ran = await next(e)
    await Promise.all([refreshUsage($), refreshBreakdown($)])

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.PostCompact', async ($, e, next) => {
    const ran = await next(e)
    await Promise.all([refreshUsage($), refreshBreakdown($)])

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.CwdChanged', async ($, e, next) => {
    await update($, cwd, () => e.new_cwd)
    const ran = await next(e)
    await Promise.all([refreshGitFiles($), refreshDefs($)])

    return ran
  }).catch(($, e, next) => next(e))

  // Settings or skills changed on disk: a plugin enabled, a skill added.
  on('classic.ConfigChange', async ($, e, next) => {
    const ran = await next(e)
    await refreshConfigured($)

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'sidebar' }, async $ => {
    const isNowOpen = !(await read($, isOpen))
    await update($, isOpen, () => isNowOpen)

    if (!isNowOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Sidebar oculta.' }
    }
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Sidebar visível.' }
  })

  // The person closed the sidebar with its own mark: keep `isOpen` true to what is drawn, so the
  // status bar and the "◀ Sidebar" button appear. An unload (a reload) must not count.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, isOpen, () => false)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await recordUsage($, useOfPrompt(e.text, await knownSkill($)))

    return next(e)
  }).catch(($, e, next) => next(e))

  // Only the main loop's turn makes the session ativo; a subagent's is its own.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, isRunning, () => true)
    // What the status bar's "(+…)" growth is counted from.
    const now = await read($, usage)
    await update($, turnBase, () => (now === null ? null : { tokens: now.tokens, usd: now.usd }))
    await refreshModel($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await refreshAgents($)
      return next(e)
    }
    await update($, isRunning, () => false)
    // The classic compact, cwd and settings events can be swallowed by another
    // plugin, so each main turn re-reads what they would have moved.
    await Promise.all([refreshSession($), refreshConfigured($)])

    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    await refreshAgents($)

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', async ($, e, next) => {
    await refreshAgents($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    await refreshAgents($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Any tool: a skill, a plugin's subagent or a plugin's MCP tool counts as a use.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran)) await recordUsage($, useOfToolCall(e.tool, e as unknown as Record<string, unknown>))

    return ran
  }).catch(($, e, next) => next(e))

  // The observers below only watch: a failure passes the call on unchanged.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran) && (await isTallyNeeded($))) {
      const change = {
        path: e.file_path,
        added: countLines(e.new_string),
        removed: countLines(e.old_string),
      }
      await update($, sessionFiles, list => addChange(list, change))
    }
    void refreshGitFiles($)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const isTallied = await isTallyNeeded($)
    const before = isTallied ? await readBefore($, e.file_path) : ''
    const ran = await next(e)
    if (isTallied && succeeded(ran)) {
      const change = {
        path: e.file_path,
        added: countLines(e.content),
        removed: countLines(before),
      }
      await update($, sessionFiles, list => addChange(list, change))
    }
    void refreshGitFiles($)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const kind = classifyCommand(e.command)
    const startedAt = await $.clock.now()
    if (kind !== undefined) {
      await update($, checks, list => applyCheck(list, { kind, status: 'running', at: startedAt }))
    }
    const ran = await next(e)
    if (kind !== undefined) {
      const finishedAt = await $.clock.now()
      const status = succeeded(ran) ? 'passed' : 'failed'
      await update($, checks, list => applyCheck(list, { kind, status, at: finishedAt }))
    }
    void refreshGitFiles($)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    void refreshGitFiles($)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran)) await update($, todos, () => e.todos)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const cards = buildCards({
      cwd: await read($, cwd),
      model: await read($, model),
      isRunning: await read($, isRunning),
      branch: await read($, branch),
      usage: await read($, usage),
      limits: await read($, limits),
      breakdown: await read($, breakdown),
      git: await read($, git),
      sessionFiles: await read($, sessionFiles),
      todos: await read($, todos),
      agents: await read($, agents),
      defs: await read($, defs),
      checks: await read($, checks),
      version: await read($, version),
      extensions: (await read($, extensions)) ?? { plugins: [], userSkills: [] },
      usageLog: await readUsageLog($),
      collapsed: (await read($, collapsed)) ?? [],
      expanded: (await read($, expanded)) ?? [],
      now: await $.clock.now(),
      width: e.props.bodyColumns,
    })

    const els = $.ui.resolve(e)
    const { Box, Button } = els
    const collapse = async () => {
      await update($, isOpen, () => false)
      await $.ui.close({ id: PANE })
    }

    const toggle = (id: string) => void update($, collapsed, list => flip(list, id))
    const more = (id: string) => void update($, expanded, list => flip(list, id))

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box justifyContent="flex-start">
          <Button key="collapse-sidebar" plain onPress={() => void collapse()}>
            {'▶ Recolher'}
          </Button>
        </Box>
        {renderPane(els, cards, e.props.bodyColumns, toggle, more)}
      </Box>
    )
  })

  // With the pane collapsed, a one-line band above the prompt brings it back.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (await read($, isOpen)) return next(e)
    // Other mods share this slot: draw theirs below ours instead of replacing it.
    const below = await next(e).catch(() => undefined)
    const { Box, Button, Text } = $.ui.resolve(e)
    const expand = async () => {
      await update($, isOpen, () => true)
      await $.ui.open({ id: PANE, title: PANE_TITLE })
    }
    // The figures the sidebar showed, as pills on the left; the button stays on the right.
    const pills = statusPills(await read($, usage), (await read($, limits)) ?? [], await read($, turnBase))
    const mine = (
      <Box flexDirection="row" alignItems="center" gap={2} paddingLeft={1} paddingRight={3} marginBottom={1}>
        {pills.map(pill => (
          <Box key={pill.label} flexDirection="row">
            <Text backgroundColor={LABEL_BACKGROUND} color={LABEL_COLOR}>
              {` ${pill.label} `}
            </Text>
            {pill.parts.map((part, index) => (
              <Text key={String(index)} backgroundColor={pill.background} color={part.color}>
                {part.text}
              </Text>
            ))}
          </Box>
        ))}
        <Box flexGrow={1} />
        <Button key="expand-sidebar" variant="primary" onPress={() => void expand()}>
          {' ◀ Sidebar '}
        </Button>
      </Box>
    )

    return below ? (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    ) : (
      mine
    )
  })
}
