import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function buildStatic(output = 'dist') {
  mkdirSync(`${output}/assets`, { recursive: true });
  // Remove retired generated assets when rebuilding in an existing checkout.
  for (const path of ['assets/theme.js', 'assets/theme.css']) rmSync(`${output}/${path}`, { force: true });
  for (const path of ['index.html', 'echarts.min.js', 'assets/dashboard.js', 'assets/dashboard.css', 'assets/ui-i18n.js', 'assets/wallboard.js', 'assets/settings.css', 'assets/incoming-wallboard.css', 'assets/favicon.svg', 'assets/runtime-config.js', 'assets/account.js']) copyFileSync(path, `${output}/${path}`);
  if (output === 'dist') copyFileSync('CNAME', `${output}/CNAME`);
  console.log(`Site assets built in ${output}/`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildStatic();
