import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { readAgents, fileReaderOf, readScopedDefinitions } from './agents'
import { applyCheck, classifyCommand } from './checks'
import { readBranch, readChangedFiles } from './git'
import { buildCards } from './layout'
import { asNames, isOffServer, MCP_OFF_KEY, offServerOfTool, switchServer } from './mcp-switch'
import { readExtensions, readPluginAgents } from './plugins'
import { renderPane } from './pane'
import { asFlag, asQuota, AUTO_RESUME_KEY, isLimitFull, RESUME_QUOTA, RESUME_QUOTA_KEY, RESUME_TEXT, resumeAt } from './resume'
import { renderResume } from './view-resume'
import { asEffort, readBreakdown, readConfiguredEffort, readModel, readUsage, toUsage } from './status'
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
// The engine seats a pane on each open, and the first one of a session can land
// inline above the prompt; one close and reopen a moment later seats it again.
const RESEAT_DELAY_MS = 500
// The last level a request was sent with, kept across sessions: what a new
// session shows until its own first request.
const EFFORT_KEY = 'effort'

const cwd = atom({ plugin: 'session-sidebar', key: 'cwd' } as const, '')
const model = atom({ plugin: 'session-sidebar', key: 'model' } as const, null)
const effort = atom({ plugin: 'session-sidebar', key: 'effort' } as const, null)
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
const autoResume = atom({ plugin: 'session-sidebar', key: 'autoResume' } as const, false)
const resumeQuota = atom({ plugin: 'session-sidebar', key: 'resumeQuota' } as const, RESUME_QUOTA)
const resumePlan = atom({ plugin: 'session-sidebar', key: 'resumePlan' } as const, null)
const isConfirmingReset = atom({ plugin: 'session-sidebar', key: 'isConfirmingReset' } as const, false)
const mcpOff = atom({ plugin: 'session-sidebar', key: 'mcpOff' } as const, [])
const selectedRow = atom({ plugin: 'session-sidebar', key: 'selectedRow' } as const, null)
// Plugins turned off in this session: still loaded until the next one, so their calls are refused.
const pluginsOffNow = atom({ plugin: 'session-sidebar', key: 'pluginsOffNow' } as const, [])
const LABEL_BACKGROUND = '#2d333b'
const LABEL_COLOR = '#e6edf3'

const flip = (list: string[], id: string) => (list.includes(id) ? list.filter(item => item !== id) : [...list, id])

// The clock redraws the pane each minute so the reset countdowns stay current.
let clockTimer: { cancel: () => void } | undefined
let modelTimer: { cancel: () => void } | undefined

let isReseatTried = false

// Once per session, and only while the pane is drawn inline: a plugin close is
// not the person's, so `isOpen` stays true. A failure leaves the pane as it is.
async function reseatPane($: EngineInterface): Promise<void> {
  try {
    await $.clock.sleep(RESEAT_DELAY_MS)
    if (!(await read($, isOpen))) return
    await $.ui.close({ id: PANE })
    await $.ui.open({ id: PANE, title: PANE_TITLE })
  } catch (error) {
    $.ui.log(`session-sidebar: pane not reseated: ${String(error)}`)
  }
}

// The toggle and the quota live in $.store, so they hold across sessions; the
// atoms mirror them for the drawing.
async function seedResume($: EngineInterface): Promise<void> {
  try {
    const [isOn, quota] = await Promise.all([$.store.get(AUTO_RESUME_KEY), $.store.get(RESUME_QUOTA_KEY)])
    await update($, autoResume, () => asFlag(isOn))
    await update($, resumeQuota, () => asQuota(quota))
  } catch (error) {
    $.ui.log(`session-sidebar: resume settings unavailable: ${String(error)}`)
  }
}

async function setAutoResume($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, autoResume, () => isOn)
  await $.store.set(AUTO_RESUME_KEY, isOn)
  if (!isOn) await cancelResume($)
}

async function setQuota($: EngineInterface, quota: number): Promise<void> {
  await update($, resumeQuota, () => quota)
  await $.store.set(RESUME_QUOTA_KEY, quota)
}

// The switched-off servers live in $.store; the atom mirrors them for the
// drawing and for the per-call check.
async function readMcpOff($: EngineInterface): Promise<string[]> {
  try {
    return asNames(await $.store.get(MCP_OFF_KEY))
  } catch (error) {
    $.ui.log(`session-sidebar: switched-off MCPs unavailable: ${String(error)}`)
    return []
  }
}

// Off: its calls are refused now, and the next session holds it back. On: it
// leaves the list and, if this session held it back, connects at once.
async function switchMcp($: EngineInterface, server: string, isOff: boolean): Promise<void> {
  const next = switchServer(await readMcpOff($), server, isOff)
  await $.store.set(MCP_OFF_KEY, next)
  await update($, mcpOff, () => next)
  await update($, selectedRow, () => null)
  if (isOff) return
  const joined = await $.mcp.connect(server)
  if (!joined.isConnected) $.ui.log(`session-sidebar: ${server} not connected: ${joined.message}`)
  await refreshBreakdown($)
}

