// The 作品 poster export must stay honest + well-formed: a single <svg> root,
// the panel's hero number, the real wish, a VERIFIABLE provenance fingerprint —
// and NEVER the alarm-red error colour (a finished run's errors are resilience).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { ParsedSession } from '../model/types.ts';
import { buildPanelModel } from '../tui/viewModel.ts';
import { computeCardProvenance } from './cardProvenance.ts';
import { renderCardSvg } from './cardSvg.ts';

// Fixture is gitignored (real transcript) → skip cleanly when absent (fresh clone).
const SAMPLE = 'sample/parsed-sample.json';
const present = existsSync(SAMPLE);
const session = present
  ? (JSON.parse(readFileSync(SAMPLE, 'utf8')) as ParsedSession)
  : (null as unknown as ParsedSession);
const model = present ? buildPanelModel(session) : (null as unknown as ReturnType<typeof buildPanelModel>);
const provenance = present ? computeCardProvenance(SAMPLE).provenance : null;
const svg = present ? renderCardSvg(model, provenance!) : '';

describe.skipIf(!present)('renderCardSvg (作品 poster export)', () => {
  it('is a well-formed, self-contained single <svg> root', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // no network / external asset references beyond the SVG namespace URI
    expect(/https?:\/\/(?!www\.w3\.org)/.test(svg)).toBe(false);
  });

  it('carries the honest hero number, wish, asymmetry, and verifiable seal', () => {
    expect(svg).toContain(`>${model.laborSteps}</text>`);
    expect(svg).toContain('杀戮尖塔');
    expect(svg).toContain('你亲手');
    expect(svg).toContain('可溯源');
    // the seal is now the real short fingerprint, not a static slogan
    expect(svg).toContain(provenance!.short);
    expect(svg).not.toContain('全程真实可溯源');
  });

  it('embeds a machine-parseable provenance receipt + an identified hero numeral', () => {
    expect(svg).toContain('<metadata id="ac-prov">');
    expect(svg).toContain('id="ac-hero"');
  });

  it('never paints errors with the alarm-red colour', () => {
    expect(svg.toLowerCase()).not.toContain('#f38ba8'); // mocha red
  });

  it('XML-escapes its text content (no raw ampersand)', () => {
    expect(/&(?!amp;|lt;|gt;|#)/.test(svg)).toBe(false);
  });
});
