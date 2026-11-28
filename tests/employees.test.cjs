const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
let serial = 0;
async function fixture(t) {
  const [{ database }, store, employees, { createReminderWorker }, directory] = await Promise.all([import('./auth-fixture.mjs'), import('../server/reminders/store.mjs'), import('../server/reminders/employees.mjs'), import('../server/reminders/worker.mjs'), import('../server/reminders/directory.mjs')]);
  const db = database(':memory:', new URL('../server/reminders/schema.sql', 'file://' + __filename.replaceAll('\\', '/'))); t.after(() => db.close());
  const appId = 'cli_employee_fixture_' + ++serial, appSecret = 'Synthetic_employee_secret_only_123';
  const state = { calls: [], now: Date.parse('2026-11-28T02:00:00Z'), users: [{ open_id: 'ou_employee_a', name: 'Employee A', email: 'private@example.invalid', mobile: 'private' }, { open_id: 'ou_employee_b', name: 'Employee A', en_name: 'Employee B' }] };
  const env = { REMINDER_DB: db, REMINDER_ENCRYPTION_KEY: randomBytes(32).toString('base64'), REMINDER_GATEWAY_SECRET: 'synthetic-employee-gateway-only-1234567890', QMS_PROXY: { async fetch() { return Response.json({ status: 200, data: [{ code: 'STTH', name: '泰国协创' }, { code: 'DGXC', name: '东莞协创' }] }); } } };
  await store.saveSettings(env, { revision: 0, appId, appSecret, enabled: false, factories: ['STTH'], dailyStart: '00:00', recipients: [] }, 'fixture', [{ code: 'STTH' }], Math.floor(state.now / 1000));
  await db.prepare('UPDATE reminder_settings SET verified_key=? WHERE id=1').bind(store.credentialKey(appId, appSecret)).run();
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).hostname, 'open.feishu.cn'); assert.equal(init.redirect, 'manual');
    state.calls.push(new URL(url));
    if (url.includes('tenant_access_token')) return Response.json({ code: 0, tenant_access_token: 'synthetic', expire: 7200 });
    const profileRequest = url.includes('/basic_batch?');
    assert.equal(init.method, profileRequest ? 'POST' : 'GET');
    const body = profileRequest ? JSON.parse(init.body) : undefined;
    if (body) state.profileBatch = body.user_ids; else assert.equal(init.body, undefined);
    if (state.reply) return state.reply(new URL(url), body);
    if (url.includes('/scopes?')) return Response.json({ code: 0, data: { has_more: false, user_ids: state.users.map(user => user.open_id), department_ids: [], group_ids: [] } });
    return Response.json({ code: 0, data: { users: state.users.filter(row=>body.user_ids.includes(row.open_id)).map(row => ({ ...row, user_id: row.open_id, i18n_name: { en_us: row.en_name } })) } });
  };
  const options = { fetchImpl, clock: () => state.now };
  return { ...state, state, db, env, store, employees, options, directory, sync:()=>directory.runDirectoryCycle(env,{...options,pause:async()=>{}}), async edit(body) { const current = await store.readSettings(env); return employees.editEmployee(env, { revision: current.revision, factoryCode: 'STTH', ...body }, 'fixture', Math.floor(state.now / 1000), options); }, request(path, body) { return createReminderWorker(options).fetch(new Request('https://reminders.internal' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + env.REMINDER_GATEWAY_SECRET, 'X-IQC-Actor': '11111111-1111-4111-8111-111111111111' }, body: body === undefined ? undefined : JSON.stringify(body) }), env); } };
}
test('name directory reads only authorised users, keeps duplicate names and strips private fields and credentials', async t => {
  const f = await fixture(t); assert.equal((await f.sync()).error,undefined); const result = await f.employees.employeeDirectory(f.env, f.options);
  assert.equal(result.people.length, 2); assert.equal(result.people[0].name, result.people[1].name);
  const json = JSON.stringify(result); for (const forbidden of ['private', 'mobile', 'email', 'tenant_access_token', 'appSecret']) assert.ok(!json.includes(forbidden));
  assert.deepEqual(f.state.profileBatch, ['ou_employee_a', 'ou_employee_b']);
  await f.employees.employeeDirectory(f.env, f.options); assert.equal(f.state.calls.length, 3);
});
test('partial or foreign directory results never become selectable employees', async t => {
  const f = await fixture(t); f.state.reply = url => Response.json({ code: 0, data: url.pathname.endsWith('scopes') ? { has_more: false, user_ids: ['ou_employee_a'] } : { users: [{ user_id: 'ou_foreign_user', name: 'Wrong tenant' }] } });
  assert.equal((await f.sync()).error,'DIRECTORY_INCOMPLETE');
  f.state.reply = url => Response.json({ code: 0, data: url.pathname.endsWith('scopes') ? { has_more: false, user_ids: ['ou_employee_a'] } : { users: [] } });
  assert.equal((await f.sync()).error,undefined);assert.equal((await f.employees.employeeDirectory(f.env)).people.length,0);
});
test('scope pagination is complete and bounded; repeated cursors fail instead of showing partial matches', async t => {
  const f = await fixture(t);
  f.state.reply = () => Response.json({ code: 0, data: { has_more: true, page_token: 'same', user_ids: [] } });
  assert.equal((await f.sync()).error,'DIRECTORY_INCOMPLETE');
});
test('department scope is fully expanded using read-only current APIs', async t => {
  const f = await fixture(t); f.state.reply = url => {
    const data = url.pathname.endsWith('/scopes') ? { has_more: false, department_ids: ['od_root'] } : url.pathname.endsWith('/children') ? { has_more: false, items: [{ open_department_id: 'od_child' }] } : url.pathname.endsWith('/basic_batch') ? { users: [{ user_id: 'ou_employee_a', name: 'Employee A' }] } : { has_more: false, items: [f.state.users[0]] };
    return Response.json({ code: 0, data });
  };
  assert.equal((await f.sync()).error,undefined);const result = await f.employees.employeeDirectory(f.env, f.options); assert.equal(result.people.length, 1);
  assert.ok(f.state.calls.some(url => url.searchParams.get('department_id') === 'od_child'));
});
test('employee selection binds aliases to one account and cannot steal another employee mapping', async t => {
  const f = await fixture(t);
  let result = await f.edit({ operation: 'save', openId: 'ou_employee_a', inspectorNames: ['Employee A', 'QMS alias'] }); assert.equal(result.recipients.length, 2);
  await assert.rejects(f.edit({ operation: 'save', openId: 'ou_employee_b', inspectorNames: ['QMS alias'] }), { code: 'DUPLICATE_INSPECTOR' });
  result = await f.store.readSettings(f.env); assert.equal(result.recipients.length, 2); assert.ok(result.recipients.every(row => row.open_id === 'ou_employee_a'));
  await assert.rejects(f.edit({ operation: 'save', openId: 'ou_outside_employee', inspectorNames: ['Other'] }), { code: 'EMPLOYEE_NOT_IN_SCOPE' });
});
test('removing the last inspector pauses only inspector reminders and leaves warehouse configuration intact', async t => {
  const f = await fixture(t); await f.edit({ operation: 'save', openId: 'ou_employee_a', inspectorNames: ['A'] });
  await f.db.prepare('UPDATE reminder_settings SET enabled=1 WHERE id=1').run(); await f.db.prepare("UPDATE warehouse_settings SET enabled=1,open_id='ou_warehouse_fixture',revision=7 WHERE id=1").run();
  const result = await f.edit({ operation: 'remove', openId: 'ou_employee_a' }); assert.equal(result.enabled, false); assert.equal(result.recipients.length, 0);
  const warehouse = await f.db.prepare('SELECT enabled,revision FROM warehouse_settings').first(); assert.deepEqual(warehouse, { enabled: 1, revision: 7 });
});
test('section saves preserve unrelated credentials, recipients and rules; stale writes fail', async t => {
  const f = await fixture(t); await f.edit({ operation: 'save', openId: 'ou_employee_a', inspectorNames: ['A'] });
  const old = await f.store.readSettings(f.env), body = { revision: old.revision, enabled: true, factories: ['STTH'], dailyStart: '07:00' };
  await f.employees.editReminderSection(f.env, body, 'rules', 'fixture', 1000);
  let current = await f.store.readSettings(f.env); assert.equal(current.app_secret, old.app_secret); assert.deepEqual(current.recipients, old.recipients);
  await assert.rejects(f.employees.editReminderSection(f.env, body, 'rules', 'fixture', 1001), { code: 'SETTINGS_CHANGED' });
  await f.employees.editReminderSection(f.env, { revision: current.revision, appId: old.app_id }, 'connection', 'fixture', 1002);
  current = await f.store.readSettings(f.env); assert.equal(current.daily_start, '07:00'); assert.equal(current.enabled, true); assert.equal(current.app_secret, old.app_secret);
  await assert.rejects(f.employees.editReminderSection(f.env, { revision: current.revision, appId: 'cli_another_app' }, 'connection', 'fixture', 1003), { code: 'APP_CHANGE_REQUIRES_UNBIND' });
});
test('internal employee directory and section routes retain gateway protection and safe errors', async t => {
  const f = await fixture(t); assert.equal((await f.request('/employees')).status, 200);
  assert.equal((await f.request('/employees', { revision: 0, operation: 'save', factoryCode: 'STTH', openId: 'ou_employee_a', inspectorNames: ['A'] })).status, 409);
  assert.equal((await f.request('/settings/rules', { revision: 1, enabled: false, factories: ['STTH'], dailyStart: '00:00' })).status, 200);
});

