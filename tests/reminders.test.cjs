const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const modules = Promise.all([import('./auth-fixture.mjs'), import('../server/reminders/worker.mjs'), import('../server/reminders/delivery.mjs'), import('../server/reminders/store.mjs')]);
let serial = 0;
async function fixture(t) {
  const [{ database }, { createReminderWorker }] = await modules;
  const db = database(':memory:', new URL('../server/reminders/schema.sql', 'file://' + __filename.replaceAll('\\', '/'))); t.after(db.close);
  let instant = Date.parse('2026-11-11T03:00:00Z');
  const calls = [], sent = new Map(), messages = [], records = { STTH: [], DGXC: [] };
  const state = { db, calls, sent, messages, records, appId: 'cli_test_' + ++serial, secret: 'Synthetic_Feishu_Secret_123456', actor: '11111111-1111-4111-8111-111111111111', failAfterAccept: false, failApi: false,
    clock: () => instant, advance: seconds => { instant += seconds * 1000; }, setTime: value => { instant = Date.parse(value); } };
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).hostname, 'open.feishu.cn'); assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['X-IQC-Actor'], undefined); assert.equal(init.headers.Cookie, undefined);
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (url.includes('tenant_access_token')) { assert.equal(body.app_secret, state.secret); return Response.json({ code: 0, tenant_access_token: 't-synthetic-token', expire: 7200 }); }
    if (state.failApi) return Response.json({ code: 230001, msg: 'private recipient detail' });
    messages.push(body); if (!sent.has(body.uuid)) sent.set(body.uuid, body);
    if (state.failAfterAccept) { state.failAfterAccept = false; throw new Error('Connection dropped after delivery'); }
    return Response.json({ code: 0, data: { message_id: 'om_' + body.uuid } });
  };
  const env = { REMINDER_DB: db, REMINDER_GATEWAY_SECRET: 'synthetic-gateway-token-only-1234567890', REMINDER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    QMS_PROXY: { async fetch(request) {
      const body = await request.json();
      if (body.path.endsWith('/factory')) return Response.json({ status: 200, data: [{ code: 'STTH', name: '测试泰国工厂' }, { code: 'DGXC', name: '测试东莞工厂' }] });
      if (state.qmsError) return new Response(null, { status: 401 });
      const rows = records[body.query['searchParams[factoryCode]']].filter(row => String(row.inspectionStatus) === body.query['searchParams[inspectionStatus]']);
      if (state.onQuery) await state.onQuery();
      return Response.json({ status: 200, data: { resultData: rows, total: rows.length } });
    } } };
  const worker = createReminderWorker({ clock: state.clock, fetchImpl });
  const request = (path, body, headers = {}) => worker.fetch(new Request('https://reminders.internal' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + env.REMINDER_GATEWAY_SECRET, 'X-IQC-Actor': state.actor, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  state.env = env; state.request = request;
  state.run = () => modules.then(([, , { runReminderCycle }]) => runReminderCycle(env, { clock: state.clock, fetchImpl }));
  state.body = { revision: 0, enabled: false, appId: state.appId, appSecret: state.secret, factories: ['STTH'], dailyStart: '00:00', recipients: [{ factory_code: 'STTH', inspector_name: '甲', open_id: 'ou_inspector_a' }] };
  state.save = async body => { const response = await request('/settings', body); assert.equal(response.status, 200, await response.clone().text()); const settings = (await response.json()).settings; state.body = { ...body, revision: settings.revision }; delete state.body.appSecret; return settings; };
  state.enable = async () => { await state.save(state.body); assert.equal((await request('/connection', {})).status, 200); await state.save({ ...state.body, enabled: true }); };
  return state;
}
const row = (id, inspector = '甲', extra = {}) => ({ orderNumber: id, inspectionStatus: '0', inspectorName: inspector, materialNumber: 'TEST-' + id, materialName: 'Synthetic material ' + id, qty: 10, createDate: '2026-11-11', ...extra });

test('reminder service requires a gateway credential and actor even if a public route is enabled', async t => {
  const f = await fixture(t);
  for (const headers of [{ Authorization: '' }, { 'X-IQC-Actor': '' }]) assert.equal((await f.request('/settings', undefined, headers)).status, 404);
  assert.equal((await f.request('/connection')).status, 404); assert.equal(f.calls.length, 0);
});
test('app credentials are encrypted, never returned, and enabling requires a verified connection', async t => {
  const f = await fixture(t);
  await f.save(f.body);
  const encoded = f.db.sqlite.prepare('SELECT app_secret FROM reminder_settings').get().app_secret;
  assert.ok(encoded.startsWith('v1.')); assert.ok(!encoded.includes(f.secret));
  assert.ok(!(await (await f.request('/settings')).text()).includes(f.secret));
  assert.equal((await f.request('/settings', { ...f.body, enabled: true })).status, 400);
  assert.equal((await f.request('/connection', {})).status, 200); assert.equal(f.messages.length, 0);
  await f.save({ ...f.body, enabled: true });
});
test('stale configuration updates cannot overwrite recipients or credentials', async t => {
  const f = await fixture(t); const stale = { ...f.body }; await f.save(f.body);
  assert.equal((await f.request('/settings', { ...stale, recipients: [] })).status, 409);
  assert.equal((await (await f.request('/settings')).json()).settings.recipients.length, 1);
});
test('each newly pending task is notified once, including later arrivals on the same day', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')];
  assert.equal((await f.run()).sent, 1); f.records.STTH.push(row('B'));
  assert.equal((await f.run()).sent, 1); assert.equal(f.messages.length, 2);
  assert.ok(!f.messages[1].content.includes('TEST-A')); assert.ok(f.messages[1].content.includes('TEST-B'));
  f.advance(86400); assert.equal((await f.run()).sent, 0); assert.equal(f.sent.size, 2);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM reminder_deliveries WHERE payload<>''").get().n, 0);
});
test('empty morning checks do not consume the day; inspectors are triggered independently', async t => {
  const f = await fixture(t); f.body.recipients.push({ factory_code: 'STTH', inspector_name: '乙', open_id: 'ou_inspector_b' }); await f.enable();
  assert.equal((await f.run()).sent, 0); f.records.STTH = [row('A')]; assert.equal((await f.run()).sent, 1);
  f.records.STTH.push(row('B', '乙')); assert.equal((await f.run()).sent, 1); assert.equal(f.sent.size, 2);
});
test('retention still removes expired delivery metadata while reminders are disabled', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')];
  await f.run(); f.advance(86400); f.records.STTH.push(row('B')); await f.run();
  await f.save({ ...f.body, enabled: false }); f.advance(90 * 86400);
  let qmsReads = 0; f.onQuery = () => { qmsReads++; };
  assert.equal((await f.run()).disabled, true);
  const remaining = f.db.sqlite.prepare('SELECT thai_day,status FROM reminder_deliveries').all();
  assert.equal(remaining.length, 1); assert.equal(remaining[0].thai_day, '2026-11-12');
  assert.equal(remaining[0].status, 'sent'); assert.equal(qmsReads, 0); assert.equal(f.messages.length, 2);
});
test('private messages contain only mapped materials for that person, combining their factories', async t => {
  const f = await fixture(t); f.body.factories.push('DGXC'); f.body.recipients.push({ factory_code: 'DGXC', inspector_name: '甲（分厂）', open_id: 'ou_inspector_a' }, { factory_code: 'STTH', inspector_name: '乙', open_id: 'ou_inspector_b' }); await f.enable();
  f.records.STTH = [row('A'), row('B', '乙'), row('U', ''), row('NO_MAP', '未绑定')]; f.records.DGXC = [row('C', '甲（分厂）')];
  const result = await f.run(); assert.equal(result.sent, 2);
  const a = f.messages.find(message => message.receive_id === 'ou_inspector_a'), card = JSON.parse(a.content), text = JSON.stringify(card);
  assert.equal(a.msg_type, 'interactive'); assert.equal(card.schema, '2.0');
  assert.ok(text.includes('TEST-A') && text.includes('TEST-C')); assert.ok(!text.includes('TEST-B') && !text.includes('NO_MAP'));
  assert.ok(card.config.summary.content.includes('待检 / รอตรวจ 2 批'));
});
test('parallel cron invocations claim one durable delivery lease', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')];
  const result = await Promise.all([f.run(), f.run()]); assert.equal(result.reduce((n, r) => n + r.sent, 0), 1); assert.equal(f.messages.length, 1);
});
test('uncertain sends retry the same immutable payload and UUID within the Feishu deduplication window', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')]; f.failAfterAccept = true;
  assert.equal((await f.run()).failed, 1); const initial = f.messages[0]; f.advance(61); f.records.STTH.push(row('B'));
  assert.equal((await f.run()).sent, 2); assert.equal(f.messages[1].uuid, initial.uuid); assert.equal(f.messages[1].content, initial.content); assert.equal(f.sent.size, 2);
});
test('an ambiguous delivery never automatically retries outside the deduplication window', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')]; f.failAfterAccept = true; await f.run(); f.advance(56 * 60);
  assert.equal((await f.run()).sent, 0); assert.equal(f.messages.length, 1);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM reminder_deliveries').get().status, 'uncertain');
});
test('an old encrypted text delivery keeps its original message type, body and UUID during upgrade retries', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')];
  const [, , { deliveryId }, { encrypt }] = await modules;
  const now = Math.floor(f.clock() / 1000), id = deliveryId('2026-11-11', f.appId, 'ou_inspector_a');
  const oldText = 'IQC 待检物料提醒\n旧版已发送正文 TEST-A';
  f.db.sqlite.prepare(`INSERT INTO reminder_deliveries(id,thai_day,app_id,open_id,inspector_names,total,urgent,overdue,payload,status,send_uuid,config_revision,attempts,uncertain,first_attempt_at,created_at)
    VALUES(?,?,?,?,?,1,0,0,?,'retry',?,?,1,1,?,?)`).run(id, '2026-11-11', f.appId, 'ou_inspector_a', '["甲"]', encrypt(f.env, oldText), id, f.body.revision, now - 60, now - 60);
  assert.equal((await f.run()).sent, 1);
  assert.equal(f.messages[0].msg_type, 'text'); assert.equal(f.messages[0].uuid, id); assert.deepEqual(JSON.parse(f.messages[0].content), { text: oldText });
  assert.equal((await f.run()).sent, 0); assert.equal(f.messages.length, 1);
});
test('Thailand start time gates new-task detection without a daily repeat', async t => {
  const f = await fixture(t); f.body.dailyStart = '08:00'; await f.enable(); f.records.STTH = [row('A')];
  f.setTime('2026-11-11T00:59:00Z'); assert.equal((await f.run()).beforeStart, true);
  f.setTime('2026-11-11T01:00:00Z'); assert.equal((await f.run()).sent, 1);
  f.setTime('2026-11-11T17:00:00Z'); assert.equal((await f.run()).beforeStart, true);
  f.setTime('2026-11-12T01:00:00Z'); assert.equal((await f.run()).sent, 0);
  f.records.STTH.push(row('B')); assert.equal((await f.run()).sent, 1);
});
test('disabled settings, lost verification and QMS failures cannot send messages', async t => {
  const f = await fixture(t); f.records.STTH = [row('A')]; assert.equal((await f.run()).disabled, true); await f.enable();
  f.qmsError = true; assert.equal((await f.run()).error, 'QMS_HTTP_ERROR'); assert.equal(f.messages.length, 0);
  f.qmsError = false; f.db.sqlite.prepare("UPDATE reminder_settings SET verified_key=''").run(); assert.equal((await f.run()).error, 'CONNECTION_NOT_VERIFIED'); assert.equal(f.messages.length, 0);
});
test('disabling during a QMS read stops newly prepared deliveries', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')];
  f.onQuery = async () => f.db.sqlite.prepare('UPDATE reminder_settings SET enabled=0,revision=revision+1').run();
  assert.equal((await f.run()).sent, 0); assert.equal(f.messages.length, 0);
});
test('preview never sends, shows unassigned mappings, escapes bot mentions and reports omitted details', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = Array.from({ length: 20 }, (_, i) => row(String(i), '甲', { materialName: '<at user_id="all">ALL</at>' })); f.records.STTH.push(row('U', ''));
  const preview = await (await f.request('/preview')).json(); assert.equal(f.messages.length, 0); assert.equal(preview.messages[0].total, 20);
  assert.ok(preview.messages[0].text.includes('另有 5 批')); assert.ok(!preview.messages[0].text.includes('<at')); assert.equal(preview.inspectors.find(row => row.name === '未分配').mapped, false);
});
test('permanent Feishu errors are recorded without exposing upstream messages or retrying endlessly', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')]; f.failApi = true;
  assert.equal((await f.run()).failed, 1); assert.equal((await f.run()).failed, 0);
  const history = await (await f.request('/history')).text(); assert.ok(history.includes('FEISHU_CODE_230001')); assert.ok(!history.includes('private recipient detail')); assert.ok(!history.includes(f.secret));
});
test('an explicit settings repair can retry a confirmed rejection but cannot resend a successful daily reminder', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')]; f.failApi = true; await f.run();
  f.failApi = false; await f.save(f.body); assert.equal((await f.run()).sent, 1);
  await f.save(f.body); assert.equal((await f.run()).sent, 0); assert.equal(f.sent.size, 1);
});
test('a settings repair cannot restart an uncertain delivery after the retry window', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')]; f.failAfterAccept = true; await f.run(); f.advance(56 * 60); await f.run();
  await f.save(f.body); assert.equal((await f.run()).sent, 0); assert.equal(f.messages.length, 1);
});
test('fifty recipients drain without duplicate sends or exceeding the free D1 query budget', async t => {
  const f = await fixture(t); f.body.recipients = Array.from({ length: 50 }, (_, i) => ({ factory_code: 'STTH', inspector_name: '检验员' + i, open_id: 'ou_inspector_' + i })); await f.enable();
  f.records.STTH = Array.from({ length: 50 }, (_, i) => row('TASK-' + i, '检验员' + i));
  let queries = 0; const prepare = f.db.prepare, batch = f.db.batch;
  const wrap = statement => ({ ...statement, bind(...params) { return wrap(statement.bind(...params)); }, async first(...args) { queries++; return statement.first(...args); }, async all(...args) { queries++; return statement.all(...args); }, async run(...args) { queries++; return statement.run(...args); } });
  f.db.prepare = sql => wrap(prepare(sql)); f.db.batch = async statements => { queries++; return batch(statements); };
  for (const expected of [16, 16, 16, 2]) { queries = 0; assert.equal((await f.run()).sent, expected); assert.ok(queries <= 50, 'D1 query budget: ' + queries); }
  assert.equal(f.sent.size, 50);
});
test('a lost database acknowledgement after delivery reuses the same external UUID', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')];
  const prepare = f.db.prepare; let fail = true;
  f.db.prepare = sql => { const statement = prepare(sql); if (!sql.includes("SET status='sent'")) return statement; return { ...statement, bind(...params) { const bound = statement.bind(...params); return { ...bound, async run() { if (fail) { fail = false; throw new Error('Lost acknowledgement'); } return bound.run(); } }; } }; };
  assert.equal((await f.run()).failed, 1); f.advance(61); assert.equal((await f.run()).sent, 1); assert.equal(f.sent.size, 1); assert.equal(f.messages[0].uuid, f.messages[1].uuid);
});
test('foreign factory data is never disclosed through an inspector reminder', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A', '甲', { factoryCode: 'DGXC' })];
  assert.equal((await f.run()).error, 'FACTORY_DATA_MISMATCH'); assert.equal(f.messages.length, 0);
});
test('reminder interface translations have matching keys in Chinese, English and Thai', async () => {
  const translations = (await import('../auth/reminder-i18n.js')).default;
  for (const lang of ['en', 'th']) assert.deepEqual(Object.keys(translations[lang]).sort(), Object.keys(translations.zh).sort());
});

