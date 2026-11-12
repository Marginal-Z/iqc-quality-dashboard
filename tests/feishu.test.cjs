const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Feishu credentials and messages never follow redirects in the Workers-compatible fetch mode', async () => {
  const { createFeishuClient } = await import('../server/reminders/feishu.mjs');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    // Match the edge runtime's supported modes rather than Node's broader API.
    if (!['manual', 'follow'].includes(init.redirect)) throw new TypeError('Unsupported edge redirect mode');
    if (url.includes('/tenant_access_token/')) return new Response(null, { status: 302, headers: { Location: 'https://other.example/credentials' } });
    throw new Error('Unexpected request');
  };
  await assert.rejects(createFeishuClient('cli_redirect_token', 'synthetic-secret', { fetchImpl }).verify(true), error => error.code === 'FEISHU_HTTP_302' && !error.retryable);
  assert.equal(calls.length, 1); assert.equal(calls[0].init.redirect, 'manual');

  const messageCalls = [];
  const client = createFeishuClient('cli_redirect_message', 'synthetic-secret', { fetchImpl: async (url, init) => {
    messageCalls.push({ url, init });
    if (url.includes('/tenant_access_token/')) return Response.json({ code: 0, tenant_access_token: 'synthetic-token', expire: 7200 });
    return new Response(null, { status: 307, headers: { Location: 'https://other.example/message' } });
  } });
  await assert.rejects(client.send('ou_synthetic_user', 'Synthetic message', 'synthetic-uuid'), error => error.code === 'FEISHU_HTTP_307');
  assert.equal(messageCalls.length, 2);
  assert.ok(messageCalls.every(call => call.init.redirect === 'manual' && new URL(call.url).hostname === 'open.feishu.cn'));
});

test('Feishu sends the native card envelope and rejects malformed messages before requesting a token', async () => {
  const { createFeishuClient } = await import('../server/reminders/feishu.mjs');
  const { reminderMessage } = await import('../server/reminders/message.mjs');
  const calls = [], client = createFeishuClient('cli_card_test', 'synthetic-secret', { fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (url.includes('/tenant_access_token/')) return Response.json({ code: 0, tenant_access_token: 'synthetic-token', expire: 7200 });
    return Response.json({ code: 0, data: { message_id: 'om_synthetic_card' } });
  } });
  for (const value of [null, {}, { msg_type: 'text', content: {} }, { msg_type: 'interactive', content: { schema: '2.0' } }]) await assert.rejects(client.send('ou_synthetic', value, 'test-uuid'), { code: 'FEISHU_INVALID_MESSAGE' });
  assert.equal(calls.length, 0);
  const { message } = reminderMessage([], '2026-11-12');
  assert.equal(await client.send('ou_synthetic', message, 'test-uuid'), 'om_synthetic_card');
  assert.deepEqual(calls[1].body, { receive_id: 'ou_synthetic', msg_type: 'interactive', content: JSON.stringify(message.content), uuid: 'test-uuid' });
  assert.ok(calls[1].url.endsWith('receive_id_type=open_id'));
});
