-- LINE e-Sign phase 2: documents, fields, signers, events, company stamps and certificates

-- ---------------------------------------------------------------- company stamps (ADM-10)
CREATE TABLE company_stamps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  name         text NOT NULL,
  storage_key  text NOT NULL,
  width        int NOT NULL,
  height       int NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE company_stamp_users (
  stamp_id  uuid NOT NULL REFERENCES company_stamps(id),
  user_id   uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (stamp_id, user_id)
);

-- ---------------------------------------------------------------- company certificates (ADM-11)
CREATE TABLE company_certificates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  storage_key     text NOT NULL,          -- encrypted .p12
  password_enc    text NOT NULL,          -- AES-256-GCM, base64
  subject         text NOT NULL,
  issuer          text NOT NULL,
  serial_number   text NOT NULL,
  not_before      timestamptz NOT NULL,
  not_after       timestamptz NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  uploaded_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  notified_30d_at timestamptz,
  notified_7d_at  timestamptz
);
CREATE UNIQUE INDEX company_certificates_one_active ON company_certificates(company_id) WHERE is_active;

-- ---------------------------------------------------------------- documents (DOC-01..10)
CREATE TABLE documents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id),
  created_by               uuid NOT NULL REFERENCES users(id),
  title                    text NOT NULL,
  description              text,
  doc_type                 text,
  tags                     text[] NOT NULL DEFAULT '{}',
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'completed', 'declined', 'voided')),
  signing_mode             text NOT NULL DEFAULT 'sequential' CHECK (signing_mode IN ('parallel', 'sequential')),
  due_at                   timestamptz,
  notify_creator_on_sign   boolean NOT NULL DEFAULT true,
  original_name            text NOT NULL,
  original_mime            text NOT NULL,
  original_key             text NOT NULL,    -- the uploaded file as received
  source_key               text NOT NULL,    -- the PDF that is signed (same bytes as original for PDF uploads)
  original_sha256          text NOT NULL,
  source_sha256            text NOT NULL,
  page_count               int  NOT NULL,
  byte_size                int  NOT NULL,
  final_key                text,
  final_sha256             text,
  seal_status              text NOT NULL DEFAULT 'none' CHECK (seal_status IN ('none', 'sealed', 'no_certificate', 'failed')),
  sealed_certificate_id    uuid REFERENCES company_certificates(id),
  timestamped              boolean NOT NULL DEFAULT false,
  sent_at                  timestamptz,
  completed_at             timestamptz,
  finalized_at             timestamptz,
  declined_at              timestamptz,
  voided_at                timestamptz,
  void_reason              text,
  due_soon_notified_at     timestamptz,
  overdue_notices_sent     int NOT NULL DEFAULT 0,
  last_overdue_notice_at   timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_company_status_idx ON documents(company_id, status, created_at DESC);
CREATE INDEX documents_creator_idx ON documents(created_by, created_at DESC);
CREATE UNIQUE INDEX documents_final_sha_idx ON documents(final_sha256) WHERE final_sha256 IS NOT NULL;
CREATE INDEX documents_source_sha_idx ON documents(source_sha256);
CREATE INDEX documents_title_trgm ON documents USING gin (title gin_trgm_ops);

-- page geometry now; text/OCR columns are filled by the search phase
CREATE TABLE document_pages (
  document_id      uuid NOT NULL REFERENCES documents(id),
  page_no          int  NOT NULL,
  width            real NOT NULL,     -- crop box, PDF points, before rotation
  height           real NOT NULL,
  rotation         int  NOT NULL DEFAULT 0,
  text             text,
  text_normalized  text,
  text_source      text CHECK (text_source IN ('pdf', 'ocr')),
  ocr_confidence   real,
  PRIMARY KEY (document_id, page_no)
);

CREATE TABLE document_signers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES documents(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  order_index      int  NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'signed', 'declined', 'replaced')),
  display_name     text,               -- snapshot for the certificate page
  position_name    text,
  department_name  text,
  notified_at      timestamptz,
  opened_at        timestamptz,
  signed_at        timestamptz,
  declined_at      timestamptz,
  decline_reason   text,
  reminder_count   int NOT NULL DEFAULT 0,
  last_reminded_at timestamptz,
  replaced_by      uuid REFERENCES document_signers(id),
  replaced_reason  text,
  signature_key    text,               -- SIG-07: copy of the signature used for this document
  sign_ip          text,
  sign_user_agent  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX document_signers_user_uq ON document_signers(document_id, user_id) WHERE status <> 'replaced';
CREATE INDEX document_signers_user_idx ON document_signers(user_id, status);

CREATE TABLE fields (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES documents(id),
  signer_id    uuid NOT NULL REFERENCES document_signers(id),
  page_no      int  NOT NULL,
  type         text NOT NULL CHECK (type IN ('signature', 'date', 'text', 'checkbox', 'stamp', 'certified_copy')),
  x            double precision NOT NULL CHECK (x >= 0 AND x <= 1),
  y            double precision NOT NULL CHECK (y >= 0 AND y <= 1),
  w            double precision NOT NULL CHECK (w > 0 AND w <= 1),
  h            double precision NOT NULL CHECK (h > 0 AND h <= 1),
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  value        jsonb,
  filled_at    timestamptz,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fields_document_idx ON fields(document_id, page_no);

-- SGN-06: append-only document audit trail
CREATE TABLE document_events (
  id                  bigserial PRIMARY KEY,
  document_id         uuid NOT NULL REFERENCES documents(id),
  type                text NOT NULL,
  actor_user_id       uuid REFERENCES users(id),
  actor_line_user_id  text,
  signer_id           uuid REFERENCES document_signers(id),
  details             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip                  text,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_events_doc_idx ON document_events(document_id, id);
CREATE TRIGGER document_events_append_only BEFORE UPDATE OR DELETE ON document_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER document_events_no_truncate BEFORE TRUNCATE ON document_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
