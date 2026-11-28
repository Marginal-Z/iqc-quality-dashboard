import { initForms, api, text, message, signedOut, submitForm, addTranslations } from './client.js';
import reminderTranslations from './reminder-i18n.js';
import { initSettingsNavigation } from './settings-nav.js';
import { initEmployeeSettings } from './employee-settings.js';
import { renderReminderCard } from './reminder-card-preview.js';
addTranslations(reminderTranslations);
initForms();

const $ = id => document.getElementById(id);
const views = {
  general: ['generalSettings', 'generalIntro'],
  qc: ['qcEmployees', 'qcEmployeesIntro'],
  warehouse: ['warehouseEmployees', 'warehouseEmployeesIntro'],
  notifications: ['notificationSettings', 'notificationsIntro'],
  history: ['historySettings', 'historyIntro'],
  connection: ['connectionSettings', 'connectionIntro']
};
const rawView = location.pathname === '/settings' ? 'general' : location.pathname === '/reminders' ? 'employees' : location.pathname.split('/').at(-1);
const view = ['employees', 'reminders'].includes(rawView) ? 'qc' : rawView;
let csrf = '', user, settings, factories = [], warehouse;
let history = [], warehouseHistory = [], previewData;
const dirtyForms = new Set();
const time = value => value ? new Intl.DateTimeFormat(document.documentElement.lang, { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(value * 1000)) : text('noCheck');
const factoryName = code => code === 'STTH' ? 'SHARETRONIC Thailand' : code === 'DGXC' ? text('factoryDongguan') : factories.find(row => row.code === code)?.name || code;
const personName = id => settings?.policies?.find(person => person.open_id === id)?.display_name;
function errorText(code) {
  const key = 'error_' + code;
  if (text(key) !== key) return text(key);
  if (code?.startsWith('FEISHU_')) return text('error_FEISHU') + ' (' + code + ')';
  if (code?.startsWith('QMS_')) return text('error_QMS');
  return text('settingsUnavailable');
}
async function request(path, body) {
  try { return await api('/api/admin/reminders' + path, body, csrf); }
  catch (error) { if (error.code === 'UNAUTHENTICATED') signedOut(); error.message = errorText(error.code); throw error; }
}
function track(form) {
  form.addEventListener('input', () => dirtyForms.add(form.id));
  form.addEventListener('change', () => dirtyForms.add(form.id));
}
for (const id of ['rulesForm', 'warehouseForm', 'connectionForm']) track($(id));
window.addEventListener('beforeunload', event => { if (dirtyForms.size) { event.preventDefault(); event.returnValue = ''; } });
function setSaved(form) { dirtyForms.delete(form.id); message(form.querySelector('[role="alert"]'), text('saved'), true); }

const employees = initEmployeeSettings({ view, request, factoryName, changed(nextSettings, nextWarehouse) { settings = nextSettings; warehouse = nextWarehouse; renderWarehousePerson(); } });
function renderWarehousePerson() {
  $('warehousePerson').textContent = text('warehouseRecipientCount') + ': ' + (warehouse?.recipients?.filter(person => person.enabled).length || 0);
}
function renderMetadata() {
  $('connectionBadge').textContent = text(settings?.verified ? 'connected' : settings?.configured ? 'configured' : 'notConfigured');
  $('lastCheck').textContent = text('lastSync') + ': ' + time(settings?.lastCheckedAt) + (settings?.lastError ? ' · ' + errorText(settings.lastError) : '');
  const diagnostics = settings?.diagnostics || {}, notes = [];
  if (Number.isInteger(diagnostics.pendingTotal)) notes.push(text('detectedPending') + ' ' + diagnostics.pendingTotal + ' · ' + text('mappedPending') + ' ' + diagnostics.mappedPendingTotal);
  if (diagnostics.unmappedInspectors?.length) notes.push(text('unmapped') + ' ' + diagnostics.unmappedInspectors.map(row => row.name + ' (' + row.total + ')').join('、'));
  $('reminderDiagnostics').textContent = notes.join('\n');
  $('warehouseMeta').textContent = warehouse ? text('lastSync') + ': ' + time(warehouse.lastCheckedAt) + (warehouse.lastError ? ' · ' + errorText(warehouse.lastError) : '') : '';
}
function renderFactories() {
  const selected = new Set([...$('reminderFactories').querySelectorAll('input:checked')].map(input => input.value));
  $('reminderFactories').replaceChildren();
  for (const factory of factories) { const label = document.createElement('label'), input = document.createElement('input'), span = document.createElement('span'); input.type = 'checkbox'; input.value = factory.code; input.checked = selected.has(factory.code); span.textContent = factoryName(factory.code); span.classList.toggle('factory-thailand', factory.code === 'STTH'); label.append(input, span); $('reminderFactories').append(label); }
}
function applyRuleFields() {
  $('reminderEnabled').checked = settings.enabled; $('dailyStart').value = settings.dailyStart;
  $('reminderFactories').replaceChildren();
  for (const code of settings.factories) { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.value = code; $('reminderFactories').append(input); }
  renderFactories();
}
$('rulesForm').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submitForm(form, async () => { const result = await request('/settings/rules', { revision: settings.revision, enabled: $('reminderEnabled').checked, dailyStart: $('dailyStart').value, factories: [...$('reminderFactories').querySelectorAll('input:checked')].map(input => input.value) }); settings = result.settings; setSaved(form); });
});
$('warehouseForm').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submitForm(form, async () => {
    const result = await request('/warehouse', { revision: warehouse.revision, enabled: $('warehouseEnabled').checked, factoryCode: 'STTH' });
    warehouse = result.settings; setSaved(form); renderWarehousePerson(); renderMetadata();
  });
});
$('connectionForm').addEventListener('input', () => { $('checkConnection').disabled = true; });
$('connectionForm').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submitForm(form, async () => { const body = { revision: settings.revision, appId: $('appId').value.trim() }; if ($('appSecret').value) body.appSecret = $('appSecret').value; const result = await request('/settings/connection', body); settings = result.settings; $('appSecret').value = ''; $('checkConnection').disabled = !settings.configured; setSaved(form); renderMetadata(); });
});
async function action(button, callback) {
  button.disabled = true; message($('pageStatus'), '');
  try { await callback(); } catch (error) { message($('pageStatus'), error.message); } finally { button.disabled = false; }
}
$('checkConnection').addEventListener('click', event => action(event.currentTarget, async () => { await request('/connection', {}); settings = (await request('')).settings; renderMetadata(); message($('pageStatus'), text('connectionOk'), true); }));
function renderHistory() {
  const root = $('deliveryHistory'); root.replaceChildren();
  for (const entry of history) {
    const row = root.insertRow();
    for (const value of [entry.thai_day, JSON.parse(entry.inspector_names).join('、'), entry.total, (entry.kind ? text(entry.kind === 'urgent' ? 'urgentNotice' : 'newTasks') + ' · ' : '') + text(entry.status) + (entry.error_code ? ' · ' + errorText(entry.error_code) : ''), time(entry.sent_at)]) row.insertCell().textContent = value;
  }
  const wareRoot = $('warehouseHistory'); wareRoot.replaceChildren();
  for (const entry of warehouseHistory) { const row = wareRoot.insertRow(); for (const value of [entry.recipient_name, entry.total, text(entry.status), time(entry.sent_at), entry.error_code ? errorText(entry.error_code) : '—']) row.insertCell().textContent = value; }
  for (const [tbody, count] of [[root, 5], [wareRoot, 5]]) if (!tbody.rows.length) { const cell = tbody.insertRow().insertCell(); cell.colSpan = count; cell.className = 'empty'; cell.textContent = text('historyEmpty'); }
}
async function loadHistory() {
  const [delivery, ware, config] = await Promise.all([request('/history'), request('/warehouse'), request('')]);
  history = delivery.deliveries; warehouseHistory = ware.deliveries; warehouse = ware.settings; settings = config.settings; renderHistory(); renderMetadata();
}
$('refreshHistory').addEventListener('click', event => action(event.currentTarget, loadHistory));
function renderPreview(data) {
  const root = $('reminderPreview'); root.replaceChildren(); root.hidden = false;
  const unmapped = data.inspectors.filter(person => !person.mapped);
  if (unmapped.length) { const note = document.createElement('p'); note.textContent = text('unmapped') + ' ' + unmapped.map(person => factoryName(person.factoryCode) + ' · ' + person.name + ' (' + person.total + ')').join('、'); root.append(note); }
  if (!data.messages.length) { const note = document.createElement('p'); note.textContent = text('noMessages'); root.append(note); }
  for (const entry of data.messages) { const article = document.createElement('article'); article.className = 'preview-message'; const title = document.createElement('strong'); title.textContent = personName(entry.openId) || entry.inspectors?.join('、') || text('inspector'); article.append(title, renderReminderCard(entry.card, entry.text)); root.append(article); }
}
$('previewReminders').addEventListener('click', event => action(event.currentTarget, async () => { previewData = await request('/preview'); renderPreview(previewData); }));
for (const tabs of [['inspectorTab', 'warehouseTab'], ['inspectorHistoryTab', 'warehouseHistoryTab']]) {
  const activate = id => { for (const tabId of tabs) { const tab = $(tabId), active = tabId === id; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; $(tab.getAttribute('aria-controls')).hidden = !active; } };
  for (const id of tabs) {
    $(id).addEventListener('click', () => activate(id));
    $(id).addEventListener('keydown', event => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs.find(value => value !== id); activate(next); $(next).focus(); } });
  }
  if (view === 'notifications' && location.hash === '#warehouse') activate('warehouseTab');
}
$('passwordForm').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submitForm(form, async () => { if ($('password').value !== $('confirmPassword').value) throw new Error(text('mismatch')); await api('/api/auth/password', { currentPassword: $('currentPassword').value, password: $('password').value }, csrf); form.reset(); signedOut(); });
});
$('logout').addEventListener('click', event => action(event.currentTarget, async () => { await api('/api/auth/logout', {}, csrf); signedOut(); }));
function localize() {
  const [title, intro] = views[view] || views.general;
  $('viewTitle').textContent = text(title); $('viewIntro').textContent = text(intro); document.title = text(title) + ' · IQC';
  $('settingsNavigation').setAttribute('aria-label', text('settingsTitle'));
  for (const tabs of document.querySelectorAll('[role="tablist"]')) tabs.setAttribute('aria-label', text('notificationType'));
  employees.localize(); renderMetadata(); renderHistory(); renderWarehousePerson();
  if (settings) renderFactories();
  if (previewData) renderPreview(previewData);
}
document.addEventListener('auth-language', localize);
window.addEventListener('storage', event => { if (event.key === 'iqc_logout_event') { dirtyForms.clear(); location.replace('/login'); } });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
localize();
$('pageStatus').classList.add('loading');
message($('pageStatus'), text('busy'));
try {
  const me = await api('/api/auth/me'); user = me.user; csrf = me.csrfToken;
  if (view !== 'general' && user.role !== 'admin') location.replace('/settings');
  else {
    initSettingsNavigation(user.role);
    $('currentAccount').textContent = user.displayName + ' (' + user.username + ')';
    if (view !== 'general') {
      const data = await request(''); settings = data.settings; factories = data.factories;
      if (['qc', 'warehouse', 'notifications'].includes(view)) { const data = await request('/warehouse'); warehouse = data.settings; }
      employees.update(settings, warehouse); employees.start();
      if (view === 'notifications') { applyRuleFields(); $('warehouseEnabled').checked = warehouse.enabled; for (const form of [$('rulesForm'), $('warehouseForm')]) form.querySelector('[type="submit"]').disabled = false; }
      if (view === 'connection') { $('appId').value = settings.appId; $('connectionForm').querySelector('[type="submit"]').disabled = false; $('checkConnection').disabled = !settings.configured; }
      if (view === 'history') await loadHistory();
    }
    for (const section of document.querySelectorAll('[data-view]')) section.hidden = !section.dataset.view.split(' ').includes(view);
    localize();
    message($('pageStatus'), '');
  }
} catch (error) { if (error.code === 'UNAUTHENTICATED') signedOut(); message($('pageStatus'), error.message || text('settingsUnavailable')); }
finally { $('pageStatus').classList.remove('loading'); }
