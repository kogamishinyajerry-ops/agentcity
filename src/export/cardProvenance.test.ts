// Verify-logic tests: mostly pure (hand-built model/provenance/SVG, no fixture)
// so the tamper-detection oracle is covered everywhere — it now binds the ENTIRE
// visible face, not just the hero numeral. A real round-trip runs behind the
// fixture gate where the private sample is present.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeReceipt, makeProvenance, toReceipt, type CardMetrics } from '../model/provenance.ts';
import type { PanelModel } from '../tui/viewModel.ts';
import {
  computeCardProvenance,
  enumerateInputs,
  extractById,
  hashInputSet,
  parseReceiptFromSvg,
  verifyAgainstTranscript,
} from './cardProvenance.ts';
import { renderCardSvg } from './cardSvg.ts';

// --- minimal model/provenance builders (cardFace only reads these fields) -----
function makeModel(over: Partial<PanelModel> = {}): PanelModel {
  return {
    intent: '通关杀戮尖塔',
    laborSteps: 611,
    duration: '1 小时',
    finale: { duration: '1 小时', laborSteps: 611, stats: [{ key: 'edits', value: 94 }, { key: 'reads', value: 16 }], punchline: '' },
    ...over,
  } as unknown as PanelModel;
}
function metricsFor(model: PanelModel): CardMetrics {
  return {
    sessionId: 'sess-xyz',
    schemaVersions: ['1.0'],
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T02:00:00Z',
    laborSteps: model.laborSteps,
    stats: (model.finale?.stats ?? []).map((s) => ({ key: s.key, value: s.value })),
    wish: model.intent ?? null,
    durationText: model.finale?.duration ?? model.duration ?? null,
  };
}
function build(over: Partial<PanelModel> = {}, hash = 'transcript-hash-1', inputCount = 3) {
  const model = makeModel(over);
  const provenance = makeProvenance('bytes', hash, inputCount, metricsFor(model));
  const svg = renderCardSvg(model, provenance);
  return { model, provenance, svg };
}
const setReceipt = (svg: string, b64: string) =>
  svg.replace(/(<metadata id="ac-prov">)[\s\S]*?(<\/metadata>)/, `$1${b64}$2`);

describe('verifyAgainstTranscript — untampered', () => {
  it('passes a freshly-rendered card', () => {
    const { model, provenance, svg } = build();
    expect(verifyAgainstTranscript(svg, { provenance, model }).ok).toBe(true);
  });
  it('passes when the run has no opening wish (no ac-wish line)', () => {
    const { model, provenance, svg } = build({ intent: null });
    expect(svg).not.toContain('ac-wish');
    expect(verifyAgainstTranscript(svg, { provenance, model }).ok).toBe(true);
  });
});