// The official CLI writes the setting, as /plugin would; the engine loads the
// change from the next session.
const PLUGIN_CLI_TIMEOUT_MS = 30_000

async function switchPlugin($: EngineInterface, name: string, isOff: boolean): Promise<void> {
  await update($, selectedRow, () => null)
  const key = ((await read($, extensions))?.plugins ?? []).find(plugin => plugin.name === name)?.key
  if (key === undefined) return
  try {
    const ran = await $.process.run(['claude', 'plugin', isOff ? 'disable' : 'enable', key], {
      timeoutMs: PLUGIN_CLI_TIMEOUT_MS,
    })
    if (ran.exitCode !== 0) {
      $.ui.log(`session-sidebar: plugin ${key} not switched: ${ran.stderr.trim() || ran.stdout.trim()}`)
      return
    }
  } catch (error) {
    $.ui.log(`session-sidebar: plugin ${key} not switched: ${String(error)}`)
    return
  }
  await update($, pluginsOffNow, list => switchServer(list ?? [], name, isOff))
  await refreshExtensions($)
}

// A row's press key is `<list>:<name>` to open its switch, `<list>-off:` / `<list>-on:` to flip it.
async function pressRow($: EngineInterface, key: string): Promise<void> {
  const [action, ...rest] = key.split(':')
  const name = rest.join(':')
  if (action === 'mcp' || action === 'plugin') await update($, selectedRow, current => (current === key ? null : key))
  else if (action === 'mcp-off' || action === 'mcp-on') await switchMcp($, name, action === 'mcp-off')
  else if (action === 'plugin-off' || action === 'plugin-on') await switchPlugin($, name, action === 'plugin-off')
}

// One pending resume per session: the timer fires once, a little past the reset.
let resumeTimer: { cancel: () => void } | undefined

async function cancelResume($: EngineInterface): Promise<void> {
  resumeTimer?.cancel()
  resumeTimer = undefined
  if ((await read($, resumePlan)) !== null) await update($, resumePlan, () => null)
}

async function scheduleResume($: EngineInterface): Promise<void> {
  if (resumeTimer !== undefined || !(await read($, autoResume)) || (await read($, resumeQuota)) <= 0) return
  const now = await $.clock.now()
  const at = resumeAt((await read($, limits)) ?? [], now)
  if (at === undefined) {
    $.ui.log('session-sidebar: rate limited, but no reset time to resume at')
    return
  }
  await update($, resumePlan, () => at)
  resumeTimer = $.clock.after(at - now, () => void resume($))
}

// Checked again at fire time: the toggle or the quota may have moved meanwhile.
async function resume($: EngineInterface): Promise<void> {
  resumeTimer = undefined
  await update($, resumePlan, () => null)
  const quota = await read($, resumeQuota)
  if (!(await read($, autoResume)) || quota <= 0) return
  await setQuota($, quota - 1)
  // A plugin's prompt runs once the session is idle; not awaited, so the timer ends now.
  $.prompt.submit({ text: RESUME_TEXT }).catch(error => $.ui.log(`session-sidebar: resume not sent: ${String(error)}`))
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const next = await readUsage($)
  if (next === undefined) return
  await update($, usage, () => next.usage)
  await update($, limits, () => next.limits)
}

async function refreshModel($: EngineInterface): Promise<void> {
  const next = await readModel($)
  if (next !== undefined && next !== (await read($, model))) await update($, model, () => next)
  await refreshConfiguredEffort($)
}

async function setEffort($: EngineInterface, level: string | null): Promise<void> {
  if (level !== (await read($, effort))) await update($, effort, () => level)
}

// A request's own level is the truth; the setting only speaks when it changes
// (an /effort), so a silent downgrade the request reported is not undone.
let lastConfiguredEffort: string | undefined

async function refreshConfiguredEffort($: EngineInterface): Promise<void> {
  const next = await readConfiguredEffort($)
  if (next === undefined || next === lastConfiguredEffort) return
  lastConfiguredEffort = next
  await setEffort($, next)
}

