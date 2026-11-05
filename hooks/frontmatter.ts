export type Frontmatter = { name?: string; model?: string; description?: string }

const FIELD = /^([A-Za-z_-]+):\s*(.*)$/
const BLOCK_MARKERS = ['>', '|', '']
const INDENTED = /^\s+\S/

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted?.[2] ?? value
}

// Reads the top-level `key: value` fields of a leading `---` block only. The
// body below it is never looked at. A folded or literal block ( > or | ) is
// joined into one line.
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) return {}

  const fields: Record<string, string> = {}
  for (let index = 1; index < end; index += 1) {
    const match = FIELD.exec(lines[index] ?? '')
    if (!match) continue
    let value = (match[2] ?? '').trim()
    if (BLOCK_MARKERS.includes(value)) {
      const block: string[] = []
      while (index + 1 < end && INDENTED.test(lines[index + 1] ?? '')) {
        index += 1
        block.push((lines[index] ?? '').trim())
      }
      value = block.join(' ')
    }
    fields[match[1] ?? ''] = unquote(value)
  }
  return { name: fields.name, model: fields.model, description: fields.description }
}