describe('verifyAgainstTranscript — visible-face tampering (the binding the review demanded)', () => {
  const failed = (svg: string, recomputed: { provenance: ReturnType<typeof makeProvenance>; model: PanelModel }, name: string) => {
    const r = verifyAgainstTranscript(svg, recomputed);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === name)!.ok).toBe(false);
  };

  it('catches an edited hero numeral', () => {
    const { model, provenance, svg } = build();
    failed(svg.replace(/(id="ac-hero"[^>]*>)611/, '$16110'), { provenance, model }, '卡面步数');
  });
  it('catches an edited wish (now via the whole-card gate)', () => {
    const { model, provenance, svg } = build();
    failed(svg.replace(/(id="ac-wish"[^>]*>)[^<]*/, '$1我没干过的事'), { provenance, model }, '卡面完整性');
  });
  it('catches an edited duration', () => {
    const { model, provenance, svg } = build();
    failed(svg.replace(/(id="ac-dur">)[^<]*/, '$1100 小时'), { provenance, model }, '卡面时长');
  });
  it('catches an edited 「包括」 detail line', () => {
    const { model, provenance, svg } = build();
    failed(svg.replace(/(id="ac-include"[^>]*>)[^<]*/, '$1包括 9999改'), { provenance, model }, '卡面明细');
  });
  it('catches an edited seal fingerprint', () => {
    const { model, provenance, svg } = build();
    failed(svg.replace(/(id="ac-seal">)[^<]*/, '$1deadbeefdead'), { provenance, model }, '卡面指纹');
  });
  it('catches a SECOND hero overlay (extractById is fail-closed on >1 match)', () => {
    const { model, provenance, svg } = build();
    const overlaid = svg.replace('</svg>', '<text id="ac-hero" x="60" y="252">9999</text></svg>');
    failed(overlaid, { provenance, model }, '卡面步数');
  });

  // N1/N2 (loop-auditor): the per-field id checks see only the 5 tagged elements,
  // so an EXTRA un-id'd visible <text> is invisible to them. The whole-card
  // completeness gate (卡面完整性) is what catches this class.
  it('catches an injected un-id\'d visible <text> (overlay headline)', () => {
    const { model, provenance, svg } = build();
    const overlay = svg.replace('</svg>', '<text x="60" y="120" font-size="40">我帮你赚了一百万</text></svg>');
    // every per-field check still passes — only the completeness gate fails:
    const r = verifyAgainstTranscript(overlay, { provenance, model });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === '卡面步数')!.ok).toBe(true);
    expect(r.checks.find((c) => c.name === '卡面完整性')!.ok).toBe(false);
  });
  it('catches a forged 愿望 line injected onto a NO-WISH card (the N1 fail-open)', () => {
    const { model, provenance, svg } = build({ intent: null });
    expect(svg).not.toContain('ac-wish'); // genuinely no wish line
    const forged = svg.replace('</svg>', '<text x="60" y="96" font-size="19">愿望 · 我帮你赚了一百万</text></svg>');
    failed(forged, { provenance, model }, '卡面完整性');
  });
});

describe('verifyAgainstTranscript — receipt / cross-transcript tampering', () => {
  it('fails when the SVG carries no valid receipt', () => {
    const { model, provenance, svg } = build();
    const stripped = svg.replace(/<metadata id="ac-prov">[\s\S]*?<\/metadata>/, '');
    expect(verifyAgainstTranscript(stripped, { provenance, model }).ok).toBe(false);
    expect(setReceipt.length).toBeGreaterThan(0); // (helper used below)
  });
  it('fails a metadata TRANSPLANT: card B visible face + card A genuine receipt', () => {
    // A = the transcript we verify against; B = a different run whose card we steal.
    const a = build({ intent: '真实愿望 A', laborSteps: 611 }, 'transcript-A');
    const b = build({ intent: '盗用愿望 B', laborSteps: 99999 }, 'transcript-B');
    // Splice A's genuine receipt into B's SVG (visible=B, receipt=A) and verify vs A.
    const transplanted = setReceipt(b.svg, encodeReceipt(toReceipt(a.provenance)));
    const r = verifyAgainstTranscript(transplanted, { provenance: a.provenance, model: a.model });
    expect(r.ok).toBe(false);
    // the receipt-vs-transcript checks PASS (receipt A is genuine for transcript A)…
    expect(r.checks.find((c) => c.name === '完整指纹')!.ok).toBe(true);
    // …but the visible face betrays it (it shows B, not A) — that's the whole point.
    expect(r.checks.find((c) => c.name === '卡面步数')!.ok).toBe(false);
  });
  it('fails when the receipt is internally inconsistent (fingerprint not re-derived)', () => {
    const { model, provenance, svg } = build();
    const tampered = setReceipt(svg, encodeReceipt({ ...toReceipt(provenance), transcriptHash: 'swapped' }));
    const r = verifyAgainstTranscript(tampered, { provenance, model });
    expect(r.checks.find((c) => c.name === '收据自洽')!.ok).toBe(false);
  });
  it('fails against a different transcript (hash mismatch)', () => {
    const { model, svg } = build();
    const other = makeProvenance('bytes', 'transcript-hash-2', 3, metricsFor(model));
    const r = verifyAgainstTranscript(svg, { provenance: other, model });
    expect(r.checks.find((c) => c.name === '原始字节指纹')!.ok).toBe(false);
  });
  it('flags a mode mismatch + an input-count mismatch', () => {
    const { model, svg } = build();
    const metricsMode = makeProvenance('metrics', 'transcript-hash-1', 1, metricsFor(model));
    const r = verifyAgainstTranscript(svg, { provenance: metricsMode, model });
    expect(r.checks.find((c) => c.name === '模式一致')!.ok).toBe(false);
    expect(r.checks.find((c) => c.name === '输入文件数')!.ok).toBe(false);
  });
});

