// ============================================================================
// App — the Ink instrument panel (layout B). Presentation ONLY.
// ----------------------------------------------------------------------------
// Consumes a PanelModel (already honest + presentation-free) and renders it.
// Colour language lives in palette.ts (semantic tokens): human = a command just
// landed · tool = activity / the labor count · FIRE = LIVE error only · ok =
// provenance. The inline finale deliberately does NOT fire its "报错没停下"
// stat — RED is live alarm; a retrospective "didn't stop" is resilience (v6).
// ============================================================================
import { Box, Text } from 'ink';
import type { SpotlightAccent } from '../render/seekState.ts';
import type { BarRow, PanelModel } from './viewModel.ts';
import { barString } from './bars.ts';
import { INK } from './palette.ts';
import { clipCols } from './width.ts';
import { STAT_SHORT } from '../model/tally.ts';

const BAR_WIDTH = 24;
const LABEL_WIDTH = 13;

function accentColor(a: SpotlightAccent): string | undefined {
  return a === 'human' ? INK.human : a === 'tool' ? INK.tool : undefined;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function BarLine({ b, max }: { b: BarRow; max: number }) {
  const bar = barString(b.calls, max, BAR_WIDTH);
  const fill = accentColor(b.accent);
  return (
    <Box>
      <Text color={b.active ? fill : undefined}>{pad(b.label, LABEL_WIDTH)}</Text>
      <Text color={b.active ? fill : INK.dim}>{pad(bar, BAR_WIDTH)}</Text>
      <Text bold> {String(b.calls).padStart(4)}</Text>
      <Text dimColor>  {b.desc}</Text>
      {b.fails > 0 && <Text color={INK.fire}> 🔥×{b.fails}</Text>}
      {b.active && <Text color={fill}> ●</Text>}
    </Box>
  );
}

export function App({ model }: { model: PanelModel }) {
  const m = model;
  const fin = m.finale;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>agentcity</Text>
        <Text dimColor>
          {'  '}
          {m.model ?? ''}
          {m.duration ? ` · ${m.duration}` : ''}
        </Text>
      </Box>

      {m.intent && (
        <Box marginTop={1}>
          <Text color={INK.human}>愿望  </Text>
          <Text>{clipCols(m.intent, 70)}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>它替你跑了 </Text>
        <Text color={INK.tool} bold>
          {m.laborSteps}
        </Text>
        <Text> 步   ·   你亲手 </Text>
        <Text color={INK.human} bold>
          0
        </Text>
        <Text dimColor> 步</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          WORKLOAD · 长度=真实调用量{'        '}seq {m.seqPos.seq}/{m.seqPos.total}
        </Text>
      </Box>
      {m.bars.map((b) => (
        <BarLine key={b.district} b={b} max={m.maxCalls} />
      ))}

      {m.now && (
        <Box marginTop={1}>
          <Text dimColor>{m.atEnd ? '最后一步  ' : '此刻  '}</Text>
          <Text color={m.now.isError ? INK.fire : m.now.isHuman ? INK.human : INK.tool}>
            {m.now.districtLabel} ›{' '}
          </Text>
          <Text>{clipCols(m.now.label, 52)}</Text>
          {m.now.isError && <Text color={INK.fire}>  🔥 报错</Text>}
        </Box>
      )}

      {m.narration && (
        <Box>
          <Text dimColor>旁白  </Text>
          <Text
            color={m.narration.drama ? INK.drama : undefined}
            bold={m.narration.drama}
            dimColor={!m.narration.drama}
            italic
          >
            {m.narration.text}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {m.footer.calls} 调用 · {m.footer.edits} 改/写 ·{' '}
        </Text>
        <Text color={m.footer.fails > 0 ? INK.fire : INK.dim}>{m.footer.fails} 报错</Text>
        <Text dimColor>
          {' '}
          · {m.footer.wipes} 次记忆清洗 · {m.footer.files} 文件 · {m.footer.cardsDone} 卡完成 ✓
        </Text>
      </Box>

      {fin && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>收工 · {fin.duration ?? '—'}   </Text>
            <Text color={INK.ok}>✓ 全程真实</Text>
          </Box>
          <Box marginTop={1}>
            <Text>你亲手 </Text>
            <Text color={INK.human} bold>
              0
            </Text>
            <Text> 步   →   它替你 </Text>
            <Text color={INK.tool} bold>
              {fin.laborSteps}
            </Text>
            <Text> 步</Text>
          </Box>
          <Box>
            <Text dimColor>包括 </Text>
            {fin.stats.map((s, i) => (
              <Text key={s.key} dimColor>
                {s.value} {STAT_SHORT[s.key] ?? s.key}
                {i === fin.stats.length - 1 ? '' : ' · '}
              </Text>
            ))}
          </Box>

          {fin.journey.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>
                一路走来{fin.journeyTotal > fin.journey.length ? `  ·  共 ${fin.journeyTotal} 个转折` : ''}
              </Text>
              {fin.journey.map((b, i) => (
                <Box key={i}>
                  <Text color={INK.dim}>{i === fin.journey.length - 1 ? '  └ ' : '  ├ '}</Text>
                  <Text color={b.drama ? INK.drama : undefined} dimColor={!b.drama}>
                    {clipCols(b.text, 56)}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor italic>
              {fin.punchline}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
