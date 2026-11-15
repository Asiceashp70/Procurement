import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T = Record<string, unknown>> = ColumnType<T, T | string | undefined, T | string>;

export type MembershipStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type MembershipRole = 'admin' | 'member';

export interface UsersTable {
  id: Generated<string>;
  line_user_id: string;
  line_display_name: string | null;
  line_picture_url: string | null;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  is_oa_friend: Generated<boolean>;
  oa_friend_checked_at: NullableTimestamp;
  is_super_admin: Generated<boolean>;
  registered_at: NullableTimestamp;
  last_login_at: NullableTimestamp;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConsentsTable {
  id: Generated<string>;
  user_id: string;
  consent_version: string;
  consent_sha256: string;
  accepted_at: Generated<Date>;
  ip: string | null;
  user_agent: string | null;
}

export interface SignaturesTable {
  id: Generated<string>;
  user_id: string;
  method: 'draw' | 'upload';
  storage_key: string;
  width: number;
  height: number;
  byte_size: number;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  deactivated_at: NullableTimestamp;
}

export interface CompanySettings {
  reminderHoursBeforeDue: number;
}

export interface CompaniesTable {
  id: Generated<string>;
  name: string;
  tax_id: string | null;
  address: string | null;
  logo_key: string | null;
  status: Generated<'active' | 'suspended'>;
  invite_code: string;
  invite_token: string;
  invite_rotated_at: Generated<Date>;
  settings: Json<CompanySettings>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ListTable {
  id: Generated<string>;
  company_id: string;
  name: string;
  sort_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface MembershipsTable {
  id: Generated<string>;
  user_id: string;
  company_id: string;
  employee_code: string | null;
  department_id: string | null;
  position_id: string | null;
  role: Generated<MembershipRole>;
  status: Generated<MembershipStatus>;
  can_create_documents: Generated<boolean>;
  join_method: Generated<'code' | 'link' | 'appointed' | 'import'>;
  requested_at: Generated<Date>;
  decided_at: NullableTimestamp;
  decided_by: string | null;
  reject_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EmployeeImportsTable {
  id: Generated<string>;
  company_id: string;
  employee_code: string;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  department_id: string | null;
  position_id: string | null;
  can_create_documents: Generated<boolean>;
  matched_membership_id: string | null;
  imported_by: string | null;
  imported_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  company_id: string | null;
  actor_user_id: string | null;
  actor_line_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Json;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface JobsTable {
  id: Generated<string>;
  type: string;
  payload: Json;
  status: Generated<'queued' | 'running' | 'done' | 'failed'>;
  run_at: Timestamp;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  last_error: string | null;
  locked_at: NullableTimestamp;
  locked_by: string | null;
  created_at: Generated<Date>;
  finished_at: NullableTimestamp;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  company_id: string | null;
  type: string;
  payload: Json;
  status: Generated<'pending' | 'sent' | 'failed' | 'skipped'>;
  attempts: Generated<number>;
  last_error: string | null;
  retry_key: Generated<string>;
  line_request_id: string | null;
  scheduled_at: Timestamp;
  sent_at: NullableTimestamp;
  created_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  consents: ConsentsTable;
  signatures: SignaturesTable;
  companies: CompaniesTable;
  departments: ListTable;
  positions: ListTable;
  memberships: MembershipsTable;
  employee_imports: EmployeeImportsTable;
  audit_logs: AuditLogsTable;
  jobs: JobsTable;
  notifications: NotificationsTable;
}

export type User = Selectable<UsersTable>;
export type Company = Selectable<CompaniesTable>;
export type Membership = Selectable<MembershipsTable>;
export type NewJob = Insertable<JobsTable>;
export type MembershipUpdate = Updateable<MembershipsTable>;

// ---------------------------------------------------------------- phase 2

export type DocumentStatus = 'draft' | 'pending' | 'completed' | 'declined' | 'voided';
export type SignerStatus = 'waiting' | 'pending' | 'signed' | 'declined' | 'replaced';
export type FieldType = 'signature' | 'date' | 'text' | 'checkbox' | 'stamp' | 'certified_copy';

export interface CompanyStampsTable {
  id: Generated<string>;
  company_id: string;
  name: string;
  storage_key: string;
  width: number;
  height: number;
  is_active: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
}

export interface CompanyStampUsersTable {
  stamp_id: string;
  user_id: string;
}

export interface CompanyCertificatesTable {
  id: Generated<string>;
  company_id: string;
  storage_key: string;
  password_enc: string;
  subject: string;
  issuer: string;
  serial_number: string;
  not_before: Timestamp;
  not_after: Timestamp;
  is_active: Generated<boolean>;
  uploaded_by: string | null;
  created_at: Generated<Date>;
  notified_30d_at: NullableTimestamp;
  notified_7d_at: NullableTimestamp;
}

export interface DocumentsTable {
  id: Generated<string>;
  company_id: string;
  created_by: string;
  title: string;
  description: string | null;
  doc_type: string | null;
  tags: ColumnType<string[], string[] | undefined, string[]>;
  status: Generated<DocumentStatus>;
  signing_mode: Generated<'parallel' | 'sequential'>;
  due_at: NullableTimestamp;
  notify_creator_on_sign: Generated<boolean>;
  original_name: string;
  original_mime: string;
  original_key: string;
  source_key: string;
  original_sha256: string;
  source_sha256: string;
  page_count: number;
  byte_size: number;
  final_key: string | null;
  final_sha256: string | null;
  seal_status: Generated<'none' | 'sealed' | 'no_certificate' | 'failed'>;
  sealed_certificate_id: string | null;
  timestamped: Generated<boolean>;
  sent_at: NullableTimestamp;
  completed_at: NullableTimestamp;
  finalized_at: NullableTimestamp;
  declined_at: NullableTimestamp;
  voided_at: NullableTimestamp;
  void_reason: string | null;
  due_soon_notified_at: NullableTimestamp;
  overdue_notices_sent: Generated<number>;
  last_overdue_notice_at: NullableTimestamp;
  title_normalized: string | null;
  text_status: Generated<'pending' | 'extracting' | 'ocr' | 'ready' | 'failed'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PageLine {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  c?: number; // OCR confidence 0..1
}

export interface DocumentPagesTable {
  document_id: string;
  page_no: number;
  width: number;
  height: number;
  rotation: Generated<number>;
  text: string | null;
  text_normalized: string | null;
  text_source: 'pdf' | 'ocr' | null;
  ocr_confidence: number | null;
  lines: Json<PageLine[]> | null;
  ocr_status: Generated<'none' | 'queued' | 'done' | 'failed' | 'skipped'>;
  extracted_at: NullableTimestamp;
}

export interface DocumentSignersTable {
  id: Generated<string>;
  document_id: string;
  user_id: string;
  order_index: Generated<number>;
  status: Generated<SignerStatus>;
  display_name: string | null;
  position_name: string | null;
  department_name: string | null;
  notified_at: NullableTimestamp;
  opened_at: NullableTimestamp;
  signed_at: NullableTimestamp;
  declined_at: NullableTimestamp;
  decline_reason: string | null;
  reminder_count: Generated<number>;
  last_reminded_at: NullableTimestamp;
  replaced_by: string | null;
  replaced_reason: string | null;
  signature_key: string | null;
  sign_ip: string | null;
  sign_user_agent: string | null;
  created_at: Generated<Date>;
}

export interface FieldSettings {
  label?: string;
  required?: boolean;
  maxLength?: number;
  fontSize?: number;
  dateFormat?: 'short' | 'long' | 'numeric';
  stampId?: string;
  text?: string; // certified copy wording
}

export interface FieldsTable {
  id: Generated<string>;
  document_id: string;
  signer_id: string;
  page_no: number;
  type: FieldType;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: Json<FieldSettings>;
  value: ColumnType<unknown, unknown, unknown>;
  filled_at: NullableTimestamp;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
}

export interface DocumentEventsTable {
  id: Generated<string>;
  document_id: string;
  type: string;
  actor_user_id: string | null;
  actor_line_user_id: string | null;
  signer_id: string | null;
  details: Json;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  company_stamps: CompanyStampsTable;
  company_stamp_users: CompanyStampUsersTable;
  company_certificates: CompanyCertificatesTable;
  documents: DocumentsTable;
  document_pages: DocumentPagesTable;
  document_signers: DocumentSignersTable;
  fields: FieldsTable;
  document_events: DocumentEventsTable;
}

export type Document = Selectable<DocumentsTable>;
export type DocumentSigner = Selectable<DocumentSignersTable>;
export type Field = Selectable<FieldsTable>;
