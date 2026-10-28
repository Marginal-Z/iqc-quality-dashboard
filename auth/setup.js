import { initForms, api, clearData, submitForm, text, message } from './client.js';
const setupToken = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', '/setup');
initForms();
const form = document.getElementById('setupForm');
if (!setupToken) { message(form.querySelector('[role="alert"]'), text('setupMissing')); form.querySelector('[type="submit"]').disabled = true; }
form.addEventListener('submit', event => {
  event.preventDefault();
  submitForm(form, async () => {
    if (form.password.value !== form.confirmPassword.value) throw new Error(text('mismatch'));
    await api('/api/auth/setup', { token: setupToken, username: form.username.value, displayName: form.displayName.value, password: form.password.value });
    form.reset(); clearData(); location.replace('/accounts');
  });
});
