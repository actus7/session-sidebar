import type { EngineInterface } from 'claude-code'

import type { Card } from './cards'
import type { Line, Part, Tone } from './text'

type Elements = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text' | 'Button'>

const TONE_COLOR: Partial<Record<Tone, 'claude' | 'warning' | 'error' | 'success'>> = {
  accent: 'claude',
  warning: 'warning',
  error: 'error',
  success: 'success',
}

// A part's own colour (a context category's) wins over its tone's.
function textProps(part: Part) {
  return {
    color: part.color ?? TONE_COLOR[part.tone],
    dimColor: part.tone === 'dim' || part.tone === 'title',
    weight: part.tone === 'strong' || part.tone === 'title' ? ('semibold' as const) : undefined,
  }
}

// Draws the cards from buildCards: each one a round-bordered box with padding
// and a margin below, its rows a left group and an optional right group. A card
// with an id draws its title row's left side as a Button that calls `onToggle`.
// `extras` are drawn right under the title row of the card with that id.
export function renderPane(
  els: Elements,
  cards: Card[],
  width: number,
  onToggle: (id: string) => void,
  onMore: (id: string) => void,
  extras: Record<string, JSX.Element> = {},
) {
  const { Box, Text, Button } = els
  const part = (value: Part, index: number) => (
    <Text key={String(index)} {...textProps(value)}>
      {value.text}
    </Text>
  )
  const row = (line: Line, index: number, id?: string) => (
    <Box key={String(index)} flexDirection="row" justifyContent="space-between">
      {id !== undefined && index === 0 ? (
        <Button key={`toggle-${id}`} plain onPress={() => onToggle(id)}>
          {line.left.map(part)}
        </Button>
      ) : id !== undefined && line.toggle !== undefined ? (
        <Button key={`more-${id}`} plain onPress={() => onMore(id)}>
          {line.left.map(part)}
        </Button>
      ) : (
        <Box flexDirection="row">{line.left.map(part)}</Box>
      )}
      <Box flexDirection="row">{(line.right ?? []).map(part)}</Box>
    </Box>
  )

  return (
    <Box flexDirection="column" width={width}>
      {cards.map((card, index) => (
        <Box
          key={String(index)}
          flexDirection="column"
          borderStyle="round"
          borderDimColor
          paddingX={1}
          marginBottom={1}
        >
          {card.rows.slice(0, 1).map((line, rowIndex) => row(line, rowIndex, card.id))}
          {card.id !== undefined && extras[card.id]}
          {card.rows.slice(1).map((line, rowIndex) => row(line, rowIndex + 1, card.id))}
        </Box>
      ))}
    </Box>
  )
}
