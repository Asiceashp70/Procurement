import { useState, type FormEvent, type ReactNode } from 'react';

export interface ProfileValues {
  firstName: string;
  lastName: string;
  nickname: string;
  phone: string;
  email: string;
}

const PHONE = /^0\d{8,9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateProfile(v: ProfileValues): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.firstName.trim()) e.firstName = 'กรุณากรอกชื่อ';
  if (!v.lastName.trim()) e.lastName = 'กรุณากรอกนามสกุล';
  if (!PHONE.test(v.phone.replace(/[\s-]/g, ''))) e.phone = 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลักขึ้นต้นด้วย 0';
  if (!EMAIL.test(v.email.trim())) e.email = 'รูปแบบอีเมลไม่ถูกต้อง';
  return e;
}

export function ProfileForm({
  initial,
  onSubmit,
  submitLabel,
  serverErrors = {},
  busy,
  extra,
}: {
  initial: ProfileValues;
  onSubmit: (v: ProfileValues) => void;
  submitLabel: string;
  serverErrors?: Record<string, string>;
  busy?: boolean;
  extra?: ReactNode;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const all = { ...serverErrors, ...errors };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateProfile(v);
    setErrors(found);
    if (!Object.keys(found).length) onSubmit(v);
  };
  const field = (key: keyof ProfileValues, label: string, type: string, required: boolean, props: Record<string, string> = {}) => (
    <label className="field">
      <span>
        {label} {required && <span className="req">*</span>}
      </span>
      <input type={type} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} {...props} />
      {all[key] && <div className="field-error">{all[key]}</div>}
    </label>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid2">
        {field('firstName', 'ชื่อ', 'text', true, { autoComplete: 'given-name' })}
        {field('lastName', 'นามสกุล', 'text', true, { autoComplete: 'family-name' })}
      </div>
      {field('nickname', 'ชื่อเล่น', 'text', false)}
      {field('phone', 'เบอร์โทร', 'tel', true, { inputMode: 'tel', autoComplete: 'tel', placeholder: '08x-xxx-xxxx' })}
      {field('email', 'อีเมล', 'email', true, { inputMode: 'email', autoComplete: 'email' })}
      {extra}
      <button className="btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? 'กำลังบันทึก...' : submitLabel}
      </button>
    </form>
  );
}
