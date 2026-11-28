import { text, message, submitForm } from './client.js';

const $ = id => document.getElementById(id);
const normal = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
const features = { new_tasks: 'qcNewTasks', urgent: 'qcUrgent', '合格': 'warehousePass', '特采': 'warehouseSpecial', '退货': 'warehouseReturn' };
export function initEmployeeSettings({ view, request, factoryName, changed }) {
  let settings, warehouse, directory, people = [], selected, editing, removing;
  let requestId = 0, searchTimer, pollTimer, loading = false, loadError = '';
  const isWarehouse = view === 'warehouse';
  const isEmployeeView = ['qc', 'warehouse'].includes(view);
  const summary = (name, caption = '') => {
    const root = document.createElement('div'); root.className = 'settings-person';
    const avatar = document.createElement('span'); avatar.className = 'person-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = [...name][0]?.toUpperCase() || '?';
    const labels = document.createElement('div'), strong = document.createElement('strong'); strong.textContent = name; labels.append(strong);
    if (caption) { const small = document.createElement('small'); small.textContent = caption; labels.append(small); }
    root.append(avatar, labels); return root;
  };
  function groups() {
    if (isWarehouse) return (warehouse?.recipients || []).map(row => ({ ...row, names: [], features: row.events }));
    const result = new Map();
    for (const row of settings?.recipients || []) {
      const key = row.factory_code + '\n' + row.open_id;
      if (!result.has(key)) {
        const policy = settings.policies?.find(p => p.factory_code === row.factory_code && p.open_id === row.open_id);
        result.set(key, { openId: row.open_id, factoryCode: row.factory_code, name: policy?.display_name || row.inspector_name, names: [], enabled: policy ? Boolean(policy.enabled) : true,
          features: policy ? [policy.notify_new_tasks && 'new_tasks', policy.notify_urgent && 'urgent'].filter(Boolean) : ['new_tasks', 'urgent'] });
      }
      result.get(key).names.push(row.inspector_name);
    }
    return [...result.values()];
  }
  function renderRows() {
    if (!isEmployeeView) return;
    const root = $('employeeRows'); root.replaceChildren();
    const query = normal($('employeeFilter').value);
    for (const group of groups().filter(row => !query || normal([row.name, ...row.names].join(' ')).includes(query))) {
      const row = root.insertRow(); row.insertCell().append(summary(group.name));
      const factory = row.insertCell(); factory.textContent = factoryName(group.factoryCode); factory.classList.toggle('factory-thailand', group.factoryCode === 'STTH');
      row.insertCell().textContent = isWarehouse ? text(group.enabled ? 'enabled' : 'disabled') : group.names.join('、');
      const functions = row.insertCell(); functions.className = 'employee-functions';
      if (!isWarehouse && !group.enabled) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = text('disabled'); functions.append(badge); }
      for (const feature of group.features) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = text(features[feature]); functions.append(badge); }
      if (!group.features.length) functions.textContent = text('noFunctions');
      const actions = row.insertCell(); actions.className = 'actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = text('employeeEdit'); edit.addEventListener('click', () => openPicker(group));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = text('employeeRemove'); remove.addEventListener('click', () => {
        removing = group; $('removeEmployeeName').textContent = group.name; message($('removeEmployeeForm').querySelector('[role="alert"]'), ''); $('removeEmployeeDialog').showModal();
      });
      actions.append(edit, remove);
    }
    if (!root.rows.length) { const cell = root.insertRow().insertCell(); cell.colSpan = 5; cell.className = 'empty'; cell.textContent = text(query ? 'employeeFilterEmpty' : 'employeeNone'); }
    $('employeeAliasesHeader').textContent = text(isWarehouse ? 'status' : 'employeeAliases');
  }
  function renderStatus() {
    let note = loadError;
    if (!note && directory) {
      if (directory.lastError) note = text('directoryStale') + ' (' + directory.lastError + ')';
      else if (directory.syncing || directory.requested) note = text('directorySyncing') + ' · ' + (directory.resolved || 0) + ' / ' + (directory.total || 0);
      else note = text('directoryReady') + ' · ' + directory.total;
      if (directory.fetchedAt) note += ' · ' + new Intl.DateTimeFormat(document.documentElement.lang, { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }).format(new Date(directory.fetchedAt * 1000));
    }
    $('directoryStatus').textContent = note; $('directoryStatus').hidden = !note;
    $('directoryStatus').classList.toggle('success', !loadError && directory?.complete && !directory.lastError && !directory.syncing);
    $('syncDirectory').disabled = loading || Boolean(directory?.syncing || directory?.requested);
    $('employeeSearchHint').textContent = text('employeeCompanySearch') + (directory?.hasMore ? ' ' + text('directoryMore') : '');
  }
  function renderPicker() {
    if (!$('employeeDialog').open) return;
    const root = $('employeeResults'); root.replaceChildren();
    if (editing) root.append(summary(selected.name));
    else if (loading || loadError) {
      const note = document.createElement('p'); note.className = 'empty'; note.textContent = loading ? text('busy') : loadError; root.append(note);
      if (!loading) { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = text('reloadEmployees'); retry.addEventListener('click', () => search()); root.append(retry); }
    } else {
      for (const person of people) {
        const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed', String(selected?.openId === person.openId));
        const duplicate = people.filter(row => row.name === person.name).length > 1;
        button.append(summary(person.name, duplicate ? (person.englishName || '') + ' · ' + person.openId.slice(-6) : person.englishName !== person.name ? person.englishName : ''));
        button.addEventListener('click', () => { selected = person; $('employeeSelection').textContent = text('employeeSelected') + ': ' + person.name; $('employeeForm').querySelector('[type="submit"]').disabled = false; message($('employeeDialogStatus'), ''); renderPicker(); });
        root.append(button);
      }
      if (!people.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = text(directory?.syncing && !directory.complete ? 'directoryFirstSync' : 'employeeSearchEmpty'); root.append(empty); }
    }
    renderStatus();
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!document.hidden && (directory?.syncing || directory?.requested)) pollTimer = setTimeout(() => search(), 10000);
  }
  async function search() {
    if (!isEmployeeView) return;
    clearTimeout(searchTimer); const id = ++requestId;
    loading = true; loadError = ''; renderPicker(); renderStatus();
    try {
      const query = !editing && $('employeeDialog').open ? $('employeeSearch').value : '';
      const result = await request('/employees?q=' + encodeURIComponent(query));
      if (id !== requestId) return;
      directory = result; people = result.people;
    } catch (error) { if (id === requestId) loadError = error.message; }
    finally { if (id === requestId) { loading = false; renderPicker(); renderStatus(); schedulePoll(); } }
  }
  function renderFunctions() {
    const root = $('employeeFeatures'); root.replaceChildren();
    for (const feature of isWarehouse ? ['合格', '特采', '退货'] : ['new_tasks', 'urgent']) {
      const label = document.createElement('label'), input = document.createElement('input'), span = document.createElement('span');
      input.type = 'checkbox'; input.name = 'feature'; input.value = feature; input.checked = editing ? editing.features.includes(feature) : true; span.textContent = text(features[feature]); label.append(input, span); root.append(label);
    }
  }
  function openPicker(group) {
    editing = group; selected = group ? { openId: group.openId, name: group.name } : undefined;
    $('employeeForm').reset(); message($('employeeDialogStatus'), '');
    $('employeeSearch').disabled = Boolean(group); $('employeeFactory').disabled = Boolean(group) || isWarehouse;
    $('employeeDialogTitle').textContent = text(group ? 'employeeEdit' : isWarehouse ? 'warehouseEmployeeAdd' : 'qcEmployeeAdd');
    $('employeeMappingFields').hidden = isWarehouse;
    $('employeeFactory').replaceChildren(...(isWarehouse ? ['STTH'] : settings.factories).map(code => new Option(factoryName(code), code)));
    if (group) { $('employeeFactory').value = group.factoryCode; $('employeeAliases').value = group.names.join('\n'); $('employeeSearch').value = group.name; }
    $('employeeAliasesDetails').open = Boolean(group); $('employeeEnabled').checked = group ? group.enabled : true;
    $('employeeSelection').textContent = ''; $('employeeForm').querySelector('[type="submit"]').disabled = !selected;
    renderFunctions(); $('employeeDialog').showModal(); renderPicker(); if (!group) search();
  }
  $('employeeSearch').addEventListener('input', () => {
    selected = undefined; $('employeeSelection').textContent = ''; $('employeeForm').querySelector('[type="submit"]').disabled = true;
    // Invalidate responses as soon as input changes, before the debounce expires.
    requestId++; clearTimeout(searchTimer); loading = true; renderPicker(); searchTimer = setTimeout(search, 250);
  });
  $('employeeFilter').addEventListener('input', renderRows);
  $('addEmployee').addEventListener('click', () => openPicker());
  $('syncDirectory').addEventListener('click', async () => {
    $('syncDirectory').disabled = true;
    try { await request('/employees/sync', {}); directory = { ...directory, requested: true }; loadError = ''; renderStatus(); clearTimeout(pollTimer); pollTimer = setTimeout(search, 10000); }
    catch (error) { loadError = error.message; renderStatus(); }
  });
  for (const id of ['closeEmployeeDialog', 'cancelEmployee']) $(id).addEventListener('click', () => $('employeeDialog').close());
  $('cancelRemoveEmployee').addEventListener('click', () => $('removeEmployeeDialog').close());
  $('employeeDialog').addEventListener('close', () => { selected = undefined; editing = undefined; requestId++; clearTimeout(searchTimer); loading = false; $('employeeForm').reset(); });
  $('employeeForm').addEventListener('submit', event => {
    event.preventDefault(); if (!selected) { message($('employeeDialogStatus'), text('chooseEmployeeFirst')); return; }
    submitForm(event.currentTarget, async () => {
      const enabled = $('employeeEnabled').checked, chosen = [...$('employeeFeatures').querySelectorAll('input:checked')].map(input => input.value);
      if (enabled && !chosen.length) throw new Error(text('chooseFunction'));
      const common = { operation: 'save', openId: selected.openId, factoryCode: $('employeeFactory').value, enabled };
      if (isWarehouse) {
        warehouse = (await request('/employees/warehouse', { ...common, ...(editing ? { id: editing.id, revision: editing.revision } : {}), events: chosen })).settings;
      } else {
        const aliases = $('employeeAliases').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        settings = (await request('/employees', { ...common, revision: settings.revision, features: chosen, inspectorNames: aliases.length ? aliases : [selected.name] })).settings;
      }
      changed(settings, warehouse); renderRows(); $('employeeDialog').close(); message($('pageStatus'), text('saved'), true);
    });
  });
  $('removeEmployeeForm').addEventListener('submit', event => {
    event.preventDefault(); submitForm(event.currentTarget, async () => {
      if (isWarehouse) warehouse = (await request('/employees/warehouse', { operation: 'remove', id: removing.id, revision: removing.revision })).settings;
      else settings = (await request('/employees', { revision: settings.revision, operation: 'remove', openId: removing.openId, factoryCode: removing.factoryCode })).settings;
      changed(settings, warehouse); renderRows(); $('removeEmployeeDialog').close(); message($('pageStatus'), text('saved'), true);
    });
  });
  document.addEventListener('visibilitychange', () => { clearTimeout(pollTimer); if (!document.hidden && (directory?.syncing || directory?.requested)) search(); });
  window.addEventListener('pagehide', () => { requestId++; clearTimeout(pollTimer); clearTimeout(searchTimer); });
  return {
    update(nextSettings, nextWarehouse) { settings = nextSettings; warehouse = nextWarehouse; renderRows(); },
    start() { if (isEmployeeView) { $('addEmployee').disabled = false; search(); } },
    localize() {
      $('employeeScope').textContent = text(isWarehouse ? 'warehouseEmployeeScope' : 'qcEmployeeScope');
      $('employeeRemoveDescription').textContent = text(isWarehouse ? 'warehouseEmployeeRemove' : 'qcEmployeeRemove');
      $('addEmployee').textContent = text(isWarehouse ? 'warehouseEmployeeAdd' : 'qcEmployeeAdd');
      for (const id of ['employeeFilter', 'employeeSearch']) { $(id).placeholder = text(id === 'employeeFilter' ? 'employeeFilter' : 'employeeSearch'); $(id).setAttribute('aria-label', text(id === 'employeeFilter' ? 'employeeFilter' : 'employeeSearch')); }
      $('closeEmployeeDialog').setAttribute('aria-label', text('cancel')); $('employeeResults').setAttribute('aria-label', text('employeeChoose'));
      // Relabel existing checkboxes without resetting unsaved feature choices.
      for (const input of $('employeeFeatures').querySelectorAll('input')) input.nextElementSibling.textContent = text(features[input.value]);
      renderRows(); renderStatus(); renderPicker();
    }
  };
}
