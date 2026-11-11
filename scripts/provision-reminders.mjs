import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cli = resolve('node_modules/wrangler/bin/wrangler.js'), config = 'wrangler.reminders.jsonc';
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.wrangler/logs'), CLOUDFLARE_ACCOUNT_ID: JSON.parse(readFileSync(config, 'utf8')).account_id };
function command(args, input) {
  try { return execFileSync(process.execPath, [cli, ...args], { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { throw new Error('Cloudflare command failed: ' + args.slice(0, 3).join(' ') + '. Check official CLI authentication and retry. Secret values were not logged.'); }
}
const workerKeys = JSON.parse(command(['secret', 'list', '--format', 'json', '--config', config])).map(row => row.name);
const pagesKeys = command(['pages', 'secret', 'list', '--project-name', 'iqc-quality-dashboard']);
const values = {};
if (!workerKeys.includes('REMINDER_ENCRYPTION_KEY')) {
  const result = JSON.parse(command(['d1', 'execute', 'iqc-reminders', '--remote', '--config', config, '--json', '--command', "SELECT (SELECT COUNT(*) FROM reminder_settings WHERE app_secret<>'')+(SELECT COUNT(*) FROM reminder_deliveries WHERE payload<>'') AS encrypted_rows;"]));
  if (Number(result[0]?.results?.[0]?.encrypted_rows) !== 0) throw new Error('Encrypted reminder data exists without an encryption key. Restore the original key; initialization stopped.');
  values.REMINDER_ENCRYPTION_KEY = randomBytes(32).toString('base64');
}
// Repair a missing half of the gateway pair together; never rotate a present
// encryption key or overwrite any QMS/account credentials.
const needsGateway = !workerKeys.includes('REMINDER_GATEWAY_SECRET') || !pagesKeys.includes('REMINDER_GATEWAY_SECRET');
if (needsGateway) values.REMINDER_GATEWAY_SECRET = randomBytes(32).toString('base64url');
if (Object.keys(values).length) command(['secret', 'bulk', '--config', config], JSON.stringify(values));
if (needsGateway) command(['pages', 'secret', 'put', 'REMINDER_GATEWAY_SECRET', '--project-name', 'iqc-quality-dashboard'], values.REMINDER_GATEWAY_SECRET + '\n');
console.log(Object.keys(values).length ? 'Reminder service keys configured securely. Deploy the authenticated Pages build next.' : 'Reminder service keys already exist; no values changed.');
