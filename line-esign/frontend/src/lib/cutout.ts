/**
 * SIG-03: turns a phone photo of a signature on white paper into a transparent PNG.
 *
 *   1. Even out lighting: estimate the paper (background) brightness at every pixel
 *      with a max filter (removes the ink) followed by a box blur, then divide.
 *      This removes hand shadows and uneven light before thresholding.
 *   2. Otsu picks the ink/paper threshold automatically.
 *   3. Soft alpha ramp around the threshold keeps stroke edges smooth.
 *   4. Connected components: blobs with too few "core" ink pixels are dust/noise.
 *   5. Crop tight to the remaining ink.
 *
 * Pure functions on RGBA arrays so it runs in the browser (SIG-05) and in unit tests.
 */

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Analysis {
  width: number;
  height: number;
  /** 0 = paper ... 255 = darkest ink, after removing shading */
  dark: Uint8Array;
  /** shading-corrected colour, 3 bytes per pixel */
  rgb: Uint8ClampedArray;
  otsu: number;
}

export type InkColor = 'original' | 'black' | 'blue';

export interface RenderOptions {
  /** 0..100, 50 = automatic threshold. Higher picks up lighter strokes. */
  sensitivity: number;
  color: InkColor;
  rotate: 0 | 90 | 180 | 270;
  /** Extra trim after the automatic crop, each 0..0.45 of the width/height */
  trim?: { top: number; right: number; bottom: number; left: number };
}

export const INK: Record<Exclude<InkColor, 'original'>, [number, number, number]> = {
  black: [17, 17, 17],
  blue: [18, 52, 160],
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Largest size that fits in max x max, keeping the aspect ratio (SIG-02: 1,600 px). */
export function fitWithin(width: number, height: number, max: number) {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Sliding-window maximum along rows then columns (separable square max filter). */
export function maxFilter(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const pass = (input: Uint8Array, output: Uint8Array, len: number, lines: number, stride: number, step: number) => {
    const dq = new Int32Array(len);
    for (let line = 0; line < lines; line++) {
      const base = line * stride;
      let head = 0;
      let tail = 0;
      // window for index i is [i - r, i + r]
      let next = 0;
      for (let i = 0; i < len; i++) {
        const hi = Math.min(len - 1, i + r);
        while (next <= hi) {
          const v = input[base + next * step];
          while (tail > head && input[base + dq[tail - 1] * step] <= v) tail--;
          dq[tail++] = next++;
        }
        while (dq[head] < i - r) head++;
        output[base + i * step] = input[base + dq[head] * step];
      }
    }
  };
  pass(src, tmp, w, h, w, 1);
  pass(tmp, out, h, w, 1, w);
  return out;
}

/** Separable box blur with running sums. */
export function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Float32Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) sum += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1);
      sum += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / (2 * r + 1));
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/** Otsu's threshold on a 256-bin histogram. */
export function otsu(values: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

export function analyze(img: Rgba): Analysis {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    // transparent areas of an uploaded PNG count as paper
    gray[i] = a < 128 ? 255 : Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  const minSide = Math.min(w, h);
  const rMax = clamp(Math.round(minSide / 50), 3, 25);
  const bg = boxBlur(maxFilter(gray, w, h, rMax), w, h, rMax * 2);

  const dark = new Uint8Array(n);
  const rgb = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const b = Math.max(bg[i], 1);
    dark[i] = clamp(Math.round(255 * (1 - gray[i] / b)), 0, 255);
    rgb[i * 3] = (data[i * 4] / b) * 255;
    rgb[i * 3 + 1] = (data[i * 4 + 1] / b) * 255;
    rgb[i * 3 + 2] = (data[i * 4 + 2] / b) * 255;
  }
  // a blank page has only noise; never let the threshold drop into it
  return { width: w, height: h, dark, rgb, otsu: Math.max(otsu(dark), 24) };
}

