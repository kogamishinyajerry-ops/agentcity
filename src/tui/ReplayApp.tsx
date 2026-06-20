// ============================================================================
// ReplayApp — the interactive Ink shell, Claude-Code style: ONE input bar drives
// everything (type a seq to jump, or card / export / play / ? / q), with ← →
// stepping. The pure replay reducer owns the playhead; this is the thin glue
// between typed commands and that reducer.
// ============================================================================
import { useEffect, useMemo, useReducer, useState } from 'react';
import { writeFileSync } from 'node:fs';
import { Box, useApp, useInput } from 'ink';
import type { ParsedSession } from '../model/types.ts';
import { buildPanelModel } from './viewModel.ts';
import { App } from './App.tsx';
import { WorkCard } from './WorkCard.tsx';
import { InputBar } from './InputBar.tsx';
import { renderCardSvg } from '../export/cardSvg.ts';
import { parseCommand } from './command.ts';
import {
  AUTOPLAY_TICK_MS,
  autoplayStride,
  clampIdx,
  replayReducer,
  type ReplayCtx,
} from './replay.ts';

const SVG_OUT = 'agentcity-card.svg';

export function ReplayApp({ session, startIdx = 0 }: { session: ParsedSession; startIdx?: number }) {
  const events = session.events;
  const len = events.length;
  const ctx: ReplayCtx = useMemo(
    () => ({ len, events, stride: autoplayStride(len) }),
    [len, events]
  );
  const [state, dispatch] = useReducer(
    (s: Parameters<typeof replayReducer>[0], a: Parameters<typeof replayReducer>[1]) =>
      replayReducer(s, a, ctx),
    { idx: clampIdx(startIdx, len), playing: false }
  );
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [showCard, setShowCard] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  function run(raw: string) {
    const cmd = parseCommand(raw);
    if (!cmd) return;
    switch (cmd.type) {
      case 'jump': {
        const idx = events.findIndex((e) => e.seq >= cmd.seq);
        dispatch({ type: 'jump', idx: idx < 0 ? len - 1 : idx });
        break;
      }
      case 'card':
        setShowCard((v) => !v);
        break;
      case 'export':
        writeFileSync(SVG_OUT, renderCardSvg(buildPanelModel(session)), 'utf8');
        setSavedTo(SVG_OUT);
        break;
      case 'play':
        dispatch({ type: 'togglePlay' });
        break;
      case 'error':
        dispatch({ type: 'errNext' });
        break;
      case 'start':
        dispatch({ type: 'home' });
        break;
      case 'end':
        dispatch({ type: 'end' });
        break;
      case 'help':
        setShowHelp((v) => !v);
        break;
      case 'quit':
        exit();
        break;
    }
  }

  useInput((ch, key) => {
    if (key.return) {
      run(input);
      setInput('');
    } else if (key.escape) {
      input ? setInput('') : exit();
    } else if (key.ctrl && ch === 'c') {
      exit();
    } else if (key.leftArrow) {
      dispatch({ type: 'left' });
    } else if (key.rightArrow) {
      dispatch({ type: 'right' });
    } else if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
    } else if (ch && !key.ctrl && !key.meta) {
      setInput((v) => v + ch);
    }
  });

  useEffect(() => {
    if (!state.playing) return;
    const t = setInterval(() => dispatch({ type: 'tick' }), AUTOPLAY_TICK_MS);
    return () => clearInterval(t);
  }, [state.playing]);

  const seq = len ? events[clampIdx(state.idx, len)].seq : 0;
  const lastSeq = len ? events[len - 1].seq : 0;
  const model = buildPanelModel(session, seq);
  const status = showCard
    ? '成品卡 · 输入 card 返回'
    : `${state.playing ? '▸ ' : ''}seq ${seq}/${lastSeq}`;

  return (
    <Box flexDirection="column">
      {showCard ? <WorkCard model={buildPanelModel(session)} /> : <App model={model} />}
      <InputBar value={input} status={status} showHelp={showHelp} saved={savedTo} />
    </Box>
  );
}
