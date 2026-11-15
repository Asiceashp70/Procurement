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
