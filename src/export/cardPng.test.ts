// The PNG-carrier verify path: a shareable raster carries its own SVG source, and
// `verify:card` extracts + verifies THAT (never the pixels). These tests prove the
// extract→oracle round-trip and that every fail-closed door is shut — no rasterizer
// needed (the carrier is built in-memory), so CI-safe.
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeProvenance, type CardMetrics } from '../model/provenance.ts';
import type { PanelModel } from '../tui/viewModel.ts';
import { loadCardSvg, verifyAgainstTranscript } from './cardProvenance.ts';
import { renderCardSvg } from './cardSvg.ts';
import { embedText, SVG_KEYWORD } from './pngChunks.ts';

// --- a real 1×1 PNG to act as the raster carrier (zlib IDAT, manual CRC) --------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makePng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const idat = deflateSync(Buffer.from([0, 0, 0, 0, 0xff]));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- a genuine card, same builders the verify-logic tests use -------------------
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
    sessionId: 'sess-xyz', schemaVersions: ['1.0'], startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T02:00:00Z',
    laborSteps: model.laborSteps, stats: (model.finale?.stats ?? []).map((s) => ({ key: s.key, value: s.value })),
    wish: model.intent ?? null, durationText: model.finale?.duration ?? model.duration ?? null,
  };
}
function genuineCard() {
  const model = makeModel();
  const provenance = makeProvenance('bytes', 'transcript-hash-1', 3, metricsFor(model));
  const svg = renderCardSvg(model, provenance);
  return { model, provenance, svg };
}

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'ac-png-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('verifiable PNG carrier (loadCardSvg + verify)', () => {
  it('verifies a genuine card embedded in a PNG (the share path)', () => {
    withTmp((dir) => {
      const { model, provenance, svg } = genuineCard();
      const carrier = embedText(makePng(), SVG_KEYWORD, svg);
      const p = join(dir, 'card.png');
      writeFileSync(p, carrier);
      const extracted = loadCardSvg(p);
      expect(extracted).toBe(svg);
      expect(verifyAgainstTranscript(extracted, { provenance, model }).ok).toBe(true);
    });
  });

  it('rejects a PNG whose embedded SVG was tampered (hero numeral edited)', () => {
    withTmp((dir) => {
      const { model, provenance, svg } = genuineCard();
      const tampered = svg.replace(/(id="ac-hero"[^>]*>)611/, '$16110');
      const p = join(dir, 'bad.png');
      writeFileSync(p, embedText(makePng(), SVG_KEYWORD, tampered));
      const r = verifyAgainstTranscript(loadCardSvg(p), { provenance, model });
      expect(r.ok).toBe(false);
    });
  });

  it('fail-closed: a PNG with no embedded card SVG throws (never verifies pixels)', () => {
    withTmp((dir) => {
      const p = join(dir, 'plain.png');
      writeFileSync(p, makePng());
      expect(() => loadCardSvg(p)).toThrow(/没有嵌入/);
    });
  });

  it('a raw .svg file passes through loadCardSvg unchanged', () => {
    withTmp((dir) => {
      const { svg } = genuineCard();
      const p = join(dir, 'card.svg');
      writeFileSync(p, svg, 'utf8');
      expect(loadCardSvg(p)).toBe(svg);
    });
  });

  // --- regression guards for the two attacks the audit hand-verified ----------
  // These keep the fail-closed doors shut if someone later "improves" readText.

  it('fail-closed: a COMPRESSED iTXt (compFlag=1) carrying our keyword is NOT read', () => {
    // We only ever WRITE uncompressed; readText must refuse compressed payloads
    // (we never decompress), so an attacker can't smuggle a card via a zlib iTXt.
    const kw = Buffer.from(SVG_KEYWORD, 'latin1');
    const payload = deflateSync(Buffer.from('<svg>fake</svg>', 'utf8'));
    const data = Buffer.concat([kw, Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00]), payload]); // compFlag=1
    const itxt = chunk('iTXt', data);
    const base = makePng();
    const iend = base.indexOf(Buffer.from('IEND', 'latin1')) - 4;
    const png = Buffer.concat([base.subarray(0, iend), itxt, base.subarray(iend)]);
    withTmp((dir) => {
      const p = join(dir, 'compressed.png');
      writeFileSync(p, png);
      expect(() => loadCardSvg(p)).toThrow(/没有嵌入/); // compFlag!=0 → readText null → throw
    });
  });

  it('fake-first multi-chunk: a tampered first chunk fails even with a genuine chunk after it', () => {
    withTmp((dir) => {
      const { model, provenance, svg } = genuineCard();
      const tampered = svg.replace(/(id="ac-hero"[^>]*>)611/, '$16110');
      // file order = first-embedded ... last-embedded (each spliced before IEND);
      // readText is first-wins, so the attacker puts the tampered SVG FIRST.
      let png = embedText(makePng(), SVG_KEYWORD, tampered);
      png = embedText(png, SVG_KEYWORD, svg); // genuine, but second → not read
      const p = join(dir, 'fakefirst.png');
      writeFileSync(p, png);
      expect(verifyAgainstTranscript(loadCardSvg(p), { provenance, model }).ok).toBe(false);
    });
  });
});
