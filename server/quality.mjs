import { queryQms, listReminderFactories } from './pending-inspections.mjs';
import { CapabilityError, dimensionGroups, analyzeCapability } from './capability.mjs';
const ROOT = '/qmsSupplierQuality/iqc/';
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function isFinalInspection(row) {
  return ['1', '3'].includes(String(row.inspectionStatus)) && row.taskKey === 'close' && /^\d{4}-\d{2}-\d{2}$/.test(row.doneDate || '') && Number.isFinite(Date.parse(row.doneDate)) && new Date(row.doneDate).toISOString().slice(0,10)===row.doneDate &&
    ['合格', '特采', '退货'].includes(row.syncInspectionResultName);
}
export async function capabilityReport(env, input) {
  const { factoryCode, materialNumber, startDate, endDate } = input;
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(factoryCode || '') || typeof materialNumber !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(materialNumber) ||
      !date(startDate) || !date(endDate) || startDate > endDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 366) throw new CapabilityError('INVALID_CAPABILITY_FILTER');
  const budget = { used: 0, limit: 46 }, options = { budget, retries: 0 }, factories = await listReminderFactories(env, options);
  if (!factories.some(factory => factory.code === factoryCode)) throw new CapabilityError('INVALID_FACTORY');
  const records = [], seen = new Set(); let expected;
  for (let pageNum = 1; pageNum <= 20; pageNum++) {
    const data = await queryQms(env, ROOT + 'documents/selectPage', { pageSize: '20', pageNum: String(pageNum), sort: 'create_date', order: 'desc',
      'searchParams[factoryCode]': factoryCode, 'searchParams[materialNumber]': materialNumber, 'searchParams[syncInspectionResult]': '1',
      'searchParams[createDateStart]': startDate, 'searchParams[createDateEnd]': endDate }, options);
    const rows = data?.resultData, total = Number(data?.total);
    if (!Array.isArray(rows) || data.total == null || !Number.isSafeInteger(total) || total < 0 || expected !== undefined && total !== expected) throw new CapabilityError('QMS_INVALID_PAGE', 502);
    // Never present the first page as a complete study.
    if (total > 20) throw new CapabilityError('CAPABILITY_RANGE_TOO_LARGE', 422);
    expected = total;
    for (const row of rows) {
      if (!safeId(row?.id) || seen.has(row.id)) throw new CapabilityError('QMS_INVALID_PAGE', 502);
      seen.add(row.id); records.push(row);
    }
    if (records.length > total || !rows.length && records.length < total) throw new CapabilityError('QMS_INVALID_PAGE', 502);
    if (records.length === total) break;
    if (pageNum === 20) throw new CapabilityError('QMS_INVALID_PAGE', 502);
  }
  const groups = []; let included = 0, missing = 0, notFinal = 0;
  for (const row of records) {
    if (row.materialNumber !== materialNumber || row.factoryCode && row.factoryCode !== factoryCode || row.createDate < startDate || row.createDate > endDate || row.syncInspectionResultName !== '合格') throw new CapabilityError('QMS_SCOPE_MISMATCH', 502);
    if (!isFinalInspection(row)) { notFinal++; continue; }
    const document = await queryQms(env, ROOT + 'documents/getById/' + row.id, {}, options);
    if (!document || document.id !== row.id || !safeId(document.materialId)) throw new CapabilityError('QMS_INVALID_DETAIL', 502);
    const material = await queryQms(env, ROOT + 'documentsMaterial/getById/' + document.materialId, {}, options);
    if (!material || material.factoryCode !== factoryCode || material.materialNumber !== materialNumber || material.supplierCode !== row.supplierCode) throw new CapabilityError('QMS_SCOPE_MISMATCH', 502);
    if (String(document.doneFlag) !== '1' || document.taskKey !== 'close' || String(document.syncInspectionResult) !== '1') { notFinal++; continue; }
    const dimensions = dimensionGroups(document, row);
    if (!dimensions.some(item => item.values.length)) missing++; else included++;
    groups.push(...dimensions);
    if (groups.reduce((sum, item) => sum + item.values.length, 0) > 20000) throw new CapabilityError('CAPABILITY_RANGE_TOO_LARGE', 422);
  }
  return { factoryCode, materialNumber, startDate, endDate, source: 'qms_passed_records', scanned: records.length, included, missing, notFinal,
    method: 'weighted_subgroup_range_d2', projects: analyzeCapability(groups), fetchedAt: new Date().toISOString(), passedOnly: true };
}
