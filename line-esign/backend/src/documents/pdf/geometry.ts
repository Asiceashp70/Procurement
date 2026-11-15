/**
 * Field positions are stored as fractions (0..1) of the page as the user SAW it:
 * the crop box after the page's /Rotate. pdf.js shows pages the same way, so a box
 * drawn on any screen size lands in the same place.
 */

export interface PageBox {
  x0: number; // crop box in PDF user space
  y0: number;
  x1: number;
  y1: number;
  rotation: number; // 0, 90, 180, 270 (clockwise, as in /Rotate)
}

export interface Fraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where to draw: a local system whose origin is the box's visual bottom-left, rotated `angle` degrees CCW. */
export interface Placement {
  origin: { x: number; y: number };
  angle: number;
  width: number;
  height: number;
}

export const normalizeRotation = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

export function displaySize(box: PageBox) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  return box.rotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

/** Display point (top-left origin, in display units) -> PDF user space. */
export function displayToPdf(box: PageBox, dx: number, dy: number) {
  switch (normalizeRotation(box.rotation)) {
    case 90:
      return { x: box.x0 + dy, y: box.y0 + dx };
    case 180:
      return { x: box.x1 - dx, y: box.y0 + dy };
    case 270:
      return { x: box.x1 - dy, y: box.y1 - dx };
    default:
      return { x: box.x0 + dx, y: box.y1 - dy };
  }
}

export function placeField(box: PageBox, f: Fraction): Placement {
  const d = displaySize(box);
  const width = f.w * d.width;
  const height = f.h * d.height;
  // visual bottom-left corner of the box
  const origin = displayToPdf(box, f.x * d.width, (f.y + f.h) * d.height);
  return { origin, angle: normalizeRotation(box.rotation), width, height };
}
