import { fitWithin, type Rgba } from './cutout';

export async function loadImageFile(file: File, maxSide: number): Promise<Rgba> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  try {
    // respects the EXIF orientation of phone photos
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('เปิดรูปไม่ได้'));
      img.src = url;
    });
    source = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  }
  const size = fitWithin(w, h, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return { data: ctx.getImageData(0, 0, size.width, size.height).data, width: size.width, height: size.height };
}

export function rgbaToCanvas(img: Rgba, canvas: HTMLCanvasElement = document.createElement('canvas')) {
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

/** PNG with transparency, longest side at most maxSide. */
export async function toPngBlob(img: Rgba, maxSide = 1200): Promise<Blob> {
  const src = rgbaToCanvas(img);
  const size = fitWithin(img.width, img.height, maxSide);
  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('สร้างไฟล์ไม่ได้'))), 'image/png'));
}
