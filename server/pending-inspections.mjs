const DOCUMENTS = '/qmsSupplierQuality/iqc/documents/selectPage';
const FACTORIES = '/qmsData/sys/dict/type/factory';

export class InspectionQueryError extends Error {
  constructor(code) { super(code); this.name = 'InspectionQueryError'; this.code = code; }
}

async function queryQms(env, path, query, options) {
  if (!env.QMS_PROXY?.fetch) throw new InspectionQueryError('QMS_UNAVAILABLE');
  const { budget, timeoutMs = 30000, retries = 2 } = options;
  for (let attempt = 0; ; attempt++) {
    if (++budget.used > budget.limit) throw new InspectionQueryError('QMS_REQUEST_LIMIT');
    let response;
    try {
      response = await env.QMS_PROXY.fetch(new Request('https://iqc-proxy.internal/api/qms', {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Origin: 'https://iqc.namecheap.xin' },
        body: JSON.stringify({ path, query })
      }));
    } catch {
      if (attempt < retries) continue;
      throw new InspectionQueryError('QMS_NETWORK_ERROR');
    }
    if ((response.status === 429 || response.status >= 500) && attempt < retries) { await response.body?.cancel(); continue; }
    if (!response.ok) throw new InspectionQueryError('QMS_HTTP_ERROR');
    let body;
    try { body = await response.json(); } catch { throw new InspectionQueryError('QMS_INVALID_RESPONSE'); }
    if (!body || typeof body !== 'object' || body.error || String(body.status) !== '200') throw new InspectionQueryError('QMS_BUSINESS_ERROR');
    return body.data;
  }
}

function optionsWithBudget(options = {}) {
  return { ...options, budget: options.budget || { used: 0, limit: 40 } };
}

export async function listReminderFactories(env, options = {}) {
  const rows = await queryQms(env, FACTORIES, {}, optionsWithBudget(options));
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.code !== 'string' || !row.code.trim())) throw new InspectionQueryError('QMS_INVALID_FACTORIES');
  return rows.map(row => ({ code: row.code, name: String(row.name || row.code) }));
}

async function loadStatus(env, factoryCode, status, options) {
  const all = [], seen = new Set();
  let expectedTotal;
  for (let pageNum = 1; pageNum <= (options.maxPages || 1000); pageNum++) {
    const data = await queryQms(env, DOCUMENTS, {
      pageSize: '2000', pageNum: String(pageNum), sort: 'create_date', order: 'desc',
      'searchParams[factoryCode]': factoryCode, 'searchParams[inspectionStatus]': status
    }, options);
    const total = Number(data?.total), rows = data?.resultData;
    if (data?.total == null || !Number.isSafeInteger(total) || total < 0 || !Array.isArray(rows)) throw new InspectionQueryError('QMS_INVALID_PAGE');
    if (expectedTotal !== undefined && total !== expectedTotal) throw new InspectionQueryError('QMS_SNAPSHOT_CHANGED');
    expectedTotal = total;
    if (!rows.length && all.length < total) throw new InspectionQueryError('QMS_INCOMPLETE_PAGE');
    for (const row of rows) {
      if (!row || typeof row.orderNumber !== 'string' || !row.orderNumber.trim()) throw new InspectionQueryError('QMS_INVALID_TASK');
      if (seen.has(row.orderNumber)) throw new InspectionQueryError('QMS_DUPLICATE_PAGE');
      seen.add(row.orderNumber); all.push(row);
    }
    if (all.length > total) throw new InspectionQueryError('QMS_INVALID_PAGE');
    if (all.length === total) return all;
  }
  throw new InspectionQueryError('QMS_PAGE_LIMIT');
}

export async function loadPendingInspections(env, factoryCode, options = {}) {
  if (typeof factoryCode !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(factoryCode)) throw new InspectionQueryError('INVALID_FACTORY');
  const limits = optionsWithBudget(options);
  const active = await loadStatus(env, factoryCode, '0', limits);
  const overdue = await loadStatus(env, factoryCode, '2', limits);
  // A task may move to overdue between the two queries. Count it only once,
  // preferring its newer overdue state, as the dashboard does.
  return [...new Map([...active, ...overdue].filter(row => ['0', '2'].includes(String(row.inspectionStatus))).map(row => [row.orderNumber, row])).values()];
}

export function localDate(now, timeZone) {
  if (timeZone === 'Asia/Bangkok') return new Date(new Date(now).getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function summarizePendingInspections(records, { timeZone = 'Asia/Bangkok', now = new Date() } = {}) {
  const today = localDate(now, timeZone), yesterday = new Date(today + 'T00:00:00Z'); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDate = yesterday.toISOString().slice(0, 10), groups = new Map(), seen = new Set();
  let total = 0, urgent = 0, overdue = 0;
  for (const record of records) {
    if (!['0', '2'].includes(String(record.inspectionStatus))) continue;
    if (seen.has(record.orderNumber)) throw new InspectionQueryError('DUPLICATE_TASK');
    seen.add(record.orderNumber);
    const name = String(record.inspectorName || '').trim() || '未分配';
    const duration = String(record.totalTime || '').match(/(\d+)天(?:(\d+)时)?(?:(\d+)分)?/);
    const hours = duration ? Number(duration[1]) * 24 + Number(duration[2] || 0) + Number(duration[3] || 0) / 60 : null;
    const created = String(record.createDate || '').slice(0, 10), dated = /^\d{4}-\d{2}-\d{2}$/.test(created);
    const isOverdue = String(record.inspectionStatus) === '2' || hours !== null && hours >= 24 || dated && created < yesterdayDate;
    const isUrgent = String(record.expeditedFlag) === '1' || record.expeditedFlagName === '是';
    const item = {
      orderNumber: record.orderNumber, materialNumber: String(record.materialNumber || ''), materialName: String(record.materialName || ''),
      supplierName: String(record.supplierName || ''), quantity: Number.isFinite(Number(record.qty)) ? Number(record.qty) : 0,
      createDate: created, taskName: String(record.taskName || ''), urgent: isUrgent, overdue: isOverdue
    };
    if (!groups.has(name)) groups.set(name, { name, total: 0, urgent: 0, overdue: 0, items: [] });
    const group = groups.get(name); group.total++; group.urgent += Number(isUrgent); group.overdue += Number(isOverdue); group.items.push(item);
    total++; urgent += Number(isUrgent); overdue += Number(isOverdue);
  }
  const compare = (a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.overdue) - Number(a.overdue) || a.createDate.localeCompare(b.createDate) || a.orderNumber.localeCompare(b.orderNumber);
  for (const group of groups.values()) group.items.sort(compare);
  return { date: today, timeZone, total, urgent, overdue, groups: [...groups.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name, 'zh')) };
}
