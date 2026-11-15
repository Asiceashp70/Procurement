/**
 * SRC-05: one normalization for both the index and the query, so "สัญญาจ้าง"
 * finds "สัญญา จ้าง", text extracted from PDFs made with old Thai fonts, and
 * "น้ํา" written as NIKHAHIT + SARA AA.
 *
 * Steps: legacy Private-Use-Area glyph codes -> standard Thai; Thai digits ->
 * 0-9; drop whitespace and zero-width characters; lower-case; NIKHAHIT (+tone)
 * + SARA AA -> (tone +) SARA AM; tone mark typed before an upper vowel ->
 * after it; doubled marks collapsed.
 *
 * `map[i]` is the index in the original text of normalized character i, so a
 * match in the normalized text can be shown and highlighted in the original.
 */

// Microsoft/WTT "Thai PUA" glyph variants used by older Thai fonts (U+F700..U+F71A)
const PUA: Record<number, number> = {
  0xf700: 0x0e10, 0xf701: 0x0e34, 0xf702: 0x0e35, 0xf703: 0x0e36, 0xf704: 0x0e37,
  0xf705: 0x0e48, 0xf706: 0x0e49, 0xf707: 0x0e4a, 0xf708: 0x0e4b, 0xf709: 0x0e4c,
  0xf70a: 0x0e48, 0xf70b: 0x0e49, 0xf70c: 0x0e4a, 0xf70d: 0x0e4b, 0xf70e: 0x0e4c,
  0xf70f: 0x0e0d, 0xf710: 0x0e31, 0xf711: 0x0e4d, 0xf712: 0x0e47,
  0xf713: 0x0e48, 0xf714: 0x0e49, 0xf715: 0x0e4a, 0xf716: 0x0e4b, 0xf717: 0x0e4c,
  0xf718: 0x0e38, 0xf719: 0x0e39, 0xf71a: 0x0e3a,
};

const NIKHAHIT = 0x0e4d;
const SARA_AA = 0x0e32;
const SARA_AM = 0x0e33;
const isTone = (c: number) => c >= 0x0e48 && c <= 0x0e4b;
const isUpperVowel = (c: number) => c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e37) || c === 0x0e47;
const isMark = (c: number) => c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e3a) || (c >= 0x0e47 && c <= 0x0e4e);
const ZERO_WIDTH = /[​-‍⁠﻿­]/;

export interface Normalized {
  text: string;
  map: number[];
}

export function normalizeWithMap(input: string): Normalized {
  const cps: number[] = [];
  const src: number[] = [];
  let i = 0;
  for (const ch of input) {
    let c = ch.codePointAt(0)!;
    const at = i;
    i += ch.length;
    if (/\s/.test(ch) || ZERO_WIDTH.test(ch)) continue;
    c = PUA[c] ?? c;
    if (c >= 0x0e50 && c <= 0x0e59) c = 0x30 + (c - 0x0e50); // Thai digits
    else if (c < 0x0e00 || c > 0x0e7f) {
      const lower = String.fromCodePoint(c).normalize('NFKC').toLowerCase();
      for (const l of lower) {
        cps.push(l.codePointAt(0)!);
        src.push(at);
      }
      continue;
    }
    cps.push(c);
    src.push(at);
  }

  const outC: number[] = [];
  const outS: number[] = [];
  for (let k = 0; k < cps.length; k++) {
    const c = cps[k];
    // NIKHAHIT [tone] SARA AA -> [tone] SARA AM
    if (c === NIKHAHIT) {
      const tone = isTone(cps[k + 1]) ? cps[k + 1] : null;
      const aaAt = tone ? k + 2 : k + 1;
      if (cps[aaAt] === SARA_AA) {
        if (tone) {
          outC.push(tone);
          outS.push(src[k + 1]);
        }
        outC.push(SARA_AM);
        outS.push(src[k]);
        k = aaAt;
        continue;
      }
    }
    // SARA AM followed by a stray SARA AA (broken extraction) -> SARA AM
    if (c === SARA_AA && outC[outC.length - 1] === SARA_AM) continue;
    // tone typed before an upper vowel -> vowel first
    if (isTone(c) && isUpperVowel(cps[k + 1])) {
      outC.push(cps[k + 1], c);
      outS.push(src[k + 1], src[k]);
      k++;
      continue;
    }
    // the same combining mark twice in a row
    if (isMark(c) && outC[outC.length - 1] === c) continue;
    outC.push(c);
    outS.push(src[k]);
  }
  return { text: String.fromCodePoint(...outC), map: outS };
}

export const normalizeThai = (s: string) => normalizeWithMap(s).text;

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** Text around the first match, cut from the ORIGINAL text (for display with <mark>). */
export function snippetFor(original: string, normalizedQuery: string, context = 60): Snippet | null {
  if (!normalizedQuery) return null;
  const n = normalizeWithMap(original);
  const at = n.text.indexOf(normalizedQuery);
  if (at < 0) return null;
  const start = n.map[at];
  const lastSrc = n.map[at + normalizedQuery.length - 1];
  let end = lastSrc + 1;
  // keep combining marks that belong to the last matched character
  while (end < original.length && isMark(original.charCodeAt(end))) end++;
  let from = Math.max(0, start - context);
  let to = Math.min(original.length, end + context);
  while (from > 0 && isMark(original.charCodeAt(from))) from--;
  while (to < original.length && isMark(original.charCodeAt(to))) to++;
  const clean = (s: string) => s.replace(/\s+/g, ' ');
  return {
    before: (from > 0 ? '…' : '') + clean(original.slice(from, start)).trimStart(),
    match: clean(original.slice(start, end)),
    after: clean(original.slice(end, to)).trimEnd() + (to < original.length ? '…' : ''),
  };
}

/** Escapes LIKE wildcards so user input is matched literally. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
