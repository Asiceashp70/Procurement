import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { InjectDb, type Db } from '../db/database';
import type { User } from '../db/types';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizePhone } from './companies.service';
import { CompanyAccessService } from './company-access.service';

/** Accepted column headers (Thai or English). */
const HEADERS: Record<string, keyof ImportRow> = {
  'รหัสพนักงาน': 'employeeCode',
  employee_code: 'employeeCode',
  'ชื่อ': 'firstName',
  first_name: 'firstName',
  'นามสกุล': 'lastName',
  last_name: 'lastName',
  'เบอร์โทร': 'phone',
  phone: 'phone',
  'แผนก': 'department',
  department: 'department',
  'ตำแหน่ง': 'position',
  position: 'position',
  'สิทธิ์สร้างเอกสาร': 'canCreate',
  can_create_documents: 'canCreate',
};

interface ImportRow {
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  department: string;
  position: string;
  canCreate: string;
}

const MAX_ROWS = 5000;
const YES = new Set(['y', 'yes', 'true', '1', 'ใช่', 'มี', '✓']);

@Injectable()
export class ImportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: CompanyAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async parseFile(file: { originalname: string; buffer: Buffer }): Promise<Record<string, string>[]> {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.csv')) {
      const text = file.buffer.toString('utf8').replace(/^﻿/, '');
      return parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
    }
    if (name.endsWith('.xlsx')) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (!ws) return [];
      const headers: string[] = [];
      ws.getRow(1).eachCell((cell, col) => (headers[col] = String(cell.text).trim()));
      const rows: Record<string, string>[] = [];
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const obj: Record<string, string> = {};
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          if (headers[col]) obj[headers[col]] = String(cell.text ?? '').trim();
        });
        if (Object.values(obj).some(Boolean)) rows.push(obj);
      });
      return rows;
    }
    throw new BadRequestException('รองรับไฟล์ .csv หรือ .xlsx เท่านั้น');
  }

  async import(user: User, companyId: string, raw: Record<string, string>[], meta: RequestMeta) {
    await this.access.requireAdmin(user, companyId);
    if (raw.length === 0) throw new BadRequestException('ไม่พบข้อมูลในไฟล์');
    if (raw.length > MAX_ROWS) throw new BadRequestException(`นำเข้าได้ครั้งละไม่เกิน ${MAX_ROWS} แถว`);

    const rows = raw.map((r) => {
      const out: Partial<ImportRow> = {};
      for (const [k, v] of Object.entries(r)) {
        const key = HEADERS[k.trim().toLowerCase()] ?? HEADERS[k.trim()];
        if (key) out[key] = String(v ?? '').trim();
      }
      return out;
    });

    const errors: { row: number; message: string }[] = [];
    const seen = new Set<string>();
    const valid: (ImportRow & { rowNo: number })[] = [];
    rows.forEach((r, i) => {
      const rowNo = i + 2; // header is row 1
      const phone = normalizePhone(r.phone ?? '');
      if (!r.employeeCode) return errors.push({ row: rowNo, message: 'ไม่มีรหัสพนักงาน' });
      if (!/^0\d{8,9}$/.test(phone)) return errors.push({ row: rowNo, message: 'เบอร์โทรไม่ถูกต้อง' });
      const key = r.employeeCode.toLowerCase();
      if (seen.has(key)) return errors.push({ row: rowNo, message: `รหัสพนักงาน ${r.employeeCode} ซ้ำในไฟล์` });
      seen.add(key);
      valid.push({ rowNo, employeeCode: r.employeeCode, phone, firstName: r.firstName ?? '', lastName: r.lastName ?? '', department: r.department ?? '', position: r.position ?? '', canCreate: r.canCreate ?? '' });
    });

    const result = await this.db.transaction().execute(async (trx) => {
      const ensure = async (kind: 'departments' | 'positions', name: string, created: Set<string>) => {
        if (!name) return null;
        const found = await trx.selectFrom(kind).select('id').where('company_id', '=', companyId).where(sql`lower(name)`, '=', name.toLowerCase()).executeTakeFirst();
        if (found) return found.id;
        created.add(name);
        const row = await trx.insertInto(kind).values({ company_id: companyId, name }).returning('id').executeTakeFirstOrThrow();
        return row.id;
      };
      const createdDepartments = new Set<string>();
      const createdPositions = new Set<string>();
      let inserted = 0;
      let updated = 0;
      for (const r of valid) {
        const departmentId = await ensure('departments', r.department, createdDepartments);
        const positionId = await ensure('positions', r.position, createdPositions);
        const values = {
          company_id: companyId,
          employee_code: r.employeeCode,
          phone: r.phone,
          first_name: r.firstName || null,
          last_name: r.lastName || null,
          department_id: departmentId,
          position_id: positionId,
          can_create_documents: YES.has(r.canCreate.toLowerCase()),
          imported_by: user.id,
        };
        const existing = await trx
          .selectFrom('employee_imports')
          .select('id')
          .where('company_id', '=', companyId)
          .where(sql`lower(employee_code)`, '=', r.employeeCode.toLowerCase())
          .executeTakeFirst();
        if (existing) {
          await trx.updateTable('employee_imports').set({ ...values, imported_at: new Date() }).where('id', '=', existing.id).execute();
          updated++;
        } else {
          await trx.insertInto('employee_imports').values(values).execute();
          inserted++;
        }
      }

      // Pending requests that now match an imported row are approved automatically.
      const company = await trx.selectFrom('companies').select('name').where('id', '=', companyId).executeTakeFirstOrThrow();
      const matches = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .innerJoin('employee_imports as e', (j) =>
          j
            .onRef('e.company_id', '=', 'm.company_id')
            .on(sql`lower(e.employee_code)`, '=', sql`lower(m.employee_code)`)
            .on(sql`e.phone`, '=', sql`regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g')`),
        )
        .select(['m.id as membershipId', 'm.user_id as userId', 'e.id as importId', 'e.can_create_documents as canCreate'])
        .where('m.company_id', '=', companyId)
        .where('m.status', '=', 'pending')
        .where('e.matched_membership_id', 'is', null)
        .execute();
      for (const m of matches) {
        await trx
          .updateTable('memberships')
          .set({ status: 'approved', decided_at: new Date(), decided_by: user.id, can_create_documents: m.canCreate, join_method: 'import', updated_at: new Date() })
          .where('id', '=', m.membershipId)
          .execute();
        await trx.updateTable('employee_imports').set({ matched_membership_id: m.membershipId }).where('id', '=', m.importId).execute();
        await this.notifications.enqueue({ userId: m.userId, companyId, type: 'membership.approved', payload: { companyName: company.name, auto: true } }, trx);
      }

      const summary = {
        inserted,
        updated,
        autoApproved: matches.length,
        createdDepartments: [...createdDepartments],
        createdPositions: [...createdPositions],
        errors,
      };
      await this.audit.log({ companyId, actor: user, action: 'employees.imported', targetType: 'company', targetId: companyId, details: { ...summary, errors: errors.length }, meta }, trx);
      return summary;
    });
    return result;
  }

  async list(user: User, companyId: string) {
    await this.access.requireAdmin(user, companyId);
    return this.db
      .selectFrom('employee_imports as e')
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .leftJoin('positions as p', 'p.id', 'e.position_id')
      .select([
        'e.id',
        'e.employee_code as employeeCode',
        'e.first_name as firstName',
        'e.last_name as lastName',
        'e.phone',
        'd.name as departmentName',
        'p.name as positionName',
        'e.can_create_documents as canCreateDocuments',
        'e.matched_membership_id as matchedMembershipId',
        'e.imported_at as importedAt',
      ])
      .where('e.company_id', '=', companyId)
      .orderBy('e.employee_code')
      .execute();
  }
}
