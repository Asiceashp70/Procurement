-- LINE e-Sign phase 3: full-text search and OCR

ALTER TABLE documents
  ADD COLUMN title_normalized text,
  ADD COLUMN text_status text NOT NULL DEFAULT 'pending'
    CHECK (text_status IN ('pending', 'extracting', 'ocr', 'ready', 'failed'));
-- rough value until the extraction job re-normalizes it in application code
UPDATE documents SET title_normalized = lower(regexp_replace(title, '\s', '', 'g'));
CREATE INDEX documents_title_norm_trgm ON documents USING gin (title_normalized gin_trgm_ops);
CREATE INDEX documents_text_status_idx ON documents(text_status) WHERE text_status <> 'ready';

ALTER TABLE document_pages
  ADD COLUMN lines jsonb,                     -- [{ t, x, y, w, h }] boxes as fractions of the displayed page
  ADD COLUMN ocr_status text NOT NULL DEFAULT 'none'
    CHECK (ocr_status IN ('none', 'queued', 'done', 'failed', 'skipped')),
  ADD COLUMN extracted_at timestamptz;

-- SRC-05/SRC-09: substring search on normalized Thai text without word segmentation
CREATE INDEX document_pages_text_trgm ON document_pages USING gin (text_normalized gin_trgm_ops);
