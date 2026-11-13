import { expect, test } from 'claude-code/testing'

import { readDefinitions, type FileEntry, type FileReader } from './agents'
import { applyCheck, checkRows, classifyCommand, relativeAge } from './checks'
import { groupByDirectory, fileRows } from './view-files'
import { contextBar, segmentCells } from './view-context'
import { pillText, statusPills } from './view-statusbar'
import { parseEnabled, parseInstalled, readPluginAgents } from './plugins'
import { toPlain } from './text'
import type { Check } from '../types'

const NOW = Date.parse('2026-10-30T10:00:00Z')

// A fake file reader: files and folders are looked up by their full path.
function fakeReader(files: Record<string, string>, folders: Record<string, FileEntry[]>): FileReader {
  return {
    read: async path => {
      const text = files[path]
      if (text === undefined) throw new Error('not found')
      return text
    },
    list: async path => {
      const entries = folders[path]
      if (entries === undefined) throw new Error('not found')
      return entries
    },
  }
}

test('segmented bar: parts add up to exactly the cells, largest remainder first', () => {
  expect(segmentCells([50, 30, 20], 10)).toEqual([5, 3, 2])
  const split = segmentCells([1, 1, 1], 10)
  expect(split.reduce((total, value) => total + value, 0)).toBe(10)
  expect(Math.max(...split) - Math.min(...split)).toBe(1)
  expect(segmentCells([0, 0], 10)).toEqual([0, 0])
})

test('context bar: every category of the engine gets its own colour, greys only for buffer and free', () => {
  const names = [
    'System prompt', 'System tools', 'MCP tools', 'MCP server instructions', 'Custom agents', 'Memory files',
    'Skills', 'Messages', 'MCP tools (deferred)', 'System tools (deferred)',
  ]
  const segments = [
    ...names.map(name => ({ name, tokens: 100, color: 'inactive', kind: 'used' as const })),
    { name: 'Autocompact buffer', tokens: 100, color: '', kind: 'buffer' as const },
    { name: 'Free space', tokens: 100, color: '', kind: 'free' as const },
  ]
  const parts = contextBar({ mcps: [], segments, maxTokens: 1200, autoCompactThreshold: null }, 120)
  const colors = parts.map(part => part.color)
  expect(parts.length).toBe(12)
  expect(new Set(colors).size).toBe(12)
  expect(colors.every(color => typeof color === 'string' && color.startsWith('#'))).toBe(true)
})

test('status bar pills: context, cost and limits in Brazilian decimals; unknown figures are left out', () => {
  const usage = { tokens: 214300, window: 1000000, percent: 21, usd: 2.04 }
  const limits = [
    { kind: 'five_hour', percentUsed: 1 },
    { kind: 'seven_day', percentUsed: 70.4 },
  ]
  const pills = statusPills(usage, limits, { tokens: 206600, usd: 1.56 })
  expect(pills.map(pillText)).toEqual([
    'contexto 21% ━━━━━━━━ 214,3k (+7,7k)',
    'custo US$ 2,04 (+0,48)',
    'limite 5h 1% · 7d 70%',
  ])
  expect(pills.map(pill => pill.label)).toEqual(['contexto', 'custo', 'limite'])
  expect(pills[0]?.background).not.toBe(pills[1]?.background)
  expect(pills[2]?.background).toBe(statusPills({ ...usage, percent: 75 }, [])[0]?.background)

  // The bar: 21% of 8 cells fills 2, the rest is the track.
  expect(pills[0]?.parts.filter(part => part.text.startsWith('━')).map(part => part.text.length)).toEqual([2, 6])

  // Without a base, or with no growth, no "(+…)".
  expect(statusPills(usage, [])[1]?.parts[0]?.text).toBe(' US$ 2,04 ')
  expect(statusPills(usage, [], { tokens: 214300, usd: 2.04 }).map(pillText)[0]).toBe('contexto 21% ━━━━━━━━ 214,3k')

  expect(statusPills(null, []).length).toBe(0)
  expect(statusPills({ ...usage, usd: null, tokens: null }, []).map(pillText)).toEqual(['contexto 21% ━━━━━━━━'])
  expect(statusPills(usage, [{ kind: 'five_hour', percentUsed: 95 }]).map(pillText)[2]).toBe('limite 5h 95%')
})

test('verification commands are classified by their pattern', () => {
  expect(classifyCommand('pnpm -F chrome-extension test')).toBe('testes')
  expect(classifyCommand('npx vitest run')).toBe('testes')
  expect(classifyCommand('npm test -- -t Sanitizer')).toBe('testes')
  expect(classifyCommand('pnpm -F pages/side-panel type-check')).toBe('type-check')
  expect(classifyCommand('npx tsc --noEmit')).toBe('type-check')
  expect(classifyCommand('pnpm lint')).toBe('lint')
  expect(classifyCommand('pnpm build')).toBe('build')
  expect(classifyCommand('git status')).toBeUndefined()
  expect(classifyCommand('ls -la')).toBeUndefined()
})

