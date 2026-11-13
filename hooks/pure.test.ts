import { expect, test } from 'claude-code/testing'

import { parseFrontmatter } from './frontmatter'
import { formatReset, limitTone } from './limits'
import { asFlag, asQuota, isLimitFull, RESUME_QUOTA, resumeAt } from './resume'
import { mergeChanged, parseNumstatZ, parsePorcelainZ, sortByDirectory } from './git'
import { isOffServer, offServerOfTool, switchServer, wireName } from './mcp-switch'
import { mcpRows } from './view-mcps'
import { fit, middleElide, toPlain, type Line } from './text'
import { agentRows, definitionRows } from './view-agents'
import { extensionRows, wrapNames } from './view-extensions'
import { parseDisabled } from './plugins'
import { byRecentUse, EMPTY_LOG, recordUse, useOfPrompt, useOfToolCall } from './usage'

const NOW = Date.parse('2026-10-30T10:00:00Z')

test('porcelain -z: modified, untracked and renamed entries; a rename skips its old path', () => {
  const output = 'M  src/a.ts\0 M src/b.ts\0?? notes.md\0R  src/new.ts\0src/old.ts\0'
  expect(parsePorcelainZ(output)).toEqual([
    { code: 'M', path: 'src/a.ts' },
    { code: 'M', path: 'src/b.ts' },
    { code: '?', path: 'notes.md' },
    { code: 'R', path: 'src/new.ts' },
  ])
})

test('numstat -z: counts per path, binary files unknown, rename keyed by its new path', () => {
  const output = '12\t3\tsrc/a.ts\0-\t-\tlogo.png\0' + '1\t1\t\0src/old.ts\0src/new.ts\0'
  const counts = parseNumstatZ(output)
  expect(counts.get('src/a.ts')).toEqual({ added: 12, removed: 3 })
  expect(counts.get('logo.png')).toEqual({ added: null, removed: null })
  expect(counts.get('src/new.ts')).toEqual({ added: 1, removed: 1 })
  expect(counts.has('src/old.ts')).toBe(false)
})

test('untracked files count their lines and remove nothing; a missing count stays unknown', () => {
  const merged = mergeChanged(
    [
      { code: '?', path: 'notes.md' },
      { code: '?', path: 'big.bin' },
      { code: 'M', path: 'src/a.ts' },
    ],
    new Map([['src/a.ts', { added: 4, removed: 2 }]]),
    new Map([
      ['notes.md', 2],
      ['big.bin', null],
    ]),
  )
  expect(merged).toEqual([
    { code: '?', path: 'notes.md', added: 2, removed: 0 },
    { code: '?', path: 'big.bin', added: null, removed: 0 },
    { code: 'M', path: 'src/a.ts', added: 4, removed: 2 },
  ])
})

test('files sort by directory, then by name', () => {
  const sorted = sortByDirectory([{ path: 'b/z.ts' }, { path: 'a/y.ts' }, { path: 'root.md' }, { path: 'a/x.ts' }])
  expect(sorted.map(file => file.path)).toEqual(['root.md', 'a/x.ts', 'a/y.ts', 'b/z.ts'])
})

test('frontmatter: name, model, quoted and folded description; the body is ignored', () => {
  const text = [
    '---',
    'name: reviewer',
    'model: claude-haiku-5-5',
    'description: "Reviews the diff for bugs"',
    '---',
    'secret: body-text-that-must-not-appear',
  ].join('\n')
  expect(parseFrontmatter(text)).toEqual({
    name: 'reviewer',
    model: 'claude-haiku-5-5',
    description: 'Reviews the diff for bugs',
  })
})

test('frontmatter: a folded block is joined into one line', () => {
  const text = ['---', 'name: planner', 'description: >', '  Plans the work', '  in small steps', '---'].join('\n')
  expect(parseFrontmatter(text).description).toBe('Plans the work in small steps')
})

test('frontmatter: no leading block means no fields', () => {
  expect(parseFrontmatter('# just a heading\nname: nope')).toEqual({})
})

test('truncation: fit ends with an ellipsis and never exceeds the width', () => {
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(fit('abc', 4)).toBe('abc')
  expect(fit('abc', 1)).toBe('…')
})

