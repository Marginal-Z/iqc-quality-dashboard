import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
export const digest = value => createHash('sha256').update(value).digest('hex');
export class ReminderError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'ReminderError'; this.code = code; this.status = status; }
}
function secretKey(env) {
  const key = Buffer.from(env.REMINDER_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new ReminderError('ENCRYPTION_NOT_CONFIGURED', 503);
  return key;
}
export function encrypt(env, text) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secretKey(env), iv);
  cipher.setAAD(Buffer.from('iqc-reminders:v1'));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decrypt(env, encoded) {
  const [version, iv, tag, value] = encoded.split('.');
  if (version !== 'v1' || !iv || !tag || !value) throw new ReminderError('ENCRYPTED_DATA_INVALID', 503);
  const decipher = createDecipheriv('aes-256-gcm', secretKey(env), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from('iqc-reminders:v1')); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(value, 'base64url')), decipher.final()]).toString('utf8');
}
export const credentialKey = (appId, secret) => digest(appId + '\n' + secret);
export async function readSettings(env) {
  const row = await env.REMINDER_DB.prepare('SELECT * FROM reminder_settings WHERE id = 1').first();
  if (!row) throw new ReminderError('DATABASE_NOT_INITIALIZED', 503);
  const recipients = (await env.REMINDER_DB.prepare('SELECT factory_code, inspector_name, open_id FROM reminder_recipients ORDER BY factory_code, inspector_name').all()).results;
  const appSecret = row.app_secret ? decrypt(env, row.app_secret) : '';
  return { ...row, enabled: Boolean(row.enabled), appSecret, factories: JSON.parse(row.factories), recipients };
}
export function publicSettings(settings) {
  return { enabled: settings.enabled, appId: settings.app_id, configured: Boolean(settings.app_id && settings.appSecret),
    verified: Boolean(settings.appSecret && settings.verified_key === credentialKey(settings.app_id, settings.appSecret)),
    factories: settings.factories, dailyStart: settings.daily_start, recipients: settings.recipients,
    lastCheckedAt: settings.last_checked_at, lastError: settings.last_error, revision: settings.revision, timeZone: 'Asia/Bangkok' };
}
export async function saveSettings(env, body, actor, availableFactories, now) {
  const old = await readSettings(env), appId = String(body.appId || '').trim();
  if (body.revision !== old.revision) throw new ReminderError('SETTINGS_CHANGED', 409);
  if (appId && !/^cli_[A-Za-z0-9_-]{4,100}$/.test(appId)) throw new ReminderError('INVALID_APP_ID');
  if (body.appSecret !== undefined && (typeof body.appSecret !== 'string' || !/^[\x21-\x7e]{8,256}$/.test(body.appSecret))) throw new ReminderError('INVALID_APP_SECRET');
  if (appId !== old.app_id && !body.appSecret) throw new ReminderError('NEW_APP_SECRET_REQUIRED');
  const appSecret = body.appSecret || old.appSecret;
  const verifiedKey = old.verified_key === credentialKey(appId, appSecret) ? old.verified_key : '';
  if (typeof body.enabled !== 'boolean') throw new ReminderError('INVALID_SETTINGS');
  if (!Array.isArray(body.factories) || body.factories.length > 8 || new Set(body.factories).size !== body.factories.length || body.factories.some(code => !availableFactories.some(factory => factory.code === code))) throw new ReminderError('INVALID_FACTORY');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.dailyStart || '')) throw new ReminderError('INVALID_START_TIME');
  if (!Array.isArray(body.recipients) || body.recipients.length > 50) throw new ReminderError('INVALID_RECIPIENTS');
  const keys = new Set();
  const recipients = body.recipients.map(row => {
    const name = typeof row.inspector_name === 'string' ? row.inspector_name.trim() : '';
    if (!body.factories.includes(row.factory_code) || !name || name === '未分配' || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || !/^ou_[A-Za-z0-9_-]{4,124}$/.test(row.open_id || '')) throw new ReminderError('INVALID_RECIPIENTS');
    const key = row.factory_code + '\n' + name; if (keys.has(key)) throw new ReminderError('DUPLICATE_INSPECTOR'); keys.add(key);
    return { factory_code: row.factory_code, inspector_name: name, open_id: row.open_id };
  });
  if (body.enabled && (!appId || !appSecret || !verifiedKey || !recipients.length || !body.factories.length)) throw new ReminderError('VERIFY_BEFORE_ENABLING');
  const encryptedSecret = appSecret ? (body.appSecret ? encrypt(env, appSecret) : old.app_secret) : '';
  const nonce = randomUUID();
  const result = await env.REMINDER_DB.batch([
    env.REMINDER_DB.prepare('UPDATE reminder_settings SET enabled=?, app_id=?, app_secret=?, verified_key=?, factories=?, daily_start=?, updated_at=?, updated_by=?, revision=revision+1, write_nonce=?, last_error=\'\' WHERE id=1 AND revision=?')
      .bind(Number(body.enabled), appId, encryptedSecret, verifiedKey, JSON.stringify(body.factories), body.dailyStart, now, actor, nonce, old.revision),
    env.REMINDER_DB.prepare('DELETE FROM reminder_recipients WHERE EXISTS(SELECT 1 FROM reminder_settings WHERE write_nonce=?)').bind(nonce),
    ...recipients.map(row => env.REMINDER_DB.prepare('INSERT INTO reminder_recipients(factory_code,inspector_name,open_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM reminder_settings WHERE write_nonce=?)').bind(row.factory_code, row.inspector_name, row.open_id, nonce))
  ]);
  if (!result[0]?.meta?.changes) throw new ReminderError('SETTINGS_CHANGED', 409);
  return publicSettings(await readSettings(env));
}
