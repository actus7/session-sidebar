import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { cardsToPlain } from './cards'
import { buildCards, type PaneData } from './layout'

// The test host prints what a test logs; the rendering below is shown that way.
declare const console: { log(...args: unknown[]): void }

const NOW = Date.parse('2026-10-30T10:00:00Z')
const WIDTH = 44
const PANE = {
  plugin: 'session-sidebar',
  component: 'Pane',
  requestId: 'session-sidebar',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: WIDTH,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const LIMITS = [
  { kind: 'five_hour', percentUsed: 72, resetsAt: new Date(NOW + 134 * 60_000).toISOString() },
  { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-11-02T12:00:00Z' },
]

const BREAKDOWN = {
  categories: [
    { name: 'Mensagens', tokens: 42100, color: 'claude', kind: 'used', isDeferred: false },
    { name: 'Sistema e ferramentas', tokens: 18000, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Buffer de compactação', tokens: 33000, color: '', kind: 'buffer', isDeferred: false },
    { name: 'Espaço livre', tokens: 106900, color: '', kind: 'free', isDeferred: false },
  ],
  totalTokens: 200000,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'model',
  percentage: 100,
  gridRows: [],
  model: 'claude-opus-4-7',
  memoryFiles: [],
  mcpTools: Array.from({ length: 10 }, (_, index) => ({
    name: `mcp__srv${index}__tool`,
    serverName: `srv${index}`,
    tokens: 1000 - index,
    isLoaded: true,
  })),
  agents: [],
  autoCompactThreshold: 167000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

const SEEDED: PaneData = {
  cwd: 'C:\\projects\\my-app',
  model: 'claude-opus-4-7',
  effort: 'high',
  branch: 'feat/sidebar',
  isRunning: true,
  usage: { tokens: 42100, window: 200000, percent: 21, usd: 0.83 },
  limits: LIMITS,
  breakdown: {
    mcps: [
      { name: 'Neon', tools: 120, tokens: 18000 },
      { name: 'graft', tools: 5, tokens: 900 },
      ...Array.from({ length: 8 }, (_, index) => ({ name: `srv${index}`, tools: 1, tokens: 100 })),
    ],
    segments: BREAKDOWN.categories.map(category => ({
      name: category.name,
      tokens: category.tokens,
      color: category.color,
      kind: category.kind as 'used' | 'free' | 'buffer',
    })),
    maxTokens: 200000,
    autoCompactThreshold: 167000,
  },
  git: [
    { code: 'M', path: 'src/app.ts', added: 12, removed: 3 },
    { code: '?', path: 'notes/plan.md', added: 2, removed: 0 },
    { code: 'D', path: 'old/legacy.ts', added: null, removed: 40 },
  ],
  sessionFiles: [],
  todos: [
    { content: 'Read the executor', status: 'completed' },
    { content: 'Write the fix', status: 'in_progress' },
    { content: 'Run e2e', status: 'pending' },
  ],
  agents: [
    { id: 'a1', type: 'Explore', description: 'Find the auth flow', status: 'running' },
    { id: 'a2', type: 'general-purpose', description: 'Lint the diff', status: 'completed' },
  ],
  defs: {
    user: [{ name: 'reviewer', model: 'claude-haiku-5-5', description: 'Reviews diffs for bugs' }],
    project: [],
    plugins: [{ plugin: 'ecc', agents: [{ name: 'planner', model: 'claude-opus-4-7', description: '' }] }],
  },
  checks: [
    { kind: 'testes', status: 'passed', at: NOW - 2 * 60_000 },
    { kind: 'type-check', status: 'failed', at: NOW - 3600_000 },
    { kind: 'build', status: 'running', at: NOW },
  ],
  version: '0.1.1',
  extensions: {
    plugins: [
      { name: 'ecc', skills: 210 },
      { name: 'ponytail', skills: 6 },
    ],
    userSkills: ['brag', 'graphify', 'hyperframes', 'impeccable', 'media-use', 'playwright-cli'],
  },
  usageLog: {
    plugins: { ponytail: { count: 3, last: NOW - 5 * 60_000 } },
    skills: { 'ponytail:ponytail': { count: 3, last: NOW - 5 * 60_000 }, impeccable: { count: 1, last: NOW - 3600_000 } },
  },
  collapsed: [],
  expanded: [],
  now: NOW,
  width: WIDTH,
}

// Nothing sits beneath the plugin: each hook here stands for the engine.
function engine(on: On, git: { status: string; numstat: string }, model: () => string = () => 'claude-opus-4-7') {
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  on('ui.log', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'sidebar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      // The fixture follows the engine's breakdown shape; the mock's type is looser.
      context: { tokens: 42100, window: 200000, percent: 21, breakdown: BREAKDOWN as never },
      rateLimits: LIMITS,
      cost: { usd: 0.83 },
    },
  }))
  on('session.model', () => ({ value: model() }))
  on('session.cwd', () => ({ value: '/w/app' }))
  on('process.run', (_, e) => {
    if (e.argv[1] === 'status') return { value: ok(git.status) }
    if (e.argv[1] === 'diff') return { value: ok(git.numstat) }
    return { value: ok('feat/sidebar\n') }
  })
  on('fs.read', () => ({ value: 'one\ntwo\n' }))
  on('agent.list', () => ({ value: [{ id: 'a1', type: 'Explore', description: 'Find the auth flow', status: 'running' }] }))
  on('env.get', () => ({ value: undefined }))
  const stored = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
}

test('the pane draws its cards from git, the breakdown and a Bash check, on the desktop surface', async ($, on) => {
  engine(on, { status: 'M  src/app.ts\0?? notes.md\0', numstat: '12\t3\tsrc/app.ts\0' })
  await $.session.start({ cwd: '/w/app', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'pnpm -F chrome-extension test' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Ship', status: 'pending', activeForm: 'Shipping' }] })
  await $.tool.call({ tool: 'Skill', skill: 'ecc:plan' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Sessão 5h/ }))?.text).toContain('Sessão 5h')
  expect((await ui.find({ type: 'Text', text: /Contexto/ }))?.text).toContain('Contexto')
  await ui.press({ key: 'more-limits' })
  expect((await ui.find({ type: 'Text', text: /Mensagens/ }))?.text).toContain('Mensagens')
  expect((await ui.find({ type: 'Text', text: /app\.ts/ }))?.text).toContain('app.ts')
  expect((await ui.find({ type: 'Text', text: /✓ testes/ }))?.text).toContain('✓ testes')
  expect((await ui.find({ type: 'Text', text: /Ship/ }))?.text).toContain('Ship')
  expect((await ui.find({ type: 'Text', text: /ecc:plan/ }))?.text).toContain('ecc:plan')
  await ui.unmount()
})

test('the cards render at 44 columns: borders close, every row fits, and the rendering is shown', () => {
  const rendered = cardsToPlain(buildCards({ ...SEEDED, expanded: ['limits'] }), WIDTH)
  console.log(rendered.join('\n'))

  const rows = rendered.filter(row => row.length > 0)
  expect(rows.every(row => row.length === WIDTH)).toBe(true)
  expect(rendered.filter(row => row.startsWith('╭')).length).toBe(8)
  expect(rendered.filter(row => row.startsWith('╰')).length).toBe(8)
  expect(rendered.some(row => row.includes('▾ MCPs') && row.includes('10 servidores'))).toBe(true)
  expect(rendered.some(row => row.includes('Neon') && row.includes('120 tools · 18k'))).toBe(true)
  expect(rendered.some(row => row.includes('Sessão 5h') && row.endsWith('72% │'))).toBe(true)
  expect(rendered.some(row => row.includes('reseta em 2h14'))).toBe(true)
  expect(rendered.some(row => row.includes('■') && row.includes('Mensagens'))).toBe(true)
  expect(rendered.some(row => row.includes('auto-compact em 167k'))).toBe(true)
  expect(rendered.some(row => row.includes('EXECUTANDO'))).toBe(true)
  expect(rendered[1]).toMatch(/^│ {6,}session-sidebar v0\.1\.1 {6,}│$/)
  expect(rendered.some(row => row.includes('▾ PLUGINS E SKILLS') && row.includes('222 skills'))).toBe(true)
  const pluginsAt = (name: string) => rendered.findIndex(row => row.startsWith(`│ ${name} `))
  expect(pluginsAt('ponytail')).toBeLessThan(pluginsAt('ecc'))
  expect(rendered.some(row => row.includes('ponytail') && row.includes('3× · 5m'))).toBe(true)
  expect(rendered.some(row => row.includes('ecc') && row.includes('210 skills'))).toBe(true)
  expect(rendered.some(row => row.includes('ponytail:ponytail') && row.includes('3× · 5m'))).toBe(true)
  expect(rendered.some(row => row.includes('impeccable, brag, graphify'))).toBe(true)
  expect(rendered.some(row => row.includes('✗ type-check') && row.includes('falhou 1h'))).toBe(true)
})

test('a collapsed card keeps only its title row, marked ▸, and the others stay open', () => {
  const rendered = cardsToPlain(buildCards({ ...SEEDED, collapsed: ['mcps'] }), WIDTH)
  expect(rendered.some(row => row.includes('▸ MCPs') && row.includes('10 servidores'))).toBe(true)
  expect(rendered.some(row => row.includes('Neon'))).toBe(false)
  expect(rendered.some(row => row.includes('▾ LIMITES'))).toBe(true)
  expect(rendered.some(row => row.includes('Sessão 5h'))).toBe(true)
  expect(rendered.filter(row => row.length > 0).every(row => row.length === WIDTH)).toBe(true)
})

test('a long list ends with "Ver mais"; expanded it shows everything and ends with "Ver menos"', () => {
  const short = cardsToPlain(buildCards(SEEDED), WIDTH)
  expect(short.some(row => row.includes('+2 servidores'))).toBe(true)
  expect(short.some(row => row.includes('Ver mais'))).toBe(true)
  expect(short.some(row => row.includes('srv7'))).toBe(false)

  const full = cardsToPlain(buildCards({ ...SEEDED, expanded: ['mcps'] }), WIDTH)
  expect(full.some(row => row.includes('srv7'))).toBe(true)
  expect(full.some(row => row.includes('Ver menos'))).toBe(true)
  expect(full.some(row => row.includes('+2 servidores'))).toBe(false)
  expect(full.filter(row => row.length > 0).every(row => row.length === WIDTH)).toBe(true)
})

test('with exactly one item hidden, "Ver mais" is still offered and opens the last one', () => {
  const nine = Array.from({ length: 9 }, (_, index) => ({ name: `srv${index}`, tools: 1, tokens: 100 }))
  const data = { ...SEEDED, breakdown: { ...SEEDED.breakdown!, mcps: nine } }
  const short = cardsToPlain(buildCards(data), WIDTH)
  expect(short.some(row => row.includes('+1 servidores'))).toBe(true)
  expect(short.some(row => row.includes('Ver mais'))).toBe(true)
  const full = cardsToPlain(buildCards({ ...data, expanded: ['mcps'] }), WIDTH)
  expect(full.some(row => row.includes('srv8'))).toBe(true)

  const seven = Array.from({ length: 7 }, (_, index) => ({ content: `t${index}`, status: 'pending' as const }))
  const tasks = cardsToPlain(buildCards({ ...SEEDED, todos: seven }), WIDTH)
  expect(tasks.some(row => row.includes('+1 tarefas'))).toBe(true)
  expect(tasks.filter(row => row.includes('Ver mais')).length).toBeGreaterThanOrEqual(2)
})

test('a card that fits whole has no "Ver mais"', () => {
  const rows = cardsToPlain(buildCards(SEEDED), WIDTH).join('\n')
  const checks = rows.slice(rows.indexOf('VERIFICAÇÕES'), rows.indexOf('ARQUIVOS'))
  expect(checks.includes('Ver mais')).toBe(false)
})

test('the context sits under the limits as one row; "Ver mais" adds its breakdown', () => {
  const short = cardsToPlain(buildCards(SEEDED), WIDTH)
  const shortLimits = short.slice(short.findIndex(row => row.includes('LIMITES')), short.findIndex(row => row.includes('MCPs')))
  expect(shortLimits.some(row => row.includes('Semana'))).toBe(true)
  expect(shortLimits.some(row => row.includes('Contexto') && row.includes('21%'))).toBe(true)
  expect(shortLimits.some(row => row.includes('42.1k / 200k'))).toBe(true)
  expect(shortLimits.some(row => row.includes('Ver mais'))).toBe(true)
  expect(short.some(row => row.includes('Mensagens'))).toBe(false)

  const full = cardsToPlain(buildCards({ ...SEEDED, expanded: ['limits'] }), WIDTH)
  expect(full.some(row => row.includes('Mensagens'))).toBe(true)
  expect(full.some(row => row.includes('auto-compact em 167k'))).toBe(true)
  expect(full.some(row => row.includes('Ver menos'))).toBe(true)
  expect(full.filter(row => row.length > 0).every(row => row.length === WIDTH)).toBe(true)
})

test('clicking a card title collapses it and a second click opens it again', async ($, on) => {
  engine(on, { status: '', numstat: '' })
  await $.session.start({ cwd: '/w/app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /▾ MCPs/ })).toBeDefined()
  await ui.press({ key: 'toggle-mcps' })
  expect(await ui.find({ type: 'Text', text: /▸ MCPs/ })).toBeDefined()
  await ui.press({ key: 'toggle-mcps' })
  expect(await ui.find({ type: 'Text', text: /▾ MCPs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Ver mais/ })).toBeDefined()
  await ui.press({ key: 'more-mcps' })
  expect(await ui.find({ type: 'Text', text: /Ver menos/ })).toBeDefined()
  await ui.unmount()
})

test('with no rate limits, no breakdown and no git, each card says so on one line', () => {
  const rendered = cardsToPlain(
    buildCards({ ...SEEDED, limits: [], breakdown: null, git: null, checks: [], todos: [], agents: [] }),
    WIDTH,
  )
  expect(rendered.some(row => row.includes('sem limites: uso por API, sem assinatura'))).toBe(true)
  expect(rendered.some(row => row.includes('detalhe após o próximo turno'))).toBe(true)
  expect(rendered.some(row => row.includes('nenhuma verificação nesta sessão'))).toBe(true)
  expect(rendered.some(row => row.includes('sessão (sem git): só Edit/Write'))).toBe(true)
})

test('switching the model redraws the header at once, without waiting for a turn', async ($, on) => {
  // As in the engine: once switched, the session reports the new model too.
  let current = 'claude-opus-4-7'
  engine(on, { status: '', numstat: '' }, () => current)
  on('classic.PostModelSwitch', () => ({}))
  await $.session.start({ cwd: '/w/app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /● opus-4-7/ })).toBeDefined()

  current = 'claude-fable-5-2'
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-4-7',
    to_model: 'claude-fable-5-2',
    requested_model: 'fable',
    source: 'command',
    context_tokens: 0,
  } as never)

  expect(await ui.find({ type: 'Text', text: /● fable-5-2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● opus-4-7/ })).toBeUndefined()
  await ui.unmount()
})

test('the main turn drives ativo/ocioso; a subagent ending its turn leaves the session ativo', async ($, on) => {
  engine(on, { status: '', numstat: '' })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/w/app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^ocioso$/ })).toBeDefined()

  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await ui.find({ type: 'Text', text: /^ativo$/ })).toBeDefined()
  await $.turn.complete({ turnId: 's1', agentId: 'a1', reason: 'completed' } as never)
  expect(await ui.find({ type: 'Text', text: /^ativo$/ })).toBeDefined()
  await $.turn.complete({ turnId: 't1', reason: 'completed' } as never)
  expect(await ui.find({ type: 'Text', text: /^ocioso$/ })).toBeDefined()
  await ui.unmount()
})