test('company directory continues past 200 employees and searches server-side without returning a partial list as complete',async t=>{
  const f=await fixture(t);f.state.users=Array.from({length:217},(_,i)=>({open_id:'ou_company_'+String(i).padStart(4,'0'),name:i===216?'Company Search Target':'Employee '+i}));
  f.state.reply=(url,body)=>{
    if(url.pathname.endsWith('/scopes')){const offset=Number(url.searchParams.get('page_token')||0),next=offset+100;return Response.json({code:0,data:{has_more:next<f.state.users.length,page_token:String(next),user_ids:f.state.users.slice(offset,next).map(row=>row.open_id)}});}
    return Response.json({code:0,data:{users:f.state.users.filter(row=>body.user_ids.includes(row.open_id)).map(row=>({user_id:row.open_id,name:row.name}))}});
  };
  await f.sync();const partial=await f.directory.searchDirectory(f.env,'Target');assert.equal(partial.syncing,true);assert.equal(partial.complete,false);
  for(let step=0;step<5&&(await f.directory.directoryStatus(f.env)).stage!=='idle';step++)await f.sync();const result=await f.directory.searchDirectory(f.env,'company search');assert.equal(result.complete,true);assert.equal(result.total,217);assert.equal(result.people.length,1);assert.equal(result.people[0].name,'Company Search Target');
  assert.equal((await f.directory.searchDirectory(f.env,'%')).people.length,0);
});

