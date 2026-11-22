(async () => {
  const runtime = window.IQC_RUNTIME, trigger = document.getElementById('urgentNotifyButton');
  if (!runtime?.authentication || runtime.user?.role !== 'admin' || !trigger) return;
  const { authError } = await import('/auth/errors.js');
  const copy = {
    zh: { title: '急料检验通知', intro: '核对当前工厂仍未完成的加急任务，按检验员合并发送中泰双语飞书卡片。', loading: '正在核对任务和收件人…', empty: '当前没有已绑定检验员的待检急料。', unmapped: '以下待检急料尚未绑定飞书账号，不会发送：', lots: '批', people: '位检验员', send: '确认通知', close: '关闭', refresh: '重新核对', retry: '核对发送结果', sent: '已发送', queued: '后台待发送', failed: '失败或需核对', network: '请求结果尚未确认，请核对发送结果；同一次通知不会重复发送。', failedRequest: '操作失败，请稍后重试。', URGENT_PREVIEW_EXPIRED: '预览已过期，请重新核对。', URGENT_TASKS_CHANGED: '任务或人员配置已变化，请重新核对。', URGENT_COOLDOWN: '刚刚已提交该工厂的急料通知，请稍后再试。', NO_URGENT_RECIPIENTS: '没有可通知的已绑定检验员。', CONNECTION_NOT_VERIFIED: '请先在机器人提醒中验证飞书连接。', QMS: '待检数据暂时不可用，本次没有新建通知。' },
    en: { title: 'Urgent inspection notice', intro: 'Review unfinished urgent tasks at the current factory. Each inspector receives one Chinese–Thai Feishu card.', loading: 'Checking tasks and recipients…', empty: 'No pending urgent tasks have a mapped inspector.', unmapped: 'These urgent tasks have no Feishu mapping and will not be sent:', lots: 'lots', people: 'inspectors', send: 'Confirm notification', close: 'Close', refresh: 'Review again', retry: 'Check sending result', sent: 'Sent', queued: 'Queued in background', failed: 'Failed or needs review', network: 'The result is not confirmed. Check the sending result; this request will not send twice.', failedRequest: 'Request failed. Try again later.', URGENT_PREVIEW_EXPIRED: 'The preview expired. Review again.', URGENT_TASKS_CHANGED: 'Tasks or recipients changed. Review again.', URGENT_COOLDOWN: 'An urgent notice was just submitted for this factory. Try again shortly.', NO_URGENT_RECIPIENTS: 'No mapped inspectors can be notified.', CONNECTION_NOT_VERIFIED: 'Verify the Feishu connection in Bot reminders first.', QMS: 'Pending data is unavailable. No new notice was created.' },
    th: { title: 'แจ้งตรวจวัสดุเร่งด่วน', intro: 'ตรวจสอบงานเร่งด่วนที่ยังไม่เสร็จของโรงงานปัจจุบัน ผู้ตรวจแต่ละคนจะได้รับการ์ด Feishu ภาษาจีน–ไทยหนึ่งใบ', loading: 'กำลังตรวจสอบงานและผู้รับ…', empty: 'ไม่มีงานเร่งด่วนรอตรวจที่ผูกบัญชีผู้ตรวจแล้ว', unmapped: 'งานเร่งด่วนต่อไปนี้ยังไม่ผูกบัญชี Feishu จึงจะไม่ส่ง:', lots: 'ล็อต', people: 'ผู้ตรวจ', send: 'ยืนยันแจ้งเตือน', close: 'ปิด', refresh: 'ตรวจสอบอีกครั้ง', retry: 'ตรวจสอบผลการส่ง', sent: 'ส่งแล้ว', queued: 'รอส่งเบื้องหลัง', failed: 'ล้มเหลวหรือต้องตรวจสอบ', network: 'ยังยืนยันผลไม่ได้ โปรดตรวจสอบผลการส่ง คำขอนี้จะไม่ส่งซ้ำ', failedRequest: 'ดำเนินการไม่สำเร็จ โปรดลองอีกครั้ง', URGENT_PREVIEW_EXPIRED: 'ตัวอย่างหมดอายุ โปรดตรวจสอบอีกครั้ง', URGENT_TASKS_CHANGED: 'งานหรือผู้รับมีการเปลี่ยนแปลง โปรดตรวจสอบอีกครั้ง', URGENT_COOLDOWN: 'เพิ่งส่งคำขอแจ้งงานเร่งด่วนของโรงงานนี้ โปรดลองอีกครั้งภายหลัง', NO_URGENT_RECIPIENTS: 'ไม่มีผู้ตรวจที่ผูกบัญชีให้แจ้งเตือน', CONNECTION_NOT_VERIFIED: 'โปรดยืนยันการเชื่อมต่อ Feishu ในหน้าตั้งค่าบอตก่อน', QMS: 'ข้อมูลงานรอตรวจไม่พร้อมใช้งาน ยังไม่ได้สร้างการแจ้งเตือนใหม่' }
  };
  const locale = () => { try { return localStorage.getItem('iqc_locale') || 'zh'; } catch { return 'zh'; } };
  const t = key => { const lang = locale(); return ['mix','en-th'].includes(lang) ? (copy[lang === 'mix' ? 'zh' : 'en'][key] ? `${copy[lang === 'mix' ? 'zh' : 'en'][key]} · ${copy.th[key]}` : undefined) : (copy[lang] || copy.zh)[key]; };
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog urgent-dialog';
  dialog.innerHTML = '<h2 id="urgentTitle"></h2><p class="urgent-intro"></p><div class="urgent-preview"></div><p class="account-error" role="status"></p><div class="account-actions"><button type="button" data-urgent="close"></button><button type="button" data-urgent="refresh"></button><button type="button" data-urgent="send"></button></div>';
  dialog.setAttribute('aria-labelledby', 'urgentTitle'); document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector), status = $('[role="status"]'), send = $('[data-urgent="send"]'), refresh = $('[data-urgent="refresh"]');
  let factoryCode, preview, uncertain = false, done = false, busy = false;
  function labels() { $('#urgentTitle').textContent = t('title'); $('.urgent-intro').textContent = t('intro'); $('[data-urgent="close"]').textContent = t('close'); refresh.textContent = t('refresh'); send.textContent = t(uncertain ? 'retry' : 'send'); }
  async function post(path, body) {
    let response, data;
    try { response = await fetch('/api/admin/reminders/urgent/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': runtime.csrfToken }, body: JSON.stringify(body) }); data = await response.json(); }
    catch { throw Object.assign(new Error(t('network')), { uncertain: path === 'send' }); }
    if (response.status === 401) { window.IQCAccount?.expire(); throw new Error(t('failedRequest')); }
    if (!response.ok) throw new Error(t(data.error?.startsWith('QMS_') ? 'QMS' : data.error) || authError(data.error, locale(), t('failedRequest')));
    return data;
  }
  async function load() {
    busy = true; preview = null; uncertain = false; done = false; labels(); send.disabled = true; refresh.disabled = true; status.textContent = t('loading'); $('.urgent-preview').replaceChildren();
    try {
      preview = await post('preview', { factoryCode }); status.textContent = '';
      if (!preview.recipients.length) { const p = document.createElement('p'); p.textContent = t('empty'); $('.urgent-preview').append(p); }
      for (const entry of preview.recipients) { const p = document.createElement('p'), name = document.createElement('strong'); name.textContent = entry.names.join('、'); p.append(name, ` · ${entry.total} ${t('lots')}`); $('.urgent-preview').append(p); }
      if (preview.unmappedInspectors.length) { const p = document.createElement('p'); p.className = 'urgent-warning'; p.textContent = t('unmapped') + ' ' + preview.unmappedInspectors.map(row => `${row.name} (${row.total})`).join('、'); $('.urgent-preview').append(p); }
      send.disabled = !preview.total; send.textContent = `${t('send')} (${preview.recipients.length} ${t('people')})`;
    } catch (error) { status.textContent = error.message; } finally { busy = false; refresh.disabled = false; }
  }
  send.addEventListener('click', async () => {
    if (busy || done || !preview) return; busy = true; send.disabled = true; refresh.disabled = true; status.textContent = t('loading');
    try { const result = await post('send', { requestId: preview.requestId }); done = true; uncertain = false; status.textContent = `${t('sent')}: ${result.sent} · ${t('queued')}: ${result.queued} · ${t('failed')}: ${result.failed}`; }
    catch (error) { status.textContent = error.message; uncertain = Boolean(error.uncertain); send.disabled = !uncertain; }
    finally { busy = false; refresh.disabled = false; labels(); }
  });
  refresh.addEventListener('click', () => { if (!busy) load(); }); $('[data-urgent="close"]').addEventListener('click', () => dialog.close());
  window.IQCUrgent = { open(code) { if (busy) return; factoryCode = code; labels(); dialog.showModal(); load(); } };
  trigger.hidden = false; trigger.disabled = false;
})();
