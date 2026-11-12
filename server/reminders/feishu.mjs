export class FeishuError extends Error {
  constructor(code, retryable = false, uncertain = false) { super(code); this.name = 'FeishuError'; Object.assign(this, { code, retryable, uncertain }); }
}
const cache = new Map();
export function createFeishuClient(appId, appSecret, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  async function request(path, body, bearer) {
    let response;
    // Workers supports manual/follow only. Inspect 3xx as an HTTP failure so
    // application credentials and message bodies can never follow a redirect.
    try { response = await fetchImpl('https://open.feishu.cn/open-apis/' + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(body) }); }
    catch { throw new FeishuError('FEISHU_NETWORK_ERROR', true, Boolean(bearer)); }
    if (!response.ok) { await response.body?.cancel(); throw new FeishuError('FEISHU_HTTP_' + response.status, response.status === 429 || response.status >= 500, Boolean(bearer) && response.status >= 500); }
    let data;
    try { data = await response.json(); } catch { throw new FeishuError('FEISHU_INVALID_RESPONSE', true, Boolean(bearer)); }
    if (!data || Number(data.code) !== 0) throw new FeishuError('FEISHU_CODE_' + (Number.isSafeInteger(Number(data?.code)) ? Number(data.code) : 'INVALID'), [99991400, 99991401].includes(Number(data?.code)));
    return data;
  }
  const key = appId + '\n' + appSecret;
  async function token(force = false) {
    const cached = cache.get(key); if (!force && cached?.expires > now()) return cached.value;
    const data = await request('auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret });
    if (typeof data.tenant_access_token !== 'string' || !data.tenant_access_token || !Number.isFinite(data.expire) || data.expire <= 0) throw new FeishuError('FEISHU_INVALID_TOKEN');
    if (cache.size > 8) cache.clear(); cache.set(key, { value: data.tenant_access_token, expires: now() + Math.max(0, data.expire - 120) * 1000 });
    return data.tenant_access_token;
  }
  return { verify: (force = false) => token(force), async send(openId, message, uuid) {
    const envelope = typeof message === 'string' ? { msg_type: 'text', content: { text: message } } : message;
    if (!envelope || !['text', 'interactive'].includes(envelope.msg_type) || !envelope.content || typeof envelope.content !== 'object' ||
      (envelope.msg_type === 'text' && typeof envelope.content.text !== 'string') ||
      (envelope.msg_type === 'interactive' && (!Array.isArray(envelope.content.body?.elements) || envelope.content.schema !== '2.0'))) throw new FeishuError('FEISHU_INVALID_MESSAGE');
    let data;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { data = await request('im/v1/messages?receive_id_type=open_id', { receive_id: openId, msg_type: envelope.msg_type, content: JSON.stringify(envelope.content), uuid }, await token(attempt > 0)); break; }
      catch (error) { if (attempt === 0 && ['FEISHU_CODE_99991663', 'FEISHU_CODE_99991668', 'FEISHU_CODE_99991677'].includes(error.code)) continue; throw error; }
    }
    if (typeof data?.data?.message_id !== 'string' || !data.data.message_id) throw new FeishuError('FEISHU_MISSING_MESSAGE_ID', true, true);
    return data.data.message_id;
  } };
}
