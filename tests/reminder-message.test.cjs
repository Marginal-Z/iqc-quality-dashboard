const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../server/reminders/message.mjs');
const item = extra => ({ orderNumber: 'TEST-001', materialNumber: 'MAT-001', materialName: '测试材料 วัสดุทดสอบ', quantity: 120, createDate: '2026-11-12', supplierName: '测试供应商', ...extra });
const group = extra => ({ name: '虚构检验员', factoryName: '测试泰国工厂', factoryCode: 'STTH', total: 1, urgent: 0, overdue: 0, items: [item()], ...extra });

test('native card shows Chinese and Thai together, correct metrics and status, and an authenticated board action', async () => {
  const { reminderMessage } = await modulePromise;
  const result = reminderMessage([group({ total: 2, urgent: 1, overdue: 1, items: [item({ urgent: true, overdue: true }), item({ orderNumber: 'TEST-002' })] })], '2026-11-12');
  const { message } = result, card = message.content;
  assert.equal(message.msg_type, 'interactive'); assert.equal(card.schema, '2.0'); assert.equal(card.header.template, 'red');
  assert.equal(card.config.update_multi, true); assert.equal(card.config.enable_forward, false);
  assert.ok(card.header.title.content.includes('待检物料提醒 / แจ้งเตือนวัสดุรอตรวจ'));
  assert.ok(card.header.subtitle.content.includes('2026-11-12 · 泰国时间 / เวลาไทย UTC+7'));
  const columns = card.body.elements.find(el => el.tag === 'column_set').columns;
  assert.deepEqual(columns.map(col => col.elements[0].content), ['### 2\n待检\nรอตรวจ', '### 1\n加急\nเร่งด่วน', '### 1\n超时\nเกินกำหนด']);
  for (const label of ['检验员 / ผู้ตรวจสอบ', '工厂 / โรงงาน', '单号 / เลขที่เอกสาร', '料号 / รหัสวัสดุ', '物料名称 / ชื่อวัสดุ', '数量 / จำนวน', '送检日期 / วันที่ส่งตรวจ', '供应商 / ผู้จำหน่าย', '加急 / เร่งด่วน', '超时 / เกินกำหนด']) assert.ok(result.text.includes(label), label);
  assert.ok(result.text.includes('测试材料 วัสดุทดสอบ')); assert.ok(result.text.includes('每日每人首次')); assert.ok(result.text.includes('วันละครั้ง'));
  const action = card.body.elements.find(el => el.tag === 'button');
  assert.equal(action.text.content, '查看待检看板 / เปิดแดชบอร์ดงานรอตรวจ');
  assert.deepEqual(action.behaviors, [{ type: 'open_url', default_url: 'https://iqc.namecheap.xin/' }]);
  assert.equal(reminderMessage([group({ urgent: 1 })], '2026-11-12').message.content.header.template, 'orange');
  assert.equal(reminderMessage([group()], '2026-11-12').message.content.header.template, 'blue');
});

test('long multi-factory cards stay below the byte budget and disclose every omitted detail', async () => {
  const { reminderMessage, MAX_CARD_BYTES } = await modulePromise;
  const groups = Array.from({ length: 50 }, (_, i) => group({ name: '🧑'.repeat(100), factoryName: '厂'.repeat(200), factoryCode: 'F' + i, total: 2, items: [item({ orderNumber: 'ORDER-' + i, materialName: '😃'.repeat(200), supplierName: 'ก'.repeat(200) }), item()] }));
  const { message, text, total } = reminderMessage(groups, '2026-11-12'), card = message.content;
  assert.equal(total, 100); assert.ok(Buffer.byteLength(JSON.stringify(card)) <= MAX_CARD_BYTES);
  const shown = card.body.elements.filter(el => el.tag === 'div' && /^\d+\. /.test(el.text.content)).length;
  assert.ok(shown > 0 && shown <= 15); assert.ok(text.includes(`另有 ${100 - shown} 批`)); assert.ok(text.includes(`ยังมีอีก ${100 - shown} ล็อต`));
});

test('QMS content cannot inject Markdown, mentions, actions or card markup', async () => {
  const { reminderMessage } = await modulePromise;
  const hostile = '<at id=all>ALL</at> [click](https://example.invalid) **bold**\n```<script>';
  const card = reminderMessage([group({ name: hostile, factoryName: hostile, items: [item({ orderNumber: hostile, materialNumber: hostile, materialName: hostile, supplierName: hostile })] })], '2026-11-12').message.content;
  const serialized = JSON.stringify(card); assert.ok(!serialized.includes('<at')); assert.ok(!serialized.includes('<script>'));
  const metrics = card.body.elements.find(el => el.tag === 'column_set');
  assert.ok(metrics.columns.every(col => !col.elements[0].content.includes('example.invalid')));
  assert.ok(card.body.elements.filter(el => el.tag === 'div').some(el => el.text.tag === 'plain_text' && el.text.content.includes('[click]')));
  assert.equal(card.body.elements.filter(el => el.tag === 'button').length, 1);
});

test('simulation markers are bilingual and the versioned outbox fails closed on unsupported formats', async () => {
  const { reminderMessage, encodeDeliveryMessage, decodeDeliveryMessage } = await modulePromise;
  const { message, text } = reminderMessage([group()], '2026-11-12', { test: true });
  assert.ok(message.content.header.title.content.startsWith('模拟测试 / ทดสอบจำลอง'));
  assert.ok(text.includes('无需进行真实检验') && text.includes('ไม่ต้องตรวจสอบจริง'));
  assert.deepEqual(decodeDeliveryMessage(encodeDeliveryMessage(message)), message);
  assert.deepEqual(decodeDeliveryMessage('legacy reminder text'), { msg_type: 'text', content: { text: 'legacy reminder text' } });
  for (const body of ['IQC_MESSAGE_V2\n{}', 'IQC_MESSAGE_V1\ninvalid', 'IQC_MESSAGE_V1\n{"msg_type":"text"}']) assert.throws(() => decodeDeliveryMessage(body), { code: 'MESSAGE_PAYLOAD_INVALID' });
});