test('truncation: a long path keeps its file name and elides middle directories', () => {
  expect(middleElide('src/components/deep/nested/file.ts', 22)).toBe('src/…/nested/file.ts')
  expect(middleElide('src/a.ts', 40)).toBe('src/a.ts')
  expect(middleElide('src/components/deep/nested/file.ts', 8)).toBe('file.ts')
})

test('limits: normal under 70, warning from 70, error from 90', () => {
  expect(limitTone(69)).toBe('plain')
  expect(limitTone(70)).toBe('warning')
  expect(limitTone(90)).toBe('error')
})

test('reset: a countdown under a day, the weekday and time from a day on', () => {
  expect(formatReset(new Date(NOW + 134 * 60_000).toISOString(), NOW)).toBe('reseta em 2h14')
  expect(formatReset(new Date(NOW + 42 * 60_000).toISOString(), NOW)).toBe('reseta em 42min')
  expect(formatReset(new Date(NOW + 3 * 24 * 3600_000).toISOString(), NOW)).toMatch(/^reseta \S+ \d\d:\d\d$/)
  expect(formatReset(undefined, NOW)).toBe('')
})

test('agents: a running agent shows its type, a badge and what it is doing', () => {
  const plain = toPlain(
    agentRows([{ id: 'a1', type: 'Explore', description: 'Find the auth flow', status: 'running' }], 40),
    40,
  )
  expect(plain[0]).toBe(`● Explore${' '.repeat(21)}EXECUTANDO`)
  expect(plain[1]).toBe('  Find the auth flow')
  expect(plain.every(row => row.length <= 40)).toBe(true)
})

test('agents: a finished agent is listed as concluído', () => {
  const plain = toPlain(agentRows([{ id: 'a2', type: 'general-purpose', description: 'Lint', status: 'completed' }], 40), 40)
  expect(plain[0]).toContain('CONCLUÍDO')
})

test('definitions: groups show a count and only the first names', () => {
  const lines: Line[] = definitionRows(
    {
      user: [],
      project: [],
      plugins: [
        {
          plugin: 'ecc',
          agents: ['a', 'b', 'c'].map(name => ({ name, model: 'claude-haiku-5-5', description: '' })),
        },
      ],
    },
    40,
  )
  const plain = toPlain(lines, 40)
  expect(plain[0]).toMatch(/^ecc +3 agentes$/)
  expect(plain.length).toBe(3)
})

test('skill names wrap at the width and the ones past the last line are counted', () => {
  const lines = toPlain(wrapNames(['alpha', 'beta', 'gamma', 'delta', 'omega'], 12, 2), 12)
  expect(lines).toEqual(['alpha, beta', 'gamma, delta', '+1 skills'])
})

test('uses: a skill names its plugin, a plugin subagent and a plugin MCP tool count, the rest do not', () => {
  expect(useOfToolCall('Skill', { skill: 'ecc:plan' })).toEqual({ skill: 'ecc:plan', plugin: 'ecc' })
  expect(useOfToolCall('Skill', { skill: 'graphify' })).toEqual({ skill: 'graphify', plugin: undefined })
  expect(useOfToolCall('Agent', { subagent_type: 'ecc:planner' })).toEqual({ plugin: 'ecc' })
  expect(useOfToolCall('Agent', { subagent_type: 'Explore' })).toBeUndefined()
  expect(useOfToolCall('mcp__plugin_chrome-devtools-mcp_chrome-devtools__click', {})).toEqual({
    plugin: 'chrome-devtools-mcp',
  })
  expect(useOfToolCall('mcp__qagent__page_click', {})).toBeUndefined()
  expect(useOfToolCall('Bash', { command: 'ls' })).toBeUndefined()
})

test('uses: a slash command counts only when it names a known skill', () => {
  const known = (name: string) => name === 'ecc:plan'
  expect(useOfPrompt('/ecc:plan add login', known)).toEqual({ skill: 'ecc:plan', plugin: 'ecc' })
  expect(useOfPrompt('/clear', known)).toBeUndefined()
  expect(useOfPrompt('plain text', known)).toBeUndefined()
})

test('usage log: a use bumps the count and the time; the order is most recent, then most used, then name', () => {
  const log = recordUse(recordUse(EMPTY_LOG, { plugin: 'ecc', skill: 'ecc:plan' }, 10), { plugin: 'ecc' }, 20)
  expect(log.plugins.ecc).toEqual({ count: 2, last: 20 })
  expect(log.skills['ecc:plan']).toEqual({ count: 1, last: 10 })
  const entries = { b: { count: 1, last: 5 }, c: { count: 9, last: 5 }, d: { count: 1, last: 50 } }
  expect(byRecentUse(['a', 'b', 'c', 'd'], name => name, entries)).toEqual(['d', 'c', 'b', 'a'])
})