// The CRITICAL determinism fix: a .jsonl's input set is the main file PLUS the
// whole sibling subagents/ tree, so subagent work is bound to the fingerprint and
// a single-file verify of a multi-agent card mismatches LOUDLY (输入文件数) rather
// than silently undercounting. Uses a real temp dir (no private fixture needed).
describe('enumerateInputs / hashInputSet (multi-agent input set is bound)', () => {
  it('enumerates main + the recursive subagents/ tree, hashes it, fails closed on drift', () => {
    const d = mkdtempSync(join(tmpdir(), 'ac-prov-'));
    try {
      const main = join(d, 'sess.jsonl');
      writeFileSync(main, '{"type":"x"}\n');
      const sub = join(d, 'sess', 'subagents');
      mkdirSync(join(sub, 'workflows', 'wf_1'), { recursive: true });
      writeFileSync(join(sub, 'agent-aaa.jsonl'), 'AAA\n');
      writeFileSync(join(sub, 'agent-aaa.meta.json'), '{}\n');
      writeFileSync(join(sub, 'workflows', 'wf_1', 'agent-bbb.jsonl'), 'BBB\n');

      const e1 = enumerateInputs(main);
      expect(e1.mode).toBe('bytes');
      expect(e1.files.map((f) => f.rel)).toEqual([
        'sess.jsonl',
        'sess/subagents/agent-aaa.jsonl',
        'sess/subagents/agent-aaa.meta.json',
        'sess/subagents/workflows/wf_1/agent-bbb.jsonl',
      ]); // sorted, relative → deterministic across machines

      const h1 = hashInputSet(e1.files);
      expect(hashInputSet(enumerateInputs(main).files)).toBe(h1); // stable

      // tampering ANY subagent file changes the transcript hash (work is bound)
      writeFileSync(join(sub, 'agent-aaa.jsonl'), 'AAA-TAMPERED\n');
      expect(hashInputSet(enumerateInputs(main).files)).not.toBe(h1);

      // losing the subagents tree drops the count → a single-file verify mismatches
      rmSync(join(d, 'sess'), { recursive: true });
      expect(enumerateInputs(main).files.length).toBe(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('terminates on a self-referential symlink cycle in the subagents tree', () => {
    const d = mkdtempSync(join(tmpdir(), 'ac-prov-sym-'));
    try {
      const main = join(d, 'sess.jsonl');
      writeFileSync(main, '{}\n');
      const sub = join(d, 'sess', 'subagents');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, 'agent-a.jsonl'), 'A\n');
      let linked = true;
      try {
        symlinkSync(sub, join(sub, 'loop')); // sub/loop -> sub : would loop without the realpath guard
      } catch {
        linked = false; // some envs forbid symlink creation — the normal walk still validates
      }
      // The call returning at all proves it terminated (the guard broke the cycle).
      const e = enumerateInputs(main);
      expect(e.files.some((f) => f.rel.endsWith('agent-a.jsonl'))).toBe(true);
      if (linked) expect(e.files.length).toBeLessThan(50); // no runaway re-descent of the alias
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// Fuzz the completeness gate's core invariant: ANY structural change to a genuine
// card (a non-whitespace edit, or an injected element) must fail verification — only
// trailing-whitespace / line-ending re-saves may still pass. A single false-accept
// here = a forgeable card. Deterministic (seeded LCG) so a failure is reproducible.
describe('verifyAgainstTranscript — fuzz: no structural mutation is a false accept', () => {
  const { model, provenance, svg } = build();
  const rec = { provenance, model };
  // seeded LCG → reproducible "randomness"
  let s = 0x2545f4914f6cdd1d % 2147483647;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const nonWs: number[] = [];
  for (let i = 0; i < svg.length; i++) if (!/\s/.test(svg[i])) nonWs.push(i);

  it('200 single-char edits at visible/structural bytes all fail', () => {
    let accepts = 0;
    for (let t = 0; t < 200; t++) {
      const pos = nonWs[Math.floor(rnd() * nonWs.length)];
      const orig = svg[pos];
      const repl = /[0-9]/.test(orig) ? String((Number(orig) + 1) % 10) : orig === 'X' ? 'Y' : 'X';
      const mutated = svg.slice(0, pos) + repl + svg.slice(pos + 1);
      if (mutated === svg) continue;
      if (verifyAgainstTranscript(mutated, rec).ok) accepts++;
    }
    expect(accepts).toBe(0);
  });

  it('100 injected elements at random positions all fail', () => {
    const payloads = [
      '<text x="60" y="120" font-size="40">我赚了一百万</text>',
      '<text id="ac-hero" x="60" y="252">999999</text>',
      '<foreignObject x="0" y="0" width="9" height="9"><div xmlns="http://www.w3.org/1999/xhtml">假</div></foreignObject>',
      '<tspan>x</tspan>',
    ];
    // inject only between top-level elements (after a '>' that precedes a '<') so the
    // SVG stays parseable — the strongest test (a malformed SVG fails trivially).
    const slots: number[] = [];
    for (let i = 0; i < svg.length - 1; i++) if (svg[i] === '>' && svg[i + 1] === '<') slots.push(i + 1);
    let accepts = 0;
    for (let t = 0; t < 100; t++) {
      const at = slots[Math.floor(rnd() * slots.length)];
      const pay = payloads[Math.floor(rnd() * payloads.length)];
      const mutated = svg.slice(0, at) + pay + svg.slice(at);
      if (verifyAgainstTranscript(mutated, rec).ok) accepts++;
    }
    expect(accepts).toBe(0);
  });

  it('benign re-saves (CRLF / trailing newline / trailing line-spaces) still verify', () => {
    expect(verifyAgainstTranscript(svg + '\n', rec).ok).toBe(true);
    expect(verifyAgainstTranscript(svg.replace(/\n/g, '\r\n'), rec).ok).toBe(true);
    expect(verifyAgainstTranscript(svg.replace(/\n/g, '  \n') + '\n\n', rec).ok).toBe(true);
  });
});

describe('SVG parse + extract (fail-closed)', () => {
  const { provenance, svg } = build();
  it('round-trips the embedded receipt', () => {
    expect(parseReceiptFromSvg(svg)).toEqual(toReceipt(provenance));
  });
  it('returns null when there is no metadata / for a non-receipt blob', () => {
    expect(parseReceiptFromSvg('<svg></svg>')).toBeNull();
    expect(parseReceiptFromSvg(setReceipt(svg, encodeReceipt({ v: 1 } as never)))).toBeNull();
  });
  it('extractById returns content for exactly-one, null for zero or many', () => {
    expect(extractById(svg, 'ac-hero')).toBe('611');
    expect(extractById(svg, 'ac-nope')).toBeNull();
    expect(extractById('<text id="x">a</text><text id="x">b</text>', 'x')).toBeNull();
  });
});

// Real end-to-end: export a card from the fixture, then verify it round-trips and
// that tampering a VISIBLE field (not just the hero) is caught. Skips on a fresh
// clone (no private sample).
const SAMPLE = 'sample/parsed-sample.json';
describe.skipIf(!existsSync(SAMPLE))('round-trip on the real sample', () => {
  it('a freshly-rendered card verifies; tampering the wish or the number is caught', () => {
    const { model, provenance } = computeCardProvenance(SAMPLE);
    const svg = renderCardSvg(model, provenance);
    expect(verifyAgainstTranscript(svg, { provenance, model }).ok).toBe(true);

    const numTamper = svg.replace(/(id="ac-hero"[^>]*>)\d+/, `$1${provenance.metrics.laborSteps + 1}`);
    expect(verifyAgainstTranscript(numTamper, { provenance, model }).ok).toBe(false);

    if (extractById(svg, 'ac-wish') != null) {
      const wishTamper = svg.replace(/(id="ac-wish"[^>]*>)[^<]*/, '$1伪造的愿望');
      expect(verifyAgainstTranscript(wishTamper, { provenance, model }).ok).toBe(false);
    }
  });
});
