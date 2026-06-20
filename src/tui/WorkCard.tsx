// ============================================================================
// WorkCard — the 作品 end-card: a run distilled into a framed, shareable
// artifact (aesthetic «极简卡片»). Presentation ONLY; every value comes from the
// already-honest PanelModel. This is the "成品" surface (distinct from the live
// instrument panel) — the thing you screenshot / export.
//
// Honesty contract (mirrors App's finale):
//   • hero = panel laborSteps (Σ bars) — the SAME number the panel shows.
//   • 0 (你亲手) is structurally true: a human turn never carries tool_use.
//   • 「包括」is a highlighted SUBSET, never claimed to sum to the hero.
//   • errors are dim, NOT red — RED is for live alarm; a retrospective
//     "didn't stop" is resilience, not an alert (the v6 finale stance).
// ============================================================================
import { Box, Text } from 'ink';
import type { PanelModel } from './viewModel.ts';
import { bigNumber } from './bignum.ts';
import { INK } from './palette.ts';

const STAT_SHORT: Record<string, string> = {
  reads: '读',
  edits: '改',
  writes: '写',
  commands: '命令',
  helpers: '帮手',
  errors: '报错没停',
  wipes: '清洗',
};

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export function WorkCard({ model }: { model: PanelModel }) {
  const fin = model.finale;
  const big = bigNumber(String(model.laborSteps));
  const stats = fin?.stats ?? [];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={INK.dim}
      paddingX={3}
      paddingY={1}
      alignSelf="flex-start"
    >
      {model.intent && (
        <Box marginBottom={1}>
          <Text dimColor>愿望 · </Text>
          <Text>{clip(model.intent, 20)}</Text>
        </Box>
      )}

      <Text dimColor>它替你跑了</Text>
      {big.map((row, i) => (
        <Text key={i} color={INK.tool} bold>
          {row}
        </Text>
      ))}
      <Box>
        <Text dimColor>步　·　你亲手 </Text>
        <Text color={INK.human} bold>
          0
        </Text>
        <Text dimColor> 步</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          包括 {stats.map((s) => `${s.value}${STAT_SHORT[s.key] ?? s.key}`).join('·')}
        </Text>
      </Box>
      <Box>
        <Text dimColor>{fin?.duration ?? model.duration ?? ''}　·　</Text>
        <Text color={INK.ok}>✓ 数据来自真实记录</Text>
      </Box>
    </Box>
  );
}
