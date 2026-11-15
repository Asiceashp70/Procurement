const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngInfo {
  width: number;
  height: number;
  colorType: number;
}

/** Reads the IHDR chunk. Returns null when the buffer is not a PNG. */
export function readPngInfo(buf: Buffer): PngInfo | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}
