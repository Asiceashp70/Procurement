import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beginText,
  endText,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  concatTransformationMatrix,
} from 'pdf-lib';

const FONT_DIR = join(__dirname, '..', '..', '..', 'assets', 'fonts');
let regularBytes: Buffer | null = null;
let boldBytes: Buffer | null = null;

interface FkGlyph {
  id: number;
  name?: string;
  codePoints: number[];
}
interface FkPosition {
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}
interface FkFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  layout(text: string): { glyphs: FkGlyph[]; positions: FkPosition[] };
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * fontkit caches one Glyph object per glyph id with the code points of the first
 * string it appeared in, so substituted glyphs (shifted tone marks, the nikhahit
 * split out of SARA AM) can carry the wrong characters into the PDF's ToUnicode
 * map, and copied or extracted text comes out garbled. Sarabun names its glyphs
 * "uniXXXX[.variant]", which gives the true character.
 */
function fixCodePoints(glyphs: FkGlyph[]) {
  for (const g of glyphs) {
    // "uni0E48.narrow" -> [0E48]; ligature "uni0E4D0E49" -> [0E4D, 0E49]
    const m = g.name ? /^uni((?:[0-9A-F]{4})+)(\.|$)/.exec(g.name) : null;
    if (!m) continue;
    const cps = m[1].match(/.{4}/g)!.map((h) => parseInt(h, 16));
    // Thai order is tone mark before the NIKHAHIT of SARA AM (น้ำ = น ้ ํ า)
    cps.sort((a, b) => (a === 0x0e4d && b >= 0x0e48 && b <= 0x0e4b ? 1 : b === 0x0e4d && a >= 0x0e48 && a <= 0x0e4b ? -1 : 0));
    g.codePoints = cps;
  }
}

/**
 * Thai text for pdf-lib. pdf-lib's drawText ignores the font's GPOS table, so
 * upper vowels and tone marks pile up or float away ("ที่", "ปี่", "น้ำ").
 * Here fontkit shapes the string (GSUB + GPOS) and every glyph is written at
 * its own position with a text matrix.
 */
export class ShapedFont {
  private readonly fk: FkFont;
  private known: Set<number> | null = null;

  constructor(readonly pdfFont: PDFFont) {
    this.fk = (pdfFont as unknown as { embedder: { font: FkFont } }).embedder.font;
  }

  static async embed(doc: PDFDocument, weight: 'regular' | 'bold' = 'regular') {
    doc.registerFontkit(fontkit);
    regularBytes ??= readFileSync(join(FONT_DIR, 'Sarabun-Regular.ttf'));
    boldBytes ??= readFileSync(join(FONT_DIR, 'Sarabun-Bold.ttf'));
    // subset:false keeps original glyph ids, which the per-glyph operators below rely on
    const font = await doc.embedFont(weight === 'bold' ? boldBytes : regularBytes, { subset: false });
    return new ShapedFont(font);
  }

  width(text: string, size: number): number {
    if (!text) return 0;
    const run = this.fk.layout(text);
    return (run.positions.reduce((s, p) => s + p.xAdvance, 0) * size) / this.fk.unitsPerEm;
  }

  /**
   * pdf-lib (full embedding) writes Widths and the ToUnicode map only for glyphs
   * reachable from the font's cmap. Shaped variants (e.g. "uni0E48.narrow") are
   * not, so they are added to its glyph list, kept sorted by id as it expects.
   */
  private registerGlyphs(glyphs: FkGlyph[]) {
    const cache = (this.pdfFont as unknown as { embedder: { glyphCache: { access(): FkGlyph[] } } }).embedder.glyphCache.access();
    this.known ??= new Set(cache.map((g) => g.id));
    for (const g of glyphs) {
      if (this.known.has(g.id)) continue;
      this.known.add(g.id);
      let i = cache.findIndex((c) => c.id > g.id);
      if (i < 0) i = cache.length;
      cache.splice(i, 0, g);
    }
  }

  /** Distance from baseline to top / bottom of the font box at this size. */
  ascent(size: number) {
    return (this.fk.ascent * size) / this.fk.unitsPerEm;
  }
  descent(size: number) {
    return (-this.fk.descent * size) / this.fk.unitsPerEm;
  }

  /**
   * Draws one line with its baseline starting at (x, y) in a local coordinate system
   * that is translated to (ox, oy) and rotated by `angle` degrees counter-clockwise.
   */
  draw(page: PDFPage, text: string, opts: { x: number; y: number; size: number; color?: Rgb; origin?: { x: number; y: number }; angle?: number }) {
    if (!text) return;
    const run = this.fk.layout(text);
    fixCodePoints(run.glyphs);
    this.registerGlyphs(run.glyphs);
    const key = page.node.newFontDictionary(this.pdfFont.name, this.pdfFont.ref);
    const scale = opts.size / this.fk.unitsPerEm;
    const c = opts.color ?? { r: 0, g: 0, b: 0 };
    const ops = [pushGraphicsState()];
    if (opts.origin) {
      const rad = ((opts.angle ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      ops.push(concatTransformationMatrix(cos, sin, -sin, cos, opts.origin.x, opts.origin.y));
    }
    ops.push(beginText(), setFontAndSize(key, opts.size), setFillingRgbColor(c.r, c.g, c.b));
    let pen = 0;
    run.glyphs.forEach((g, i) => {
      const p = run.positions[i];
      ops.push(setTextMatrix(1, 0, 0, 1, opts.x + (pen + p.xOffset) * scale, opts.y + p.yOffset * scale));
      ops.push(showText(PDFHexString.of(g.id.toString(16).padStart(4, '0'))));
      pen += p.xAdvance;
    });
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }

  /** Word-wraps Thai (no spaces between words) with the ICU word segmenter. */
  wrap(text: string, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    const words = new Intl.Segmenter('th', { granularity: 'word' });
    const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const { segment } of words.segment(paragraph)) {
        if (this.width(line + segment, size) <= maxWidth) {
          line += segment;
          continue;
        }
        if (line.trim()) lines.push(line.trimEnd());
        line = '';
        const word = segment.trimStart();
        if (this.width(word, size) <= maxWidth) {
          line = word;
          continue;
        }
        // one word wider than the line: break between grapheme clusters (never inside one)
        for (const g of graphemes.segment(word)) {
          if (line && this.width(line + g.segment, size) > maxWidth) {
            lines.push(line);
            line = '';
          }
          line += g.segment;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
}
