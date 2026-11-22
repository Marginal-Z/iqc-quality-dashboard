import { randomUUID } from 'node:crypto';
import { collectSnapshots, recipientGroups, deliveryId } from './delivery.mjs';
import { filterGroups, jobStatements, runReminderCycle, snapshotDiagnostics } from './scheduler.mjs';
import { readSettings, credentialKey, digest, ReminderError } from './store.mjs';
import { localDate } from '../pending-inspections.mjs';
async function currentUrgent(env, factoryCode, clock) {
  const settings = await readSettings(env);
  if (typeof factoryCode !== 'string' || !settings.factories.includes(factoryCode)) throw new ReminderError('INVALID_FACTORY');
  if (!settings.appSecret || settings.verified_key !== credentialKey(settings.app_id, settings.appSecret)) throw new ReminderError('CONNECTION_NOT_VERIFIED', 503);
  const snapshots = (await collectSnapshots(env, { ...settings, factories: [factoryCode] }, new Date(clock()))).map(snapshot => {
    const groups = filterGroups(snapshot.groups, (_, item) => item.urgent);
    return { ...snapshot, groups, total: groups.reduce((n, group) => n + group.total, 0) };
  });
  const recipients = recipientGroups(settings, snapshots), diagnostics = snapshotDiagnostics(settings, snapshots);
  const fingerprint = digest(JSON.stringify([settings.revision, [...recipients].map(([openId, groups]) => [openId, groups.map(group => [group.factoryCode, group.name, group.items.map(item => item.orderNumber)])]), diagnostics.unmappedInspectors]));
  return { settings, snapshots, recipients, diagnostics, fingerprint };
}
export async function previewUrgent(env, body, actor, { clock = () => Date.now() } = {}) {
  const current = await currentUrgent(env, body.factoryCode, clock), time = Math.floor(clock() / 1000), id = randomUUID();
  await env.REMINDER_DB.prepare('INSERT INTO reminder_urgent_requests(id,actor,factory_code,config_revision,fingerprint,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id, actor, body.factoryCode, current.settings.revision, current.fingerprint, time, time + 300).run();
  return { requestId: id, expiresAt: time + 300, factoryCode: body.factoryCode, total: current.diagnostics.mappedPendingTotal,
    recipients: [...current.recipients.values()].map(groups => ({ names: groups.map(group => group.name), total: groups.reduce((n, group) => n + group.total, 0), orders: groups.flatMap(group => group.items.map(item => item.orderNumber)) })),
    unmappedInspectors: current.diagnostics.unmappedInspectors };
}
async function status(env, id) {
  const jobs = (await env.REMINDER_DB.prepare('SELECT d.status,d.total,d.error_code FROM reminder_deliveries d JOIN reminder_jobs j ON j.id=d.id WHERE j.request_id=?').bind(id).all()).results;
  return { requestId: id, recipients: jobs.length, total: jobs.reduce((n, row) => n + row.total, 0), sent: jobs.filter(row => row.status === 'sent').length,
    queued: jobs.filter(row => ['pending', 'retry', 'sending'].includes(row.status)).length, failed: jobs.filter(row => ['failed', 'uncertain', 'cancelled'].includes(row.status)).length };
}
export async function sendUrgent(env, body, actor, { clock = () => Date.now(), fetchImpl = fetch } = {}) {
  if (!/^[a-f0-9-]{36}$/.test(body.requestId || '')) throw new ReminderError('INVALID_BODY');
  const db = env.REMINDER_DB, request = await db.prepare('SELECT * FROM reminder_urgent_requests WHERE id=? AND actor=?').bind(body.requestId, actor).first();
  if (!request) throw new ReminderError('URGENT_PREVIEW_EXPIRED', 409);
  if (request.status === 'queued') return status(env, request.id);
  const time = Math.floor(clock() / 1000);
  if (request.expires_at <= time) throw new ReminderError('URGENT_PREVIEW_EXPIRED', 409);
  const current = await currentUrgent(env, request.factory_code, clock);
  if (current.fingerprint !== request.fingerprint) throw new ReminderError('URGENT_TASKS_CHANGED', 409);
  if (!current.recipients.size) throw new ReminderError('NO_URGENT_RECIPIENTS');
  const nonce = randomUUID();
  const commands = [db.prepare(`UPDATE reminder_urgent_requests SET status='queued',write_nonce=? WHERE id=? AND actor=? AND status='draft' AND expires_at>?
    AND EXISTS(SELECT 1 FROM reminder_settings WHERE revision=?)
    AND NOT EXISTS(SELECT 1 FROM reminder_urgent_requests WHERE factory_code=? AND status='queued' AND id<>? AND created_at>?)`)
    .bind(nonce, request.id, actor, time, current.settings.revision, request.factory_code, request.id, time - 60)];
  for (const [openId, groups] of current.recipients) commands.push(...jobStatements(env, current.settings, { id: deliveryId('urgent', request.id, openId), openId, groups,
    kind: 'urgent', actor, time, date: localDate(new Date(clock()), 'Asia/Bangkok'), guard: { id: request.id, nonce } }));
  const saved = await db.batch(commands);
  if (!saved[0].meta?.changes) {
    const latest = await db.prepare('SELECT status FROM reminder_urgent_requests WHERE id=?').bind(request.id).first();
    if (latest?.status !== 'queued') throw new ReminderError('URGENT_COOLDOWN', 409);
  }
  await runReminderCycle(env, { clock, fetchImpl, manualOnly: true });
  return status(env, request.id);
}
