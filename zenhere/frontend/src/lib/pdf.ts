// pdf.js "legacy" build: works in the LINE in-app browser on older iOS/Android too.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ url, withCredentials: true, isEvalSupported: false }).promise;
}

export interface PageInfo {
  pageNo: number;
  width: number;
  height: number;
  rotation: number;
}

/** Size of the page as displayed (after /Rotate), in PDF points. */
export function displaySize(p: PageInfo) {
  return p.rotation % 180 === 0 ? { width: p.width, height: p.height } : { width: p.height, height: p.width };
}
