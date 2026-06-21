// ============================================================================
// pngChunks — minimal, dependency-free PNG text-chunk read/write (node:Buffer +
// node:zlib's CRC only). The point: a PNG can carry its OWN verifiable SVG source
// in an iTXt chunk, so a shared raster (for social platforms that don't render
// SVG) stays independently checkable — `verify:card` extracts the embedded SVG and
// runs the normal oracle on it. No image decoding, no native dep, no rasterizer
// here (rasterization is delegated to a detected system tool in exportCard).
//
// Honest scope: an embedded SVG proves the CARD'S CLAIMS are faithful to the
// transcript; the PNG pixels are a rendering of that SVG (re-rasterize to confirm
// they match). We never claim the raster pixels are themselves cryptographically
// bound — only the embedded SVG is.
// ============================================================================
import { Buffer } from 'node:buffer';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The keyword under which the verifiable SVG source is stored in the PNG. */
export const SVG_KEYWORD = 'agentcity-card-svg';

export function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG);
}

// Standard CRC-32 (PNG appendix). Table built once.
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

function buildChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** An uncompressed iTXt chunk (UTF-8 capable — required for the CJK in the SVG). */
function buildITxt(keyword: string, text: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0x00]), // keyword null terminator
    Buffer.from([0x00, 0x00]), // compression flag (0 = uncompressed) + method
    Buffer.from([0x00]), // language tag (empty) + null
    Buffer.from([0x00]), // translated keyword (empty) + null
    Buffer.from(text, 'utf8'),
  ]);
  return buildChunk('iTXt', data);
}

/** Walk the chunk list: yields {type, dataStart, dataLen, chunkStart, chunkEnd}. */
function* chunks(png: Buffer): Generator<{ type: string; dataStart: number; dataLen: number; chunkStart: number; chunkEnd: number }> {
  let off = 8; // past signature
  while (off + 8 <= png.length) {
    const dataLen = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const dataStart = off + 8;
    const chunkEnd = dataStart + dataLen + 4; // + CRC
    if (chunkEnd > png.length) break;
    yield { type, dataStart, dataLen, chunkStart: off, chunkEnd };
    off = chunkEnd;
  }
}

/** Insert an iTXt chunk carrying `text` (UTF-8) just before IEND. Throws if not a PNG. */
export function embedText(png: Buffer, keyword: string, text: string): Buffer {
  if (!isPng(png)) throw new Error('embedText: input is not a PNG');
  let iendStart = -1;
  for (const c of chunks(png)) if (c.type === 'IEND') { iendStart = c.chunkStart; break; }
  if (iendStart < 0) throw new Error('embedText: PNG has no IEND chunk');
  return Buffer.concat([png.subarray(0, iendStart), buildITxt(keyword, text), png.subarray(iendStart)]);
}

/** Read the UTF-8 text of the first iTXt/tEXt chunk with `keyword` (null if absent). */
export function readText(png: Buffer, keyword: string): string | null {
  if (!isPng(png)) return null;
  const kw = Buffer.from(keyword, 'latin1');
  for (const c of chunks(png)) {
    if (c.type !== 'iTXt' && c.type !== 'tEXt') continue;
    const data = png.subarray(c.dataStart, c.dataStart + c.dataLen);
    const nul = data.indexOf(0x00);
    if (nul < 0 || !data.subarray(0, nul).equals(kw)) continue;
    if (c.type === 'tEXt') return data.subarray(nul + 1).toString('latin1');
    // iTXt: keyword \0 compFlag compMethod langTag \0 transKeyword \0 text
    const compFlag = data[nul + 1];
    let p = nul + 3; // skip compFlag + compMethod
    p = data.indexOf(0x00, p) + 1; // past language tag
    p = data.indexOf(0x00, p) + 1; // past translated keyword
    if (p <= 0 || p > data.length) return null;
    const body = data.subarray(p);
    return compFlag === 0 ? body.toString('utf8') : null; // we only write uncompressed
  }
  return null;
}
