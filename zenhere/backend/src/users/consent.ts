import { config } from '../config/config';
import { sha256Hex } from '../common/crypto';

/**
 * REG-08 / PDPA: purpose notice shown at registration. Changing the text means
 * bumping PDPA_CONSENT_VERSION so everyone is asked again; each acceptance stores
 * the version and the SHA-256 of the exact text.
 * NOTE: draft wording, to be reviewed by the company's legal/DPO before go-live.
 */
const CONSENT_TEXT = `การเก็บและใช้ข้อมูลส่วนบุคคลในระบบ ZenHere

1. ข้อมูลที่เก็บ: รหัสบัญชีและชื่อที่แสดงของบัญชีที่ใช้เข้าสู่ระบบ ชื่อ นามสกุล ชื่อเล่น เบอร์โทร อีเมล รหัสพนักงาน แผนก ตำแหน่ง รูปลายเซ็น และหลักฐานการลงนาม (เวลา หมายเลข IP และอุปกรณ์ที่ใช้)
2. วัตถุประสงค์: ยืนยันตัวตน ส่งเอกสารให้ลงนาม แจ้งเตือนเมื่อมีเอกสาร และเก็บหลักฐานว่าใครลงนามเอกสารใดเมื่อใด
3. ผู้ที่เห็นข้อมูล: ผู้ดูแลระบบของบริษัทที่ท่านสังกัด และผู้เกี่ยวข้องกับเอกสารที่ท่านเป็นผู้สร้างหรือผู้ลงนามเท่านั้น
4. ระยะเวลาเก็บ: ตามนโยบายการเก็บรักษาเอกสารของบริษัท เอกสารที่ลงนามครบแล้วจะถูกเก็บไว้เป็นหลักฐานและไม่สามารถลบได้ก่อนครบกำหนด
5. สิทธิ์ของท่าน: ท่านดูและแก้ไขข้อมูลส่วนตัวและลายเซ็นของตนเองได้ที่หน้า "ข้อมูลของฉัน" และติดต่อผู้ดูแลระบบของบริษัทเพื่อใช้สิทธิ์อื่นตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล`;

export function currentConsent() {
  return { version: config().PDPA_CONSENT_VERSION, text: CONSENT_TEXT, sha256: sha256Hex(CONSENT_TEXT) };
}
