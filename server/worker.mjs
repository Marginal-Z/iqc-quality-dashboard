import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

const COMPILED_SETUP_HASH = '__IQC_SETUP_HASH__';
const SESSION_AGE = 7 * 24 * 60 * 60;
const IDLE_AGE = 12 * 60 * 60;
const HASH_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const DUMMY_HASH = `scrypt$32768$8$3$${'00'.repeat(16)}$${'00'.repeat(32)}`;
const QMS_PATHS = new Set(['/qmsData/sys/dict/type/factory', '/qmsSupplierQuality/iqc/documents/selectPage']);
const PUBLIC_ASSETS = new Set(['/auth/auth.css', '/auth/client.js', '/auth/login.js', '/auth/setup.js', '/assets/favicon.svg']);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const now = () => Math.floor(Date.now() / 1000);
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const changes = result => Number(result?.meta?.changes || 0);
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const error = (status, code, message) => json({ error: code, message }, status);
const redirect = path => new Response(null, { status: 303, headers: { Location: path } });
const publicUser = row => ({ id: row.id || row.user_id, username: row.username, displayName: row.display_name, role: row.role });
const local = (request, env) => env.LOCAL_DEV === true && new URL(request.url).protocol === 'http:' && ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
const cookieName = (request, env) => local(request, env) ? 'iqc_dev_session' : '__Host-iqc_session';
const cookie = (request, env, value, age = SESSION_AGE) => `${cookieName(request, env)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${local(request, env) ? '' : '; Secure'}`;

function equal(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}
function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Vary', 'Cookie');
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function safeNext(value) {
  return typeof value === 'string' && /^(?:\/|\/index\.html|\/accounts)(?:#[a-z]+)?$/.test(value) ? value : '/';
}
function usernameOf(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._@-]{2,63}$/.test(username) ? username : null;
}
function validPassword(value, creating = true) {
  return typeof value === 'string' && [...value].length >= (creating ? 15 : 1) && [...value].length <= 128 && Buffer.byteLength(value) <= 512;
}
async function derive(password, salt) {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, HASH_OPTIONS, (err, result) => err ? reject(err) : resolve(result)));
}
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Password must contain 15 to 128 characters');
  const salt = randomBytes(16);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded || '');
  if (!match || !validPassword(password, false)) return false;
  const key = await derive(password, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}