// Nothing measured yet in this session: the last level any session sent.
async function seedEffort($: EngineInterface): Promise<void> {
  if ((await read($, effort)) !== null) return
  try {
    const stored = asEffort(await $.store.get(EFFORT_KEY))
    if (stored !== undefined) await setEffort($, stored)
  } catch (error) {
    $.ui.log(`session-sidebar: stored effort unavailable: ${String(error)}`)
  }
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

// The folder the engine reads its settings, plugins, skills and agents from:
// CLAUDE_CONFIG_DIR when set (a profile manager's), else ~/.claude.
async function readConfigDir($: EngineInterface): Promise<string | undefined> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configured) return configured
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.claude` : undefined
}

async function refreshDefs($: EngineInterface): Promise<void> {
  const folder = await read($, cwd)
  const configDir = await readConfigDir($)
  const reader = fileReaderOf($)
  const scoped = await readScopedDefinitions(reader, configDir, folder)
  let plugins = (await read($, defs)).plugins ?? []
  try {
    plugins = configDir ? await readPluginAgents(reader, configDir) : []
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
  const configDir = await readConfigDir($)
  if (!configDir) return
  try {
    const next = await readExtensions(fileReaderOf($), configDir)
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
  const plugins = new Set((current?.plugins ?? []).filter(plugin => !plugin.isOff).map(plugin => plugin.name))
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
    isReseatTried = false
    await seedEffort($)
    await cancelResume($)
    await seedResume($)
    const off = await readMcpOff($)
    await update($, mcpOff, () => off)
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
    // The person carried on by hand: the pending resume is theirs to drop.
    if (e.origin?.kind === 'composer') await cancelResume($)

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

  // Each main-loop request names the reasoning level it is sent with: after
  // /effort, a model switch or a downgrade, the header follows the next one.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const level = e.effort === undefined ? null : String(e.effort)
      if (level !== (await read($, effort))) {
        await setEffort($, level)
        if (level !== null) await $.store.set(EFFORT_KEY, level)
      }
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await refreshAgents($)
      return next(e)
    }
    await update($, isRunning, () => false)
    // The classic compact, cwd and settings events can be swallowed by another
    // plugin, so each main turn re-reads what they would have moved.
    await Promise.all([refreshSession($), refreshConfigured($)])
    // The StopFailure event can be swallowed by another plugin, so an error
    // turn with a full window counts as a rate-limit stop too.
    if (e.reason === 'error' && isLimitFull((await read($, limits)) ?? [])) await scheduleResume($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    const ran = await next(e)
    if (e.error === 'rate_limit') {
      await refreshUsage($)
      await scheduleResume($)
    }

    return ran
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

  // The engine's own join of a switched-off server is held back: /mcp lists it
  // as held by this plugin, and [Ligar] (our own connect) lets it through.
  on('mcp.connect', async ($, e, next) => {
    if (next.origin.plugin !== 'engine' || !isOffServer(await readMcpOff($), e.server)) return next(e)
    return { value: { isConnected: false, reason: 'disabled', message: `${e.server} desligado na sidebar` } as const }
  }).catch(($, e, next) => next(e))

  // Any tool: a skill, a plugin's subagent or a plugin's MCP tool counts as a use.
  // A server switched off mid-session keeps its tools until the next one: its calls are refused.
  on('tool.call', async ($, e, next) => {
    const off = e.tool.startsWith('mcp__') ? offServerOfTool((await read($, mcpOff)) ?? [], e.tool) : undefined
    if (off !== undefined) {
      return { deny: `O servidor MCP "${off}" foi desligado na sidebar da sessão. Não use as ferramentas dele.` }
    }
    const use = useOfToolCall(e.tool, e as unknown as Record<string, unknown>)
    const plugin = use?.plugin
    if (plugin !== undefined && ((await read($, pluginsOffNow)) ?? []).includes(plugin)) {
      return { deny: `O plugin "${plugin}" foi desligado na sidebar da sessão. Não use as skills, agentes ou ferramentas dele.` }
    }
    const ran = await next(e)
    if (succeeded(ran)) await recordUsage($, use)

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
      effort: await read($, effort),
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
      mcpOff: (await read($, mcpOff)) ?? [],
      selectedRow: await read($, selectedRow),
      now: await $.clock.now(),
      width: e.props.bodyColumns,
    })

    if (e.props.placement === 'inline' && !isReseatTried) {
      isReseatTried = true
      void reseatPane($)
    }

    const els = $.ui.resolve(e)
    const { Box, Button } = els
    const collapse = async () => {
      await update($, isOpen, () => false)
      await $.ui.close({ id: PANE })
    }

    const resumeBox = renderResume(
      els,
      {
        isOn: await read($, autoResume),
        quota: await read($, resumeQuota),
        plannedAt: await read($, resumePlan),
        isConfirming: await read($, isConfirmingReset),
      },
      {
        onToggle: () => void read($, autoResume).then(isOn => setAutoResume($, !isOn)),
        onReset: () => void update($, isConfirmingReset, () => true),
        onConfirm: () => void setQuota($, RESUME_QUOTA).then(() => update($, isConfirmingReset, () => false)),
        onCancel: () => void update($, isConfirmingReset, () => false),
      },
    )

    // A collapsed LIMITES card keeps only its title row, the options too.
    const isLimitsShut = ((await read($, collapsed)) ?? []).includes('limits')
    const toggle = (id: string) => void update($, collapsed, list => flip(list, id))
    const more = (id: string) => void update($, expanded, list => flip(list, id))

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box justifyContent="flex-start">
          <Button key="collapse-sidebar" plain onPress={() => void collapse()}>
            {'▶ Recolher'}
          </Button>
        </Box>
        {renderPane(els, cards, e.props.bodyColumns, toggle, more, isLimitsShut ? {} : { limits: resumeBox }, key => void pressRow($, key))}
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
