import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../server/worker.mjs';

// Small D1 adapter for real SQLite queries, constraints and atomic batch behavior.
export function database(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const wrap = (sql, params = []) => ({
    sql, params,
    bind(...values) { return wrap(sql, values); },
    async first(column) { const row = sqlite.prepare(sql).get(...params); return row ? (column ? row[column] : { ...row }) : null; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...params).map(row => ({ ...row })) }; },
    async run() { const result = sqlite.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; }
  });
  return {
    prepare: sql => wrap(sql),
    async batch(statements) { sqlite.exec('BEGIN IMMEDIATE'); try { const result = statements.map(statement => ({ success: true, meta: { changes: Number(sqlite.prepare(statement.sql).run(...statement.params).changes) } })); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
    sqlite, close: () => sqlite.close()
  };
}
export const SETUP_TOKEN = 'synthetic-test-setup-token-only';
export function fixture(options = {}) {
  const db = database(options.filename);
  const qmsCalls = [];
  const env = { AUTH_DB: db, LOCAL_DEV: true, SETUP_TOKEN_HASH: createHash('sha256').update(SETUP_TOKEN).digest('hex'),
    ASSETS: { async fetch(request) { const path = new URL(request.url).pathname; try {
      const file = path === '/' ? 'index.html' : /^\/auth\/(login|setup|accounts)\/$/.test(path) ? path.slice(1, -1) + '.html' : path.slice(1);
      const allowed = /^(?:index\.html|echarts\.min\.js|assets\/[a-z0-9-]+\.(?:js|css|svg)|auth\/[a-z-]+\.(?:js|css|html))$/;
      if (!allowed.test(file)) return new Response('Not found', { status: 404 });
      const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
      return new Response(request.method === 'HEAD' ? null : readFileSync(new URL('../' + file, import.meta.url)), { headers: { 'Content-Type': types[file.split('.').pop()] + '; charset=utf-8' } });
    } catch { return new Response('Not found', { status: 404 }); } } },
    QMS_PROXY: { async fetch(request) { qmsCalls.push(request); const body = await request.clone().json(); return Response.json({ status: '200', data: body.path.endsWith('/factory') ? [{ code: 'STTH', name: '本地虚构测试工厂' }] : { resultData: [], total: 0 } }); } }
  };
  const origin = 'http://127.0.0.1:8767';
  const request = (path, body, session, headers = {}) => worker.fetch(new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  const session = async response => ({ cookie: response.headers.get('Set-Cookie')?.split(';')[0], ...(await response.json()) });
  return { env, db, request, session, qmsCalls, origin, close: () => db.close() };
}
