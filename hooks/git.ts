import type { EngineInterface } from 'claude-code'

import type { ChangedFile } from '../types'
import { countLines } from './text'

const GIT_TIMEOUT_MS = 5000
const UNTRACKED_READ_LIMIT = 200

type Entry = { code: string; path: string }
type Counts = { added: number | null; removed: number | null }

const LETTER_OF: Record<string, string> = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'A', T: 'M', U: 'M' }
const RENAME_LETTERS = ['R', 'C']
const MIN_ENTRY_LENGTH = 4
const NUMSTAT_FIELDS = 3
const NOT_COUNTED = '-'

function letterOf(xy: string): string {
  if (xy === '??') return '?'
  const letter = xy[0] !== ' ' ? xy[0] : xy[1]
  return LETTER_OF[letter ?? ''] ?? 'M'
}

// `git status --porcelain=v1 -z`: "XY path" per NUL token. A rename or copy is
// followed by one more token, its old path, which is skipped.
export function parsePorcelainZ(output: string): Entry[] {
  const tokens = output.split('\0')
  const entries: Entry[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (token.length < MIN_ENTRY_LENGTH) continue
    const xy = token.slice(0, 2)
    entries.push({ code: letterOf(xy), path: token.slice(3) })
    if (RENAME_LETTERS.some(letter => xy.includes(letter))) index += 1
  }
  return entries
}

function toCount(text: string): number | null {
  if (text === NOT_COUNTED) return null
  const value = Number(text)
  return Number.isNaN(value) ? null : value
}

// `git diff --numstat -z HEAD`: "added\tremoved\tpath" per NUL token. A rename
// has an empty path field and is followed by the old and the new path tokens.
// Keyed by the new path, which is the one `git status` reports.
export function parseNumstatZ(output: string): Map<string, Counts> {
  const tokens = output.split('\0')
  const counts = new Map<string, Counts>()
  for (let index = 0; index < tokens.length; index += 1) {
    const fields = (tokens[index] ?? '').split('\t')
    if (fields.length < NUMSTAT_FIELDS) continue
    let path = fields[2] ?? ''
    if (path === '') {
      path = tokens[index + 2] ?? ''
      index += 2
    }
    counts.set(path, { added: toCount(fields[0] ?? ''), removed: toCount(fields[1] ?? '') })
  }
  return counts
}

// Untracked files have no diff: their lines are counted, and they removed none.
export function mergeChanged(
  entries: Entry[],
  counts: Map<string, Counts>,
  untrackedLines: Map<string, number | null>,
): ChangedFile[] {
  return entries.map(entry => {
    if (entry.code === '?') {
      return { code: '?', path: entry.path, added: untrackedLines.get(entry.path) ?? null, removed: 0 }
    }
    const count = counts.get(entry.path)
    return { code: entry.code, path: entry.path, added: count?.added ?? null, removed: count?.removed ?? null }
  })
}

function directoryOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

// Sorted by directory, then by file name, so a folder's files sit together.
export function sortByDirectory<T extends { path: string }>(list: T[]): T[] {
  return [...list].sort((left, right) => {
    const byDirectory = directoryOf(left.path).localeCompare(directoryOf(right.path))
    if (byDirectory !== 0) return byDirectory
    return left.path.localeCompare(right.path)
  })
}

async function linesOf($: EngineInterface, path: string): Promise<number | null> {
  try {
    const text = await $.fs.read(path)
    return text.includes('\0') ? null : countLines(text)
  } catch {
    // Too large to read or gone since git listed it: shown as unknown.
    return null
  }
}

async function countUntracked($: EngineInterface, paths: string[]): Promise<Map<string, number | null>> {
  const pairs = await Promise.all(
    paths.slice(0, UNTRACKED_READ_LIMIT).map(async path => [path, await linesOf($, path)] as const),
  )
  return new Map(pairs)
}

// The working tree against HEAD. Null when the folder is not a git repository;
// undefined when git could not run at all, so the caller keeps what it had.
export async function readChangedFiles($: EngineInterface): Promise<ChangedFile[] | null | undefined> {
  try {
    const [status, diff] = await Promise.all([
      $.process.run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeoutMs: GIT_TIMEOUT_MS }),
      $.process.run(['git', 'diff', '--numstat', '-z', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS }),
    ])
    if (status.exitCode !== 0) return null
    const counts = diff.exitCode === 0 ? parseNumstatZ(diff.stdout) : new Map<string, Counts>()
    const entries = parsePorcelainZ(status.stdout)
    const untracked = await countUntracked(
      $,
      entries.filter(entry => entry.code === '?').map(entry => entry.path),
    )
    return sortByDirectory(mergeChanged(entries, counts, untracked))
  } catch (error) {
    $.ui.log(`session-sidebar: git status unavailable: ${String(error)}`)
    return undefined
  }
}

// The checked-out branch. Null outside a git repository; undefined when git
// could not run, so the caller keeps what it had.
export async function readBranch($: EngineInterface): Promise<string | null | undefined> {
  try {
    const result = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS })
    return result.exitCode === 0 ? result.stdout.trim() : null
  } catch (error) {
    $.ui.log(`session-sidebar: git branch unavailable: ${String(error)}`)
    return undefined
  }
}
