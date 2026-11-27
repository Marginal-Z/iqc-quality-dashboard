import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createPagesClient, currentProduction, PAGES, retainCurrentDeployment, runWrangler } from './pages-retention.mjs';

export async function releasePages({ client = createPagesClient(), run = runWrangler, build, commit, verify } = {}) {
  await build();
  await run(['pages', 'deploy', 'dist-auth', '--project-name', PAGES.project, '--branch', 'main', '--commit-hash', commit, '--commit-dirty', 'false']);
  const deployment = currentProduction(await client.project());
  if (deployment.deployment_trigger?.metadata?.commit_hash !== commit) throw new Error('Production commit differs from the release commit; no old deployments were deleted.');
  return retainCurrentDeployment(client, { expectedId: deployment.id, apply: true, verify,
    onDelete: id => console.log(`Removed old deployment ${id}`) });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--cleanup-only', '--apply'].includes(arg)) || args.includes('--apply') && !args.includes('--cleanup-only')) throw new Error('Usage: node scripts/release-pages.mjs [--cleanup-only [--apply]]');
  if (args.includes('--cleanup-only')) {
    console.log(JSON.stringify(await retainCurrentDeployment(createPagesClient(), { apply: args.includes('--apply'), onDelete: id => console.log(`Removed old deployment ${id}`) }), null, 2));
    return;
  }
  const git = (...options) => execFileSync('git', options, { encoding: 'utf8' }).trim();
  if (git('branch', '--show-current') !== 'main' || git('status', '--porcelain')) throw new Error('Release requires a clean main branch.');
  const commit = git('rev-parse', 'HEAD');
  const checks = JSON.parse(execFileSync('gh', ['run', 'list', '--repo', 'Marginal-Z/iqc-quality-dashboard', '--branch', 'main', '--commit', commit, '--workflow', 'CI', '--limit', '1', '--json', 'headSha,status,conclusion'], { encoding: 'utf8' }));
  if (checks.length !== 1 || checks[0].headSha !== commit || checks[0].status !== 'completed' || checks[0].conclusion !== 'success') throw new Error('Matching main CI has not succeeded; deployment stopped.');
  const result = await releasePages({ commit, build: async () => { execFileSync(process.execPath, ['scripts/build-auth.mjs'], { stdio: 'inherit' }); } });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
