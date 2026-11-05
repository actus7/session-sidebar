// Cards: each section is a bordered box with padding and a gap below it. The
// border and padding take CARD_CHROME columns; the rows fit what is left.
import { padEnd, toPlain, type Line } from './text'

// A card with an `id` has a title row that expands and collapses it.
export type Card = { id?: string; rows: Line[] }

const BORDER_COLUMNS = 2
const PADDING_COLUMNS = 2
export const CARD_CHROME = BORDER_COLUMNS + PADDING_COLUMNS

export function cardInnerWidth(width: number): number {
  return Math.max(width - CARD_CHROME, 1)
}

// The cards as a terminal shows them with a round border: a gap between cards,
// the border drawn in box characters, one padded row per line of content.
export function cardsToPlain(cards: Card[], width: number): string[] {
  const inner = cardInnerWidth(width)
  const edge = '─'.repeat(width - BORDER_COLUMNS)
  const out: string[] = []
  cards.forEach((card, index) => {
    if (index > 0) out.push('')
    out.push(`╭${edge}╮`)
    for (const row of toPlain(card.rows, inner)) out.push(`│ ${padEnd(row, inner)} │`)
    out.push(`╰${edge}╯`)
  })
  return out
}
