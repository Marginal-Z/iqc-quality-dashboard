import { listReminderFactories, loadPendingInspections, summarizePendingInspections, localDate } from '../pending-inspections.mjs';
import { readSettings, digest, ReminderError } from './store.mjs';
import { reminderMessage } from './message.mjs';
const TIME_ZONE = 'Asia/Bangkok';
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
export function recipientGroups(settings, snapshots) {
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
    messages: [...byRecipient].map(([openId, groups]) => { const { message, ...summary } = reminderMessage(groups, localDate(now, TIME_ZONE)); return { openId, ...summary, card: message.content }; }) };
}
export { runReminderCycle } from './scheduler.mjs';