test('with the model-switch event swallowed, the next main turn still shows the new model', async ($, on) => {
  let current = 'claude-opus-4-7'
  engine(on, { status: '', numstat: '' }, () => current)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/w/app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /● opus-4-7/ })).toBeDefined()

  current = 'claude-opus-5-5'
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await ui.find({ type: 'Text', text: /● opus-5-5/ })).toBeDefined()
  await ui.unmount()
})

test('the header shows the reasoning level beside the model, and drops it when unknown', () => {
  const header = (data: PaneData) => cardsToPlain(buildCards(data), WIDTH)[2] ?? ''
  expect(header(SEEDED)).toMatch(/^│ ● opus-4-7 · alto +ativo │$/)
  expect(header({ ...SEEDED, effort: 'xhigh' })).toContain('● opus-4-7 · extra alto')
  expect(header({ ...SEEDED, effort: null })).toMatch(/^│ ● opus-4-7 +ativo │$/)
  const narrow = cardsToPlain(buildCards({ ...SEEDED, model: 'claude-some-very-long-model-name', width: 34 }), 34)
  expect(narrow.filter(row => row.length > 0).every(row => row.length === 34)).toBe(true)
})

test('a main-loop request sets the level; a subagent request does not', async ($, on) => {
  engine(on, { status: '', numstat: '' })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  await $.session.start({ cwd: '/w/app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  const step = async (e: object) => {
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-4-7', messageCount: 1, ...e } as never)
    for await (const _ of stream) void _
  }
  await step({ effort: 'max' })
  expect(await ui.find({ type: 'Text', text: /· máximo/ })).toBeDefined()
  await step({ effort: 'low', agentId: 'a1' })
  expect(await ui.find({ type: 'Text', text: /· máximo/ })).toBeDefined()
  await step({ effort: 'medium' })
  expect(await ui.find({ type: 'Text', text: /· médio/ })).toBeDefined()
  await ui.unmount()
})
