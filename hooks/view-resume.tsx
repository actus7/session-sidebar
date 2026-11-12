import type { EngineInterface } from 'claude-code'

import { formatClock, RESUME_TEXT } from './resume'

type Elements = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text' | 'Button'>

export type ResumeState = {
  isOn: boolean
  quota: number
  plannedAt: number | null
  isConfirming: boolean
}

export type ResumeActions = {
  onToggle: () => void
  onReset: () => void
  onConfirm: () => void
  onCancel: () => void
}

// The first rows of the LIMITES card: the toggle, the quota with its
// "Redefinir" (confirmed inline), and the pending resume when there is one.
export function renderResume(els: Elements, state: ResumeState, actions: ResumeActions) {
  const { Box, Text, Button } = els
  const quotaRow = state.isConfirming ? (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      <Text>Redefinir resets?</Text>
      <Button key="resume-confirm" plain onPress={actions.onConfirm}>
        <Text color="warning">[Sim]</Text>
      </Button>
      <Button key="resume-cancel" plain onPress={actions.onCancel}>
        <Text dimColor>[Não]</Text>
      </Button>
    </Box>
  ) : (
    <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between">
      <Text color={state.quota === 0 ? 'error' : undefined}>{`Resets disponíveis: ${state.quota}`}</Text>
      <Button key="resume-reset" plain onPress={actions.onReset}>
        <Text color="claude">[Redefinir]</Text>
      </Button>
    </Box>
  )

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" justifyContent="center">
        <Button key="resume-toggle" plain onPress={actions.onToggle}>
          <Text>{`${state.isOn ? '[x]' : '[ ]'} Retomar ao resetar`}</Text>
        </Button>
      </Box>
      {quotaRow}
      {state.plannedAt !== null && (
        <Text color="warning">{`⏳ envia "${RESUME_TEXT}" às ${formatClock(state.plannedAt)}`}</Text>
      )}
    </Box>
  )
}
