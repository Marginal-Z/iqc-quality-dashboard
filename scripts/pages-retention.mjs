import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PAGES = Object.freeze({ account: '0788b55315084e3ff5707462aa89d051', project: 'iqc-quality-dashboard', origin: 'https://iqc.namecheap.xin' });
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');

export async function runWrangler(args) {
  try {
    return await execute(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 300000,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: PAGES.account, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.wrangler/logs', WRANGLER_LOG_SANITIZE: 'true' }
    });
  } catch {
    // Child errors can contain captured stdout, including authentication tokens.
    throw new Error('Cloudflare CLI failed. Check the local login and retry; no deployments were cleaned by this command.');
  }
}

export function createPagesClient({ credentials, fetchImpl = fetch } = {}) {
  let auth;
  async function request(suffix = '', { method = 'GET', query } = {}) {
    if (!/^\/(?:deployments(?:\/[a-f0-9-]+)?)?$/.test(suffix || '/') || !['GET', 'DELETE'].includes(method)) throw new Error('Pages request outside the approved project scope.');
    if (method === 'DELETE' && !/^\/deployments\/[a-f0-9-]+$/.test(suffix)) throw new Error('Only individual deployments may be deleted.');
    if (!auth) {
      try { auth = credentials || JSON.parse((await runWrangler(['auth', 'token', '--json'])).stdout); }
      catch { throw new Error('Cloudflare authentication unavailable; run the official Wrangler login.'); }
    }
    if (!['oauth', 'api_token'].includes(auth.type) || !auth.token) throw new Error('A Cloudflare OAuth or API token is required.');
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${PAGES.account}/pages/projects/${PAGES.project}${suffix}`);
    if (query) url.search = new URLSearchParams(query).toString();
    let response, data;
    try {
      response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${auth.token}` } });
      data = await response.json();
    } catch { throw new Error('Cloudflare Pages request failed; cleanup stopped.'); }
    if (!response.ok || data?.success !== true) throw new Error(`Cloudflare Pages ${method} ${suffix || '/project'} failed (HTTP ${response.status}); cleanup stopped.`);
    return data;
  }
  return { project: async () => (await request()).result,
    list: async () => {
      const rows = [], ids = new Set();
      for (let page = 1; page <= 1000; page++) {
        const data = await request('/deployments', { query: { page: String(page), per_page: '25' } });
        if (!Array.isArray(data.result)) throw new Error('Malformed Pages deployment inventory.');
        for (const row of data.result) {
          if (!uuid.test(row?.id) || ids.has(row.id)) throw new Error('Invalid or repeated Pages deployment inventory.');
          ids.add(row.id); rows.push(row);
        }
        const totalPages = data.result_info?.total_pages;
        if (totalPages !== undefined) {
          if (!Number.isSafeInteger(totalPages) || totalPages < 0 || page < totalPages && !data.result.length) throw new Error('Incomplete Pages deployment inventory.');
          if (page >= totalPages) return rows;
        } else if (data.result.length < 25) return rows;
      }
      throw new Error('Pages deployment inventory exceeded its page limit.');
    },
    remove: async id => {
      if (!uuid.test(id)) throw new Error('Invalid deployment ID.');
      // force only removes old deployment aliases; it cannot target the project or D1.
      await request(`/deployments/${id}`, { method: 'DELETE', query: { force: 'true' } });
    } };
}

export function currentProduction(project) {
  const deployment = project?.canonical_deployment;
  if (project?.name !== PAGES.project || project.production_branch !== 'main' || !uuid.test(deployment?.id) ||
      deployment.environment !== 'production' || deployment.latest_stage?.status !== 'success' ||
      !Number.isFinite(Date.parse(deployment.created_on)) ||
      deployment.url !== `https://${deployment.id.split('-')[0]}.${PAGES.project}.pages.dev`) throw new Error('A successful current production deployment could not be verified.');
  if (project.latest_deployment?.id !== deployment.id) throw new Error('A different deployment is newer than production; cleanup stopped.');
  return deployment;
}

export async function verifyPagesRelease(deployment, { fetchImpl = fetch, read = readFileSync } = {}) {
  let checks = 0;
  const publicFiles = [['/login', 'auth/login.html'], ['/auth/auth.css', 'auth/auth.css'], ['/auth/errors.js', 'auth/errors.js']];
  for (const origin of [PAGES.origin, deployment.url]) {
    const get = (path, opts = {}) => fetchImpl(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...opts });
    for (const [path, local] of publicFiles) {
      const response = await get(path);
      if (response.status !== 200 || hash(await response.text()) !== hash(read(local))) throw new Error(`Release asset verification failed: ${origin}${path}`);
      checks++;
    }
    for (const path of ['/healthz', '/api/auth/status']) {
      const response = await get(path); const body = await response.json();
      if (response.status !== 200 || body.initialized !== true || path === '/healthz' && body.ready !== true) throw new Error(`Release initialization check failed: ${origin}${path}`);
      checks++;
    }
    for (const path of ['/', '/accounts', '/reminders', '/assets/dashboard.js', '/api/qms', '/api/admin/reminders']) {
      const isPage = ['/', '/accounts', '/reminders'].includes(path);
      const response = await get(path, { headers: { Accept: isPage ? 'text/html' : 'application/json' } });
      if (response.status !== (isPage ? 303 : 401) || isPage && !response.headers.get('location')?.startsWith('/login?next=') ||
          !response.headers.get('cache-control')?.includes('no-store')) throw new Error(`Release authentication check failed: ${origin}${path}`);
      await response.body?.cancel(); checks++;
    }
  }
  return checks;
}

export async function retainCurrentDeployment(client, { expectedId, apply = false, verify = verifyPagesRelease, onDelete = () => {} } = {}) {
  const keep = currentProduction(await client.project());
  if (expectedId && keep.id !== expectedId) throw new Error('Production changed from the expected deployment; cleanup stopped.');
  const inventory = await client.list();
  if (!inventory.some(row => row.id === keep.id)) throw new Error('Current production is absent from the inventory; cleanup stopped.');
  const candidates = inventory.filter(row => row.id !== keep.id);
  for (const row of candidates) {
    if (!uuid.test(row.id) || !Number.isFinite(Date.parse(row.created_on)) || Date.parse(row.created_on) > Date.parse(keep.created_on) ||
        !['success', 'failure', 'canceled'].includes(row.latest_stage?.status)) throw new Error('Newer, active or malformed deployment detected; cleanup stopped.');
  }
  const checks = await verify(keep);
  const assertUnchanged = async () => {
    if (currentProduction(await client.project()).id !== keep.id) throw new Error('Production changed during cleanup; stopped before the next deletion.');
  };
  await assertUnchanged();
  const deleted = [];
  if (apply) {
    for (const row of candidates) {
      await assertUnchanged();
      await client.remove(row.id); deleted.push(row.id); onDelete(row.id);
    }
    await assertUnchanged();
    const remaining = await client.list();
    if (remaining.length !== 1 || remaining[0].id !== keep.id) throw new Error('Cleanup did not converge to the current production deployment; inspect the inventory.');
    await verify(keep);
  }
  return { kept: keep.id, candidates: candidates.map(row => row.id), deleted, checks, applied: apply };
}
