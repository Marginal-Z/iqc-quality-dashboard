import { createServer } from 'node:http';
import worker from '../server/worker.mjs';
import { fixture, SETUP_TOKEN } from '../tests/auth-fixture.mjs';
const f = fixture();
const port = Number(process.argv[2] || 8767);
// Test-only server: synthetic empty QMS responses, in-memory accounts, never production credentials.
createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await worker.fetch(request, f.env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Preview error'); }
}).listen(port, '127.0.0.1', () => console.log(`Synthetic auth preview: http://127.0.0.1:${port}/setup#token=${SETUP_TOKEN}\nAccounts reset when this server stops. QMS is not contacted.`));
