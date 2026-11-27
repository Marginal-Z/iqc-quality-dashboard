const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../scripts/pages-retention.mjs');
const id = n => `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`;
const deployment = (n, extra = {}) => ({ id: id(n), environment: 'production', created_on: `2026-11-${String(n + 1).padStart(2, '0')}T00:00:00Z`,
  latest_stage: { status: 'success' }, url: `https://${String(n).padStart(8, '0')}.iqc-quality-dashboard.pages.dev`, deployment_trigger: { metadata: { commit_hash: 'release-sha' } }, ...extra });
function fixture() {
  let rows = [deployment(3), deployment(2), deployment(1)]; const deleted = [], verified = [];
  const project = { name: 'iqc-quality-dashboard', production_branch: 'main', canonical_deployment: rows[0], latest_deployment: rows[0] };
  return { project, deleted, verified, get rows() { return rows; },
    client: { project: async () => project, list: async () => rows, remove: async id => { deleted.push(id); rows = rows.filter(row => row.id !== id); } },
    verify: async row => { verified.push(row.id); return 22; } };
}

test('cleanup defaults to a health-verified dry run and applies only to older deployments', async () => {
  const { retainCurrentDeployment } = await load(); const f = fixture();
  const plan = await retainCurrentDeployment(f.client, { verify: f.verify });
  assert.equal(plan.kept, id(3)); assert.equal(plan.applied, false); assert.equal(plan.candidates.length, 2); assert.deepEqual(f.deleted, []);
  const applied = await retainCurrentDeployment(f.client, { verify: f.verify, apply: true });
  assert.deepEqual(applied.deleted, [id(2), id(1)]); assert.deepEqual(f.rows.map(row => row.id), [id(3)]);
  assert.equal(f.verified.length, 3);
});

test('a failed release health check never removes the previous deployments', async () => {
  const { retainCurrentDeployment } = await load(); const f = fixture();
  await assert.rejects(retainCurrentDeployment(f.client, { apply: true, verify: async () => { throw new Error('health failed'); } }), /health failed/);
  assert.deepEqual(f.deleted, []);
});

test('cleanup refuses preview, failed, renamed, newer or active deployments and mismatched expected production', async () => {
  const { retainCurrentDeployment } = await load();
  for (const mutate of [
    f => { f.project.name = 'another-project'; },
    f => { f.project.canonical_deployment.environment = 'preview'; },
    f => { f.project.canonical_deployment.latest_stage.status = 'failure'; },
    f => { f.project.latest_deployment = deployment(4); },
    f => { f.rows[1].created_on = '2026-11-30T00:00:00Z'; },
    f => { f.rows[1].latest_stage.status = 'active'; },
    f => { f.rows[1].created_on = 'invalid'; }
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(retainCurrentDeployment(f.client, { apply: true, verify: f.verify }));
    assert.deepEqual(f.deleted, []); assert.deepEqual(f.verified, []);
  }
  const f = fixture();
  await assert.rejects(retainCurrentDeployment(f.client, { apply: true, expectedId: id(2), verify: f.verify }), /expected deployment/);
  assert.deepEqual(f.deleted, []);
});

test('another release appearing mid-cleanup stops before the next deletion', async () => {
  const { retainCurrentDeployment } = await load(); const f = fixture(); let reads = 0;
  f.client.project = async () => {
    if (++reads === 4) { f.project.canonical_deployment = deployment(4); f.project.latest_deployment = f.project.canonical_deployment; }
    return f.project;
  };
  await assert.rejects(retainCurrentDeployment(f.client, { apply: true, verify: f.verify }), /Production changed/);
  assert.deepEqual(f.deleted, [id(2)]);
});

test('an inventory that still contains deleted deployments cannot be reported as successful cleanup', async () => {
  const { retainCurrentDeployment } = await load(); const f = fixture(); f.client.remove = async id => f.deleted.push(id);
  await assert.rejects(retainCurrentDeployment(f.client, { apply: true, verify: f.verify }), /did not converge/);
});

test('Pages inventory follows every page and rejects a repeated or missing page', async () => {
  const { createPagesClient } = await load(); const calls = [];
  const client = createPagesClient({ credentials: { type: 'api_token', token: 'test-only' }, fetchImpl: async (url, opts) => {
    assert.equal(url.searchParams.get('per_page'), '25');
    calls.push({ url, opts }); const page = Number(url.searchParams.get('page'));
    return Response.json({ success: true, result: [deployment(page)], result_info: { total_pages: 2 } });
  } });
  assert.equal((await client.list()).length, 2); assert.equal(calls.length, 2);
  assert.ok(calls.every(({ url, opts }) => url.origin === 'https://api.cloudflare.com' && !url.href.includes('test-only') && opts.redirect === 'error' && opts.headers.Authorization === 'Bearer test-only'));
  for (const second of [[deployment(1)], []]) {
    let count = 0;
    const malformed = createPagesClient({ credentials: { type: 'oauth', token: 'test-only' }, fetchImpl: async () => Response.json({ success: true, result: ++count === 1 ? [deployment(1)] : second, result_info: { total_pages: 3 } }) });
    await assert.rejects(malformed.list(), /inventory/);
  }
  let pages = 0;
  const withoutTotals = createPagesClient({ credentials: { type: 'oauth', token: 'test-only' }, fetchImpl: async () => Response.json({ success: true,
    result: ++pages === 1 ? Array.from({ length: 25 }, (_, index) => deployment(index + 1)) : [deployment(26)] }) });
  assert.equal((await withoutTotals.list()).length, 26); assert.equal(pages, 2);
});

test('Pages API can delete only a deployment in the fixed project and sanitizes upstream failures', async () => {
  const { createPagesClient, PAGES } = await load(); const calls = [];
  const client = createPagesClient({ credentials: { type: 'oauth', token: 'test-only' }, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return Response.json({ success: true, result: null }); } });
  await assert.rejects(client.remove('../other-project'), /Invalid deployment/); assert.equal(calls.length, 0);
  await client.remove(id(2));
  assert.equal(calls[0].url.pathname, `/client/v4/accounts/${PAGES.account}/pages/projects/${PAGES.project}/deployments/${id(2)}`);
  assert.equal(calls[0].opts.method, 'DELETE'); assert.equal(calls[0].url.search, '?force=true');
  const failed = createPagesClient({ credentials: { type: 'oauth', token: 'test-only' }, fetchImpl: async () => Response.json({ success: false, errors: [{ message: 'upstream-private-value' }] }, { status: 403 }) });
  await assert.rejects(failed.project(), error => /HTTP 403/.test(error.message) && !/upstream-private-value|test-only/.test(error.message));
});

