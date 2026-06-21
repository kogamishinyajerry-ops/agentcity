// The 作品 poster export must stay honest + well-formed: a single <svg> root,
// the panel's hero number, the real wish, a VERIFIABLE provenance fingerprint —
// and NEVER the alarm-red error colour (a finished run's errors are resilience).
//
// Driven by the SYNTHETIC session (src/test/synthSession.ts) through the REAL
// derivation path (computeCardProvenance), so these honesty assertions run on a
// fresh clone / in CI — the private transcript fixture is gitignored and would
// otherwise skip them all (green-but-empty, fatal for a credential).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synthSession, SYNTH_WISH } from '../test/synthSession.ts';
import { computeCardProvenance } from './cardProvenance.ts';
import { renderCardSvg } from './cardSvg.ts';

const dir = mkdtempSync(join(tmpdir(), 'ac-cardsvg-'));
const path = join(dir, 'synth.json');
writeFileSync(path, JSON.stringify(synthSession()));
const { session, model, provenance } = computeCardProvenance(path);
const svg = renderCardSvg(model, provenance);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('renderCardSvg (作品 poster export)', () => {
  it('is a well-formed, self-contained single <svg> root', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // no network / external asset references beyond the SVG namespace URI
    expect(/https?:\/\/(?!www\.w3\.org)/.test(svg)).toBe(false);
  });

  it('carries the honest hero number, wish, asymmetry, and verifiable seal', () => {
    expect(svg).toContain(`>${model.laborSteps}</text>`);
    expect(svg).toContain(SYNTH_WISH);
    expect(svg).toContain('你亲手');
    expect(svg).toContain('可溯源');
    // the seal is the real short fingerprint, not a static slogan
    expect(svg).toContain(provenance.short);
    expect(svg).not.toContain('全程真实可溯源');
  });

  it('embeds a machine-parseable receipt + tags every verifiable visible field', () => {
    expect(svg).toContain('<metadata id="ac-prov">');
    for (const id of ['ac-hero', 'ac-wish', 'ac-include', 'ac-dur', 'ac-seal']) {
      expect(svg).toContain(`id="${id}"`);
    }
  });

  it('leaks no plaintext sessionId / timestamps in the embedded receipt (privacy)', () => {
    const sid = session.meta.sessionId;
    // The receipt is hashes-only; the sessionId is re-derived from the transcript,
    // never embedded — so inspecting the SVG source reveals nothing the redactor stripped.
    expect(svg).not.toContain(sid);
    const meta = svg.match(/<metadata id="ac-prov">([\s\S]*?)<\/metadata>/)![1];
    const decoded = Buffer.from(meta, 'base64').toString('utf8');
    expect(decoded).not.toContain(sid);
    expect(/\d{4}-\d{2}-\d{2}T/.test(decoded)).toBe(false); // no ISO timestamps
  });

  it('never paints errors with the alarm-red colour', () => {
    expect(svg.toLowerCase()).not.toContain('#f38ba8'); // mocha red
  });

  it('XML-escapes its text content (no raw ampersand)', () => {
    expect(/&(?!amp;|lt;|gt;|#)/.test(svg)).toBe(false);
  });

  it('renders the "一路走来" journey from real beats, with an honest truncation label', () => {
    expect(svg).toContain('一路走来');
    // the journey beats are the model's, in order, never invented
    for (const b of model.finale!.journey) expect(svg).toContain(b.text.slice(0, 8));
    // a capped highlights pick must disclose the real total, never silently drop
    if (model.finale!.journeyTotal > model.finale!.journey.length) {
      expect(svg).toContain(`共 ${model.finale!.journeyTotal} 个转折`);
    }
    // the card grew past the classic 450 to fit the journey
    expect(svg).toMatch(/height="(4[6-9]\d|[5-9]\d\d)"/);
  });

  it('keeps the verifiable seal ABOVE the journey (a bottom crop can never lose it)', () => {
    const sealY = Number(svg.match(/y="(\d+)"[^>]*>[^<]*<tspan id="ac-dur"/)?.[1] ?? svg.match(/<text x="\d+" y="(\d+)"[^>]*><tspan id="ac-dur"/)?.[1]);
    const firstBeatY = Number(svg.match(/y="(\d+)" font-size="15"[^>]*>[├└]/)?.[1]);
    expect(sealY).toBeGreaterThan(0);
    expect(firstBeatY).toBeGreaterThan(sealY); // journey is below the stamp
  });
});
