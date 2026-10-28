import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { buildStatic } from './build.mjs';
const output = 'dist-auth';
let setupHash = process.env.IQC_SETUP_TOKEN_HASH || '';
if (process.argv.includes('--init')) {
  mkdirSync('.wrangler', { recursive: true });
  const path = '.wrangler/first-admin-token.txt';
  // Reuse the local one-time token across rebuilds until setup is complete.
  const token = existsSync(path) ? readFileSync(path, 'utf8').trim() : randomBytes(32).toString('base64url');
  writeFileSync(path, token + '\n', { mode: 0o600 });
  setupHash = createHash('sha256').update(token).digest('hex');
  console.log('One-time setup token prepared locally. It is excluded from Git and build assets.');
}
if (setupHash && !/^[a-f0-9]{64}$/.test(setupHash)) throw new Error('IQC_SETUP_TOKEN_HASH must be a SHA-256 hex digest');
buildStatic(output);
mkdirSync(`${output}/auth`, { recursive: true });
for (const file of ['auth.css', 'client.js', 'login.js', 'setup.js', 'accounts.js']) copyFileSync(`auth/${file}`, `${output}/auth/${file}`);
for (const page of ['login', 'setup', 'accounts']) {
  mkdirSync(`${output}/auth/${page}`, { recursive: true });
  copyFileSync(`auth/${page}.html`, `${output}/auth/${page}/index.html`);
  rmSync(`${output}/auth/${page}.html`, { force: true });
}
writeFileSync(`${output}/404.html`, '<!doctype html><html lang="zh"><meta charset="utf-8"><title>404 · IQC</title><h1>页面不存在</h1><a href="/">返回看板</a></html>');
writeFileSync(`${output}/_worker.js`, readFileSync('server/worker.mjs', 'utf8').replace('__IQC_SETUP_HASH__', setupHash || 'disabled'));
writeFileSync(`${output}/_routes.json`, JSON.stringify({ version: 1, include: ['/*'], exclude: [] }, null, 2) + '\n');
// A misplaced static upload must not silently use the old public data endpoint.
writeFileSync(`${output}/assets/runtime-config.js`, "window.IQC_RUNTIME={authentication:true,qmsProxyUrl:''};\n");
rmSync(`${output}/CNAME`, { force: true });
console.log('Authenticated Cloudflare Pages build ready in dist-auth/');
