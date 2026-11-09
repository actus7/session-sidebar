import type { ChangedFile, FileChange } from '../types'
import { sortByDirectory } from './git'
import { cap, dimLine, fit, middleElide, NO_VALUE, overflowLine, padStart, type Line, type Tone } from './text'

const MAX_BODY_ROWS = 12
const COUNT_WIDTH = 6
const ROOT_LABEL = '(raiz)'
const FALLBACK_CODE = '~'
const CODE_TONE: Record<string, Tone> = { M: 'warning', A: 'success', D: 'error', R: 'strong', '?': 'dim' }

export type DirectoryGroup = { directory: string; files: ChangedFile[] }

// Files grouped under their directory, in directory order.
export function groupByDirectory(files: ChangedFile[]): DirectoryGroup[] {
  const groups: DirectoryGroup[] = []
  for (const file of sortByDirectory(files)) {
    const cut = file.path.lastIndexOf('/')
    const directory = cut === -1 ? ROOT_LABEL : file.path.slice(0, cut)
    const last = groups[groups.length - 1]
    if (last?.directory === directory) last.files.push(file)
    else groups.push({ directory, files: [file] })
  }
  return groups
}

function countCell(count: number | null, sign: string): string {
  return padStart(count === null ? NO_VALUE : `${sign}${count}`, COUNT_WIDTH)
}

function fileRow(file: ChangedFile, width: number): Line {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1)
  const added = countCell(file.added, '+')
  const removed = countCell(file.removed, '−')
  const codeWidth = 2
  const nameWidth = width - codeWidth - COUNT_WIDTH * 2 - 2
  return {
    left: [
      { text: `  ${file.code} `, tone: CODE_TONE[file.code] ?? 'dim' },
      { text: middleElide(name, nameWidth), tone: 'plain' },
    ],
    right: [
      { text: added, tone: file.added === null ? 'dim' : 'success' },
      { text: ' ', tone: 'plain' },
      { text: removed, tone: file.removed === null ? 'dim' : 'error' },
    ],
  }
}

function directoryRow(directory: string, width: number): Line {
  return dimLine(fit(`${directory}/`, width), width)
}

function totals(files: ChangedFile[], width: number): Line {
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0)
  const removed = files.reduce((sum, file) => sum + (file.removed ?? 0), 0)
  return dimLine(fit(`${files.length} arquivos · +${added} −${removed}`, width), width)
}

// The body of the files card: directory headers, indented files with their
// counts, a cap on rows, and a totals footer. Outside git it says so.
export function fileRows(git: ChangedFile[] | null, sessionFiles: FileChange[], width: number, isMore = false): Line[] {
  const maxRows = cap(MAX_BODY_ROWS, isMore)
  const isFallback = git === null
  const files: ChangedFile[] = git ?? sessionFiles.map(file => ({ code: FALLBACK_CODE, ...file }))
  const label = isFallback ? [dimLine('sessão (sem git): só Edit/Write', width)] : []
  if (files.length === 0) return [...label, dimLine('nenhuma alteração', width)]

  const body: Line[] = []
  let shownFiles = 0
  for (const group of groupByDirectory(files)) {
    if (body.length + 1 >= maxRows) break
    body.push(directoryRow(group.directory, width))
    for (const file of group.files) {
      if (body.length >= maxRows) break
      body.push(fileRow(file, width))
      shownFiles += 1
    }
  }
  return [
    ...label,
    ...body,
    ...overflowLine(files.length - shownFiles, 'arquivos', width),
    totals(files, width),
  ]
}