test('a rerun replaces the state of its kind and keeps the others, at most four', () => {
  const first: Check[] = [{ kind: 'testes', status: 'failed', at: NOW }]
  const next = applyCheck(first, { kind: 'testes', status: 'passed', at: NOW + 1000 })
  expect(next).toEqual([{ kind: 'testes', status: 'passed', at: NOW + 1000 }])
  const many = applyCheck(
    [
      { kind: 'lint', status: 'passed', at: NOW },
      { kind: 'build', status: 'passed', at: NOW },
      { kind: 'testes', status: 'passed', at: NOW },
    ],
    { kind: 'type-check', status: 'failed', at: NOW },
  )
  expect(many.length).toBe(4)
  expect(many[0]?.kind).toBe('type-check')
})

test('relative age: agora, minutes, hours, days', () => {
  expect(relativeAge(NOW - 30_000, NOW)).toBe('agora')
  expect(relativeAge(NOW - 2 * 60_000, NOW)).toBe('2m')
  expect(relativeAge(NOW - 3 * 3600_000, NOW)).toBe('3h')
  expect(relativeAge(NOW - 2 * 24 * 3600_000, NOW)).toBe('2d')
})

test('verification rows: passed with its age, failed, running, and a dim line when empty', () => {
  const plain = toPlain(
    checkRows(
      [
        { kind: 'testes', status: 'passed', at: NOW - 2 * 60_000 },
        { kind: 'type-check', status: 'failed', at: NOW - 3600_000 },
        { kind: 'build', status: 'running', at: NOW },
      ],
      NOW,
      40,
    ),
    40,
  )
  expect(plain[0]).toMatch(/^✓ testes +passou 2m$/)
  expect(plain[1]).toMatch(/^✗ type-check +falhou 1h$/)
  expect(plain[2]).toMatch(/^⟳ build +rodando$/)
  expect(toPlain(checkRows([], NOW, 40), 40)).toEqual(['nenhuma verificação nesta sessão'])
})

test('installed plugins: the first install path per key; enabled keys with true only', () => {
  const installed = parseInstalled(
    JSON.stringify({ plugins: { 'ecc@ecc': [{ installPath: 'C:/cache/ecc' }], 'x@y': [{ scope: 'user' }] } }),
  )
  expect(installed.get('ecc@ecc')).toBe('C:/cache/ecc')
  expect(installed.has('x@y')).toBe(false)
  const enabled = parseEnabled(JSON.stringify({ enabledPlugins: { 'ecc@ecc': true, 'off@x': false } }))
  expect([...enabled]).toEqual(['ecc@ecc'])
})

test('plugin agents: only installed and enabled plugins, read from their agents folder', async () => {
  const home = 'C:/Users/dev'
  const reader = fakeReader(
    {
      [`${home}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
        plugins: {
          'ecc@ecc': [{ installPath: 'C:/cache/ecc' }],
          'off@x': [{ installPath: 'C:/cache/off' }],
        },
      }),
      [`${home}/.claude/settings.json`]: JSON.stringify({
        enabledPlugins: { 'ecc@ecc': true, 'off@x': false, 'ghost@y': true },
      }),
      'C:/cache/ecc/agents/planner.md': '---\nname: planner\nmodel: claude-opus-4-7\ndescription: Plans work\n---\nbody',
    },
    {
      'C:/cache/ecc/agents': [
        { name: 'planner.md', kind: 'file' },
        { name: 'notes.txt', kind: 'file' },
      ],
    },
  )
  const groups = await readPluginAgents(reader, `${home}/.claude`)
  expect(groups.map(group => group.plugin)).toEqual(['ecc'])
  expect(groups[0]?.agents).toEqual([{ name: 'planner', model: 'claude-opus-4-7', description: 'Plans work' }])
})

test('plugin agents: no installed list means no plugin groups, not an error', async () => {
  expect(await readPluginAgents(fakeReader({}, {}), 'C:/Users/dev/.claude')).toEqual([])
})

test('definitions: a missing folder is empty, and a file without frontmatter takes its file name', async () => {
  const reader = fakeReader(
    { 'C:/p/agents/bare.md': 'no frontmatter here' },
    { 'C:/p/agents': [{ name: 'bare.md', kind: 'file' }] },
  )
  expect(await readDefinitions(reader, 'C:/p/agents')).toEqual([{ name: 'bare', model: null, description: '' }])
  expect(await readDefinitions(reader, 'C:/missing')).toEqual([])
})

test('files group under their directory; root files sit under (raiz)', () => {
  const groups = groupByDirectory([
    { code: 'M', path: 'src/b.ts', added: 1, removed: 0 },
    { code: 'M', path: 'a.md', added: 2, removed: 0 },
    { code: 'M', path: 'src/a.ts', added: 3, removed: 1 },
  ])
  expect(groups.map(group => group.directory)).toEqual(['(raiz)', 'src'])
  expect(groups[1]?.files.map(file => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
})

test('files card: caps the rows, footers the totals, and names the fallback outside git', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    code: 'M',
    path: `dir${index}/f.ts`,
    added: 1,
    removed: 1,
  }))
  const plain = toPlain(fileRows(many, [], 40), 40)
  expect(plain[plain.length - 1]).toBe('20 arquivos · +20 −20')
  expect(plain.some(row => row.includes('+14 arquivos'))).toBe(true)
  const fallback = toPlain(fileRows(null, [{ path: 'a.ts', added: 1, removed: 0 }], 40), 40)
  expect(fallback[0]).toBe('sessão (sem git): só Edit/Write')
})
