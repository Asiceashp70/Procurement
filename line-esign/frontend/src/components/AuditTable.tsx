import { thaiDateTime } from '../lib/thai';

export interface AuditItem {
  id: string;
  createdAt: string;
  companyName: string | null;
  actorName: string;
  action: string;
  targetType: string | null;
  details: Record<string, unknown>;
  ip: string | null;
}
export interface AuditPage {
  page: number;
  hasMore: boolean;
  items: AuditItem[];
}

const ACTION_LABEL: Record<string, string> = {
  'membership.requested': 'ขอเข้าร่วมบริษัท',
  'membership.approved': 'อนุมัติสมาชิก',
  'membership.rejected': 'ปฏิเสธสมาชิก',
  'membership.suspended': 'ระงับสมาชิก',
  'membership.reactivated': 'เปิดใช้สมาชิกอีกครั้ง',
  'membership.updated': 'แก้ข้อมูลสมาชิก',
  'membership.create_permission_granted': 'เปิดสิทธิ์สร้างเอกสาร',
  'membership.create_permission_revoked': 'ปิดสิทธิ์สร้างเอกสาร',
  'membership.auto_approved_by_import': 'อนุมัติอัตโนมัติจากรายชื่อนำเข้า',
  'company.created': 'สร้างบริษัท',
  'company.updated': 'แก้ข้อมูลบริษัท',
  'company.suspended': 'ระงับบริษัท',
  'company.reactivated': 'เปิดใช้บริษัทอีกครั้ง',
  'company.invite_rotated': 'สร้างรหัสเชิญใหม่',
  'company_admin.appointed': 'แต่งตั้งผู้ดูแลบริษัท',
  'company_admin.removed': 'ถอดผู้ดูแลบริษัท',
  'employees.imported': 'นำเข้ารายชื่อพนักงาน',
  'departments.created': 'เพิ่มแผนก',
  'departments.updated': 'แก้แผนก',
  'positions.created': 'เพิ่มตำแหน่ง',
  'positions.updated': 'แก้ตำแหน่ง',
  'super_admin.granted_by_config': 'ได้สิทธิ์ Super Admin จากไฟล์ตั้งค่า',
  'super_admin.revoked_by_config': 'ถูกถอดสิทธิ์ Super Admin จากไฟล์ตั้งค่า',
};

export function AuditTable({ data, page, setPage, showCompany }: { data: AuditPage | null; page: number; setPage: (p: number) => void; showCompany?: boolean }) {
  if (!data) return <div className="loading">กำลังโหลด...</div>;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>เวลา</th>
            {showCompany && <th>บริษัท</th>}
            <th>ผู้ทำ</th>
            <th>การกระทำ</th>
            <th>รายละเอียด</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{thaiDateTime(i.createdAt)}</td>
              {showCompany && <td>{i.companyName ?? '-'}</td>}
              <td>{i.actorName}</td>
              <td>{ACTION_LABEL[i.action] ?? i.action}</td>
              <td className="muted small" style={{ maxWidth: 320, wordBreak: 'break-word' }}>
                {Object.keys(i.details ?? {}).length ? JSON.stringify(i.details) : ''}
                {i.ip && <div>IP {i.ip}</div>}
              </td>
            </tr>
          ))}
          {data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="muted center">
                ไม่มีรายการ
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
        <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span className="small">หน้า {page}</span>
        <button className="btn-sm" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
          ถัดไป
        </button>
      </div>
    </div>
  );
}
