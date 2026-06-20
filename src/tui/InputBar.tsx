// ============================================================================
// InputBar — the single Claude-Code-style command bar. A rounded box with a
// prompt; you TYPE (a seq to jump, or card / export / play / ? / q) and Enter.
// No shortcut list, no play/pause badge — shortcuts live behind `?`. A fixed
// content column (COLUMN) so the bar reads as part of the panel, not a sprawl;
// below it one justified status line (position left, the persistent ? hint —
// or a just-exported confirmation — right). Presentation only.
// ============================================================================
import { Box, Text } from 'ink';
import { INK } from './palette.ts';

export const COLUMN = 78;
const PLACEHOLDER = '输入 seq 跳转,或 ? 看命令';

export function InputBar({
  value,
  status,
  showHelp,
  saved,
}: {
  value: string;
  status: string;
  showHelp: boolean;
  saved: string | null;
}) {
  return (
    <Box flexDirection="column" marginTop={1} width={COLUMN}>
      {showHelp && (
        <Box flexDirection="column" marginBottom={1} paddingX={1}>
          <Text dimColor>
            命令 · <Text color={INK.human}>数字</Text>=跳到该 seq · <Text color={INK.human}>card</Text>
            =成品卡 · <Text color={INK.human}>export</Text>=导出 SVG · <Text color={INK.human}>play</Text>
            =回放
          </Text>
          <Text dimColor>
            {'     '}
            <Text color={INK.human}>error</Text>=跳报错 · <Text color={INK.human}>start/end</Text>=首尾 ·{' '}
            <Text color={INK.human}>← →</Text>=步进 · <Text color={INK.human}>q</Text>=退出
          </Text>
        </Box>
      )}

      <Box borderStyle="round" borderColor={INK.dim} paddingX={1} width={COLUMN}>
        <Text color={INK.human}>› </Text>
        {value ? (
          <Text>
            {value}
            <Text color={INK.human}>▌</Text>
          </Text>
        ) : (
          <Text dimColor>{PLACEHOLDER}</Text>
        )}
      </Box>

      <Box width={COLUMN} paddingX={1} justifyContent="space-between">
        <Text dimColor>{status}</Text>
        {saved ? (
          <Text color={INK.ok}>✓ 已导出 {saved}</Text>
        ) : (
          <Text dimColor>? 命令</Text>
        )}
      </Box>
    </Box>
  );
}
