import { initForms, api, clearData, safeNext, submitForm } from './client.js';
initForms();
document.getElementById('loginForm').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submitForm(form, async () => {
    await api('/api/auth/login', { username: form.username.value, password: form.password.value });
    form.password.value = ''; clearData(); location.replace(safeNext(new URL(location.href).searchParams.get('next')));
  });
});
