import { initForms, api, text, message, signedOut, submitForm } from './client.js';
initForms();
let csrf = '', currentUser, users = [], targetId = '';
const status = document.getElementById('status'), dialog = document.getElementById('userDialog'), form = document.getElementById('userForm');
async function request(path, body) {
  try { return await api(path, body, csrf); } catch (error) { if (error.code === 'UNAUTHENTICATED') signedOut(); throw error; }
}
function cell(row, value, badge = '') { const td = row.insertCell(); const el = document.createElement(badge ? 'span' : 'span'); el.textContent = value; if (badge) el.className = badge; td.append(el); return td; }
function render() {
  const tbody = document.getElementById('users'); tbody.replaceChildren();
  for (const user of users) {
    const row = tbody.insertRow(); cell(row, user.username); cell(row, user.displayName); cell(row, text(user.role)); cell(row, text(user.disabled ? 'disabled' : 'enabled'), 'badge' + (user.disabled ? ' disabled' : ''));
    const actions = row.insertCell(); actions.className = 'actions';
    const reset = document.createElement('button'); reset.textContent = text('reset'); reset.addEventListener('click', () => openUser(user)); actions.append(reset);
    if (user.id !== currentUser.id) { const toggle = document.createElement('button'); toggle.textContent = text(user.disabled ? 'enable' : 'disable'); toggle.addEventListener('click', async () => { toggle.disabled = true; try { await request(`/api/admin/users/${user.id}/status`, { disabled: !user.disabled }); await loadUsers(); } catch (e) { message(status, e.message); } finally { toggle.disabled = false; } }); actions.append(toggle); }
  }
}
async function loadUsers() { users = (await request('/api/admin/users')).users; render(); }
function openUser(user) {
  targetId = user?.id || ''; form.reset(); message(form.querySelector('[role="alert"]'), '');
  document.getElementById('newUserFields').hidden = Boolean(user);
  document.getElementById('resetHint').hidden = !user;
  for (const input of document.getElementById('newUserFields').querySelectorAll('input, select')) input.disabled = Boolean(user);
  document.getElementById('dialogTitle').textContent = user ? `${text('reset')} · ${user.username}` : text('add');
  dialog.showModal();
}
form.addEventListener('submit', event => {
  event.preventDefault(); submitForm(form, async () => {
    if (targetId) await request(`/api/admin/users/${targetId}/password`, { password: form.password.value });
    else await request('/api/admin/users', { username: form.username.value, displayName: form.displayName.value, role: form.role.value, password: form.password.value });
    form.reset(); dialog.close();
    if (targetId === currentUser.id) { signedOut(); return; }
    await loadUsers(); message(status, text('saved'), true);
  });
});
document.getElementById('cancelUser').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => form.reset());
document.getElementById('addUser').addEventListener('click', () => openUser());
document.addEventListener('auth-language', render);
document.getElementById('logout').addEventListener('click', async () => { try { await request('/api/auth/logout', {}); signedOut(); } catch (e) { message(status, e.message); } });
window.addEventListener('storage', event => { if (event.key === 'iqc_logout_event') location.replace('/login'); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
try { const me = await request('/api/auth/me'); currentUser = me.user; csrf = me.csrfToken; if (currentUser.role !== 'admin') location.replace('/'); else { await loadUsers(); document.getElementById('addUser').disabled = false; } } catch (e) { message(status, e.message); }