test('QC employees have independent automatic and urgent switches and warehouse edits cannot overwrite them',async t=>{
  const f=await fixture(t);
  await f.edit({operation:'save',openId:'ou_employee_a',inspectorNames:['A'],enabled:true,features:['urgent']});
  const settings=await f.store.readSettings(f.env),{recipientGroups}=await import('../server/reminders/delivery.mjs');
  const snapshots=[{factoryCode:'STTH',factoryName:'Thai',groups:[{name:'A',total:1,items:[{}]}]}];
  assert.equal(recipientGroups(settings,snapshots).size,0);assert.equal(recipientGroups(settings,snapshots,'urgent').size,1);
  const warehouse=await f.employees.editWarehouseEmployee(f.env,{operation:'save',factoryCode:'STTH',openId:'ou_employee_b',enabled:true,events:['合格']},1000,f.options);
  assert.equal(warehouse.recipients.length,1);assert.deepEqual(warehouse.recipients[0].events,['合格']);
  const after=await f.store.readSettings(f.env);assert.equal(after.revision,settings.revision);assert.deepEqual(after.policies,settings.policies);
});

test('directory refresh retains a working snapshot on failure, honours leases and searches long multilingual names literally',async t=>{
  const f=await fixture(t);f.state.users[0].name='พนักงานทดสอบชื่อยาวมากสำหรับการค้นหาภายในบริษัท';
  await f.sync();assert.equal((await f.directory.searchDirectory(f.env,f.state.users[0].name)).people.length,1);
  const original=(await f.directory.directoryStatus(f.env)).active_generation;
  await f.directory.requestDirectorySync(f.env);f.state.reply=()=>Response.json({code:99991400,msg:'test failure'});
  assert.ok((await f.sync()).error);assert.equal((await f.directory.searchDirectory(f.env,'พนักงาน')).people.length,1);
  assert.equal((await f.directory.directoryStatus(f.env)).active_generation,original);
  await f.db.prepare('UPDATE feishu_directory_state SET lease_until=? WHERE id=1').bind(Math.floor(f.state.now/1000)+60).run();
  const calls=f.state.calls.length;assert.deepEqual(await f.sync(),{busy:true});assert.equal(f.state.calls.length,calls);
});

test('company directory work stays below free-plan D1 limits during department enumeration',async t=>{
  const f=await fixture(t);f.state.reply=(url)=>Response.json({code:0,data:url.pathname.endsWith('/scopes')?{has_more:false,department_ids:Array.from({length:50},(_,i)=>'od_department_'+i)}:{has_more:false,items:[]}});
  let calls=0;const prepare=f.db.prepare,batch=f.db.batch;
  const wrap=s=>({...s,bind(...args){return wrap(s.bind(...args));},async first(...args){calls++;return s.first(...args);},async all(...args){calls++;return s.all(...args);},async run(...args){calls++;return s.run(...args);}});
  f.db.prepare=sql=>wrap(prepare(sql));f.db.batch=async statements=>{calls++;return batch(statements);};
  for(let i=0;i<3;i++){calls=0;const result=await f.sync();assert.equal(result.error,undefined);assert.ok(result.requests<=8);assert.ok(calls<=50,'D1 calls: '+calls);}
});

test('adding an existing QC employee cannot overwrite QMS aliases or notification choices',async t=>{
  const f=await fixture(t);await f.edit({operation:'save',openId:'ou_employee_a',inspectorNames:['Employee A','QMS alias'],features:['urgent'],enabled:true});
  const before=await f.store.readSettings(f.env);
  await assert.rejects(f.edit({operation:'save',create:true,openId:'ou_employee_a',inspectorNames:['Employee A'],features:['new_tasks','urgent'],enabled:true}),{code:'DUPLICATE_RECIPIENT'});
  const after=await f.store.readSettings(f.env);assert.equal(after.revision,before.revision);assert.deepEqual(after.recipients,before.recipients);assert.deepEqual(after.policies,before.policies);
});
