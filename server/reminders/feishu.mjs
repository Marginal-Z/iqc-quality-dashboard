export class FeishuError extends Error {
  constructor(code, retryable = false, uncertain = false) { super(code); this.name = 'FeishuError'; Object.assign(this, { code, retryable, uncertain }); }
}
const cache = new Map();
export function createFeishuClient(appId, appSecret, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  async function request(path, body, bearer) {
    let response;
    try { response = await fetchImpl('https://open.feishu.cn/open-apis/' + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
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
  return { verify: (force = false) => token(force), async send(openId, text, uuid) {
    let data;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { data = await request('im/v1/messages?receive_id_type=open_id', { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }), uuid }, await token(attempt > 0)); break; }
      catch (error) { if (attempt === 0 && ['FEISHU_CODE_99991663', 'FEISHU_CODE_99991668', 'FEISHU_CODE_99991677'].includes(error.code)) continue; throw error; }
    }
    if (typeof data?.data?.message_id !== 'string' || !data.data.message_id) throw new FeishuError('FEISHU_MISSING_MESSAGE_ID', true, true);
    return data.data.message_id;
  } };
}
const safe = (value, size = 100) => [...String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[<>&]/g, c => ({ '<': '＜', '>': '＞', '&': '＆' })[c])].slice(0, size).join('');
export function reminderText(groups, date) {
  const total = groups.reduce((n, group) => n + group.total, 0), urgent = groups.reduce((n, group) => n + group.urgent, 0), overdue = groups.reduce((n, group) => n + group.overdue, 0);
  const lines = ['【IQC 待检物料提醒】', date + ' · 泰国时间 UTC+7', '检验员：' + [...new Set(groups.map(group => safe(group.name, 80)))].join('、'), `待检 ${total} 批 · 加急 ${urgent} 批 · 超时 ${overdue} 批`, ''];
  let shown = 0;
  for (const group of groups) {
    lines.push(`${safe(group.factoryName)}（${safe(group.factoryCode, 32)}）：${group.total} 批`);
    for (const item of group.items) {
      if (shown >= 15) break; shown++;
      lines.push(`${shown}. ${item.urgent ? '【加急】' : ''}${item.overdue ? '【超时】' : ''}${safe(item.orderNumber, 64)} · ${safe(item.materialNumber, 64)}`, `   ${safe(item.materialName)} · 数量 ${item.quantity} · ${safe(item.createDate, 10)}`);
    }
  }
  if (shown < total) lines.push(`另有 ${total - shown} 批，请登录看板查看全部待检物料。`);
  lines.push('', 'https://iqc.namecheap.xin/', '每日每人首次检测到待检物料时提醒一次。');
  return { text: lines.join('\n'), total, urgent, overdue };
}
