"""ZenHere OCR worker (SRC-07). Local only: listens on 127.0.0.1.

POST /ocr   multipart: file=<PDF>, pages="1,3" (empty = all), dpi=200
            -> {"pages": [{"page", "text", "confidence", "lines": [{text, confidence, x, y, w, h}]}]}
GET  /health
"""
from __future__ import annotations

import os
import threading
import time

import numpy as np
import pypdfium2 as pdfium
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

from engine import EngineConfig, PPOCREngine

MAX_BYTES = 60 * 1024 * 1024
MAX_PAGES_PER_REQUEST = 50

app = FastAPI(title="ZenHere OCR worker")
_engine: PPOCREngine | None = None
_lock = threading.Lock()  # one page at a time per process; run more processes for more throughput


def engine() -> PPOCREngine:
    global _engine
    if _engine is None:
        _engine = PPOCREngine(EngineConfig.from_env())
    return _engine


def render(pdf: pdfium.PdfDocument, page_no: int, dpi: int) -> np.ndarray:
    """Page as a BGR image, oriented as displayed (PDFium applies /Rotate)."""
    page = pdf[page_no - 1]
    try:
        bitmap = page.render(scale=dpi / 72)
        arr = bitmap.to_numpy()
        if arr.ndim == 2:
            arr = np.repeat(arr[:, :, None], 3, axis=2)
        return np.ascontiguousarray(arr[:, :, :3])  # PDFium gives BGR(x)
    finally:
        page.close()


def ocr_pdf(data: bytes, pages: list[int] | None, dpi: int = 200) -> list[dict]:
    pdf = pdfium.PdfDocument(data)
    try:
        wanted = pages or list(range(1, len(pdf) + 1))
        out = []
        for n in wanted:
            if n < 1 or n > len(pdf):
                raise HTTPException(400, f"page {n} out of range")
            img = render(pdf, n, dpi)
            with _lock:
                lines = engine().read(img)
            total = sum(len(l.text) for l in lines) or 1
            out.append(
                {
                    "page": n,
                    "text": "\n".join(l.text for l in lines),
                    "confidence": round(sum(l.confidence * len(l.text) for l in lines) / total, 4) if lines else None,
                    "lines": [l.__dict__ for l in lines],
                }
            )
        return out
    finally:
        pdf.close()


@app.get("/health")
def health():
    try:
        e = engine()
        return {"status": "ok", "engine": e.name, "charset": len(e.charset)}
    except Exception as err:  # model files missing etc.
        raise HTTPException(503, f"engine not ready: {err}")


@app.post("/ocr")
def ocr(
    file: UploadFile = File(...),
    pages: str = Form(""),
    dpi: int = Form(200),
    x_ocr_token: str | None = Header(default=None),
):
    token = os.environ.get("OCR_TOKEN", "")
    if token and x_ocr_token != token:
        raise HTTPException(401, "bad token")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "file too large")
    try:
        page_list = [int(p) for p in pages.split(",") if p.strip()] or None
    except ValueError:
        raise HTTPException(400, "pages must be numbers")
    if page_list and len(page_list) > MAX_PAGES_PER_REQUEST:
        raise HTTPException(400, f"at most {MAX_PAGES_PER_REQUEST} pages per request")
    if not 72 <= dpi <= 400:
        raise HTTPException(400, "dpi must be 72..400")
    started = time.perf_counter()
    try:
        result = ocr_pdf(data, page_list, dpi)
    except pdfium.PdfiumError:
        raise HTTPException(400, "cannot open PDF")
    return {"pages": result, "engine": engine().name, "elapsedMs": int((time.perf_counter() - started) * 1000)}
