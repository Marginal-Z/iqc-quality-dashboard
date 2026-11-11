import { randomUUID } from 'node:crypto';
import { listReminderFactories, loadPendingInspections, summarizePendingInspections, localDate } from '../pending-inspections.mjs';
import { readSettings, credentialKey, digest, encrypt, decrypt, ReminderError } from './store.mjs';
import { createFeishuClient, reminderText } from './feishu.mjs';
const TIME_ZONE = 'Asia/Bangkok';
const seconds = clock => Math.floor(clock() / 1000);
export function deliveryId(day, appId, openId) {
  const hash = digest(JSON.stringify([day, appId, openId])).slice(0, 32);
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20)].join('-');
}
export async function collectSnapshots(env, settings, now) {
  const budget = { used: 0, limit: 24 }, available = await listReminderFactories(env, { budget }), snapshots = [];
  for (const code of settings.factories) {
    const factory = available.find(row => row.code === code); if (!factory) throw new ReminderError('FACTORY_UNAVAILABLE', 503);
    const records = await loadPendingInspections(env, code, { budget });
    if (records.some(row => row.factoryCode && row.factoryCode !== code)) throw new ReminderError('FACTORY_DATA_MISMATCH', 503);
    snapshots.push({ factoryCode: code, factoryName: factory.name, ...summarizePendingInspections(records, { now, timeZone: TIME_ZONE }) });
  }
  return snapshots;
}
function recipientGroups(settings, snapshots) {
  const groups = new Map();
  for (const recipient of settings.recipients) {
    const snapshot = snapshots.find(row => row.factoryCode === recipient.factory_code), group = snapshot?.groups.find(row => row.name === recipient.inspector_name);
    if (!group?.total) continue;
    if (!groups.has(recipient.open_id)) groups.set(recipient.open_id, []);
    groups.get(recipient.open_id).push({ ...group, factoryCode: snapshot.factoryCode, factoryName: snapshot.factoryName });
  }
  return groups;
}
export async function previewReminders(env, now = new Date()) {
  const settings = await readSettings(env), snapshots = await collectSnapshots(env, settings, now), byRecipient = recipientGroups(settings, snapshots);
  return { date: localDate(now, TIME_ZONE), timeZone: TIME_ZONE,
    inspectors: snapshots.flatMap(snapshot => snapshot.groups.map(group => ({ factoryCode: snapshot.factoryCode, factoryName: snapshot.factoryName, name: group.name, total: group.total,
      mapped: settings.recipients.some(row => row.factory_code === snapshot.factoryCode && row.inspector_name === group.name) }))),
    messages: [...byRecipient].map(([openId, groups]) => ({ openId, ...reminderText(groups, localDate(now, TIME_ZONE)) })) };
}
export async function runReminderCycle(env, { clock = () => Date.now(), fetchImpl = fetch } = {}) {
  const result = { sent: 0, skipped: 0, failed: 0 }, db = env.REMINDER_DB;
  if (!db) return { ...result, error: 'DATABASE_NOT_CONFIGURED' };
  try {
    const settings = await readSettings(env);
    if (!settings.enabled) return { ...result, disabled: true };
    const instant = new Date(clock()), date = localDate(instant, TIME_ZONE);
    const minute = new Date(instant.getTime() + 7 * 3600000).toISOString().slice(11, 16);
    if (minute < settings.daily_start) return { ...result, beforeStart: true };
    if (!settings.appSecret || settings.verified_key !== credentialKey(settings.app_id, settings.appSecret)) throw new ReminderError('CONNECTION_NOT_VERIFIED', 503);
    const snapshots = await collectSnapshots(env, settings, instant), groupsByRecipient = recipientGroups(settings, snapshots);
    const client = createFeishuClient(settings.app_id, settings.appSecret, { fetchImpl, now: clock });
    const owner = randomUUID(), time = seconds(clock);
    await db.prepare("UPDATE reminder_deliveries SET status=CASE WHEN uncertain=1 THEN 'uncertain' ELSE 'failed' END,payload='',error_code='RETRY_WINDOW_ENDED' WHERE thai_day=? AND status IN ('sending','retry') AND lease_until<=? AND (attempts>=6 OR first_attempt_at<?)")
      .bind(date, time, time - 3300).run();
    const prior = new Map((await db.prepare('SELECT id,status,attempts,uncertain,config_revision FROM reminder_deliveries WHERE thai_day=? AND app_id=?').bind(date, settings.app_id).all()).results.map(row => [row.id, row]));
    const ids = [], inserts = [];
    for (const [openId, groups] of groupsByRecipient) {
      const id = deliveryId(date, settings.app_id, openId), message = reminderText(groups, date); ids.push(id);
      const old = prior.get(id), repaired = old?.status === 'failed' && !old.uncertain && old.config_revision < settings.revision;
      if (old && !(old.status === 'cancelled' && old.attempts === 0) && !repaired) continue;
      if (repaired) prior.delete(id);
      inserts.push(db.prepare(`INSERT INTO reminder_deliveries(id,thai_day,app_id,open_id,inspector_names,total,urgent,overdue,payload,created_at,send_uuid,config_revision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,total=excluded.total,urgent=excluded.urgent,overdue=excluded.overdue,inspector_names=excluded.inspector_names,status='pending',send_uuid=excluded.send_uuid,config_revision=excluded.config_revision,attempts=0,first_attempt_at=0,next_attempt_at=0,lease_until=0,error_code=''
        WHERE (reminder_deliveries.status='cancelled' AND reminder_deliveries.attempts=0) OR (reminder_deliveries.status='failed' AND reminder_deliveries.uncertain=0 AND reminder_deliveries.config_revision<excluded.config_revision)`)
        .bind(id, date, settings.app_id, openId, JSON.stringify(groups.map(group => group.factoryCode + ' · ' + group.name)), message.total, message.urgent, message.overdue, encrypt(env, message.text), time, repaired ? randomUUID() : id, settings.revision));
    }
    if (inserts.length) await db.batch(inserts);
    await db.prepare("UPDATE reminder_deliveries SET status='cancelled',payload='' WHERE thai_day=? AND status='pending' AND attempts=0 AND id NOT IN (SELECT value FROM json_each(?))").bind(date, JSON.stringify(ids)).run();
    let dispatched = 0;
    for (const id of ids) {
      if (dispatched >= 20 || localDate(new Date(clock()), TIME_ZONE) !== date) break;
      if (['sent', 'failed', 'uncertain'].includes(prior.get(id)?.status)) { result.skipped++; continue; }
      const now = seconds(clock);
      const job = await db.prepare(`UPDATE reminder_deliveries SET status='sending',lease_owner=?,lease_until=?,attempts=attempts+1,
        first_attempt_at=CASE WHEN first_attempt_at=0 THEN ? ELSE first_attempt_at END
        WHERE id=? AND status IN ('pending','retry','sending') AND lease_until<=? AND next_attempt_at<=? AND attempts<6
        AND (first_attempt_at=0 OR first_attempt_at>=?)
        AND EXISTS(SELECT 1 FROM reminder_settings WHERE id=1 AND enabled=1 AND revision=?) RETURNING *`)
        .bind(owner, now + 120, now, id, now, now, now - 3300, settings.revision).first();
      if (!job) { result.skipped++; continue; }
      dispatched++;
      try {
        const messageId = await client.send(job.open_id, decrypt(env, job.payload), job.send_uuid);
        await db.prepare("UPDATE reminder_deliveries SET status='sent',sent_at=?,message_id=?,payload='',lease_until=0,error_code='' WHERE id=? AND lease_owner=?")
          .bind(seconds(clock), messageId, id, owner).run(); result.sent++;
      } catch (error) {
        const uncertain = Boolean(job.uncertain || error.uncertain || !error.code), retry = Boolean((error.retryable || !error.code) && job.attempts < 6 && seconds(clock) - job.first_attempt_at < 3300);
        const status = retry ? 'retry' : uncertain ? 'uncertain' : 'failed';
        await db.prepare('UPDATE reminder_deliveries SET status=?,uncertain=?,next_attempt_at=?,lease_until=0,error_code=?,payload=CASE WHEN ? THEN payload ELSE \'\' END WHERE id=? AND lease_owner=?')
          .bind(status, Number(uncertain), seconds(clock) + Math.min(600, 60 * 2 ** (job.attempts - 1)), error.code || 'DELIVERY_STATE_ERROR', Number(retry), id, owner).run(); result.failed++;
      }
    }
    await db.prepare("UPDATE reminder_settings SET last_checked_at=?,last_error='' WHERE id=1").bind(seconds(clock)).run();
    await db.prepare('DELETE FROM reminder_deliveries WHERE created_at<?').bind(seconds(clock) - 90 * 86400).run();
    return result;
  } catch (error) {
    const code = error.code || 'REMINDER_SERVICE_ERROR';
    try { await db.prepare('UPDATE reminder_settings SET last_checked_at=?,last_error=? WHERE id=1').bind(seconds(clock), code).run(); } catch {}
    return { ...result, error: code };
  }
}
