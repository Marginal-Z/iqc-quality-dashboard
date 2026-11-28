import { randomUUID } from 'node:crypto';
import { localDate } from '../pending-inspections.mjs';
import { collectSnapshots, recipientGroups } from './delivery.mjs';
import { readSettings, credentialKey, digest, encrypt, decrypt, ReminderError } from './store.mjs';
import { createFeishuClient } from './feishu.mjs';
import { reminderMessage, encodeDeliveryMessage, decodeDeliveryMessage } from './message.mjs';
const seconds = clock => Math.floor(clock() / 1000);
export const taskKey = (appId, openId, group, item) => digest(JSON.stringify([appId, openId, group.factoryCode, item.orderNumber]));
export function filterGroups(groups, predicate) {
  return groups.map(group => {
    const items = group.items.filter(item => predicate(group, item));
    return { ...group, items, total: items.length, urgent: items.filter(item => item.urgent).length, overdue: items.filter(item => item.overdue).length };
  }).filter(group => group.total);
}
export function snapshotDiagnostics(settings, snapshots) {
  const inspectors = snapshots.flatMap(snapshot => snapshot.groups.map(group => ({ factoryCode: snapshot.factoryCode, name: group.name, total: group.total,
    mapped: settings.recipients.some(row => row.factory_code === snapshot.factoryCode && row.inspector_name === group.name) })));
  return { pendingTotal: inspectors.reduce((n, row) => n + row.total, 0), mappedPendingTotal: inspectors.filter(row => row.mapped).reduce((n, row) => n + row.total, 0), unmappedInspectors: inspectors.filter(row => !row.mapped) };
}
export function jobStatements(env, settings, { id = randomUUID(), openId, groups, date, time, kind = 'new_tasks', actor = '', guard } = {}) {
  const summary = reminderMessage(groups, date, { kind }), payload = encrypt(env, encodeDeliveryMessage(summary.message));
  const condition = guard ? 'EXISTS(SELECT 1 FROM reminder_urgent_requests WHERE id=? AND write_nonce=?)' : 'EXISTS(SELECT 1 FROM reminder_settings WHERE id=1 AND enabled=1 AND revision=?)';
  const values = guard ? [guard.id, guard.nonce] : [settings.revision];
  const keys = groups.flatMap(group => group.items.map(item => taskKey(settings.app_id, openId, group, item)));
  const scope = JSON.stringify({ groups: groups.map(group => [group.factoryCode, group.name]), keys });
  const statements = [env.REMINDER_DB.prepare(`INSERT INTO reminder_deliveries(id,thai_day,app_id,open_id,inspector_names,total,urgent,overdue,payload,created_at,send_uuid,config_revision)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${condition} ON CONFLICT(id) DO NOTHING`)
    .bind(id, date, settings.app_id, openId, JSON.stringify(groups.map(group => group.factoryCode + ' · ' + group.name)), summary.total, summary.urgent, summary.overdue, payload, time, id, settings.revision, ...values),
    env.REMINDER_DB.prepare('INSERT OR IGNORE INTO reminder_jobs(id,kind,actor,request_id,scope) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM reminder_deliveries WHERE id=?)').bind(id, kind, actor, guard?.id || '', scope, id)];
  if (kind === 'new_tasks') statements.push(env.REMINDER_DB.prepare('INSERT OR IGNORE INTO reminder_task_receipts(task_key,job_id,last_seen_at) SELECT value,?,? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM reminder_deliveries WHERE id=?)').bind(id, time, JSON.stringify(keys), id));
  return statements;
}
export async function runReminderCycle(env, { clock = () => Date.now(), fetchImpl = fetch, manualOnly = false, deliveryLimit = 16 } = {}) {
  const result = { sent: 0, skipped: 0, failed: 0 }, db = env.REMINDER_DB;
  if (!db) return { ...result, error: 'DATABASE_NOT_CONFIGURED' };
  let owner;
  try {
    const settings = await readSettings(env), time = seconds(clock), instant = new Date(clock()), date = localDate(instant, 'Asia/Bangkok');
    owner = randomUUID();
    const lease = await db.prepare('UPDATE reminder_runtime SET lease_owner=?,lease_until=? WHERE id=1 AND lease_until<=? RETURNING id').bind(owner, time + 180, time).first();
    if (!lease) { owner = ''; return { ...result, busy: true }; }
    await db.batch([
      db.prepare('DELETE FROM reminder_deliveries WHERE created_at<?').bind(time - 90 * 86400),
      db.prepare('DELETE FROM reminder_jobs WHERE id NOT IN (SELECT id FROM reminder_deliveries)'),
      db.prepare('DELETE FROM reminder_task_receipts WHERE last_seen_at<?').bind(time - 90 * 86400),
      db.prepare('DELETE FROM reminder_urgent_requests WHERE expires_at<?').bind(time - 86400),
      db.prepare("UPDATE reminder_deliveries SET status=CASE WHEN uncertain=1 THEN 'uncertain' ELSE 'failed' END,payload='',error_code='RETRY_WINDOW_ENDED' WHERE status IN ('sending','retry') AND lease_until<=? AND (attempts>=6 OR first_attempt_at<?)").bind(time, time - 3300),
      db.prepare("UPDATE reminder_deliveries SET status=CASE WHEN uncertain=1 THEN 'uncertain' ELSE 'cancelled' END,payload='',error_code='SETTINGS_CHANGED' WHERE config_revision<>? AND status IN ('pending','retry','sending') AND lease_until<=?").bind(settings.revision, time),
      db.prepare("DELETE FROM reminder_task_receipts WHERE job_id IN(SELECT id FROM reminder_deliveries WHERE status='cancelled' OR (status='failed' AND uncertain=0 AND config_revision<?))").bind(settings.revision)
    ]);
    const queued = await db.prepare("SELECT COUNT(*) n FROM reminder_deliveries WHERE status IN ('pending','retry','sending')").first('n');
    const minute = new Date(instant.getTime() + 7 * 3600000).toISOString().slice(11, 16), auto = settings.enabled && minute >= settings.daily_start && !manualOnly;
    if (!auto && !queued) {
      await db.prepare("UPDATE reminder_settings SET last_checked_at=?,last_error='' WHERE id=1").bind(time).run();
      return { ...result, ...(!settings.enabled ? { disabled: true } : { beforeStart: true }) };
    }
    if (!settings.appSecret || settings.verified_key !== credentialKey(settings.app_id, settings.appSecret)) throw new ReminderError('CONNECTION_NOT_VERIFIED', 503);
    const snapshots = await collectSnapshots(env, settings, instant), groupsByRecipient = recipientGroups(settings, snapshots);
    const urgentGroups = recipientGroups(settings, snapshots, 'urgent');
    const currentKeys = [...groupsByRecipient].flatMap(([openId, groups]) => groups.flatMap(group => group.items.map(item => taskKey(settings.app_id, openId, group, item))));
    const receipts = [], receiptQueries = Math.max(1, Math.ceil(currentKeys.length / 4000));
    for (let i = 0; i < receiptQueries; i++) receipts.push(...(await db.prepare('SELECT task_key,job_id FROM reminder_task_receipts WHERE task_key IN(SELECT value FROM json_each(?))').bind(JSON.stringify(currentKeys.slice(i * 4000, (i + 1) * 4000))).all()).results);
    const known = new Map(receipts.map(row => [row.task_key, row.job_id])), inserts = [];
    // Reserve the current tasks for immutable pre-upgrade daily jobs once,
    // including accepted-but-unacknowledged messages with an existing UUID.
    const legacy = (await db.prepare('SELECT d.id,d.open_id FROM reminder_deliveries d LEFT JOIN reminder_jobs j ON j.id=d.id WHERE j.id IS NULL AND d.thai_day=? AND d.app_id=? AND EXISTS(SELECT 1 FROM reminder_runtime WHERE legacy_seeded=0)').bind(date, settings.app_id).all()).results;
    for (const [openId, groups] of groupsByRecipient) {
      const old = legacy.find(row => row.open_id === openId), keys = groups.flatMap(group => group.items.map(item => taskKey(settings.app_id, openId, group, item)));
      if (old) {
        keys.forEach(key => known.set(key, old.id));
        inserts.push(db.prepare('INSERT OR IGNORE INTO reminder_task_receipts(task_key,job_id,last_seen_at) SELECT value,?,? FROM json_each(?)').bind(old.id, time, JSON.stringify(keys)));
      }
      if (auto) {
        const fresh = filterGroups(groups, (group, item) => !known.has(taskKey(settings.app_id, openId, group, item)));
        if (fresh.length) inserts.push(...jobStatements(env, settings, { openId, groups: fresh, date, time }));
      }
    }
    for (let i = 0; i < receiptQueries; i++) inserts.push(db.prepare('UPDATE reminder_task_receipts SET last_seen_at=? WHERE last_seen_at<? AND task_key IN(SELECT value FROM json_each(?))').bind(time, time - 86400, JSON.stringify(currentKeys.slice(i * 4000, (i + 1) * 4000))));
    inserts.push(db.prepare('UPDATE reminder_runtime SET legacy_seeded=1 WHERE id=1 AND legacy_seeded=0'));
    await db.batch(inserts);
    const jobs = (await db.prepare(`SELECT d.*,j.kind,j.scope FROM reminder_deliveries d LEFT JOIN reminder_jobs j ON j.id=d.id
      WHERE d.app_id=? AND d.status IN ('pending','retry','sending') AND d.next_attempt_at<=? AND d.lease_until<=?
      ORDER BY CASE WHEN j.kind='urgent' THEN 0 ELSE 1 END,d.created_at,d.id LIMIT ?`).bind(settings.app_id, time, time, Math.max(1, Math.min(manualOnly ? 15 : 16, deliveryLimit) - Math.ceil((receiptQueries - 1) / 2))).all()).results;
    const reserved = jobs.length ? (await db.prepare('SELECT task_key,job_id FROM reminder_task_receipts WHERE job_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(jobs.map(job => job.id))).all()).results : [];
    const client = createFeishuClient(settings.app_id, settings.appSecret, { fetchImpl, now: clock });
    for (const row of jobs) {
      let payload = row.payload, total = row.total, urgent = row.urgent, overdue = row.overdue;
      if (!row.attempts && row.kind) {
        const scope = JSON.parse(row.scope), keys = new Set(row.kind === 'urgent' ? scope.keys : reserved.filter(value => value.job_id === row.id).map(value => value.task_key));
        const current = filterGroups((row.kind==='urgent'?urgentGroups:groupsByRecipient).get(row.open_id) || [], (group, item) => scope.groups.some(([code, name]) => code === group.factoryCode && name === group.name) && keys.has(taskKey(settings.app_id, row.open_id, group, item)) && (row.kind !== 'urgent' || item.urgent));
        if (!current.length) {
          await db.batch([db.prepare("UPDATE reminder_deliveries SET status='cancelled',payload='' WHERE id=? AND attempts=0").bind(row.id), db.prepare('DELETE FROM reminder_task_receipts WHERE job_id=?').bind(row.id)]);
          result.skipped++; continue;
        }
        const summary = reminderMessage(current, row.thai_day, { kind: row.kind }); ({ total, urgent, overdue } = summary);
        payload = encrypt(env, encodeDeliveryMessage(summary.message));
      }
      const now = seconds(clock);
      const job = await db.prepare(`UPDATE reminder_deliveries SET status='sending',lease_owner=?,lease_until=?,attempts=attempts+1,payload=?,total=?,urgent=?,overdue=?,
        first_attempt_at=CASE WHEN first_attempt_at=0 THEN ? ELSE first_attempt_at END
        WHERE id=? AND status IN ('pending','retry','sending') AND lease_until<=? AND next_attempt_at<=? AND attempts<6
        AND (first_attempt_at=0 OR first_attempt_at>=?) AND config_revision=?
        AND EXISTS(SELECT 1 FROM reminder_settings WHERE id=1 AND revision=? AND (enabled=1 OR ?='urgent')) RETURNING *`)
        .bind(owner, now + 120, payload, total, urgent, overdue, now, row.id, now, now, now - 3300, settings.revision, settings.revision, row.kind || 'new_tasks').first();
      if (!job) { result.skipped++; continue; }
      try {
        const messageId = await client.send(job.open_id, decodeDeliveryMessage(decrypt(env, job.payload)), job.send_uuid);
        await db.prepare("UPDATE reminder_deliveries SET status='sent',sent_at=?,message_id=?,payload='',lease_until=0,error_code='' WHERE id=? AND lease_owner=?").bind(seconds(clock), messageId, row.id, owner).run(); result.sent++;
      } catch (error) {
        const uncertain = Boolean(job.uncertain || error.uncertain || !error.code), retry = Boolean((error.retryable || !error.code) && job.attempts < 6 && seconds(clock) - job.first_attempt_at < 3300);
        await db.prepare("UPDATE reminder_deliveries SET status=?,uncertain=?,next_attempt_at=?,lease_until=0,error_code=?,payload=CASE WHEN ? THEN payload ELSE '' END WHERE id=? AND lease_owner=?")
          .bind(retry ? 'retry' : uncertain ? 'uncertain' : 'failed', Number(uncertain), seconds(clock) + Math.min(600, 60 * 2 ** (job.attempts - 1)), error.code || 'DELIVERY_STATE_ERROR', Number(retry), row.id, owner).run(); result.failed++;
      }
    }
    const diagnostics = { ...snapshotDiagnostics(settings, snapshots), ...result, mode: 'new_tasks' };
    await db.batch([db.prepare("UPDATE reminder_settings SET last_checked_at=?,last_error='' WHERE id=1").bind(seconds(clock)), db.prepare('UPDATE reminder_runtime SET diagnostics=? WHERE id=1').bind(JSON.stringify(diagnostics))]);
    return { ...result, ...diagnostics };
  } catch (error) {
    const code = error.code || 'REMINDER_SERVICE_ERROR';
    try { await db.prepare('UPDATE reminder_settings SET last_checked_at=?,last_error=? WHERE id=1').bind(seconds(clock), code).run(); } catch {}
    return { ...result, error: code };
  } finally {
    if (owner) await db.prepare("UPDATE reminder_runtime SET lease_owner='',lease_until=0 WHERE id=1 AND lease_owner=?").bind(owner).run();
  }
}
