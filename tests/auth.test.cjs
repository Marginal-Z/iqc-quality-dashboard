const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const PASSWORD = 'Synthetic test passphrase 123!';
const NEW_PASSWORD = 'Another synthetic passphrase 456!';
const modules = Promise.all([import('./auth-fixture.mjs'), import('../server/worker.mjs')]);
async function start(t, initialize = true) {
  const [{ fixture, SETUP_TOKEN }] = await modules;
  const f = fixture(); t.after(f.close);
  f.setupBody = { token: SETUP_TOKEN, username: 'quality.admin', displayName: '测试管理员', password: PASSWORD };
  if (initialize) { const res = await f.request('/api/auth/setup', f.setupBody); assert.equal(res.status, 200); f.admin = await f.session(res); }
  return f;
}
async function createViewer(f, role = 'viewer', username = 'quality.viewer') {
  const res = await f.request('/api/admin/users', { username, displayName: '<script>test</script>', password: PASSWORD, role }, f.admin); assert.equal(res.status, 201);
  const user = (await res.json()).user;
  const login = await f.request('/api/auth/login', { username, password: PASSWORD }); assert.equal(login.status, 200);
  return { user, session: await f.session(login) };
}
test('salted native scrypt hashes verify exact passwords without storing plaintext', async () => {
  const [, { hashPassword, verifyPassword }] = await modules;
  const a = await hashPassword(PASSWORD), b = await hashPassword(PASSWORD);
  assert.notEqual(a, b); assert.match(a, /^scrypt\$32768\$8\$3\$/); assert.ok(!a.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, a), true); assert.equal(await verifyPassword(PASSWORD + ' ', a), false);
  assert.equal(await verifyPassword(PASSWORD, 'invalid'), false);
  await assert.rejects(hashPassword('too short')); await assert.rejects(hashPassword('a'.repeat(129)));
});
test('unauthenticated HTML, scripts, runtime config and QMS cannot bypass login', async t => {
  const f = await start(t, false);
  for (const path of ['/', '/index.html', '/accounts']) { const res = await f.request(path); assert.equal(res.status, 303); assert.match(res.headers.get('Location'), /^\/login\?next=/); }
  for (const path of ['/assets/dashboard.js', '/assets/runtime-config.js', '/auth/accounts.js', '/api/auth/me']) assert.equal((await f.request(path)).status, 401, path);
  assert.equal((await f.request('/api/qms', { path: '/qmsData/sys/dict/type/factory', query: {} })).status, 401);
  assert.equal(f.qmsCalls.length, 0);
  assert.equal((await f.request('/login')).status, 200);
  assert.equal((await f.request('/auth/client.js')).status, 200);
});
test('setup is origin checked, token checked, one-use and records only password hashes', async t => {
  const f = await start(t, false);
  assert.equal((await f.request('/api/auth/setup', f.setupBody, null, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/api/auth/setup', { ...f.setupBody, token: 'wrong' })).status, 403);
  assert.equal((await f.request('/api/auth/setup', { ...f.setupBody, password: 'weak' })).status, 400);
  const res = await f.request('/api/auth/setup', f.setupBody); assert.equal(res.status, 200);
  const cookie = res.headers.get('Set-Cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await f.request('/api/auth/setup', f.setupBody)).status, 409);
  assert.equal((await f.request('/setup')).headers.get('Location'), '/login');
  const row = f.db.sqlite.prepare('SELECT * FROM users').get(); assert.equal(row.role, 'admin'); assert.ok(!row.password_hash.includes(PASSWORD));
  const session = await f.session(res); const raw = session.cookie.split('=')[1];
  const stored = f.db.sqlite.prepare('SELECT * FROM sessions').get(); assert.equal(stored.token_hash, createHash('sha256').update(raw).digest('hex')); assert.notEqual(stored.token_hash, raw);
});
test('parallel initialization cannot create two administrators', async t => {
  const f = await start(t, false);
  const results = await Promise.all([f.request('/api/auth/setup', f.setupBody), f.request('/api/auth/setup', { ...f.setupBody, username: 'another.admin' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
});
test('production sessions use Secure host-only cookies; redirects cannot leave the site', async t => {
  const f = await start(t);
  const res = await (await modules)[1].default.fetch(new Request('https://iqc.example/api/auth/login', { method: 'POST', headers: { Origin: 'https://iqc.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QUALITY.ADMIN', password: PASSWORD }) }), f.env);
  assert.equal(res.status, 200); assert.match(res.headers.get('Set-Cookie'), /^__Host-iqc_session=/); assert.match(res.headers.get('Set-Cookie'), /; Secure$/); assert.ok(!res.headers.get('Set-Cookie').includes('Domain='));
  const redirect = await f.request('/login?next=https://evil.example', undefined, f.admin); assert.equal(redirect.headers.get('Location'), '/');
  assert.match(res.headers.get('Content-Security-Policy'), /connect-src 'self'/); assert.match(res.headers.get('Cache-Control'), /no-store/);
});
test('login errors are generic and attempts are limited', async t => {
  const f = await start(t);
  const first = await f.request('/api/auth/login', { username: 'quality.admin', password: 'wrong' });
  const unknown = await f.request('/api/auth/login', { username: 'unknown.user', password: 'wrong' });
  assert.equal(first.status, 401); assert.deepEqual(await first.json(), await unknown.json());
  for (let i = 1; i < 10; i++) assert.equal((await f.request('/api/auth/login', { username: 'quality.admin', password: 'wrong' })).status, 401);
  const limited = await f.request('/api/auth/login', { username: 'quality.admin', password: PASSWORD }); assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '900');
});
test('CSRF token and same origin are both required; logout revokes server session', async t => {
  const f = await start(t);
  assert.equal((await f.request('/api/auth/logout', {}, f.admin, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await f.request('/api/auth/logout', {}, f.admin, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/api/auth/me', undefined, f.admin)).status, 200);
  const out = await f.request('/api/auth/logout', {}, f.admin); assert.equal(out.status, 200); assert.match(out.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await f.request('/api/auth/me', undefined, f.admin)).status, 401);
});
test('a concurrent reset or disable cannot mint a new session from a stale password verification', async t => {
  for (const mutation of ["UPDATE users SET disabled = 1", "UPDATE users SET password_hash = 'changed-concurrently'"]) {
    const f = await start(t), original = f.db.prepare;
    f.db.prepare = sql => {
      const statement = original(sql);
      if (!sql.startsWith('INSERT INTO auth_audit')) return statement;
      return { ...statement, bind(...args) { const bound = statement.bind(...args); return { ...bound, async run() { const result = await bound.run(); if (args[1] === 'login') f.db.sqlite.exec(mutation); return result; } }; } };
    };
    const response = await f.request('/api/auth/login', { username: 'quality.admin', password: PASSWORD });
    assert.equal(response.status, 401); assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
  }
});
test('idle or absolute expiration rejects and deletes the session', async t => {
  const f = await start(t);
  f.db.sqlite.prepare('UPDATE sessions SET last_seen = ?').run(Math.floor(Date.now() / 1000) - 12 * 3600 - 1);
  assert.equal((await f.request('/api/auth/me', undefined, f.admin)).status, 401);
  const res = await f.request('/api/auth/login', { username: 'quality.admin', password: PASSWORD }); const session = await f.session(res);
  f.db.sqlite.prepare('UPDATE sessions SET expires_at = 0').run();
  assert.equal((await f.request('/api/auth/me', undefined, session)).status, 401); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
});
test('viewer cannot open user management or call administrator APIs', async t => {
  const f = await start(t); const viewer = await createViewer(f);
  for (const path of ['/accounts', '/api/admin/users']) assert.equal((await f.request(path, undefined, viewer.session)).status, 403);
  assert.equal((await f.request('/api/admin/users', { username: 'new.user', password: PASSWORD }, viewer.session)).status, 403);
  assert.equal((await f.request('/api/admin/users', undefined, f.admin)).status, 200);
  assert.equal((await f.request('/api/admin/users', { username: viewer.user.username, password: PASSWORD }, f.admin)).status, 409);
});
test('disabling an account revokes sessions and admin cannot disable self', async t => {
  const f = await start(t); const viewer = await createViewer(f);
  assert.equal((await f.request(`/api/admin/users/${f.admin.user.id}/status`, { disabled: true }, f.admin)).status, 400);
  assert.equal((await f.request(`/api/admin/users/${viewer.user.id}/status`, { disabled: true }, f.admin)).status, 200);
  assert.equal((await f.request('/api/auth/me', undefined, viewer.session)).status, 401);
  assert.equal((await f.request('/api/auth/login', { username: viewer.user.username, password: PASSWORD })).status, 401);
  assert.equal((await f.request(`/api/admin/users/${viewer.user.id}/status`, { disabled: false }, f.admin)).status, 200);
});
test('password reset and self-service password change revoke every old session', async t => {
  const f = await start(t); const viewer = await createViewer(f);
  assert.equal((await f.request(`/api/admin/users/${viewer.user.id}/password`, { password: NEW_PASSWORD }, f.admin)).status, 200);
  assert.equal((await f.request('/api/auth/me', undefined, viewer.session)).status, 401);
  assert.equal((await f.request('/api/auth/login', { username: viewer.user.username, password: PASSWORD })).status, 401);
  const current = await f.session(await f.request('/api/auth/login', { username: viewer.user.username, password: NEW_PASSWORD }));
  assert.equal((await f.request('/api/auth/password', { currentPassword: 'wrong', password: PASSWORD }, current)).status, 400);
  assert.equal((await f.request('/api/auth/password', { currentPassword: NEW_PASSWORD, password: PASSWORD }, current)).status, 200);
  assert.equal((await f.request('/api/auth/me', undefined, current)).status, 401);
  assert.equal((await f.request('/api/auth/login', { username: viewer.user.username, password: PASSWORD })).status, 200);
});
test('QMS gateway forwards only whitelisted queries without browser credentials', async t => {
  const f = await start(t);
  const body = { path: '/qmsSupplierQuality/iqc/documents/selectPage', query: { factoryCode: 'STTH', pageNum: '1' } };
  const res = await f.request('/api/qms', body, f.admin); assert.equal(res.status, 200);
  const forwarded = f.qmsCalls[0]; assert.equal(forwarded.headers.get('Cookie'), null); assert.equal(forwarded.headers.get('X-CSRF-Token'), null); assert.equal(forwarded.headers.get('Authorization'), null); assert.deepEqual(await forwarded.json(), body);
  assert.equal((await f.request('/api/qms', { ...body, path: '/qmsSupplierQuality/delete' }, f.admin)).status, 400);
  assert.equal((await f.request('/api/qms', { ...body, query: { pageNum: 1 } }, f.admin)).status, 400);
  const runtime = await f.request('/assets/runtime-config.js', undefined, f.admin); const js = await runtime.text(); assert.ok(js.includes('"qmsProxyUrl":""')); assert.ok(js.includes(f.admin.csrfToken)); assert.ok(!js.includes(PASSWORD));
});
test('unconfigured database and malformed or oversized JSON fail closed', async t => {
  const f = await start(t); const worker = (await modules)[1].default;
  assert.equal((await worker.fetch(new Request(f.origin + '/'), {})).status, 503);
  for (const body of ['{bad', JSON.stringify({ username: 'a'.repeat(17000) })]) {
    const response = await worker.fetch(new Request(f.origin + '/api/auth/login', { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json' }, body }), f.env); assert.equal(response.status, 400);
  }
  const plain = await worker.fetch(new Request(f.origin + '/api/auth/login', { method: 'POST', headers: { Origin: f.origin }, body: 'username=test' }), f.env); assert.equal(plain.status, 400);
});
test('auth build routes every asset through the Worker and excludes local setup material', () => {
  const { execFileSync } = require('node:child_process');
  const { readFileSync, existsSync } = require('node:fs');
  execFileSync(process.execPath, ['scripts/build-auth.mjs'], { env: { ...process.env, IQC_SETUP_TOKEN_HASH: '' }, stdio: 'pipe' });
  const routes = JSON.parse(readFileSync('dist-auth/_routes.json', 'utf8'));
  assert.deepEqual(routes, { version: 1, include: ['/*'], exclude: [] });
  for (const file of ['.wrangler', 'server', 'tests', 'CNAME', 'first-admin-token.txt']) assert.equal(existsSync('dist-auth/' + file), false, file);
  assert.ok(readFileSync('dist-auth/_worker.js', 'utf8').includes("COMPILED_SETUP_HASH = 'disabled'"));
  assert.match(readFileSync('dist-auth/assets/runtime-config.js', 'utf8'), /authentication:true,qmsProxyUrl:''/);
  for (const page of ['login', 'setup', 'accounts']) assert.ok(existsSync(`dist-auth/auth/${page}/index.html`));
});