async function readJson(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('CONTENT_TYPE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('BODY');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); throw new Error('BODY_SIZE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('BODY');
    return data;
  } finally { reader.releaseLock(); }
}
function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}
async function initialized(db) {
  const state = await db.prepare('SELECT initialized FROM auth_state WHERE id = 1').first();
  return Boolean(state?.initialized || (await db.prepare('SELECT COUNT(*) AS count FROM users').first())?.count);
}
async function audit(db, actor, action, target) {
  await db.prepare('INSERT INTO auth_audit (actor_id, action, target_id, created_at) VALUES (?, ?, ?, ?)').bind(actor, action, target, now()).run();
}
async function rateLimit(db, key, limit) {
  const time = now();
  const row = await db.prepare(`INSERT INTO throttle (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(key, time + 900, time, time).first();
  return Number(row.count) <= limit;
}
async function authThrottle(request, env, username, prefix = 'login') {
  const ip = request.headers.get('CF-Connecting-IP') || (local(request, env) ? 'local' : 'unknown');
  const allowedIp = await rateLimit(env.AUTH_DB, `${prefix}:ip:${digest(ip)}`, 30);
  if (!allowedIp) return false;
  return rateLimit(env.AUTH_DB, `${prefix}:user:${digest(username)}`, 10);
}
async function sessionFor(request, env) {
  const name = cookieName(request, env);
  const value = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1);
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const hash = digest(value);
  const row = await env.AUTH_DB.prepare(`SELECT s.*, u.username, u.display_name, u.role, u.disabled
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(hash).first();
  if (!row) return null;
  const time = now();
  if (row.disabled || row.expires_at <= time || row.last_seen + IDLE_AGE <= time) {
    await env.AUTH_DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    return null;
  }
  if (row.last_seen + 60 <= time) await env.AUTH_DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(time, hash).run();
  return row;
}
async function newSession(request, env, user) {
  const value = token(), csrfToken = token(), time = now();
  const result = await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(time),
    env.AUTH_DB.prepare('DELETE FROM throttle WHERE expires_at <= ?').bind(time),
    env.AUTH_DB.prepare('DELETE FROM auth_audit WHERE created_at < ?').bind(time - 90 * 86400),
    // Recheck the verified hash and enabled state at insertion, so a concurrent
    // reset/disable cannot create a fresh session after its revocation batch.
    env.AUTH_DB.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen, expires_at)
      SELECT ?, id, ?, ?, ?, ? FROM users WHERE id = ? AND disabled = 0 AND (? IS NULL OR password_hash = ?)`)
      .bind(digest(value), csrfToken, time, time, time + SESSION_AGE, user.id, user.password_hash || null, user.password_hash || null)
  ]);
  if (!changes(result[3])) return error(401, 'INVALID_CREDENTIALS', '账号或密码错误，或账号不可用');
  return json({ user: publicUser(user), csrfToken }, 200, { 'Set-Cookie': cookie(request, env, value) });
}
async function login(request, env, body) {
  const username = usernameOf(body.username);
  if (!username || !validPassword(body.password, false)) return error(401, 'INVALID_CREDENTIALS', '账号或密码错误，或账号不可用');
  if (!(await authThrottle(request, env, username))) return json({ error: 'RATE_LIMITED', message: '尝试次数过多，请 15 分钟后再试' }, 429, { 'Retry-After': '900' });
  const user = await env.AUTH_DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  const valid = await verifyPassword(body.password, user?.password_hash || DUMMY_HASH);
  if (!user || !valid || user.disabled) return error(401, 'INVALID_CREDENTIALS', '账号或密码错误，或账号不可用');
  await env.AUTH_DB.prepare('DELETE FROM throttle WHERE key = ?').bind(`login:user:${digest(username)}`).run();
  await audit(env.AUTH_DB, user.id, 'login', user.id);
  return newSession(request, env, user);
}
async function setup(request, env, body) {
  const configuredHash = env.SETUP_TOKEN_HASH || COMPILED_SETUP_HASH;
  if (!/^[a-f0-9]{64}$/.test(configuredHash)) return error(503, 'SETUP_DISABLED', '初始化尚未配置，请联系维护人员');
  if (!(await authThrottle(request, env, 'setup', 'setup'))) return error(429, 'RATE_LIMITED', '尝试次数过多，请稍后再试');
  if (typeof body.token !== 'string' || !equal(digest(body.token), configuredHash)) return error(403, 'INVALID_SETUP_TOKEN', '初始化凭据无效');
  if (await initialized(env.AUTH_DB)) return error(409, 'ALREADY_INITIALIZED', '管理员已经建立，请登录');
  const username = usernameOf(body.username);
  if (!username || !validPassword(body.password)) return error(400, 'INVALID_ACCOUNT', '账号需为 3–64 位字母、数字或 . _ @ -；密码需为 15–128 个字符');
  const owner = token(), time = now();
  const lock = await env.AUTH_DB.prepare(`INSERT INTO bootstrap_lock (id, owner, expires_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE expires_at < ? RETURNING owner`).bind(owner, time + 300, time).first();
  if (!lock || lock.owner !== owner) return error(409, 'SETUP_BUSY', '初始化正在进行，请稍后再试');
  try {
    if (await initialized(env.AUTH_DB)) return error(409, 'ALREADY_INITIALIZED', '管理员已经建立，请登录');
    const id = randomUUID(), passwordHash = await hashPassword(body.password);
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare('INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(id, username, String(body.displayName || username).trim().slice(0, 80), passwordHash, 'admin', time),
      env.AUTH_DB.prepare('UPDATE auth_state SET initialized = 1 WHERE id = 1'),
      env.AUTH_DB.prepare('INSERT INTO auth_audit (actor_id, action, target_id, created_at) VALUES (?, ?, ?, ?)').bind(id, 'initialize', id, time)
    ]);
    return newSession(request, env, { id, username, display_name: String(body.displayName || username).trim().slice(0, 80), role: 'admin' });
  } finally { await env.AUTH_DB.prepare('DELETE FROM bootstrap_lock WHERE owner = ?').bind(owner).run(); }
}
async function changePassword(request, env, session, body) {
  if (!validPassword(body.password)) return error(400, 'INVALID_PASSWORD', '新密码需为 15–128 个字符');
  if (!(await authThrottle(request, env, session.user_id, 'password'))) return error(429, 'RATE_LIMITED', '尝试次数过多，请稍后再试');
  const user = await env.AUTH_DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(session.user_id).first();
  if (!(await verifyPassword(body.currentPassword, user?.password_hash))) return error(400, 'INVALID_PASSWORD', '当前密码错误');
  const hash = await hashPassword(body.password);
  const result = await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?').bind(hash, session.user_id, user.password_hash),
    env.AUTH_DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(session.user_id)
  ]);
  if (!changes(result[0])) return error(409, 'CONFLICT', '账号信息已变化，请重新登录');
  await audit(env.AUTH_DB, session.user_id, 'change_password', session.user_id);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, env, '', 0) });
}
async function manageUsers(request, env, session, body, path) {
  if (session.role !== 'admin') return error(403, 'FORBIDDEN', '需要管理员权限');
  if (request.method === 'GET' && path === '/api/admin/users') {
    const rows = await env.AUTH_DB.prepare('SELECT id, username, display_name, role, disabled, created_at FROM users ORDER BY created_at, username LIMIT 500').all();
    return json({ users: rows.results.map(row => ({ ...publicUser(row), disabled: Boolean(row.disabled), createdAt: row.created_at })) });
  }
  if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', '不支持此操作');
  if (path === '/api/admin/users') {
    const username = usernameOf(body.username), role = body.role === 'admin' ? 'admin' : 'viewer';
    if (!username || !validPassword(body.password)) return error(400, 'INVALID_ACCOUNT', '账号格式无效，或密码不足 15 个字符');
    if (!(await authThrottle(request, env, session.user_id, 'create'))) return error(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试');
    if (await env.AUTH_DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()) return error(409, 'USERNAME_EXISTS', '账号已存在');
    const id = randomUUID(), hash = await hashPassword(body.password), displayName = String(body.displayName || username).trim().slice(0, 80);
    await env.AUTH_DB.prepare('INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(id, username, displayName, hash, role, now()).run();
    await audit(env.AUTH_DB, session.user_id, 'create_user', id);
    return json({ user: { id, username, displayName, role } }, 201);
  }
  const match = /^\/api\/admin\/users\/([a-f0-9-]{36})\/(status|password)$/.exec(path);
  if (!match) return error(404, 'NOT_FOUND', '未找到此操作');
  const id = match[1], user = await env.AUTH_DB.prepare('SELECT id, role, disabled FROM users WHERE id = ?').bind(id).first();
  if (!user) return error(404, 'NOT_FOUND', '账号不存在');
  if (match[2] === 'status') {
    if (typeof body.disabled !== 'boolean') return error(400, 'INVALID_STATUS', '账号状态无效');
    if (id === session.user_id && body.disabled) return error(400, 'SELF_DISABLE', '不能停用当前登录的管理员');
    const result = await env.AUTH_DB.prepare(`UPDATE users SET disabled = ? WHERE id = ? AND
      (? = 0 OR role != 'admin' OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0) > 1)`).bind(Number(body.disabled), id, Number(body.disabled)).run();
    if (!changes(result)) return error(409, 'LAST_ADMIN', '必须保留至少一位可用管理员');
    if (body.disabled) await env.AUTH_DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    await audit(env.AUTH_DB, session.user_id, body.disabled ? 'disable_user' : 'enable_user', id);
    return json({ ok: true });
  }
  if (!validPassword(body.password)) return error(400, 'INVALID_PASSWORD', '新密码需为 15–128 个字符');
  if (!(await authThrottle(request, env, session.user_id, 'reset'))) return error(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试');
  const hash = await hashPassword(body.password);
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, id),
    env.AUTH_DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)
  ]);
  await audit(env.AUTH_DB, session.user_id, 'reset_password', id);
  return json({ ok: true }, 200, id === session.user_id ? { 'Set-Cookie': cookie(request, env, '', 0) } : {});
}
async function proxyQms(request, env, body) {
  if (!env.QMS_PROXY?.fetch) return error(503, 'PROXY_UNAVAILABLE', '数据服务暂不可用');
  if (!QMS_PATHS.has(body.path) || !body.query || typeof body.query !== 'object' || Array.isArray(body.query)) return error(400, 'INVALID_QUERY', '查询格式无效');
  const entries = Object.entries(body.query);
  if (entries.length > 40 || entries.some(([key, value]) => key.length > 128 || typeof value !== 'string' || value.length > 512)) return error(400, 'INVALID_QUERY', '查询条件过长或格式无效');
  const upstream = await env.QMS_PROXY.fetch(new Request('https://iqc-proxy.internal/api/qms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://iqc.namecheap.xin' },
    body: JSON.stringify({ path: body.path, query: body.query }), signal: AbortSignal.timeout(30000)
  }));
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8' } });
}
async function serveAsset(request, env, path) {
  return env.ASSETS.fetch(new Request(new URL(path, request.url), { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }));
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!env.AUTH_DB) return error(503, 'AUTH_UNAVAILABLE', '登录服务尚未配置');
  if (path === '/healthz') return json({ ready: true, initialized: await initialized(env.AUTH_DB) });
  if (PUBLIC_ASSETS.has(path) && ['GET', 'HEAD'].includes(request.method)) return serveAsset(request, env, path);
  if (path === '/api/auth/status' && request.method === 'GET') return json({ initialized: await initialized(env.AUTH_DB) });
  if (['/api/auth/login', '/api/auth/setup'].includes(path)) {
    if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', '请使用 POST');
    if (!sameOrigin(request)) return error(403, 'ORIGIN_REJECTED', '请求来源无效');
    let body; try { body = await readJson(request); } catch { return error(400, 'INVALID_BODY', '请求格式无效'); }
    return path.endsWith('/login') ? login(request, env, body) : setup(request, env, body);
  }
  const session = await sessionFor(request, env);
  if (path === '/login' && ['GET', 'HEAD'].includes(request.method)) return session ? redirect(safeNext(url.searchParams.get('next'))) : serveAsset(request, env, '/auth/login/');
  if (path === '/setup' && ['GET', 'HEAD'].includes(request.method)) return await initialized(env.AUTH_DB) ? redirect('/login') : serveAsset(request, env, '/auth/setup/');
  if (!session) {
    if (path.startsWith('/api/')) return json({ error: 'UNAUTHENTICATED', message: '登录已失效，请重新登录' }, 401, { 'Set-Cookie': cookie(request, env, '', 0) });
    if ((request.headers.get('Accept') || '').includes('text/html') || ['/', '/index.html', '/accounts'].includes(path)) return redirect('/login?next=' + encodeURIComponent(safeNext(path)));
    return error(401, 'UNAUTHENTICATED', '请先登录');
  }
  if (path === '/api/auth/me' && request.method === 'GET') return json({ user: publicUser(session), csrfToken: session.csrf_token });
  if (path === '/assets/runtime-config.js' && ['GET', 'HEAD'].includes(request.method)) return new Response(`window.IQC_RUNTIME=${JSON.stringify({ authentication: true, qmsProxyUrl: '', user: publicUser(session), csrfToken: session.csrf_token })};`, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
  if (path.startsWith('/api/')) {
    if (request.method !== 'GET') {
      if (!sameOrigin(request) || !equal(request.headers.get('X-CSRF-Token'), session.csrf_token)) return error(403, 'CSRF_REJECTED', '请求验证失败，请刷新页面后重试');
      if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', '不支持此操作');
    }
    let body = {};
    if (request.method === 'POST') { try { body = await readJson(request); } catch { return error(400, 'INVALID_BODY', '请求格式无效'); } }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      await env.AUTH_DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.token_hash).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, env, '', 0) });
    }
    if (path === '/api/auth/password' && request.method === 'POST') return changePassword(request, env, session, body);
    if (path.startsWith('/api/admin/')) return manageUsers(request, env, session, body, path);
    if (path === '/api/qms' && request.method === 'POST') return proxyQms(request, env, body);
    return error(404, 'NOT_FOUND', '未找到此接口');
  }
  if (!['GET', 'HEAD'].includes(request.method)) return error(405, 'METHOD_NOT_ALLOWED', '不支持此操作');
  if (path === '/accounts') return session.role === 'admin' ? serveAsset(request, env, '/auth/accounts/') : error(403, 'FORBIDDEN', '需要管理员权限');
  if (path.startsWith('/auth/') && !['/auth/accounts.js'].includes(path)) return error(404, 'NOT_FOUND', '未找到此页面');
  return serveAsset(request, env, path);
}
export default {
  async fetch(request, env) {
    try { return secureResponse(await route(request, env)); }
    catch (err) {
      console.error('IQC authentication request failed', { path: new URL(request.url).pathname, name: err?.name || 'Error' });
      return secureResponse(error(503, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试'));
    }
  }
};
