import type { EngineInterface } from 'claude-code'

import type { FileChange } from '../types'

const MAX_FILES_KEPT = 50

// The most recently changed file first; one entry per path, its counts summed.
export function addChange(list: FileChange[], change: FileChange): FileChange[] {
  const previous = list.find(one => one.path === change.path)
  const merged: FileChange = {
    path: change.path,
    added: (previous?.added ?? 0) + change.added,
    removed: (previous?.removed ?? 0) + change.removed,
  }
  return [merged, ...list.filter(one => one.path !== change.path)].slice(
    0,
    MAX_FILES_KEPT,
  )
}

// A file that does not exist yet (or is too large to read) counts as empty.
export async function readBefore(
  $: EngineInterface,
  path: string,
): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}
