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
