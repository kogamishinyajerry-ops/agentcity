// ============================================================================
// rasterize — turn a card SVG into a PNG using whatever SVG rasterizer the host
// already has. Deliberately a SOFT, optional dependency: AgentCity bundles NO
// native rasterizer (keeps install pure-JS + zero-network), so PNG export is a
// best-effort enhancement with a graceful SVG-only fallback when no tool is found.
//
// Security: every tool is invoked via execFileSync with an argv array (NO shell),
// so card paths can't inject. The raster pixels are never trusted by the verifier
// — only the SVG embedded into the PNG is (see pngChunks / loadCardSvg). A buggy
// or hostile rasterizer can therefore only produce wrong PIXELS, never a false
// verify; the honest fix for that is "re-rasterize the embedded SVG and compare".
// ============================================================================
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { isPng } from './pngChunks.ts';

interface Rasterizer {
  tool: string;
  run(svgPath: string, pngPath: string): void;
}

function which(tool: string): boolean {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** qlmanage (macOS Quick Look) writes `<outdir>/<name>.png`, not a direct file —
 *  render into a temp dir then copy to the requested path. */
function viaQlmanage(svgPath: string, pngPath: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'ac-ql-'));
  try {
    execFileSync('qlmanage', ['-t', '-s', '1640', '-o', dir, svgPath], { stdio: 'ignore' });
    const produced = join(dir, basename(svgPath) + '.png');
    if (!existsSync(produced)) throw new Error('qlmanage 未生成 PNG');
    copyFileSync(produced, pngPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Detection order: dedicated SVG rasterizers first (faithful), ImageMagick next,
// macOS Quick Look last (always present on macOS but lowest fidelity).
const CANDIDATES: Rasterizer[] = [
  { tool: 'rsvg-convert', run: (s, p) => execFileSync('rsvg-convert', ['-o', p, s], { stdio: 'ignore' }) },
  { tool: 'resvg', run: (s, p) => execFileSync('resvg', [s, p], { stdio: 'ignore' }) },
  { tool: 'inkscape', run: (s, p) => execFileSync('inkscape', [s, '--export-type=png', `--export-filename=${p}`], { stdio: 'ignore' }) },
  { tool: 'magick', run: (s, p) => execFileSync('magick', [s, p], { stdio: 'ignore' }) },
  { tool: 'convert', run: (s, p) => execFileSync('convert', [s, p], { stdio: 'ignore' }) },
  { tool: 'qlmanage', run: viaQlmanage },
];

/** Rasterize `svgPath` → `pngPath`, trying each available tool in order until one
 *  ACTUALLY produces a valid PNG. Returns the tool name used, or null if none is
 *  installed or every one failed (→ caller does SVG-only). `which`-presence is only
 *  necessary, not sufficient — a tool may exist yet not handle SVG (e.g. ImageMagick
 *  without librsvg), so we fall through to the next candidate on any failure. */
export function rasterize(svgPath: string, pngPath: string): string | null {
  for (const c of CANDIDATES) {
    if (!which(c.tool)) continue;
    try {
      c.run(svgPath, pngPath);
      if (existsSync(pngPath) && isPng(readFileSync(pngPath))) return c.tool;
    } catch {
      // tool present but couldn't render this SVG — try the next one
    }
  }
  return null;
}
