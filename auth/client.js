const translations = {
  zh: { title: '账号登录', intro: '登录后查看来料检验与供应商质量数据。', username: '账号', password: '密码', show: '显示', hide: '隐藏', submit: '登录看板', busy: '正在处理…', footer: '账号由质量团队管理员开通。忘记密码请联系管理员。', language: '语言', setupTitle: '建立管理员账号', setupIntro: '首次启用时设置管理员。初始化完成后，此入口自动关闭。', displayName: '显示名称', newPassword: '新密码', passwordHint: '15–128 个字符，可使用长句密码；支持粘贴和密码管理器。', usernameHint: '3–64 位字母、数字，或 . _ @ -', confirmPassword: '确认密码', setupSubmit: '建立管理员并进入看板', mismatch: '两次输入的密码不一致', network: '连接失败，请检查网络后重试', setupMissing: '缺少初始化凭据，请使用维护人员提供的完整链接。', setupFooter: '密码仅通过加密连接发送，由服务端保存加盐哈希。', back: '返回看板', logout: '退出登录', accounts: '账号管理', accountsIntro: '管理员开通账号并管理访问权限。', add: '新增账号', role: '权限', viewer: '查看者', admin: '管理员', status: '状态', enabled: '可用', disabled: '已停用', actions: '操作', disable: '停用', enable: '启用', reset: '重置密码', cancel: '取消', save: '保存', create: '创建账号', noUsers: '暂无账号', saved: '已保存', resetHint: '保存后，该账号的全部登录会话将失效。', change: '修改密码', currentPassword: '当前密码', changeHint: '修改成功后需重新登录。', account: '当前账号', expired: '登录已失效，请重新登录' },
  en: { title: 'Sign in', intro: 'Access incoming inspection and supplier quality data.', username: 'Username', password: 'Password', show: 'Show', hide: 'Hide', submit: 'Open dashboard', busy: 'Working…', footer: 'Ask your quality team administrator for an account or password reset.', language: 'Language', setupTitle: 'Create administrator', setupIntro: 'Create the first administrator. This setup closes automatically when complete.', displayName: 'Display name', newPassword: 'New password', passwordHint: '15–128 characters. Passphrases, paste and password managers are supported.', usernameHint: '3–64 letters, numbers, or . _ @ -', confirmPassword: 'Confirm password', setupSubmit: 'Create administrator and continue', mismatch: 'The passwords do not match', network: 'Connection failed. Check your network and try again.', setupMissing: 'Setup credential missing. Use the complete link from your maintainer.', setupFooter: 'Passwords are sent over HTTPS and stored as salted hashes on the server.', back: 'Dashboard', logout: 'Sign out', accounts: 'Accounts', accountsIntro: 'Create accounts and manage access permissions.', add: 'Add account', role: 'Role', viewer: 'Viewer', admin: 'Administrator', status: 'Status', enabled: 'Active', disabled: 'Disabled', actions: 'Actions', disable: 'Disable', enable: 'Enable', reset: 'Reset password', cancel: 'Cancel', save: 'Save', create: 'Create account', noUsers: 'No accounts', saved: 'Saved', resetHint: 'Saving signs this account out of all sessions.', change: 'Change password', currentPassword: 'Current password', changeHint: 'Sign in again after changing your password.', account: 'Account', expired: 'Your session expired. Sign in again.' },
  th: { title: 'เข้าสู่ระบบ', intro: 'เข้าสู่ระบบเพื่อดูข้อมูลตรวจรับวัตถุดิบและคุณภาพผู้จำหน่าย', username: 'บัญชี', password: 'รหัสผ่าน', show: 'แสดง', hide: 'ซ่อน', submit: 'เปิดแดชบอร์ด', busy: 'กำลังดำเนินการ…', footer: 'ติดต่อผู้ดูแลทีมคุณภาพเพื่อเปิดบัญชีหรือรีเซ็ตรหัสผ่าน', language: 'ภาษา', setupTitle: 'สร้างบัญชีผู้ดูแล', setupIntro: 'ตั้งค่าผู้ดูแลครั้งแรก หน้านี้จะปิดอัตโนมัติเมื่อตั้งค่าเสร็จ', displayName: 'ชื่อที่แสดง', newPassword: 'รหัสผ่านใหม่', passwordHint: '15–128 อักขระ รองรับการวางและโปรแกรมจัดการรหัสผ่าน', usernameHint: '3–64 ตัวอักษรภาษาอังกฤษ ตัวเลข หรือ . _ @ -', confirmPassword: 'ยืนยันรหัสผ่าน', setupSubmit: 'สร้างผู้ดูแลและเข้าสู่แดชบอร์ด', mismatch: 'รหัสผ่านไม่ตรงกัน', network: 'เชื่อมต่อไม่สำเร็จ โปรดตรวจสอบเครือข่ายแล้วลองอีกครั้ง', setupMissing: 'ไม่มีข้อมูลยืนยันการตั้งค่า โปรดใช้ลิงก์ฉบับเต็มจากผู้ดูแล', setupFooter: 'ส่งรหัสผ่านผ่าน HTTPS และจัดเก็บเป็นแฮชแบบใส่เกลือบนเซิร์ฟเวอร์', back: 'แดชบอร์ด', logout: 'ออกจากระบบ', accounts: 'จัดการบัญชี', accountsIntro: 'สร้างบัญชีและจัดการสิทธิ์การเข้าถึง', add: 'เพิ่มบัญชี', role: 'สิทธิ์', viewer: 'ผู้ดู', admin: 'ผู้ดูแล', status: 'สถานะ', enabled: 'ใช้งาน', disabled: 'ปิดใช้งาน', actions: 'การดำเนินการ', disable: 'ปิดใช้งาน', enable: 'เปิดใช้งาน', reset: 'รีเซ็ตรหัสผ่าน', cancel: 'ยกเลิก', save: 'บันทึก', create: 'สร้างบัญชี', noUsers: 'ไม่มีบัญชี', saved: 'บันทึกแล้ว', resetHint: 'หลังบันทึก บัญชีนี้จะออกจากระบบทุกเซสชัน', change: 'เปลี่ยนรหัสผ่าน', currentPassword: 'รหัสผ่านปัจจุบัน', changeHint: 'ต้องเข้าสู่ระบบอีกครั้งหลังเปลี่ยนรหัสผ่าน', account: 'บัญชีปัจจุบัน', expired: 'เซสชันหมดอายุ โปรดเข้าสู่ระบบอีกครั้ง' }
};
let language = 'zh';
try { language = localStorage.getItem('iqc_locale') || 'zh'; } catch {}
export const text = key => (translations[language] || translations.zh)[key] || translations.zh[key] || key;
export function translate() {
  document.documentElement.lang = language === 'mix' ? 'zh' : language;
  document.querySelectorAll('[data-auth-text]').forEach(el => { el.textContent = text(el.dataset.authText); });
  document.querySelectorAll('[data-password-toggle]').forEach(button => { button.textContent = text(document.getElementById(button.dataset.passwordToggle).type === 'password' ? 'show' : 'hide'); });
  document.querySelectorAll('[data-auth-language]').forEach(el => { el.value = language === 'mix' ? 'zh' : language; });
}
export function initForms() {
  translate();
  document.querySelectorAll('[data-auth-language]').forEach(el => el.addEventListener('change', () => { language = el.value; try { localStorage.setItem('iqc_locale', language); } catch {} translate(); document.dispatchEvent(new Event('auth-language')); }));
  document.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    input.type = input.type === 'password' ? 'text' : 'password'; button.setAttribute('aria-pressed', String(input.type === 'text')); button.textContent = text(input.type === 'text' ? 'hide' : 'show');
  }));
}
export function message(el, value, success = false) { el.textContent = value; el.hidden = !value; el.classList.toggle('success', success); }
export async function api(path, body, csrf) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.message || text('network')); error.code = data.error; throw error; }
  return data;
}
export function clearData() { try { ['qms_dash_cache', 'qms_factories_cache', 'qms_factory'].forEach(key => localStorage.removeItem(key)); } catch {} }
export function signedOut() { clearData(); try { localStorage.setItem('iqc_logout_event', String(Date.now())); } catch {} location.replace('/login'); }
export function safeNext(value) { return /^(?:\/|\/index\.html|\/accounts)(?:#[a-z]+)?$/.test(value || '') ? value : '/'; }
export async function submitForm(form, action) {
  const button = form.querySelector('[type="submit"]'), status = form.querySelector('[role="alert"]');
  message(status, ''); button.disabled = true; const label = button.textContent; button.textContent = text('busy');
  try { await action(); } catch (error) { message(status, error.message || text('network')); } finally { button.disabled = false; button.textContent = label; }
}