test('resume: the latest reset of the full windows, plus a margin; none full, the earliest ahead', () => {
  const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
  const margin = 30_000
  const full = [
    { kind: 'five_hour', percentUsed: 100, resetsAt: at(90) },
    { kind: 'seven_day', percentUsed: 40, resetsAt: at(3000) },
  ]
  expect(resumeAt(full, NOW)).toBe(NOW + 90 * 60_000 + margin)
  const lagging = [
    { kind: 'five_hour', percentUsed: 98, resetsAt: at(20) },
    { kind: 'seven_day', percentUsed: 60, resetsAt: at(3000) },
  ]
  expect(resumeAt(lagging, NOW)).toBe(NOW + 20 * 60_000 + margin)
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 100, resetsAt: at(-5) }], NOW)).toBeUndefined()
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 100 }], NOW)).toBeUndefined()
})

test('resume settings: a bad stored quota falls back to the full one; the flag is on only when true', () => {
  expect(asQuota(1)).toBe(1)
  expect(asQuota(0)).toBe(0)
  expect(asQuota(-1)).toBe(RESUME_QUOTA)
  expect(asQuota('2')).toBe(RESUME_QUOTA)
  expect(asFlag(true)).toBe(true)
  expect(asFlag('true')).toBe(false)
  expect(isLimitFull([{ kind: 'five_hour', percentUsed: 100 }])).toBe(true)
  expect(isLimitFull([{ kind: 'five_hour', percentUsed: 99.9 }])).toBe(false)
})

test('mcp switch: names match in either spelling, a call finds its server, a switch adds or drops it', () => {
  expect(wireName('claude.ai Gmail')).toBe('claude_ai_Gmail')
  expect(wireName('plugin:context7:context7')).toBe('plugin_context7_context7')
  expect(isOffServer(['claude.ai Gmail'], 'claude_ai_Gmail')).toBe(true)
  expect(offServerOfTool(['claude.ai Gmail'], 'mcp__claude_ai_Gmail__create_draft')).toBe('claude.ai Gmail')
  expect(offServerOfTool(['srv'], 'mcp__srv2__tool')).toBeUndefined()
  expect(switchServer(['a'], 'b', true)).toEqual(['a', 'b'])
  expect(switchServer(['a', 'b'], 'a', false)).toEqual(['b'])
})

test('mcp rows: a held-back server still lists as off, and the selected one shows its action', () => {
  const rows = mcpRows([{ name: 'Neon', tools: 3, tokens: 900 }], 40, false, ['graft'], 'mcp:graft')
  const plain = toPlain(rows, 40)
  expect(plain.some(row => row.includes('● Neon'))).toBe(true)
  expect(plain.some(row => row.includes('○ graft') && row.includes('desligado'))).toBe(true)
  expect(plain.some(row => row.includes('[Ligar]'))).toBe(true)
  expect(mcpRows(null, 40, false, ['graft']).length).toBe(1)
})

test('plugins: a disabled one lists after the enabled, a pressed one opens its switch, the sidebar has none', () => {
  expect([...parseDisabled('{"enabledPlugins":{"a@m":true,"b@m":false}}')]).toEqual(['b@m'])
  const extensions = {
    plugins: [
      { name: 'session-sidebar', key: 'session-sidebar@m', skills: 0 },
      { name: 'ecc', key: 'ecc@m', skills: 3 },
      { name: 'vercel', key: 'vercel@m', skills: 0, isOff: true },
    ],
    userSkills: [],
  }
  const rows = extensionRows(extensions, EMPTY_LOG, NOW, 40, false, 'plugin:vercel')
  const plain = toPlain(rows, 40)
  expect(plain.findIndex(row => row.includes('○ vercel'))).toBeGreaterThan(plain.findIndex(row => row.includes('ecc')))
  expect(plain.some(row => row.includes('[Ligar]'))).toBe(true)
  expect(rows.find(row => row.press === 'plugin:ecc')).toBeDefined()
  expect(rows.find(row => row.press === 'plugin:session-sidebar')).toBeUndefined()
})