async function urgentPreview(f) {
  const response = await f.request('/urgent/preview', { factoryCode: 'STTH' });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
test('unmapped pending work is diagnosed without a private message or receipt', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('U', '未绑定'), row('V', '')];
  const result = await f.run(); assert.equal(result.sent, 0); assert.equal(result.pendingTotal, 2); assert.equal(result.mappedPendingTotal, 0);
  assert.equal(result.unmappedInspectors.length, 2); assert.equal(f.messages.length, 0);
  const settings = (await (await f.request('/settings')).json()).settings;
  assert.equal(settings.diagnostics.pendingTotal, 2); assert.equal(settings.mode, 'new_tasks');
});
test('reassignment notifies the new mapped inspector without repeating the old recipient', async t => {
  const f = await fixture(t); f.body.recipients.push({ factory_code: 'STTH', inspector_name: '乙', open_id: 'ou_inspector_b' }); await f.enable();
  f.records.STTH = [row('A')]; await f.run(); f.records.STTH = [row('A', '乙')];
  assert.equal((await f.run()).sent, 1); assert.equal(f.messages[1].receive_id, 'ou_inspector_b');
  assert.equal((await f.run()).sent, 0);
});
test('minute checks do not rewrite every active task receipt, while daily retention stays fresh', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('A')]; await f.run();
  const initial = f.db.sqlite.prepare('SELECT last_seen_at FROM reminder_task_receipts').get().last_seen_at;
  f.advance(61); assert.equal((await f.run()).sent, 0);
  assert.equal(f.db.sqlite.prepare('SELECT last_seen_at FROM reminder_task_receipts').get().last_seen_at, initial);
  f.advance(86400); assert.equal((await f.run()).sent, 0);
  assert.ok(f.db.sqlite.prepare('SELECT last_seen_at FROM reminder_task_receipts').get().last_seen_at > initial);
});
test('urgent preview never sends; manual cards include only mapped urgent unfinished work', async t => {
  const f = await fixture(t); await f.enable(); await f.save({ ...f.body, enabled: false });
  f.records.STTH = [row('URGENT', '甲', { expeditedFlag: '1' }), row('NORMAL'), row('DONE', '甲', { inspectionStatus: '1', expeditedFlag: '1' }), row('UNMAPPED', '无绑定', { expeditedFlag: '1' })];
  const preview = await urgentPreview(f); assert.equal(f.messages.length, 0); assert.equal(preview.total, 1); assert.equal(preview.unmappedInspectors.length, 1);
  const response = await f.request('/urgent/send', { requestId: preview.requestId });
  assert.equal(response.status, 200, await response.clone().text()); const result = await response.json(); assert.equal(result.sent, 1);
  const body = f.messages[0].content; assert.ok(body.includes('TEST-URGENT')); for (const name of ['TEST-NORMAL','TEST-DONE','TEST-UNMAPPED']) assert.ok(!body.includes(name));
  assert.ok(body.includes('急料检验通知') && body.includes('แจ้งตรวจวัสดุเร่งด่วน'));
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM reminder_task_receipts').get().n, 0);
});
test('urgent confirmation is bound to the actor and fails closed on changed tasks, revision or expiry', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('U', '甲', { expeditedFlag: '1' })];
  let preview = await urgentPreview(f);
  assert.equal((await f.request('/urgent/send', { requestId: preview.requestId }, { 'X-IQC-Actor': '22222222-2222-4222-8222-222222222222' })).status, 409);
  f.records.STTH.push(row('V', '甲', { expeditedFlag: '1' })); assert.equal((await f.request('/urgent/send', { requestId: preview.requestId })).status, 409);
  preview = await urgentPreview(f); await f.save(f.body); assert.equal((await f.request('/urgent/send', { requestId: preview.requestId })).status, 409);
  preview = await urgentPreview(f); f.advance(301); assert.equal((await f.request('/urgent/send', { requestId: preview.requestId })).status, 409); assert.equal(f.messages.length, 0);
});
test('parallel and repeated urgent confirmations send once; a new immediate request is rate limited', async t => {
  const f = await fixture(t); await f.enable(); f.records.STTH = [row('U', '甲', { expeditedFlag: '1' })];
  const preview = await urgentPreview(f);
  const responses = await Promise.all([f.request('/urgent/send', { requestId: preview.requestId }), f.request('/urgent/send', { requestId: preview.requestId })]);
  assert.ok(responses.every(response => response.status === 200)); assert.equal(f.messages.length, 1);
  assert.equal((await f.request('/urgent/send', { requestId: preview.requestId })).status, 200); assert.equal(f.messages.length, 1);
  const again = await urgentPreview(f); assert.equal((await f.request('/urgent/send', { requestId: again.requestId })).status, 409);
});
test('queued urgent work is rechecked after the browser request ends and completed tasks are cancelled', async t => {
  const f = await fixture(t); await f.enable(); await f.save({ ...f.body, enabled: false });
  f.records.STTH = [row('U', '甲', { expeditedFlag: '1' })]; const preview = await urgentPreview(f);
  f.db.sqlite.prepare("UPDATE reminder_runtime SET lease_until=?").run(Math.floor(f.clock()/1000) + 180);
  const queued = await (await f.request('/urgent/send', { requestId: preview.requestId })).json(); assert.equal(queued.queued, 1); assert.equal(f.messages.length, 0);
  f.records.STTH = []; f.advance(181); assert.equal((await f.run()).sent, 0);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM reminder_deliveries').get().status, 'cancelled');
});
test('large manual urgent requests remain within the free D1 budget and continue on later background cycles', async t => {
  const f = await fixture(t); f.body.recipients = Array.from({ length: 50 }, (_, i) => ({ factory_code: 'STTH', inspector_name: '检验员' + i, open_id: 'ou_inspector_' + i }));
  await f.enable(); await f.save({ ...f.body, enabled: false });
  f.records.STTH = Array.from({ length: 50 }, (_, i) => row('URGENT-' + i, '检验员' + i, { expeditedFlag: '1' }));
  const preview = await urgentPreview(f);
  let queries = 0; const prepare = f.db.prepare, batch = f.db.batch;
  const wrap = statement => ({ ...statement, bind(...params) { return wrap(statement.bind(...params)); }, async first(...args) { queries++; return statement.first(...args); }, async all(...args) { queries++; return statement.all(...args); }, async run(...args) { queries++; return statement.run(...args); } });
  f.db.prepare = sql => wrap(prepare(sql)); f.db.batch = async statements => { queries++; return batch(statements); };
  const response = await f.request('/urgent/send', { requestId: preview.requestId }); assert.equal(response.status, 200);
  assert.equal((await response.json()).sent, 15); assert.ok(queries <= 50, 'manual D1 budget: ' + queries);
  for (const expected of [16, 16, 3]) { queries = 0; assert.equal((await f.run()).sent, expected); assert.ok(queries <= 50, 'scheduled D1 budget: ' + queries); }
  assert.equal(f.sent.size, 50);
});
test('the new-task migration is repeatable and preserves existing credentials and delivery state', async t => {
  const { DatabaseSync } = require('node:sqlite'), { readFileSync } = require('node:fs');
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(readFileSync(require('node:path').join(__dirname, '../server/reminders/schema.sql'), 'utf8').split('-- Additive')[0]);
  db.prepare("UPDATE reminder_settings SET enabled=1,app_secret='synthetic-encrypted-sentinel',revision=7").run();
  const migration = readFileSync(require('node:path').join(__dirname, '../server/reminders/migrations/0002-new-task-outbox.sql'), 'utf8');
  db.exec(migration); db.exec(migration);
  const row = db.prepare('SELECT enabled,app_secret,revision FROM reminder_settings').get(); assert.equal(row.enabled, 1); assert.equal(row.app_secret, 'synthetic-encrypted-sentinel'); assert.equal(row.revision, 7);
  assert.equal(db.prepare('SELECT count(*) n FROM reminder_runtime').get().n, 1);
});
