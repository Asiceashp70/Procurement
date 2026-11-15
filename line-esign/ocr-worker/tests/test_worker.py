from fastapi.testclient import TestClient

import app as worker
from tests.make_pdf import make_pdf

PDF = make_pdf(
    [
        ([(60, 760, 28, "INVOICE NO 2569"), (60, 700, 20, "Total amount 12345 THB"), (60, 120, 16, "Signed by Somsri")], 0),
        ([(60, 760, 28, "ROTATED PAGE")], 90),
    ]
)

client = TestClient(worker.app)


def test_health_reports_engine():
    r = client.get("/health")
    assert r.status_code == 200
    assert "det" in r.json()["engine"]


def test_reads_text_with_boxes_in_page_fractions():
    r = client.post("/ocr", files={"file": ("a.pdf", PDF, "application/pdf")}, data={"pages": "1"})
    assert r.status_code == 200, r.text
    page = r.json()["pages"][0]
    text = page["text"].replace(" ", "").upper()
    assert "INVOICE" in text and "2569" in text
    assert "12345" in text
    assert 0.5 < page["confidence"] <= 1
    # reading order top to bottom; boxes are fractions of the displayed page
    first, last = page["lines"][0], page["lines"][-1]
    assert "INVOICE" in first["text"].upper()
    assert 0.05 < first["y"] < 0.15  # y=760pt of 842 from the bottom -> near the top
    assert last["y"] > 0.8
    for ln in page["lines"]:
        assert 0 <= ln["x"] <= 1 and 0 <= ln["y"] <= 1 and 0 < ln["w"] <= 1 and 0 < ln["h"] <= 1


def test_rotated_page_is_read_as_displayed():
    r = client.post("/ocr", files={"file": ("a.pdf", PDF, "application/pdf")}, data={"pages": "2"})
    page = r.json()["pages"][0]
    assert "ROTATED" in page["text"].replace(" ", "").upper()
    # /Rotate 90 shows the page landscape: text that ran along the top edge runs down the right side
    line = page["lines"][0]
    assert line["x"] > 0.8


def test_rejects_bad_input():
    assert client.post("/ocr", files={"file": ("a.pdf", b"not a pdf", "application/pdf")}).status_code == 400
    assert client.post("/ocr", files={"file": ("a.pdf", PDF, "application/pdf")}, data={"pages": "9"}).status_code == 400
    assert client.post("/ocr", files={"file": ("a.pdf", PDF, "application/pdf")}, data={"dpi": "1000"}).status_code == 400


def test_token(monkeypatch):
    monkeypatch.setenv("OCR_TOKEN", "s3cret")
    assert client.post("/ocr", files={"file": ("a.pdf", PDF, "application/pdf")}).status_code == 401
    ok = client.post("/ocr", files={"file": ("a.pdf", PDF, "application/pdf")}, data={"pages": "1"}, headers={"x-ocr-token": "s3cret"})
    assert ok.status_code == 200
