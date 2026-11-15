"""PP-OCR style ONNX pipeline (text detection + CTC line recognition) on CPU.

OpenThai2.0-OCR-Text ships a PP-OCR detector and a Thai CTC line recognizer as
ONNX files; point OCR_DET_MODEL / OCR_REC_MODEL / OCR_REC_KEYS at them. Every
pre/post-processing value is configurable because the exact settings must be
taken from the model card (see README).
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass

import cv2
import numpy as np
import onnxruntime as ort

DET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


@dataclass
class Line:
    text: str
    confidence: float
    x: float  # box as fractions of the image
    y: float
    w: float
    h: float


@dataclass
class EngineConfig:
    det_model: str
    rec_model: str
    rec_keys: str | None = None
    rec_height: int = 48
    rec_max_width: int = 1600
    det_limit: int = 960
    det_thresh: float = 0.3
    box_thresh: float = 0.5
    unclip_ratio: float = 1.6
    text_score: float = 0.5
    use_space_char: bool = True
    threads: int = 0

    @staticmethod
    def from_env() -> "EngineConfig":
        def env(name: str, default=None):
            v = os.environ.get(name)
            return v if v not in (None, "") else default

        det, rec = env("OCR_DET_MODEL"), env("OCR_REC_MODEL")
        if not det or not rec:
            raise RuntimeError("set OCR_DET_MODEL and OCR_REC_MODEL to the ONNX model files")
        return EngineConfig(
            det_model=det,
            rec_model=rec,
            rec_keys=env("OCR_REC_KEYS"),
            rec_height=int(env("OCR_REC_HEIGHT", 48)),
            det_limit=int(env("OCR_DET_LIMIT", 960)),
            text_score=float(env("OCR_TEXT_SCORE", 0.5)),
            use_space_char=env("OCR_USE_SPACE_CHAR", "true").lower() == "true",
            threads=int(env("OCR_THREADS", 0)),
        )


class PPOCREngine:
    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        so = ort.SessionOptions()
        so.intra_op_num_threads = cfg.threads
        providers = ["CPUExecutionProvider"]
        self.det = ort.InferenceSession(cfg.det_model, so, providers=providers)
        self.rec = ort.InferenceSession(cfg.rec_model, so, providers=providers)
        chars = self._load_chars()
        # CTC: index 0 is "blank"; PP-OCR appends a space when use_space_char is on
        self.charset = ["<blank>"] + chars + ([" "] if cfg.use_space_char else [])
        self.name = f"{os.path.basename(cfg.det_model)} + {os.path.basename(cfg.rec_model)}"

    def _load_chars(self) -> list[str]:
        if self.cfg.rec_keys:
            with open(self.cfg.rec_keys, encoding="utf-8") as f:
                return [line.rstrip("\r\n") for line in f if line.rstrip("\r\n") != ""]
        meta = self.rec.get_modelmeta().custom_metadata_map
        if "character" in meta:
            return meta["character"].splitlines()
        raise RuntimeError("recognizer has no embedded character list; set OCR_REC_KEYS")

    # ------------------------------------------------------------ detection
    def detect(self, img: np.ndarray) -> list[np.ndarray]:
        h, w = img.shape[:2]
        ratio = min(1.0, self.cfg.det_limit / max(h, w))
        nh = max(32, int(round(h * ratio / 32)) * 32)
        nw = max(32, int(round(w * ratio / 32)) * 32)
        x = cv2.resize(img, (nw, nh)).astype(np.float32) / 255.0
        x = ((x - DET_MEAN) / DET_STD).transpose(2, 0, 1)[None]
        prob = self.det.run(None, {self.det.get_inputs()[0].name: x})[0][0, 0]

        bitmap = (prob > self.cfg.det_thresh).astype(np.uint8)
        bitmap = cv2.dilate(bitmap, np.ones((2, 2), np.uint8))
        contours, _ = cv2.findContours(bitmap * 255, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for c in contours[:1000]:
            if len(c) < 4:
                continue
            rect = cv2.minAreaRect(c)
            if min(rect[1]) < 3:
                continue
            if self._score(prob, c) < self.cfg.box_thresh:
                continue
            rw, rh = rect[1]
            d = rw * rh * self.cfg.unclip_ratio / (2 * (rw + rh))  # DB "unclip" for a rectangle
            rect = (rect[0], (rw + 2 * d, rh + 2 * d), rect[2])
            if min(rect[1]) < 5:
                continue
            pts = cv2.boxPoints(rect)
            pts[:, 0] = np.clip(pts[:, 0] / nw * w, 0, w - 1)
            pts[:, 1] = np.clip(pts[:, 1] / nh * h, 0, h - 1)
            boxes.append(self._order(pts))
        return boxes

    @staticmethod
    def _score(prob: np.ndarray, contour: np.ndarray) -> float:
        x, y, bw, bh = cv2.boundingRect(contour)
        mask = np.zeros((bh, bw), np.uint8)
        cv2.fillPoly(mask, [contour.reshape(-1, 2) - [x, y]], 1)
        return float(cv2.mean(prob[y : y + bh, x : x + bw], mask)[0])

    @staticmethod
    def _order(pts: np.ndarray) -> np.ndarray:
        """top-left, top-right, bottom-right, bottom-left"""
        s = pts.sum(axis=1)
        d = np.diff(pts, axis=1).ravel()
        return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)

    @staticmethod
    def _crop(img: np.ndarray, box: np.ndarray) -> np.ndarray:
        w = int(max(np.linalg.norm(box[0] - box[1]), np.linalg.norm(box[2] - box[3])))
        h = int(max(np.linalg.norm(box[0] - box[3]), np.linalg.norm(box[1] - box[2])))
        dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
        crop = cv2.warpPerspective(img, cv2.getPerspectiveTransform(box, dst), (max(w, 1), max(h, 1)), borderMode=cv2.BORDER_REPLICATE)
        if crop.shape[0] / max(crop.shape[1], 1) >= 1.5:
            crop = np.rot90(crop)
        return crop

    # ------------------------------------------------------------ recognition
    def recognize(self, crops: list[np.ndarray]) -> list[tuple[str, float]]:
        out: list[tuple[str, float]] = []
        H = self.cfg.rec_height
        for i in range(0, len(crops), 8):
            batch = crops[i : i + 8]
            widths = [min(self.cfg.rec_max_width, max(H, int(math.ceil(H * c.shape[1] / max(c.shape[0], 1))))) for c in batch]
            W = max(widths)
            x = np.zeros((len(batch), 3, H, W), dtype=np.float32)
            for j, (c, cw) in enumerate(zip(batch, widths)):
                r = cv2.resize(c, (cw, H)).astype(np.float32) / 255.0
                x[j, :, :, :cw] = ((r - 0.5) / 0.5).transpose(2, 0, 1)
            preds = self.rec.run(None, {self.rec.get_inputs()[0].name: x})[0]
            idx, prob = preds.argmax(axis=2), preds.max(axis=2)
            for j in range(len(batch)):
                chars, scores, prev = [], [], 0
                for t, k in enumerate(idx[j]):
                    if k != 0 and k != prev and k < len(self.charset):
                        chars.append(self.charset[k])
                        scores.append(float(prob[j, t]))
                    prev = k
                out.append(("".join(chars), float(np.mean(scores)) if scores else 0.0))
        return out

    # ------------------------------------------------------------ page
    def read(self, img: np.ndarray) -> list[Line]:
        h, w = img.shape[:2]
        boxes = self.detect(img)
        if not boxes:
            return []
        texts = self.recognize([self._crop(img, b) for b in boxes])
        lines = []
        for box, (text, score) in zip(boxes, texts):
            if not text.strip() or score < self.cfg.text_score:
                continue
            x0, y0 = box[:, 0].min(), box[:, 1].min()
            x1, y1 = box[:, 0].max(), box[:, 1].max()
            f = lambda v: round(float(v), 4)  # noqa: E731  plain floats for JSON
            lines.append(Line(text.strip(), f(score), f(x0 / w), f(y0 / h), f((x1 - x0) / w), f((y1 - y0) / h)))
        return merge_rows(lines)


def merge_rows(lines: list[Line]) -> list[Line]:
    """Reading order: pieces on the same visual row (vertical overlap) become one line, left to right."""
    rows: list[list[Line]] = []
    for ln in sorted(lines, key=lambda l: l.y + l.h / 2):
        mid = ln.y + ln.h / 2
        if rows and abs(mid - (rows[-1][0].y + rows[-1][0].h / 2)) < min(ln.h, rows[-1][0].h) * 0.5:
            rows[-1].append(ln)
        else:
            rows.append([ln])
    merged = []
    for row in rows:
        row.sort(key=lambda l: l.x)
        x0, y0 = min(l.x for l in row), min(l.y for l in row)
        x1, y1 = max(l.x + l.w for l in row), max(l.y + l.h for l in row)
        n = sum(len(l.text) for l in row) or 1
        conf = sum(l.confidence * len(l.text) for l in row) / n
        merged.append(Line(" ".join(l.text for l in row), round(conf, 4), x0, y0, round(x1 - x0, 4), round(y1 - y0, 4)))
    return merged
