(() => {
  const runtime = window.IQC_RUNTIME;
  if (!runtime?.authentication) return;
  const clearData = (includeFactory = false) => { try { ['qms_dash_cache', 'qms_factories_cache', ...(includeFactory ? ['qms_factory'] : [])].forEach(key => localStorage.removeItem(key)); } catch {} };
  const expire = () => { clearData(true); document.body.style.visibility = 'hidden'; location.replace('/login'); };
  window.IQCAccount = { expire };
  clearData();
  window.addEventListener('storage', event => { if (event.key === 'iqc_logout_event') expire(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') return;
    try { const response = await fetch('/api/auth/me', { cache: 'no-store' }); if (response.status === 401) expire(); else if (response.ok && (await response.json()).user.id !== runtime.user?.id) location.reload(); } catch {}
  });
  const labels = {
    zh: { account: '当前账号', change: '修改密码', accounts: '账号管理', logout: '退出登录', current: '当前密码', password: '新密码', hint: '15–128 个字符。修改后需重新登录。', cancel: '取消', save: '修改密码', failed: '操作失败，请稍后重试', busy: '正在保存…' },
    en: { account: 'Account', change: 'Change password', accounts: 'Accounts', logout: 'Sign out', current: 'Current password', password: 'New password', hint: '15–128 characters. Sign in again after saving.', cancel: 'Cancel', save: 'Change password', failed: 'Request failed. Try again later.', busy: 'Saving…' },
    th: { account: 'บัญชีปัจจุบัน', change: 'เปลี่ยนรหัสผ่าน', accounts: 'จัดการบัญชี', logout: 'ออกจากระบบ', current: 'รหัสผ่านปัจจุบัน', password: 'รหัสผ่านใหม่', hint: '15–128 อักขระ ต้องเข้าสู่ระบบอีกครั้งหลังบันทึก', cancel: 'ยกเลิก', save: 'เปลี่ยนรหัสผ่าน', failed: 'ไม่สำเร็จ โปรดลองอีกครั้ง', busy: 'กำลังบันทึก…' }
  };
  const panel = document.createElement('fieldset'); panel.className = 'account-settings';
  panel.innerHTML = '<legend data-account-label="account"></legend><p class="account-name"></p><div class="account-actions"><button type="button" data-action="password" data-account-label="change"></button><a href="/accounts" data-account-label="accounts" hidden></a><button type="button" data-action="logout" data-account-label="logout"></button></div><p class="account-error" role="alert" hidden></p>';
  panel.querySelector('.account-name').textContent = runtime.user?.displayName || runtime.user?.username || '';
  panel.querySelector('a').hidden = runtime.user?.role !== 'admin';
  document.getElementById('displaySettings').append(panel);
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog';
  dialog.innerHTML = '<h2 data-account-label="change"></h2><form><label for="accountCurrent" data-account-label="current"></label><input id="accountCurrent" name="currentPassword" type="password" autocomplete="current-password" maxlength="256" required><label for="accountNew" data-account-label="password"></label><input id="accountNew" name="password" type="password" autocomplete="new-password" maxlength="256" required aria-describedby="accountPasswordHint"><p id="accountPasswordHint" data-account-label="hint"></p><p class="account-error" role="alert" hidden></p><div class="account-actions"><button type="button" data-action="cancel" data-account-label="cancel"></button><button type="submit" data-account-label="save"></button></div></form>';
  document.body.append(dialog);
  let lang = 'zh'; const t = key => (labels[lang] || labels.zh)[key];
  function translate() { try { lang = localStorage.getItem('iqc_locale') || 'zh'; } catch {} [panel, dialog].forEach(root => root.querySelectorAll('[data-account-label]').forEach(el => { el.textContent = t(el.dataset.accountLabel); })); }
  translate(); document.querySelectorAll('[data-locale]').forEach(button => button.addEventListener('click', () => setTimeout(translate, 0)));
  async function post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': runtime.csrfToken }, body: JSON.stringify(body) });
    const data = await response.json(); if (response.status === 401) expire(); if (!response.ok) throw new Error(data.message || t('failed')); return data;
  }
  const showError = (root, value) => { const el = root.querySelector('[role="alert"]'); el.hidden = !value; el.textContent = value; };
  panel.querySelector('[data-action="password"]').addEventListener('click', () => { document.getElementById('displaySettings').hidePopover(); showError(dialog, ''); dialog.showModal(); });
  panel.querySelector('[data-action="logout"]').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await post('/api/auth/logout', {}); try { localStorage.setItem('iqc_logout_event', String(Date.now())); } catch {} expire(); } catch (e) { showError(panel, e.message); } finally { event.target.disabled = false; }
  });
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.querySelector('form').reset());
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = t('busy'); showError(dialog, '');
    try { await post('/api/auth/password', { currentPassword: form.currentPassword.value, password: form.password.value }); form.reset(); try { localStorage.setItem('iqc_logout_event', String(Date.now())); } catch {} expire(); } catch (e) { showError(dialog, e.message); } finally { button.disabled = false; button.textContent = t('save'); }
  });
})();
