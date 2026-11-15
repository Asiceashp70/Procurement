-- ZenHere: phase 1 schema (accounts, companies, members, signatures, notifications, jobs, audit)
-- All timestamps are stored as timestamptz (UTC). The UI shows Thai time (UTC+7) and Buddhist-era years.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id        text NOT NULL UNIQUE,
  line_display_name   text,
  line_picture_url    text,
  first_name          text,
  last_name           text,
  nickname            text,
  phone               text,
  email               text,
  is_oa_friend        boolean NOT NULL DEFAULT false,
  oa_friend_checked_at timestamptz,
  is_super_admin      boolean NOT NULL DEFAULT false,
  registered_at       timestamptz,               -- null until the first-time form (REG-01..03, REG-08) is complete
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- REG-08: every PDPA consent is kept with the exact text version and time
CREATE TABLE consents (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id),
  consent_version  text NOT NULL,
  consent_sha256   text NOT NULL,
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  ip               text,
  user_agent       text
);
CREATE INDEX consents_user_idx ON consents(user_id);

-- ---------------------------------------------------------------- signatures (SIG-01..07)
CREATE TABLE signatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  method          text NOT NULL CHECK (method IN ('draw', 'upload')),
  storage_key     text NOT NULL,                 -- AES-256-GCM encrypted PNG on disk
  width           int  NOT NULL,
  height          int  NOT NULL,
  byte_size       int  NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz
);
CREATE UNIQUE INDEX signatures_one_active ON signatures(user_id) WHERE is_active;
CREATE INDEX signatures_user_idx ON signatures(user_id, created_at DESC);

-- ---------------------------------------------------------------- companies (ADM-01, ADM-02)
CREATE TABLE companies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  tax_id             text,
  address            text,
  logo_key           text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  invite_code        char(8) NOT NULL UNIQUE,
  invite_token       text NOT NULL UNIQUE,
  invite_rotated_at  timestamptz NOT NULL DEFAULT now(),
  settings           jsonb NOT NULL DEFAULT '{"reminderHoursBeforeDue": 24}'::jsonb,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ADM-05: per-company dropdown lists
CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX departments_name_uq ON departments(company_id, lower(name));

CREATE TABLE positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX positions_name_uq ON positions(company_id, lower(name));

-- ---------------------------------------------------------------- memberships (REG-02, REG-04, REG-05, ADM-03, ADM-04, ADM-06)
CREATE TABLE memberships (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id),
  company_id            uuid NOT NULL REFERENCES companies(id),
  employee_code         text,
  department_id         uuid REFERENCES departments(id),
  position_id           uuid REFERENCES positions(id),
  role                  text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  can_create_documents  boolean NOT NULL DEFAULT false,
  join_method           text NOT NULL DEFAULT 'code' CHECK (join_method IN ('code', 'link', 'appointed', 'import')),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  decided_by            uuid REFERENCES users(id),
  reject_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);
-- REG-02: employee code is unique inside one company (rejected requests do not hold the code)
CREATE UNIQUE INDEX memberships_employee_code_uq
  ON memberships(company_id, lower(employee_code))
  WHERE employee_code IS NOT NULL AND status <> 'rejected';
CREATE INDEX memberships_company_status_idx ON memberships(company_id, status);

-- ADM-07: employees imported ahead of time; a join request matching code + phone is approved automatically
CREATE TABLE employee_imports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  employee_code         text NOT NULL,
  phone                 text NOT NULL,            -- digits only
  first_name            text,
  last_name             text,
  department_id         uuid REFERENCES departments(id),
  position_id           uuid REFERENCES positions(id),
  can_create_documents  boolean NOT NULL DEFAULT false,
  matched_membership_id uuid REFERENCES memberships(id),
  imported_by           uuid REFERENCES users(id),
  imported_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employee_imports_code_uq ON employee_imports(company_id, lower(employee_code));

-- ---------------------------------------------------------------- audit log (ADM-09, SGN-06 style: append-only)
CREATE TABLE audit_logs (
  id              bigserial PRIMARY KEY,
  company_id      uuid REFERENCES companies(id),
  actor_user_id   uuid REFERENCES users(id),
  actor_line_user_id text,
  action          text NOT NULL,
  target_type     text,
  target_id       text,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip              text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_idx ON audit_logs(company_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();

-- ---------------------------------------------------------------- background jobs (no Redis: FOR UPDATE SKIP LOCKED)
CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  last_error    text,
  locked_at     timestamptz,
  locked_by     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs(run_at) WHERE status = 'queued';

-- ---------------------------------------------------------------- LINE notifications (every message is recorded)
CREATE TABLE notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  company_id        uuid REFERENCES companies(id),
  type              text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  retry_key         uuid NOT NULL DEFAULT gen_random_uuid(),   -- X-Line-Retry-Key, so a retry never sends twice
  line_request_id   text,
  scheduled_at      timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_sent_month_idx ON notifications(sent_at) WHERE status = 'sent';
