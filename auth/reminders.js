import { initForms, api, text, message, signedOut, submitForm, addTranslations, translate } from './client.js';
import translations from './reminder-i18n.js';
addTranslations(translations); initForms();
const $ = id => document.getElementById(id), form = $('reminderForm');
let csrf = '', settings, factories = [], history = [], previewData, dirty = false;
function errorText(code) { const key = 'error_' + code; if (text(key) !== key) return text(key); if (code?.startsWith('FEISHU_')) return text('error_FEISHU') + ` (${code})`; if (code?.startsWith('QMS_')) return text('error_QMS'); return text('reminderError'); }
async function request(path, body) { try { return await api('/api/admin/reminders' + path, body, csrf); } catch (error) { if (error.code === 'UNAUTHENTICATED') signedOut(); error.message = errorText(error.code); throw error; } }
const selectedFactories = () => [...$('reminderFactories').querySelectorAll('input:checked')].map(input => input.value);
function markDirty() { dirty = true; $('previewReminders').disabled = true; $('checkConnection').disabled = true; }
form.addEventListener('input', markDirty);
function field(row, key, control, className = '') { const div = document.createElement('div'); div.className = 'field ' + className; const label = document.createElement('label'), caption = document.createElement('span'); caption.dataset.authText = key; caption.textContent = text(key); label.append(caption, control); div.append(label); row.append(div); return control; }
function addRecipient(value = {}) {
  if ($('recipientRows').children.length >= 50) return;
  const row = document.createElement('div'); row.className = 'recipient-row';
  const select = document.createElement('select'); select.dataset.field = 'factory_code'; select.required = true;
  for (const factory of factories) select.add(new Option(factory.name + ' · ' + factory.code, factory.code));
  select.value = value.factory_code || selectedFactories()[0] || factories[0]?.code || ''; field(row, 'factory', select);
  const name = document.createElement('input'); name.dataset.field = 'inspector_name'; name.required = true; name.maxLength = 80; name.value = value.inspector_name || ''; field(row, 'inspector', name);
  const id = document.createElement('input'); id.dataset.field = 'open_id'; id.required = true; id.pattern = 'ou_[A-Za-z0-9_\\-]{4,124}'; id.maxLength = 127; id.spellcheck = false; id.autocomplete = 'off'; id.value = value.open_id || ''; field(row, 'openId', id, 'recipient-id');
  const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.authText = 'removeRecipient'; remove.textContent = text('removeRecipient'); remove.addEventListener('click', () => { row.remove(); markDirty(); }); row.append(remove); $('recipientRows').append(row);
}
function renderMetadata() {
  document.title = text('reminders') + ' · IQC';
  if (!settings) return;
  $('connectionBadge').textContent = text(settings.verified ? 'connected' : settings.configured ? 'configured' : 'notConfigured');
  $('lastCheck').textContent = text('lastChecked') + '：' + (settings.lastCheckedAt ? time(settings.lastCheckedAt) : text('notChecked')) + (settings.lastError ? ' · ' + text('lastError') + '：' + errorText(settings.lastError) : '');
}
function time(value) { return value ? new Intl.DateTimeFormat(document.documentElement.lang, { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(value * 1000)) : '—'; }
function applySettings(value) {
  settings = value; $('appId').value = settings.appId; $('appSecret').value = ''; $('reminderEnabled').checked = settings.enabled; $('dailyStart').value = settings.dailyStart;
  const selected = settings.factories.length ? settings.factories : factories.some(factory => factory.code === 'STTH') ? ['STTH'] : [];
  $('reminderFactories').replaceChildren();
  for (const factory of factories) { const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = factory.code; input.checked = selected.includes(factory.code); label.append(input, document.createTextNode(factory.name + ' · ' + factory.code)); $('reminderFactories').append(label); }
  $('recipientRows').replaceChildren(); for (const row of settings.recipients) addRecipient(row);
  for (const id of ['saveReminders', 'addRecipient', 'previewReminders', 'refreshHistory']) $(id).disabled = false;
  $('checkConnection').disabled = !settings.configured; dirty = false; renderMetadata(); translate();
}
async function loadSettings() { const data = await request(''); factories = data.factories; applySettings(data.settings); }
function renderHistory() {
  const tbody = $('deliveryHistory'); tbody.replaceChildren();
  if (!history.length) { const cell = tbody.insertRow().insertCell(); cell.colSpan = 5; cell.className = 'empty'; cell.textContent = text('noHistory'); return; }
  for (const entry of history) {
    const row = tbody.insertRow();
    for (const value of [entry.thai_day, JSON.parse(entry.inspector_names).join('、'), entry.total, text(entry.status) + (entry.error_code ? ' · ' + errorText(entry.error_code) : ''), time(entry.sent_at)]) row.insertCell().textContent = value;
  }
}
async function loadHistory() { history = (await request('/history')).deliveries; renderHistory(); }
$('addRecipient').addEventListener('click', () => { addRecipient(); markDirty(); });
form.addEventListener('submit', event => {
  event.preventDefault(); const selected = selectedFactories(), keys = new Set(), rows = [];
  for (const row of $('recipientRows').children) {
    const controls = Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => { input.setCustomValidity(''); return [input.dataset.field, input]; }));
    const value = Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value.trim()]));
    if (!selected.includes(value.factory_code)) controls.factory_code.setCustomValidity(text('mappingFactory'));
    const key = value.factory_code + '\n' + value.inspector_name; if (keys.has(key)) controls.inspector_name.setCustomValidity(text('duplicateInspector')); keys.add(key); rows.push(value);
  }
  if (!form.reportValidity()) return;
  submitForm(form, async () => {
    const body = { revision: settings.revision, appId: $('appId').value.trim(), enabled: $('reminderEnabled').checked, dailyStart: $('dailyStart').value, factories: selected, recipients: rows };
    if ($('appSecret').value) body.appSecret = $('appSecret').value;
    const result = await request('', body); $('appSecret').value = ''; applySettings(result.settings); message(form.querySelector('[role="alert"]'), text('saved'), true);
  });
});
async function action(button, callback) { button.disabled = true; message($('pageStatus'), ''); try { await callback(); } catch (error) { message($('pageStatus'), error.message); } finally { button.disabled = dirty || (button.id === 'checkConnection' && !settings?.configured); } }
$('checkConnection').addEventListener('click', event => action(event.currentTarget, async () => { await request('/connection', {}); await loadSettings(); message($('pageStatus'), text('connectionOk'), true); }));
$('refreshHistory').addEventListener('click', event => action(event.currentTarget, async () => { await loadHistory(); if (!dirty) await loadSettings(); }));
function renderPreview(data) {
  const root = $('reminderPreview'); root.replaceChildren(); root.hidden = false;
  const unmapped = data.inspectors.filter(row => !row.mapped);
  if (unmapped.length) { const note = document.createElement('p'); note.textContent = text('unmapped') + ' ' + unmapped.map(row => row.factoryName + ' · ' + row.name + ` (${row.total})`).join('、'); root.append(note); }
  if (!data.messages.length) { const note = document.createElement('p'); note.textContent = text('noMessages'); root.append(note); }
  for (const entry of data.messages) { const article = document.createElement('article'); article.className = 'preview-message'; const title = document.createElement('strong'); title.textContent = entry.openId; const pre = document.createElement('pre'); pre.textContent = entry.text; article.append(title, pre); root.append(article); }
}
$('previewReminders').addEventListener('click', event => action(event.currentTarget, async () => { previewData = await request('/preview'); renderPreview(previewData); }));
document.addEventListener('auth-language', () => { renderMetadata(); renderHistory(); if (previewData) renderPreview(previewData); message($('pageStatus'), ''); message(form.querySelector('[role="alert"]'), ''); });
window.addEventListener('storage', event => { if (event.key === 'iqc_logout_event') location.replace('/login'); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
try { const me = await api('/api/auth/me'); csrf = me.csrfToken; if (me.user.role !== 'admin') location.replace('/'); else { await loadSettings(); await loadHistory(); message($('pageStatus'), ''); } }
catch (error) { if (error.code === 'UNAUTHENTICATED') signedOut(); message($('pageStatus'), errorText(error.code)); }
