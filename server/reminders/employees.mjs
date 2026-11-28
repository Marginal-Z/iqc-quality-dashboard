import { readSettings, saveSettings, credentialKey, ReminderError } from './store.mjs';
import { listReminderFactories } from '../pending-inspections.mjs';
import { createFeishuClient } from './feishu.mjs';

const openIdPattern = /^ou_[A-Za-z0-9_-]{4,124}$/;
const departmentPattern = /^[A-Za-z0-9][A-Za-z0-9_@.-]{0,63}$/;
const directoryCache = new Map();
const invalidDirectory = () => new ReminderError('DIRECTORY_INCOMPLETE', 503);

// Read only the app's existing contact scope. Never cache or return phone/email,
// employee IDs, avatars, employment attributes or the raw Feishu response.
export async function employeeDirectory(env, { fetchImpl = fetch, clock = () => Date.now() } = {}) {
  const bot = await readSettings(env);
  if (!bot.appSecret || bot.verified_key !== credentialKey(bot.app_id, bot.appSecret)) throw new ReminderError('CONNECTION_NOT_VERIFIED', 409);
  const key = credentialKey(bot.app_id, bot.appSecret);
  const cached = directoryCache.get(key);
  if (cached?.expires > clock()) return cached.value;
  const client = createFeishuClient(bot.app_id, bot.appSecret, { fetchImpl, now: clock });
  let calls = 0;
  async function pages(path, params, accept) {
    let next = '', seen = new Set();
    do {
      if (++calls > 24) throw new ReminderError('DIRECTORY_TOO_LARGE', 422);
      const data = await client.contacts(path, { ...params, ...(next ? { page_token: next } : {}) });
      if (!data || typeof data.has_more !== 'boolean') throw invalidDirectory();
      accept(data);
      if (!data.has_more) break;
      if (typeof data.page_token !== 'string' || !data.page_token || data.page_token.length > 4096 || seen.has(data.page_token)) throw invalidDirectory();
      next = data.page_token; seen.add(next);
    } while (true);
  }
  const ids = new Set(), departments = new Map(), users = new Map();
  function addId(id) {
    if (!openIdPattern.test(id)) throw invalidDirectory();
    ids.add(id);
    if (ids.size > 200) throw new ReminderError('DIRECTORY_TOO_LARGE', 422);
  }
  await pages('scopes', { user_id_type: 'open_id', department_id_type: 'open_department_id', page_size: '100' }, data => {
    if (![data.user_ids, data.department_ids, data.group_ids].every(value => value === undefined || Array.isArray(value))) throw invalidDirectory();
    if (data.group_ids?.length) throw new ReminderError('DIRECTORY_GROUP_SCOPE', 422);
    for (const id of data.user_ids || []) addId(id);
    for (const id of data.department_ids || []) { if (!departmentPattern.test(id)) throw invalidDirectory(); departments.set(id, ''); }
    if (departments.size > 20) throw new ReminderError('DIRECTORY_TOO_LARGE', 422);
  });
  // Department grants are bounded and fully paginated as well.
  for (const root of [...departments.keys()]) {
    await pages(`departments/${root}/children`, { department_id_type: 'open_department_id', fetch_child: 'true', page_size: '50' }, data => {
      if (!Array.isArray(data.items)) throw invalidDirectory();
      for (const department of data.items) { if (!departmentPattern.test(department.open_department_id)) throw invalidDirectory(); departments.set(department.open_department_id, ''); }
      if (departments.size > 20) throw new ReminderError('DIRECTORY_TOO_LARGE', 422);
    });
  }
  for (const department of departments.keys()) await pages('users/find_by_department', { department_id_type: 'open_department_id', department_id: department, user_id_type: 'open_id', page_size: '50' }, data => {
    if (!Array.isArray(data.items)) throw invalidDirectory();
    data.items.forEach(row => addId(row.open_id));
  });
  // Use the dedicated name endpoint, not the broader contact-profile fields.
  // With user_id_type=open_id its response calls the identifier `user_id`.
  const list = [...ids];
  for (let offset = 0; offset < list.length; offset += 10) {
    if (++calls > 24) throw new ReminderError('DIRECTORY_TOO_LARGE', 422);
    const batch = list.slice(offset, offset + 10), data = await client.profiles(batch);
    if (!Array.isArray(data?.users)) throw invalidDirectory();
    const returned = new Set();
    for (const row of data.users) {
      if (!batch.includes(row.user_id) || returned.has(row.user_id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 160) throw invalidDirectory();
      returned.add(row.user_id);
      users.set(row.user_id, { openId: row.user_id, name: row.name.trim(), englishName: typeof row.i18n_name?.en_us === 'string' ? row.i18n_name.en_us.slice(0, 160) : '' });
    }
    if (returned.size !== batch.length) throw invalidDirectory();
  }
  const value = { people: [...users.values()].sort((a, b) => a.name.localeCompare(b.name)), fetchedAt: Math.floor(clock() / 1000) };
  if (directoryCache.size > 8) directoryCache.clear();
  directoryCache.set(key, { value, expires: clock() + 60_000 });
  return value;
}

export async function editEmployee(env, body, actor, time, options = {}) {
  const old = await readSettings(env);
  if (body.revision !== old.revision) throw new ReminderError('SETTINGS_CHANGED', 409);
  if (!openIdPattern.test(body.openId || '') || !old.factories.includes(body.factoryCode) || !['save', 'remove'].includes(body.operation)) throw new ReminderError('INVALID_RECIPIENTS');
  if (body.operation === 'save') {
    const { people } = await employeeDirectory(env, options);
    if (!people.some(person => person.openId === body.openId)) throw new ReminderError('EMPLOYEE_NOT_IN_SCOPE', 409);
    if (!Array.isArray(body.inspectorNames) || !body.inspectorNames.length || body.inspectorNames.length > 10 || new Set(body.inspectorNames).size !== body.inspectorNames.length) throw new ReminderError('INVALID_RECIPIENTS');
  }
  const recipients = old.recipients.filter(row => !(row.open_id === body.openId && row.factory_code === body.factoryCode));
  if (body.operation === 'save') recipients.push(...body.inspectorNames.map(name => ({ factory_code: body.factoryCode, inspector_name: name, open_id: body.openId })));
  // An empty recipient list pauses only inspector reminders; warehouse is independent.
  return saveSettings(env, { revision: old.revision, appId: old.app_id, enabled: old.enabled && recipients.length > 0, factories: old.factories, dailyStart: old.daily_start, recipients }, actor, await listReminderFactories(env), time);
}

export async function editReminderSection(env, body, section, actor, time) {
  const old = await readSettings(env);
  const value = { revision: body.revision, appId: old.app_id, enabled: old.enabled, factories: old.factories, dailyStart: old.daily_start, recipients: old.recipients };
  if (section === 'rules') Object.assign(value, { enabled: body.enabled, factories: body.factories, dailyStart: body.dailyStart });
  else {
    if (body.appId !== old.app_id && old.recipients.length) throw new ReminderError('APP_CHANGE_REQUIRES_UNBIND', 409);
    value.appId = body.appId;
    if (body.appSecret) value.appSecret = body.appSecret;
    if (body.appSecret || body.appId !== old.app_id) value.enabled = false;
  }
  return saveSettings(env, value, actor, await listReminderFactories(env), time);
}
