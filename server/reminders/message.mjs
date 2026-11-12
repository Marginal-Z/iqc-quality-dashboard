const PAYLOAD_PREFIX = 'IQC_MESSAGE_V1\n';
export const MAX_CARD_BYTES = 28 * 1024;
const DASHBOARD_URL = 'https://iqc.namecheap.xin/';
const labels = {
  title: 'IQC 待检物料提醒 / แจ้งเตือนวัสดุรอตรวจ',
  inspector: '检验员 / ผู้ตรวจสอบ', factory: '工厂 / โรงงาน',
  pending: '待检 / รอตรวจ', urgent: '加急 / เร่งด่วน', overdue: '超时 / เกินกำหนด',
  order: '单号 / เลขที่เอกสาร', material: '料号 / รหัสวัสดุ', name: '物料名称 / ชื่อวัสดุ',
  quantity: '数量 / จำนวน', date: '送检日期 / วันที่ส่งตรวจ', supplier: '供应商 / ผู้จำหน่าย',
  action: '查看待检看板 / เปิดแดชบอร์ดงานรอตรวจ',
  rule: '每日每人首次发现待检物料时提醒一次。\nแจ้งเตือนผู้ตรวจสอบแต่ละคนวันละครั้ง เมื่อพบวัสดุรอตรวจครั้งแรกของวัน',
  test: '模拟测试 / ทดสอบจำลอง',
  testNote: '虚构测试数据，无需进行真实检验。\nข้อมูลทดสอบจำลอง ไม่ต้องตรวจสอบจริง'
};
const clean = (value, size = 100) => {
  const chars = [...String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[<>&]/g, c => ({ '<': '＜', '>': '＞', '&': '＆' })[c])];
  return chars.length > size ? chars.slice(0, size).join('') + '…' : chars.join('');
};
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const plain = content => ({ tag: 'div', text: { tag: 'plain_text', content } });
const batches = total => `${total} 批 / ล็อต`;
const remaining = total => `另有 ${total} 批，请登录看板查看全部待检物料。\nยังมีอีก ${total} ล็อต กรุณาเข้าสู่ระบบแดชบอร์ดเพื่อดูรายการทั้งหมด`;
const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).length;

export function reminderMessage(groups, date, { test = false } = {}) {
  const total = groups.reduce((n, group) => n + count(group.total), 0);
  const urgent = groups.reduce((n, group) => n + count(group.urgent), 0);
  const overdue = groups.reduce((n, group) => n + count(group.overdue), 0);
  const inspectors = clean([...new Set(groups.map(group => clean(group.name, 80)))].join('、'), 160);
  const title = (test ? labels.test + ' · ' : '') + labels.title;
  const subtitle = clean(date, 10) + ' · 泰国时间 / เวลาไทย UTC+7';
  const metrics = [[total, '待检', 'รอตรวจ'], [urgent, '加急', 'เร่งด่วน'], [overdue, '超时', 'เกินกำหนด']];
  const selected = groups.flatMap((group, groupIndex) => (group.items || []).map(item => ({ group, groupIndex, item }))).slice(0, 15);
  function details() {
    const elements = [], text = []; let previous = -1;
    for (const [index, { group, groupIndex, item }] of selected.entries()) {
      if (groupIndex !== previous) {
        const heading = `${labels.factory}：${clean(group.factoryName)} (${clean(group.factoryCode, 32)}) · ${batches(count(group.total))}`;
        elements.push(plain(heading)); text.push(heading); previous = groupIndex;
      }
      const status = [item.urgent ? labels.urgent : '', item.overdue ? labels.overdue : ''].filter(Boolean).join(' · ') || labels.pending;
      const lines = [`${index + 1}. ${status}`, `${labels.order}：${clean(item.orderNumber, 64) || '—'}`,
        `${labels.material}：${clean(item.materialNumber, 64) || '—'}`, `${labels.name}：${clean(item.materialName) || '—'}`,
        `${labels.quantity}：${Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0} · ${labels.date}：${clean(item.createDate, 10) || '—'}`];
      if (item.supplierName) lines.push(`${labels.supplier}：${clean(item.supplierName)}`);
      elements.push(plain(lines.join('\n'))); text.push(lines.join('\n'));
    }
    if (selected.length < total) { elements.push(plain(remaining(total - selected.length))); text.push(remaining(total - selected.length)); }
    return { elements, text };
  }
  function build() {
    const detail = details();
    const card = {
      schema: '2.0',
      config: { update_multi: true, enable_forward: false, summary: { content: `${test ? labels.test + ' · ' : ''}IQC ${labels.pending} ${batches(total)} · ${labels.urgent} ${urgent} · ${labels.overdue} ${overdue}` } },
      header: { template: test ? 'blue' : overdue ? 'red' : urgent ? 'orange' : 'blue', title: { tag: 'plain_text', content: title }, subtitle: { tag: 'plain_text', content: subtitle } },
      body: { elements: [
        ...(test ? [plain(labels.testNote)] : []), plain(`${labels.inspector}：${inspectors}`),
        { tag: 'column_set', flex_mode: 'trisect', columns: metrics.map(([value, zh, th]) => ({ tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'markdown', content: `### ${value}\n${zh}\n${th}`, text_align: 'center' }] })) },
        { tag: 'hr' }, ...detail.elements,
        { tag: 'button', text: { tag: 'plain_text', content: labels.action }, type: 'primary', behaviors: [{ type: 'open_url', default_url: DASHBOARD_URL }] },
        plain(labels.rule)
      ] }
    };
    const text = [title, subtitle, ...(test ? [labels.testNote] : []), `${labels.inspector}：${inspectors}`,
      `${labels.pending} ${batches(total)} · ${labels.urgent} ${batches(urgent)} · ${labels.overdue} ${batches(overdue)}`,
      ...detail.text, labels.action + '：' + DASHBOARD_URL, labels.rule].join('\n');
    return { card, text };
  }
  let result = build();
  // Large upstream strings must not turn a valid reminder into a rejected card.
  // Keep complete totals and disclose omitted rows; the authenticated board has all tasks.
  while (byteLength(result.card) > MAX_CARD_BYTES && selected.length) { selected.pop(); result = build(); }
  return { message: { msg_type: 'interactive', content: result.card }, text: result.text, total, urgent, overdue };
}

export function encodeDeliveryMessage(message) { return PAYLOAD_PREFIX + JSON.stringify(message); }
export function decodeDeliveryMessage(payload) {
  if (!payload.startsWith('IQC_MESSAGE_')) return { msg_type: 'text', content: { text: payload } };
  try {
    if (!payload.startsWith(PAYLOAD_PREFIX)) throw new Error();
    const message = JSON.parse(payload.slice(PAYLOAD_PREFIX.length));
    if (message?.msg_type !== 'interactive' || message.content?.schema !== '2.0' || !Array.isArray(message.content.body?.elements)) throw new Error();
    return message;
  } catch { throw Object.assign(new Error('MESSAGE_PAYLOAD_INVALID'), { code: 'MESSAGE_PAYLOAD_INVALID' }); }
}
