import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(scope="session", autouse=True)
def stand_in_models():
    """The OpenThai models cannot be downloaded in CI; the PP-OCRv3 models bundled with
    rapidocr_onnxruntime (same detector/recognizer architecture) exercise the pipeline."""
    if os.environ.get("OCR_DET_MODEL"):
        return
    import rapidocr_onnxruntime

    models = Path(rapidocr_onnxruntime.__file__).parent / "models"
    os.environ["OCR_DET_MODEL"] = str(models / "ch_PP-OCRv3_det_infer.onnx")
    os.environ["OCR_REC_MODEL"] = str(models / "ch_PP-OCRv3_rec_infer.onnx")
