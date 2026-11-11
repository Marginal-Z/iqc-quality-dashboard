const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../server/pending-inspections.mjs');
const row = (id, status = '0', extra = {}) => ({ orderNumber: id, inspectionStatus: status, inspectorName: '检验员甲', materialNumber: 'M-1', materialName: '测试物料', createDate: '2026-11-11', qty: 10, ...extra });
function proxy(handler) { const calls = []; return { calls, QMS_PROXY: { async fetch(request) { const body = await request.json(); calls.push({ body, headers: request.headers }); return handler(body); } } }; }
const page = (rows, total = rows.length) => Response.json({ status: 200, data: { resultData: rows, total } });

test('reminders load every server-capped page, include overdue and reconcile status transitions', async () => {
  const { loadPendingInspections } = await modulePromise;
  const env = proxy(({ query }) => query['searchParams[inspectionStatus]'] === '2' ? page([row('B', '2')]) : page([row(query.pageNum === '1' ? 'A' : 'B')], 2));
  const rows = await loadPendingInspections(env, 'STTH');
  assert.equal(rows.length, 2); assert.equal(rows[1].inspectionStatus, '2'); assert.equal(env.calls.length, 3);
  for (const call of env.calls) { assert.equal(call.headers.get('Cookie'), null); assert.equal(call.headers.get('Authorization'), null); assert.equal(call.body.query['searchParams[factoryCode]'], 'STTH'); }
});

test('partial, duplicate, changing totals or malformed QMS data never produce reminder snapshots', async () => {
  const { loadPendingInspections } = await modulePromise;
  for (const handler of [
    ({ query }) => page(query.pageNum === '1' ? [row('A')] : [], 2),
    () => page([row('A')], 2),
    ({ query }) => page([row(query.pageNum)], query.pageNum === '1' ? 2 : 3),
    () => Response.json({ status: 200, data: { total: null, resultData: [] } }),
    () => page([{ materialNumber: 'missing-order' }])
  ]) await assert.rejects(loadPendingInspections(proxy(handler), 'STTH'));
});

test('QMS authorization and business errors fail without retry; exhausted budgets fail closed', async () => {
  const { loadPendingInspections } = await modulePromise;
  for (const handler of [() => new Response(null, { status: 401 }), () => Response.json({ status: 500, message: 'private upstream detail' })]) {
    const env = proxy(handler); await assert.rejects(loadPendingInspections(env, 'STTH'), error => !error.message.includes('private')); assert.equal(env.calls.length, 1);
  }
  const env = proxy(() => page([row('A')], 2));
  await assert.rejects(loadPendingInspections(env, 'STTH', { budget: { used: 0, limit: 1 } }), { code: 'QMS_REQUEST_LIMIT' });
  await assert.rejects(loadPendingInspections(env, 'https://untrusted.example/'), { code: 'INVALID_FACTORY' });
});

test('inspector reminders retain all inspectors, unassigned tasks and urgent/overdue material details', async () => {
  const { summarizePendingInspections } = await modulePromise;
  const records = Array.from({ length: 8 }, (_, i) => row(String(i), '0', { inspectorName: '检验员' + i }));
  records.push(row('unassigned', '2', { inspectorName: ' ', expeditedFlag: 1 }), row('old', 0, { createDate: '2026-11-08' }), row('hours', '0', { totalTime: '1天0时0分' }), row('done', '1'));
  const snapshot = summarizePendingInspections(records, { now: new Date('2026-11-11T02:00:00Z') });
  assert.equal(snapshot.total, 11); assert.equal(snapshot.overdue, 3); assert.equal(snapshot.urgent, 1); assert.equal(snapshot.groups.length, 10);
  assert.equal(snapshot.groups.reduce((n, group) => n + group.total, 0), snapshot.total);
  assert.equal(snapshot.groups.find(group => group.name === '未分配').items[0].materialNumber, 'M-1');
});

test('reminder dates follow the selected plant time zone at the midnight boundary', async () => {
  const { summarizePendingInspections } = await modulePromise;
  const now = new Date('2026-11-10T16:30:00Z');
  assert.equal(summarizePendingInspections([], { now, timeZone: 'Asia/Bangkok' }).date, '2026-11-10');
  assert.equal(summarizePendingInspections([], { now, timeZone: 'Asia/Shanghai' }).date, '2026-11-11');
});
