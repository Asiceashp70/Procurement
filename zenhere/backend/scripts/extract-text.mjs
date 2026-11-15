// DOC-08: extracts the text of every page with pdf.js, plus line boxes for search highlighting.
// Runs as a child process (pdf.js is ESM-only and parsing a 200-page file should not block the API).
// stdin: the PDF bytes. stdout: JSON [{ page, text, lines: [{ t, x, y, w, h }] }] with boxes as
// fractions of the displayed page (after /Rotate), the same coordinates the web app uses.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'));

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const data = new Uint8Array(Buffer.concat(chunks));

const doc = await pdfjs.getDocument({
  data,
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  cMapUrl: pathToFileURL(join(pkgDir, 'cmaps')).href + '/',
  cMapPacked: true,
  standardFontDataUrl: pathToFileURL(join(pkgDir, 'standard_fonts')).href + '/',
  verbosity: 0,
}).promise;

const out = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const lines = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.t.trim()) lines.push(cur);
    cur = null;
  };
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontH = Math.hypot(tx[2], tx[3]) || 1;
    const horizontal = Math.abs(tx[1]) < Math.abs(tx[0]) * 0.2 || Math.abs(tx[0]) > 0;
    const x = tx[4];
    const top = tx[5] - fontH;
    const w = horizontal ? item.width * viewport.scale : 0;
    if (cur && Math.abs(top - cur.top) > fontH * 0.6) flush();
    if (!cur) cur = { t: '', top, x0: x, x1: x + w, y0: top, y1: top + fontH };
    else if (item.str && cur.t && x - cur.x1 > fontH * 0.3 && !cur.t.endsWith(' ')) cur.t += ' ';
    cur.t += item.str;
    cur.x0 = Math.min(cur.x0, x);
    cur.x1 = Math.max(cur.x1, x + w);
    cur.y0 = Math.min(cur.y0, top);
    cur.y1 = Math.max(cur.y1, top + fontH);
    if (item.hasEOL) flush();
  }
  flush();
  const W = viewport.width;
  const H = viewport.height;
  const r = (v) => Math.round(v * 10000) / 10000;
  out.push({
    page: n,
    text: lines.map((l) => l.t).join('\n'),
    lines: lines.map((l) => ({ t: l.t, x: r(l.x0 / W), y: r(l.y0 / H), w: r((l.x1 - l.x0) / W), h: r((l.y1 - l.y0) / H) })),
  });
  page.cleanup();
}
await doc.destroy();
process.stdout.write(JSON.stringify(out));
