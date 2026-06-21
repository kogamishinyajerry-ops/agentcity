import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { isPng, embedText, readText, SVG_KEYWORD } from './pngChunks.ts';

// ---------------------------------------------------------------------------
// A real, valid 1×1 RGBA PNG built from scratch (zlib for IDAT, manual CRC) so
// the tests exercise genuine chunk-walking, not a hand-waved stub. No fixture,
// no rasterizer — CI-safe.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makePng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const raw = Buffer.from([0x00, 0xff, 0x00, 0x00, 0xff]); // filter byte + one RGBA pixel
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

describe('pngChunks', () => {
  it('recognises a real PNG and rejects non-PNG bytes', () => {
    expect(isPng(makePng())).toBe(true);
    expect(isPng(Buffer.from('<svg/>', 'utf8'))).toBe(false);
    expect(isPng(Buffer.alloc(4))).toBe(false);
  });

  it('round-trips UTF-8 (incl. CJK) text through an iTXt chunk', () => {
    const png = makePng();
    const svg = '<svg>愿望 · 把项目迁移到 TUI · ✓ 可溯源</svg>';
    const out = embedText(png, SVG_KEYWORD, svg);
    expect(out.length).toBeGreaterThan(png.length);
    expect(isPng(out)).toBe(true); // still a valid PNG
    expect(readText(out, SVG_KEYWORD)).toBe(svg);
  });

  it('preserves the original image chunks when embedding (IHDR/IDAT/IEND intact)', () => {
    const png = makePng();
    const out = embedText(png, SVG_KEYWORD, 'x');
    // embedText only splices before IEND: the entire pre-IEND prefix (sig..IDAT)
    // must survive byte-for-byte. IEND is a fixed 12-byte trailer (len+type+crc).
    const prefix = png.subarray(0, png.length - 12);
    expect(out.subarray(0, prefix.length).equals(prefix)).toBe(true);
    // IEND must remain the final chunk
    expect(out.subarray(out.length - 8).toString('latin1')).toContain('IEND');
  });

  it('returns null for a missing keyword', () => {
    const png = embedText(makePng(), SVG_KEYWORD, 'present');
    expect(readText(png, 'no-such-key')).toBeNull();
  });

  it('reads the embedded text from a freshly built carrier (the share path)', () => {
    // mimics export: build PNG carrier → later verify re-extracts the exact SVG
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><metadata id="ac-prov">{"v":1}</metadata></svg>';
    const carrier = embedText(makePng(), SVG_KEYWORD, svg);
    const extracted = readText(carrier, SVG_KEYWORD);
    expect(extracted).toBe(svg);
  });

  it('throws when asked to embed into non-PNG bytes (fail-closed)', () => {
    expect(() => embedText(Buffer.from('not a png'), SVG_KEYWORD, 'x')).toThrow(/not a PNG/);
  });

  it('survives a second embed (two chunks, first match wins on read)', () => {
    let png = embedText(makePng(), SVG_KEYWORD, 'first');
    png = embedText(png, SVG_KEYWORD, 'second');
    // readText returns the first matching chunk in file order
    expect(readText(png, SVG_KEYWORD)).toBe('first');
  });
});
