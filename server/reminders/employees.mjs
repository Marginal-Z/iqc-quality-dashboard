import { readSettings, saveSettings, ReminderError } from './store.mjs';
import { listReminderFactories } from '../pending-inspections.mjs';
import { searchDirectory, verifyEmployee } from './directory.mjs';
import { saveWarehouseRecipient, readWarehouseSettings } from './warehouse.mjs';
export async function employeeDirectory(env,{query=''}={}) { return searchDirectory(env,query); }
export async function editEmployee(env, body, actor, time, options = {}) {
  const old=await readSettings(env),policy=old.policies.find(row=>row.factory_code===body.factoryCode&&row.open_id===body.openId);
  if(body.revision!==old.revision)throw new ReminderError('SETTINGS_CHANGED',409);
  if(!/^ou_[A-Za-z0-9_-]{4,124}$/.test(body.openId||'')||!old.factories.includes(body.factoryCode)||!['save','remove'].includes(body.operation))throw new ReminderError('INVALID_RECIPIENTS');
  let update;
  if(body.operation==='save'){
    const person=await verifyEmployee(env,body.openId,options);
    if(!Array.isArray(body.inspectorNames)||!body.inspectorNames.length||body.inspectorNames.length>10||new Set(body.inspectorNames).size!==body.inspectorNames.length)throw new ReminderError('INVALID_RECIPIENTS');
    const enabled=body.enabled??Boolean(policy?.enabled??true),features=body.features??['new_tasks','urgent'];
    if(typeof enabled!=='boolean'||!Array.isArray(features)||features.some(value=>!['new_tasks','urgent'].includes(value))||new Set(features).size!==features.length||enabled&&!features.length)throw new ReminderError('INVALID_RECIPIENTS');
    update={factoryCode:body.factoryCode,openId:body.openId,name:person.name,enabled,newTasks:features.includes('new_tasks'),urgent:features.includes('urgent')};
  }
  const recipients=old.recipients.filter(row=>!(row.open_id===body.openId&&row.factory_code===body.factoryCode));
  if(body.operation==='save')recipients.push(...body.inspectorNames.map(name=>({factory_code:body.factoryCode,inspector_name:name,open_id:body.openId})));
  return saveSettings(env,{revision:old.revision,appId:old.app_id,enabled:old.enabled&&recipients.length>0,factories:old.factories,dailyStart:old.daily_start,recipients},actor,await listReminderFactories(env),time,{policy:update});
}
export async function editWarehouseEmployee(env,body,time,options={}) {
  const person=body.operation==='remove'?null:await verifyEmployee(env,body.openId,options);
  return saveWarehouseRecipient(env,body,person?.name||'',time);
}
export async function editReminderSection(env, body, section, actor, time) {
  const old = await readSettings(env);
  const value = { revision: body.revision, appId: old.app_id, enabled: old.enabled, factories: old.factories, dailyStart: old.daily_start, recipients: old.recipients };
  if (section === 'rules') Object.assign(value, { enabled: body.enabled, factories: body.factories, dailyStart: body.dailyStart });
  else {
    if (body.appId !== old.app_id && (old.recipients.length || (await readWarehouseSettings(env)).recipients.length)) throw new ReminderError('APP_CHANGE_REQUIRES_UNBIND', 409);
    value.appId = body.appId;
    if (body.appSecret) value.appSecret = body.appSecret;
    if (body.appSecret || body.appId !== old.app_id) value.enabled = false;
  }
  return saveSettings(env, value, actor, await listReminderFactories(env), time);
}
