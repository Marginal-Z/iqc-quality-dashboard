import { initForms, api, text, message, signedOut, submitForm, addTranslations, translate } from './client.js';
import reminderTranslations from './reminder-i18n.js';
import { initSettingsNavigation } from './settings-nav.js';
import { renderReminderCard } from './reminder-card-preview.js';
addTranslations(reminderTranslations);
initForms();

const $ = id => document.getElementById(id);
const views = {
  general: ['generalSettings', 'generalIntro'],
  employees: ['employeeSettings', 'employeesIntro'],
  notifications: ['notificationSettings', 'notificationsIntro'],
  history: ['historySettings', 'historyIntro'],
  connection: ['connectionSettings', 'connectionIntro']
};
const view = location.pathname === '/settings' ? 'general' : location.pathname === '/reminders' ? 'employees' : location.pathname.split('/').at(-1);
let csrf = '', user, settings, factories = [], warehouse, warehouseChoice, people, directoryError = false;
let history = [], warehouseHistory = [], previewData, selectedPerson, pickerMode = 'inspector', removeTarget;
let editingOpenId = '';
const dirtyForms = new Set();
const normal = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
const time = value => value ? new Intl.DateTimeFormat(document.documentElement.lang, { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(value * 1000)) : text('noCheck');
const factoryName = code => code === 'STTH' ? 'SHARETRONIC Thailand' : code === 'DGXC' ? text('factoryDongguan') : factories.find(row => row.code === code)?.name || code;
const personName = id => people?.find(person => person.openId === id)?.name;
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

function personSummary(name, caption) {
  const root = document.createElement('div'); root.className = 'settings-person';
  const avatar = document.createElement('span'); avatar.className = 'person-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = [...name][0]?.toUpperCase() || '?';
  const labels = document.createElement('div'), strong = document.createElement('strong'); strong.textContent = name; labels.append(strong);
  if (caption) { const small = document.createElement('small'); small.textContent = caption; labels.append(small); }
  root.append(avatar, labels); return root;
}
function employeeGroups() {
  const groups = new Map();
  for (const row of settings?.recipients || []) {
    const key = row.factory_code + '\n' + row.open_id;
    if (!groups.has(key)) groups.set(key, { openId: row.open_id, factoryCode: row.factory_code, names: [] });
    groups.get(key).names.push(row.inspector_name);
  }
  return [...groups.values()];
}
function renderEmployees() {
  const root = $('employeeRows'); root.replaceChildren();
  const query = normal($('employeeFilter').value);
  const groups = employeeGroups().map(group => ({ ...group, name: personName(group.openId) || group.names[0], type: 'inspector' }));
  if (warehouse?.openId) groups.push({ openId: warehouse.openId, factoryCode: warehouse.factoryCode, name: warehouse.recipientName, names: [], type: 'warehouse' });
  for (const group of groups.filter(group => !query || normal([group.name, ...group.names].join(' ')).includes(query))) {
    const row = root.insertRow(); row.insertCell().append(personSummary(group.name, ''));
    const factory = row.insertCell(); factory.textContent = factoryName(group.factoryCode); factory.classList.toggle('factory-thailand', group.factoryCode === 'STTH');
    row.insertCell().textContent = group.names.join('、') || '—';
    const type = row.insertCell(), badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = text(group.type === 'warehouse' ? 'warehouseNotices' : 'inspectorNotices'); type.append(badge);
    const actions = row.insertCell(); actions.className = 'actions';
    if (group.type === 'warehouse') {
      const link = document.createElement('a'); link.href = '/settings/notifications#warehouse'; link.textContent = text('notificationSettings'); actions.append(link);
    } else {
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = text('employeeEdit'); edit.addEventListener('click', () => openPicker('inspector', group));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = text('employeeRemove'); remove.addEventListener('click', () => { removeTarget = group; $('removeEmployeeName').textContent = group.name; message($('removeEmployeeForm').querySelector('[role="alert"]'), ''); $('removeEmployeeDialog').showModal(); });
      actions.append(edit, remove);
    }
  }
  if (!root.rows.length) { const cell = root.insertRow().insertCell(); cell.colSpan = 5; cell.className = 'empty'; cell.textContent = text(query ? 'employeeSearchEmpty' : 'employeeNone'); }
}
async function loadDirectory() {
  people = undefined; directoryError = false;
  try { const data = await request('/employees'); people = data.people; message($('directoryStatus'), ''); }
  catch { directoryError = true; message($('directoryStatus'), text('employeeDirectoryError')); }
  if (editingOpenId && $('employeeDialog').open) {
    selectedPerson = people?.find(person => person.openId === editingOpenId);
    $('employeeForm').querySelector('[type="submit"]').disabled = !selectedPerson;
  }
  renderEmployees(); renderPicker();
}
function renderPicker() {
  if (!$('employeeDialog').open) return;
  const root = $('employeeResults'); root.replaceChildren();
  if (!people) {
    const note = document.createElement('p'); note.className = 'empty'; note.textContent = text(directoryError ? 'employeeDirectoryError' : 'busy'); root.append(note);
    if (directoryError) { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = text('reloadEmployees'); retry.addEventListener('click', () => loadDirectory()); root.append(retry); }
    return;
  }
  const query = normal($('employeeSearch').value);
  const matches = people.filter(person => editingOpenId ? person.openId === editingOpenId : !query || normal(person.name + ' ' + person.englishName).includes(query)).slice(0, 30);
  for (const person of matches) {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed', String(selectedPerson?.openId === person.openId));
    const duplicate = people.filter(row => row.name === person.name).length > 1;
    button.append(personSummary(person.name, duplicate ? (person.englishName || '') + ' · ' + person.openId.slice(-6) : person.englishName !== person.name ? person.englishName : ''));
    button.addEventListener('click', () => { selectedPerson = person; $('employeeSearch').value = person.name; $('employeeSelection').textContent = text('employeeSelected') + ': ' + person.name; $('employeeForm').querySelector('[type="submit"]').disabled = false; message($('employeeDialogStatus'), ''); renderPicker(); });
    root.append(button);
  }
  if (!matches.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = text('employeeSearchEmpty'); root.append(empty); }
}
async function openPicker(mode, group) {
  pickerMode = mode; editingOpenId = group?.openId || ''; selectedPerson = people?.find(person => person.openId === editingOpenId); $('employeeForm').reset(); message($('employeeDialogStatus'), '');
  $('employeeSearch').disabled = Boolean(group); $('employeeFactory').disabled = Boolean(group);
  $('employeeDialogTitle').textContent = text(mode === 'warehouse' ? 'warehouseChoose' : group ? 'employeeEdit' : 'employeeAdd');
  $('employeeMappingFields').hidden = mode === 'warehouse';
  $('employeeFactory').replaceChildren(...(settings?.factories || []).map(code => new Option(factoryName(code), code)));
  if (group) { $('employeeFactory').value = group.factoryCode; $('employeeAliases').value = group.names.join('\n'); $('employeeAliasesDetails').open = true; $('employeeSearch').value = group.name; }
  else $('employeeAliasesDetails').open = false;
  $('employeeSelection').textContent = ''; $('employeeForm').querySelector('[type="submit"]').disabled = !selectedPerson;
  $('employeeDialog').showModal(); renderPicker();
  if (!people) await loadDirectory();
}
$('employeeSearch').addEventListener('input', () => { selectedPerson = undefined; $('employeeSelection').textContent = ''; $('employeeForm').querySelector('[type="submit"]').disabled = true; renderPicker(); });
$('employeeFilter').addEventListener('input', renderEmployees);
$('addEmployee').addEventListener('click', () => openPicker('inspector'));
$('chooseWarehouse').addEventListener('click', () => openPicker('warehouse'));
for (const id of ['closeEmployeeDialog', 'cancelEmployee']) $(id).addEventListener('click', () => $('employeeDialog').close());
$('cancelRemoveEmployee').addEventListener('click', () => $('removeEmployeeDialog').close());
$('employeeDialog').addEventListener('close', () => { selectedPerson = undefined; editingOpenId = ''; $('employeeForm').reset(); });
$('employeeForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!selectedPerson) { message($('employeeDialogStatus'), text('chooseEmployeeFirst')); return; }
  submitForm(event.currentTarget, async () => {
    if (pickerMode === 'warehouse') {
      warehouseChoice = selectedPerson; dirtyForms.add('warehouseForm'); renderWarehousePerson();
    } else {
      const aliases = $('employeeAliases').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      const result = await request('/employees', { revision: settings.revision, operation: 'save', openId: selectedPerson.openId, factoryCode: $('employeeFactory').value, inspectorNames: aliases.length ? aliases : [selectedPerson.name] });
      settings = result.settings; renderEmployees(); message($('pageStatus'), text('saved'), true);
    }
    $('employeeDialog').close();
  });
});
$('removeEmployeeForm').addEventListener('submit', event => {
  event.preventDefault(); submitForm(event.currentTarget, async () => {
    const result = await request('/employees', { revision: settings.revision, operation: 'remove', openId: removeTarget.openId, factoryCode: removeTarget.factoryCode });
    settings = result.settings; renderEmployees(); $('removeEmployeeDialog').close(); message($('pageStatus'), text('saved'), true);
  });
});
function renderWarehousePerson() {
  const person = warehouseChoice || (warehouse?.openId ? { name: warehouse.recipientName, openId: warehouse.openId } : null);
  $('warehousePerson').replaceChildren(person ? personSummary(person.name, '') : Object.assign(document.createElement('p'), { textContent: text('warehouseUnassigned') }));
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
    const recipient = warehouseChoice || (warehouse?.openId ? { openId: warehouse.openId, name: warehouse.recipientName } : null);
    if (!recipient) throw new Error(text('chooseEmployeeFirst'));
    const result = await request('/warehouse', { revision: warehouse.revision, enabled: $('warehouseEnabled').checked, factoryCode: 'STTH', recipientName: recipient.name, openId: recipient.openId });
    warehouse = result.settings; warehouseChoice = undefined; setSaved(form); renderWarehousePerson(); renderMetadata();
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
  for (const entry of warehouseHistory) { const row = wareRoot.insertRow(); for (const value of [entry.total, text(entry.status), time(entry.sent_at), entry.error_code ? errorText(entry.error_code) : '—']) row.insertCell().textContent = value; }
  for (const [tbody, count] of [[root, 5], [wareRoot, 4]]) if (!tbody.rows.length) { const cell = tbody.insertRow().insertCell(); cell.colSpan = count; cell.className = 'empty'; cell.textContent = text('historyEmpty'); }
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
  for (const id of ['employeeFilter', 'employeeSearch']) { $(id).placeholder = text('employeeSearch'); $(id).setAttribute('aria-label', text('employeeSearch')); }
  $('closeEmployeeDialog').setAttribute('aria-label', text('cancel'));
  $('employeeResults').setAttribute('aria-label', text('employeeChoose'));
  renderEmployees(); renderMetadata(); renderHistory(); renderWarehousePerson(); renderPicker();
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
      if (['employees', 'notifications'].includes(view)) { const data = await request('/warehouse'); warehouse = data.settings; }
      if (view === 'employees') { $('addEmployee').disabled = false; loadDirectory(); }
      if (view === 'notifications') { applyRuleFields(); $('warehouseEnabled').checked = warehouse.enabled; $('chooseWarehouse').disabled = false; for (const form of [$('rulesForm'), $('warehouseForm')]) form.querySelector('[type="submit"]').disabled = false; }
      if (view === 'connection') { $('appId').value = settings.appId; $('connectionForm').querySelector('[type="submit"]').disabled = false; $('checkConnection').disabled = !settings.configured; }
      if (view === 'history') await loadHistory();
    }
    for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== view;
    localize();
    message($('pageStatus'), '');
  }
} catch (error) { if (error.code === 'UNAUTHENTICATED') signedOut(); message($('pageStatus'), error.message || text('settingsUnavailable')); }
finally { $('pageStatus').classList.remove('loading'); }
