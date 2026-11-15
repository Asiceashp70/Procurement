export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public errors?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? `เกิดข้อผิดพลาด (${res.status})`);
    throw new ApiError(res.status, msg, data?.code, data?.errors);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const fieldErrors = (err: unknown): Record<string, string> =>
  err instanceof ApiError && err.errors ? Object.fromEntries(err.errors.map((e) => [e.field, e.message])) : {};

// ---- types shared by pages

export type MembershipStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface MyMembership {
  id: string;
  companyId: string;
  companyName: string;
  companyStatus: 'active' | 'suspended';
  employeeCode: string | null;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  role: 'admin' | 'member';
  status: MembershipStatus;
  canCreateDocuments: boolean;
  rejectReason: string | null;
  requestedAt: string;
}

export interface Me {
  id: string;
  lineDisplayName: string | null;
  linePictureUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  isOaFriend: boolean;
  isSuperAdmin: boolean;
  registered: boolean;
  needsConsent: boolean;
  activeSignature: { id: string; createdAt: string } | null;
  memberships: MyMembership[];
}

export interface AuthConfig {
  lineLoginEnabled: boolean;
  devLoginEnabled: boolean;
  oaAddFriendUrl: string | null;
  consentVersion: string;
}

export interface ListItem {
  id: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}
