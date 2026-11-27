// The QMS dimension matrix stores specifications in row zero and samples below.
// Each inspection batch is a subgroup; no rejected or selected sample is removed.
export class CapabilityError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const numeric = value => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
const number = value => numeric(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const D2 = [null, null, 1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.970, 3.078];
function limits(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const target = number(spec.standardValue), down = number(spec.downValue), up = number(spec.upValue);
  if (target === null || down === null || up === null || down < 0 || up < 0 || !['+', '-'].includes(spec.downSymbol) || !['+', '-'].includes(spec.upSymbol)) return null;
  const ends = [target + (spec.downSymbol === '+' ? down : -down), target + (spec.upSymbol === '+' ? up : -up)].map(value => Number(value.toFixed(8)));
  return ends.some(value => !Number.isFinite(value)) || ends[0] === ends[1] ? null : { target, lsl: Math.min(...ends), usl: Math.max(...ends) };
}
export function dimensionGroups(document, record) {
  let matrix;
  try { matrix = typeof document.criticalDimensionJson === 'string' ? JSON.parse(document.criticalDimensionJson) : document.criticalDimensionJson; }
  catch { throw new CapabilityError('INVALID_DIMENSION_DATA', 502); }
  if (!matrix) return [];
  if (!Array.isArray(matrix.header) || !Array.isArray(matrix.data) || matrix.header.length > 50 || matrix.data.length > 1000) throw new CapabilityError('INVALID_DIMENSION_DATA', 502);
  const groups = [], labels = new Set();
  for (const column of matrix.header) {
    if (column?.prop === 'rowName') continue;
    if (typeof column?.prop !== 'string' || typeof column.label !== 'string' || !column.label.trim() || labels.has(column.label)) throw new CapabilityError('INVALID_DIMENSION_DATA', 502);
    labels.add(column.label);
    const spec = limits(matrix.data[0]?.[column.prop]);
    const raw = matrix.data.slice(1).map(row => row?.[column.prop]);
    const values = raw.map(number).filter(value => value !== null);
    groups.push({ project: column.label.trim(), unit: typeof column.unit === 'string' ? column.unit.trim() : '', spec,
      orderNumber: record.orderNumber, date: document.doneDate || record.doneDate || record.createDate,
      supplier: record.supplierCode || record.supplierName || '', values, invalid: raw.length - values.length });
  }
  return groups;
}
export function analyzeCapability(groups) {
  const buckets = new Map();
  for (const group of groups) {
    const key = JSON.stringify([group.supplier, group.project, group.unit, group.spec]);
    if (!buckets.has(key)) buckets.set(key, { project: group.project, unit: group.unit, supplier: group.supplier, spec: group.spec, subgroups: [] });
    buckets.get(key).subgroups.push(group);
  }
  return [...buckets.values()].map(bucket => {
    const subgroups = bucket.subgroups.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.orderNumber.localeCompare(b.orderNumber));
    const values = subgroups.flatMap(row => row.values), n = values.length, invalid = subgroups.reduce((sum, row) => sum + row.invalid, 0);
    let mean = 0, m2 = 0, seen = 0;
    for (const value of values) { const delta = value - mean; mean += delta / ++seen; m2 += delta * (value - mean); }
    if (!Number.isFinite(mean) || !Number.isFinite(m2)) throw new CapabilityError('INVALID_DIMENSION_DATA', 502);
    const overall = n > 1 ? Math.sqrt(Math.max(0, m2 / (n - 1))) : null;
    // R/d2 within each rational subgroup, weighted by its degrees of freedom.
    const eligible = subgroups.filter(row => row.values.length >= 2 && row.values.length <= 10 && !row.invalid);
    const allEligible = eligible.length === subgroups.length;
    const dof = eligible.reduce((sum, row) => sum + row.values.length - 1, 0);
    const within = allEligible && dof ? eligible.reduce((sum, row) => {
      const estimate = (Math.max(...row.values) - Math.min(...row.values)) / D2[row.values.length];
      return sum + (row.values.length - 1) * estimate;
    }, 0) / dof : null;
    const stats = sigma => !bucket.spec || !Number.isFinite(sigma) || !sigma || !n || invalid ? { cp: null, cpk: null } : {
      cp: (bucket.spec.usl - bucket.spec.lsl) / (6 * sigma), cpk: Math.min(bucket.spec.usl - mean, mean - bucket.spec.lsl) / (3 * sigma) };
    const potential = stats(within), performance = stats(overall);
    return { project: bucket.project, unit: bucket.unit, supplier: bucket.supplier, spec: bucket.spec, n, batches: subgroups.length, invalid,
      mean: n ? mean : null, within, overall, cp: potential.cp, cpk: potential.cpk, pp: performance.cp, ppk: performance.cpk,
      outside: bucket.spec ? values.filter(value => value < bucket.spec.lsl || value > bucket.spec.usl).length : null,
      issues: [...(!bucket.spec ? ['missingSpec'] : []), ...(invalid ? ['invalidSamples'] : []), ...(n < 50 ? ['smallSample'] : []),
        ...(!allEligible ? ['unsupportedSubgroup'] : []), ...(overall === 0 || within === 0 ? ['zeroVariance'] : [])],
      samples: subgroups.flatMap(row => row.values.map((value, index) => ({ orderNumber: row.orderNumber, date: row.date, index: index + 1, value }))) };
  });
}
