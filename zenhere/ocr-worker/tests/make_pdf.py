"""Writes small PDFs with Helvetica text for the tests (no extra dependencies)."""


def make_pdf(pages: list[tuple[list[tuple[float, float, int, str]], int]]) -> bytes:
    """pages: [([(x, y, size, text), ...], rotate), ...] on A4 portrait."""
    objs: list[bytes] = []

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids = []
    pages_id_placeholder = len(objs) + 1 + 2 * len(pages)  # objects added below, then /Pages
    for lines, rotate in pages:
        stream = b"BT\n" + b"".join(f"/F1 {s} Tf 1 0 0 1 {x} {y} Tm ({t}) Tj\n".encode() for x, y, s, t in lines) + b"ET"
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Rotate %d /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id_placeholder, rotate, font, content)
            )
        )
    pages_id = add(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % p for p in page_ids), len(page_ids)))
    assert pages_id == pages_id_placeholder
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = bytearray(b"%PDF-1.7\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, xref)
    return bytes(out)
