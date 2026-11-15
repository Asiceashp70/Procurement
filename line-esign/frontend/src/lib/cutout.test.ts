import { describe, expect, it } from 'vitest';
import { analyze, fitWithin, maxFilter, otsu, render, rotate, trimTransparent } from './cutout';

/**
 * Synthetic "phone photo": paper whose brightness falls from 245 to 150 left to right
 * (a hand shadow), a dark pen stroke, and specks of dust.
 */
function photo(w = 400, h = 200) {
  const data = new Uint8ClampedArray(w * h * 4);
  const isStroke = (x: number, y: number) => {
    // a sine-wave signature, 5 px thick, between x=60 and x=340
    if (x < 60 || x > 340) return false;
    const cy = 100 + 40 * Math.sin((x - 60) / 30);
    return Math.abs(y - cy) <= 2.5;
  };
  const specks = new Set([`20,20`, `380,180`, `200,20`]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const paper = 245 - (95 * x) / w;
      let v = paper;
      if (isStroke(x, y)) v = paper * 0.25;
      if (specks.has(`${x},${y}`)) v = paper * 0.4;
      const o = (y * w + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = Math.min(255, v + 10);
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h, isStroke };
}

describe('cutout (SIG-03)', () => {
  it('removes the shadow, keeps the stroke, drops specks and crops tight', () => {
    const img = photo();
    const out = render(analyze(img), { sensitivity: 50, color: 'black', rotate: 0 });

    // cropped to the stroke (x 60..340, y ~57..143) plus 4 px padding
    expect(out.width).toBeGreaterThanOrEqual(281);
    expect(out.width).toBeLessThanOrEqual(281 + 8 + 2);
    expect(out.height).toBeLessThan(100);

    // count opaque pixels in the output vs stroke pixels in the input
    let opaque = 0;
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 128) opaque++;
    let stroke = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.isStroke(x, y)) stroke++;
    expect(opaque / stroke).toBeGreaterThan(0.9);
    expect(opaque / stroke).toBeLessThan(1.15);

    // the shaded right half of the paper did not turn into ink
    const corner = (out.height - 1) * out.width * 4 + (out.width - 1) * 4;
    expect(out.data[corner + 3]).toBe(0);
    // fixed ink colour
    const firstInk = out.data.findIndex((v, i) => i % 4 === 3 && v === 255);
    expect([...out.data.slice(firstInk - 3, firstInk)]).toEqual([17, 17, 17]);
  });

  it('returns an empty 1x1 image for a blank page', () => {
    const w = 120;
    const h = 80;
    const data = new Uint8ClampedArray(w * h * 4).fill(235);
    const out = render(analyze({ data, width: w, height: h }), { sensitivity: 50, color: 'black', rotate: 0 });
    expect(out.inkPixels).toBe(0);
  });

  it('higher sensitivity picks up lighter strokes', () => {
    const img = photo();
    const an = analyze(img);
    const low = render(an, { sensitivity: 10, color: 'black', rotate: 0 }).inkPixels;
    const high = render(an, { sensitivity: 90, color: 'black', rotate: 0 }).inkPixels;
    expect(high).toBeGreaterThanOrEqual(low);
  });
});

describe('helpers', () => {
  it('fits large photos within 1600 px', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('max filter spreads the brightest value', () => {
    const src = new Uint8Array([0, 0, 0, 0, 9, 0, 0, 0, 0]);
    expect([...maxFilter(src, 3, 3, 1)]).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9]);
  });

  it('otsu splits two clusters', () => {
    const v = new Uint8Array([...Array(50).fill(10), ...Array(50).fill(200)]);
    const t = otsu(v);
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(200);
  });

  it('rotates 90 degrees clockwise', () => {
    // 2x1: red, green  ->  1x2: red on top, green below
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) };
    const r = rotate(img, 90);
    expect([r.width, r.height]).toEqual([1, 2]);
    expect([...r.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('trims a drawn signature to its strokes', () => {
    const w = 50;
    const h = 30;
    const data = new Uint8ClampedArray(w * h * 4);
    data[(10 * w + 20) * 4 + 3] = 255;
    const t = trimTransparent({ data, width: w, height: h }, 2)!;
    expect([t.width, t.height]).toEqual([5, 5]);
  });
});
