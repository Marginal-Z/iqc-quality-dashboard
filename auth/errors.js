// Translate stable server codes, never display upstream/private error details.
const errors = {
  INVALID_CREDENTIALS: ['Incorrect username or password, or the account is unavailable.', 'บัญชีหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีไม่พร้อมใช้งาน'],
  RATE_LIMITED: ['Too many attempts. Please try again later.', 'พยายามบ่อยเกินไป โปรดลองใหม่ภายหลัง'],
  UNAUTHENTICATED: ['Your session expired. Please sign in again.', 'เซสชันหมดอายุ โปรดเข้าสู่ระบบอีกครั้ง'],
  INVALID_PASSWORD: ['Check the password. New passwords must contain 15–128 characters.', 'ตรวจสอบรหัสผ่าน รหัสผ่านใหม่ต้องมี 15–128 อักขระ'],
  INVALID_ACCOUNT: ['Use a valid username and a password of 15–128 characters.', 'ใช้ชื่อบัญชีที่ถูกต้องและรหัสผ่าน 15–128 อักขระ'],
  USERNAME_EXISTS: ['This username already exists.', 'ชื่อบัญชีนี้มีอยู่แล้ว'],
  SELF_DISABLE: ['You cannot disable the administrator account you are using.', 'ไม่สามารถปิดใช้งานบัญชีผู้ดูแลที่กำลังใช้อยู่ได้'],
  LAST_ADMIN: ['Keep at least one active administrator.', 'ต้องมีผู้ดูแลที่ใช้งานได้อย่างน้อยหนึ่งคน'],
  FORBIDDEN: ['Administrator access is required.', 'ต้องใช้สิทธิ์ผู้ดูแล'],
  CSRF_REJECTED: ['Request verification failed. Refresh the page and try again.', 'ยืนยันคำขอไม่สำเร็จ รีเฟรชหน้าแล้วลองใหม่'],
  ORIGIN_REJECTED: ['The request source is invalid. Reopen the dashboard.', 'แหล่งที่มาของคำขอไม่ถูกต้อง โปรดเปิดแดชบอร์ดใหม่'],
  INVALID_BODY: ['The request format is invalid. Refresh and try again.', 'รูปแบบคำขอไม่ถูกต้อง รีเฟรชแล้วลองใหม่'],
  INVALID_STATUS: ['The account status is invalid.', 'สถานะบัญชีไม่ถูกต้อง'],
  CONFLICT: ['The account changed. Please sign in again.', 'ข้อมูลบัญชีมีการเปลี่ยนแปลง โปรดเข้าสู่ระบบอีกครั้ง'],
  NOT_FOUND: ['The requested item was not found.', 'ไม่พบรายการที่ร้องขอ'],
  METHOD_NOT_ALLOWED: ['This operation is not supported.', 'ไม่รองรับการดำเนินการนี้'],
  SETUP_DISABLED: ['Initial setup is unavailable. Contact your maintainer.', 'ไม่สามารถตั้งค่าเริ่มต้นได้ โปรดติดต่อผู้ดูแลระบบ'],
  INVALID_SETUP_TOKEN: ['The setup credential is invalid.', 'ข้อมูลยืนยันการตั้งค่าไม่ถูกต้อง'],
  ALREADY_INITIALIZED: ['The administrator already exists. Please sign in.', 'สร้างผู้ดูแลแล้ว โปรดเข้าสู่ระบบ'],
  SETUP_BUSY: ['Setup is in progress. Please try again later.', 'กำลังตั้งค่า โปรดลองใหม่ภายหลัง'],
  AUTH_UNAVAILABLE: ['The sign-in service is unavailable. Contact your maintainer.', 'บริการเข้าสู่ระบบไม่พร้อม โปรดติดต่อผู้ดูแลระบบ'],
  SERVICE_UNAVAILABLE: ['The service is unavailable. Please try again later.', 'บริการไม่พร้อมใช้งาน โปรดลองใหม่ภายหลัง']
};
export function authError(code, language, fallback = '') {
  if (language === 'en-th') return `${authError(code, 'en')} · ${authError(code, 'th')}`;
  if (language !== 'en' && language !== 'th') return fallback || '操作失败，请稍后重试';
  return errors[code]?.[language === 'en' ? 0 : 1] || (language === 'en' ? 'Request failed. Please try again later.' : 'ดำเนินการไม่สำเร็จ โปรดลองใหม่ภายหลัง');
}
