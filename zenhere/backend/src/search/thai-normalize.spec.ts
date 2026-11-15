import { likeEscape, normalizeThai, normalizeWithMap, snippetFor } from './thai-normalize';

describe('Thai search normalization (SRC-05)', () => {
  it('ignores spaces and line breaks between words', () => {
    expect(normalizeThai('สัญญา จ้าง')).toBe(normalizeThai('สัญญาจ้าง'));
    expect(normalizeThai('สัญญา\nจ้าง​')).toBe('สัญญาจ้าง');
  });

  it('maps legacy PUA glyph codes to standard Thai', () => {
    // ป + SARA II shifted left (F702) + MAI EK low-left (F705) = ปี่
    expect(normalizeThai('ป')).toBe('ปี่');
    // THO THAN / YO YING without the lower tail
    expect(normalizeThai('าน าติ')).toBe('ฐานญาติ');
  });

  it('recombines NIKHAHIT + SARA AA into SARA AM, with or without a tone mark', () => {
    expect(normalizeThai('ทํางาน')).toBe('ทำงาน');
    expect(normalizeThai('น้ํา')).toBe('น้ำ'); // tone, nikhahit, aa
    expect(normalizeThai('นํ้า')).toBe('น้ำ'); // nikhahit, tone, aa
    expect(normalizeThai('จำากัด')).toBe('จำกัด'); // doubled by a broken extractor
  });

  it('puts a tone mark after the upper vowel and drops doubled marks', () => {
    expect(normalizeThai('ท่ี')).toBe('ที่');
    expect(normalizeThai('ก่่า')).toBe('ก่า');
  });

  it('matches Thai and Arabic digits and ignores case', () => {
    expect(normalizeThai('ปี ๒๕๖๙')).toBe('ปี2569');
    expect(normalizeThai('PDPA Policy')).toBe('pdpapolicy');
  });

  it('keeps a map back to the original text for snippets', () => {
    const n = normalizeWithMap('ก ข');
    expect(n.text).toBe('กข');
    expect(n.map).toEqual([0, 2]);
    const s = snippetFor('เอกสารนี้เป็นสัญญา จ้างงานพนักงานประจำ', normalizeThai('สัญญาจ้าง'), 8)!;
    expect(s.match).toBe('สัญญา จ้าง');
    expect(s.before.endsWith('เป็น')).toBe(true);
    expect(snippetFor('ไม่มีคำนี้', normalizeThai('สัญญา'))).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    expect(likeEscape('100%_a\\')).toBe('100\\%\\_a\\\\');
  });
});