test('release verification checks both domains, initialization, public bytes and private routes', async () => {
  const { verifyPagesRelease } = await load(); const publicPaths = new Set(['/login', '/auth/auth.css', '/auth/errors.js']);
  const fetchImpl = async url => {
    const path = new URL(url).pathname;
    if (publicPaths.has(path)) return new Response('release fixture');
    if (['/healthz', '/api/auth/status'].includes(path)) return Response.json({ initialized: true, ready: true });
    const isPage = ['/', '/accounts', '/reminders'].includes(path);
    return new Response('', { status: isPage ? 303 : 401, headers: { 'Cache-Control': 'no-store', Location: '/login?next=%2F' } });
  };
  assert.equal(await verifyPagesRelease(deployment(3), { fetchImpl, read: () => Buffer.from('release fixture') }), 22);
  await assert.rejects(verifyPagesRelease(deployment(3), { fetchImpl, read: () => Buffer.from('wrong release') }), /asset verification failed/);
  await assert.rejects(verifyPagesRelease(deployment(3), { read: () => 'release fixture', fetchImpl: async url => new URL(url).pathname === '/assets/dashboard.js' ? new Response('leaked source') : fetchImpl(url) }), /authentication check failed/);
});

test('release deploys and verifies the exact commit before cleanup; build, upload and commit failures retain old versions', async () => {
  const { releasePages } = await import('../scripts/release-pages.mjs');
  for (const failure of ['build', 'upload', 'commit', 'health']) {
    const f = fixture();
    await assert.rejects(releasePages({ client: f.client, commit: failure === 'commit' ? 'different' : 'release-sha',
      build: async () => { if (failure === 'build') throw new Error('build'); },
      run: async () => { if (failure === 'upload') throw new Error('upload'); },
      verify: failure === 'health' ? async () => { throw new Error('health'); } : f.verify }));
    assert.deepEqual(f.deleted, []);
  }
  const f = fixture(); const steps = [];
  await releasePages({ client: f.client, commit: 'release-sha', build: async () => steps.push('build'), run: async args => { steps.push('deploy'); assert.ok(args.includes('release-sha')); }, verify: async () => { steps.push('verify'); return 22; } });
  assert.deepEqual(steps, ['build', 'deploy', 'verify', 'verify']); assert.deepEqual(f.deleted, [id(2), id(1)]);
});