export function render(an: Analysis, opts: RenderOptions): Rgba & { inkPixels: number } {
  const { width: w, height: h, dark } = an;
  const n = w * h;
  const factor = 1.6 - (clamp(opts.sensitivity, 0, 100) / 100) * 1.2;
  const t = clamp(an.otsu * factor, 8, 250);
  const lo = t * 0.5;
  const hi = Math.min(255, t * 1.5);

  // label 8-connected blobs of "some ink" (above lo); keep blobs with enough core ink (above t)
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const keep: boolean[] = [];
  const minCore = Math.max(6, Math.round(n * 0.00001));
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || dark[start] <= lo) continue;
    const id = keep.length;
    let core = 0;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp > 0) {
      const p = stack[--sp];
      if (dark[p] >= t) core++;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (label[q] === -1 && dark[q] > lo) {
            label[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    keep.push(core >= minCore);
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;
  const alpha = new Uint8ClampedArray(n);
  for (let p = 0; p < n; p++) {
    if (label[p] === -1 || !keep[label[p]]) continue;
    const a = clamp(((dark[p] - lo) / (hi - lo)) * 255, 0, 255);
    if (a <= 0) continue;
    alpha[p] = a;
    inkPixels++;
    const x = p % w;
    const y = (p - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return { data: new Uint8ClampedArray(4), width: 1, height: 1, inkPixels: 0 };

  const pad = 4;
  let x0 = Math.max(0, minX - pad);
  let y0 = Math.max(0, minY - pad);
  let x1 = Math.min(w - 1, maxX + pad);
  let y1 = Math.min(h - 1, maxY + pad);
  if (opts.trim) {
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    x0 += Math.round(cw * clamp(opts.trim.left, 0, 0.45));
    x1 -= Math.round(cw * clamp(opts.trim.right, 0, 0.45));
    y0 += Math.round(ch * clamp(opts.trim.top, 0, 0.45));
    y1 -= Math.round(ch * clamp(opts.trim.bottom, 0, 0.45));
  }
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = new Uint8ClampedArray(cw * ch * 4);
  const fixed = opts.color === 'original' ? null : INK[opts.color];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const p = (y + y0) * w + (x + x0);
      const o = (y * cw + x) * 4;
      const a = alpha[p];
      if (!a) continue;
      if (fixed) {
        out[o] = fixed[0];
        out[o + 1] = fixed[1];
        out[o + 2] = fixed[2];
      } else {
        // darken the corrected colour a bit so pale ballpoint ink stays readable
        out[o] = an.rgb[p * 3] * 0.7;
        out[o + 1] = an.rgb[p * 3 + 1] * 0.7;
        out[o + 2] = an.rgb[p * 3 + 2] * 0.7;
      }
      out[o + 3] = a;
    }
  }
  return { ...rotate({ data: out, width: cw, height: ch }, opts.rotate), inkPixels };
}

export function rotate(img: Rgba, deg: 0 | 90 | 180 | 270): Rgba {
  if (deg === 0) return img;
  const { width: w, height: h, data } = img;
  const nw = deg === 180 ? w : h;
  const nh = deg === 180 ? h : w;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (deg === 90) [nx, ny] = [h - 1 - y, x];
      else if (deg === 180) [nx, ny] = [w - 1 - x, h - 1 - y];
      else [nx, ny] = [y, w - 1 - x];
      const s = (y * w + x) * 4;
      const d = (ny * nw + nx) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { data: out, width: nw, height: nh };
}

/** Crops a drawn signature (already transparent) to its strokes. */
export function trimTransparent(img: Rgba, pad = 6): Rgba | null {
  const { width: w, height: h, data } = img;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const cw = Math.min(w - 1, maxX + pad) - x0 + 1;
  const ch = Math.min(h - 1, maxY + pad) - y0 + 1;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4), y * cw * 4);
  return { data: out, width: cw, height: ch };
}
