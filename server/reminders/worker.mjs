import { timingSafeEqual } from 'node:crypto';
import { listReminderFactories } from '../pending-inspections.mjs';
import { readSettings, publicSettings, saveSettings, credentialKey, ReminderError } from './store.mjs';
import { createFeishuClient } from './feishu.mjs';
import { readWarehouseSettings, publicWarehouseSettings, saveWarehouseSettings, runWarehouseCycle } from './warehouse.mjs';
import { previewReminders, runReminderCycle } from './delivery.mjs';
import { previewUrgent, sendUrgent } from './urgent.mjs';
function authorized(request, env) {
  const supplied = Buffer.from(request.headers.get('Authorization') || ''), expected = Buffer.from('Bearer ' + (env.REMINDER_GATEWAY_SECRET || ''));
  return Boolean(env.REMINDER_GATEWAY_SECRET?.length >= 32 && supplied.length === expected.length && timingSafeEqual(supplied, expected) && /^[a-f0-9-]{36}$/.test(request.headers.get('X-IQC-Actor') || ''));
}
async function readBody(request) {
  const reader = request.body?.getReader(); if (!reader) throw new ReminderError('INVALID_BODY');
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 16384) { await reader.cancel(); throw new ReminderError('INVALID_BODY'); } chunks.push(value); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body;
  } catch { throw new ReminderError('INVALID_BODY'); } finally { reader.releaseLock(); }
}
export function createReminderWorker({ clock = () => Date.now(), fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env) {
      if (!authorized(request, env)) return new Response('Not found', { status: 404 });
      const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
      try {
        if (!env.REMINDER_DB) throw new ReminderError('DATABASE_NOT_CONFIGURED', 503);
        const path = new URL(request.url).pathname, time = Math.floor(clock() / 1000);
        let data;
        if (path === '/settings' && request.method === 'GET') data = { settings: publicSettings(await readSettings(env)), factories: await listReminderFactories(env) };
        else if (path === '/settings' && request.method === 'POST') data = { settings: await saveSettings(env, await readBody(request), request.headers.get('X-IQC-Actor'), await listReminderFactories(env), time) };
        else if (path === '/connection' && request.method === 'POST') {
          const settings = await readSettings(env); if (!settings.app_id || !settings.appSecret) throw new ReminderError('APP_NOT_CONFIGURED');
          await createFeishuClient(settings.app_id, settings.appSecret, { fetchImpl, now: clock }).verify(true);
          const result = await env.REMINDER_DB.prepare('UPDATE reminder_settings SET verified_key=?,last_error=\'\' WHERE id=1 AND revision=?').bind(credentialKey(settings.app_id, settings.appSecret), settings.revision).run();
          if (!result.meta?.changes) throw new ReminderError('SETTINGS_CHANGED', 409);
          data = { verified: true };
        } else if (path === '/preview' && request.method === 'GET') data = await previewReminders(env, new Date(clock()));
        else if (path === '/urgent/preview' && request.method === 'POST') data = await previewUrgent(env, await readBody(request), request.headers.get('X-IQC-Actor'), { clock });
        else if (path === '/urgent/send' && request.method === 'POST') data = await sendUrgent(env, await readBody(request), request.headers.get('X-IQC-Actor'), { clock, fetchImpl });
        else if(path==='/warehouse'&&request.method==='GET')data={settings:publicWarehouseSettings(await readWarehouseSettings(env)),deliveries:(await env.REMINDER_DB.prepare('SELECT id,total,status,attempts,sent_at,error_code FROM warehouse_deliveries ORDER BY created_at DESC,id LIMIT 30').all()).results};
        else if(path==='/warehouse'&&request.method==='POST')data={settings:await saveWarehouseSettings(env,await readBody(request),time)};
        else if (path === '/history' && request.method === 'GET') data = { deliveries: (await env.REMINDER_DB.prepare('SELECT d.id,d.thai_day,d.inspector_names,d.total,d.urgent,d.overdue,d.status,d.attempts,d.sent_at,d.error_code,j.kind FROM reminder_deliveries d LEFT JOIN reminder_jobs j ON j.id=d.id ORDER BY d.created_at DESC,d.id LIMIT 50').all()).results };
        else return new Response('Not found', { status: 404 });
        return new Response(JSON.stringify(data), { headers });
      } catch (error) { return new Response(JSON.stringify({ error: error.code || 'REMINDER_SERVICE_ERROR' }), { status: error.status || 503, headers }); }
    },
    async scheduled(_controller, env) {
      const warehouse=await readWarehouseSettings(env);
      const result = await runReminderCycle(env, { clock, fetchImpl, deliveryLimit:warehouse.enabled?6:16 });
      const warehouseResult=await runWarehouseCycle(env,{clock,fetchImpl,config:warehouse});
      const { sent, skipped, failed, error, disabled, beforeStart, busy, pendingTotal, mappedPendingTotal } = result;
      console.log('IQC reminder cycle', JSON.stringify({ sent, skipped, failed, error, disabled, beforeStart, busy, pendingTotal, mappedPendingTotal, unmapped: result.unmappedInspectors?.length }));
      console.log('IQC warehouse cycle',JSON.stringify(warehouseResult));
      if (result.error) throw new Error(result.error);
      if(warehouseResult.error)throw new Error(warehouseResult.error);
    }
  };
}
export default createReminderWorker();
