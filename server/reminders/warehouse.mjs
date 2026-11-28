import { randomUUID } from 'node:crypto';
import { queryQms, listReminderFactories, localDate } from '../pending-inspections.mjs';
import { isFinalInspection } from '../quality.mjs';
import { readSettings, credentialKey, digest, encrypt, decrypt, ReminderError } from './store.mjs';
import { createFeishuClient } from './feishu.mjs';
import { encodeDeliveryMessage, decodeDeliveryMessage } from './message.mjs';
const epoch = clock => Math.floor(clock()/1000);
const safe = (value, max=100) => [...String(value ?? '').replace(/[\x00-\x1f\x7f]/g,' ').replace(/[<>&]/g,'')].slice(0,max).join('');
const signature = row => digest(JSON.stringify([row.syncInspectionResultName,row.doneDate,row.materialNumber,row.qty]));
export async function readWarehouseSettings(env) {
  const config=await env.REMINDER_DB.prepare('SELECT * FROM warehouse_settings WHERE id=1').first();
  const recipients=(await env.REMINDER_DB.prepare('SELECT * FROM warehouse_recipients ORDER BY recipient_name,id').all()).results;
  return {...config,recipients};
}
export function publicWarehouseSettings(config) {
  return {enabled:Boolean(config.enabled),factoryCode:config.factory_code,recipientName:config.recipient_name,openId:config.open_id,revision:config.revision,
    baselineAt:config.baseline_at,lastSuccessAt:config.last_success_at,lastCheckedAt:config.last_checked_at,lastError:config.last_error,results:'per_recipient',
    recipients:config.recipients.map(row=>({id:row.id,factoryCode:row.factory_code,openId:row.open_id,name:row.recipient_name,enabled:Boolean(row.enabled),events:JSON.parse(row.result_events),revision:row.revision,baselineAt:row.baseline_at}))};
}
export async function saveWarehouseRecipient(env,body,name,time) {
  if(!['save','remove'].includes(body.operation))throw new ReminderError('INVALID_RECIPIENTS');
  const old=body.id?await env.REMINDER_DB.prepare('SELECT * FROM warehouse_recipients WHERE id=?').bind(body.id).first():null;
  if(body.id&&(!old||old.revision!==body.revision))throw new ReminderError('SETTINGS_CHANGED',409);
  if(body.operation==='remove'){
    if(!old)throw new ReminderError('INVALID_RECIPIENTS');
    const result=await env.REMINDER_DB.prepare('DELETE FROM warehouse_recipients WHERE id=? AND revision=?').bind(old.id,old.revision).run();
    if(!result.meta?.changes)throw new ReminderError('SETTINGS_CHANGED',409);
    return publicWarehouseSettings(await readWarehouseSettings(env));
  }
  if(body.factoryCode!=='STTH'||typeof body.enabled!=='boolean'||typeof name!=='string'||!name.trim()||name.length>160||!/^ou_[A-Za-z0-9_-]{4,124}$/.test(body.openId||'')||
    !Array.isArray(body.events)||body.events.some(value=>!['合格','特采','退货'].includes(value))||new Set(body.events).size!==body.events.length||body.enabled&&!body.events.length)throw new ReminderError('INVALID_RECIPIENTS');
  const bot=await readSettings(env);if(!bot.appSecret||bot.verified_key!==credentialKey(bot.app_id,bot.appSecret))throw new ReminderError('VERIFY_BEFORE_ENABLING');
  const duplicate=await env.REMINDER_DB.prepare('SELECT id FROM warehouse_recipients WHERE factory_code=? AND open_id=? AND id<>?').bind(body.factoryCode,body.openId,old?.id||'').first();
  if(duplicate)throw new ReminderError('DUPLICATE_RECIPIENT',409);
  const id=old?.id||randomUUID(),reset=!old||!old.enabled||old.open_id!==body.openId||old.app_id!==bot.app_id;
  let result;
  if(old)result=await env.REMINDER_DB.prepare(`UPDATE warehouse_recipients SET open_id=?,recipient_name=?,enabled=?,result_events=?,app_id=?,revision=revision+1,
    enabled_at=CASE WHEN ? THEN ? ELSE enabled_at END,baseline_at=CASE WHEN ? THEN 0 ELSE baseline_at END,last_success_at=CASE WHEN ? THEN 0 ELSE last_success_at END
    WHERE id=? AND revision=?`).bind(body.openId,name.trim(),Number(body.enabled),JSON.stringify(body.events),bot.app_id,Number(reset),time,Number(reset),Number(reset),old.id,old.revision).run();
  else result=await env.REMINDER_DB.prepare(`INSERT INTO warehouse_recipients(id,factory_code,app_id,open_id,recipient_name,enabled,result_events,enabled_at)
    SELECT ?,'STTH',?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM warehouse_recipients)<20`).bind(id,bot.app_id,body.openId,name.trim(),Number(body.enabled),JSON.stringify(body.events),time).run();
  if(!result.meta?.changes)throw new ReminderError(old?'SETTINGS_CHANGED':'RECIPIENT_LIMIT',409);
  return publicWarehouseSettings(await readWarehouseSettings(env));
}
export async function saveWarehouseSettings(env,body,time) {
  const old=await readWarehouseSettings(env),bot=await readSettings(env);
  if(body.revision!==old.revision)throw new ReminderError('SETTINGS_CHANGED',409);
  if(typeof body.enabled!=='boolean'||body.factoryCode!=='STTH')throw new ReminderError('INVALID_RECIPIENTS');
  if(body.enabled&&(!bot.appSecret||bot.verified_key!==credentialKey(bot.app_id,bot.appSecret)))throw new ReminderError('VERIFY_BEFORE_ENABLING');
  const reset=!old.enabled||old.app_id!==bot.app_id,nonce=randomUUID();
  // Keep old open browser tabs compatible, with the recipient and master switch
  // committed in the same CAS batch. A stale form cannot partly change a person.
  const compatibility=[];
  if(body.openId!==undefined){
    if(!/^ou_[A-Za-z0-9_-]{4,124}$/.test(body.openId||'')||typeof body.recipientName!=='string'||!body.recipientName.trim()||body.recipientName.length>160)throw new ReminderError('INVALID_RECIPIENTS');
    const recipient=old.recipients.find(row=>row.open_id===old.open_id),id=recipient?.id||randomUUID();
    if(old.recipients.some(row=>row.open_id===body.openId&&row.id!==id))throw new ReminderError('DUPLICATE_RECIPIENT',409);
    const recipientReset=!recipient||!recipient.enabled||recipient.open_id!==body.openId||recipient.app_id!==bot.app_id;
    if(recipient)compatibility.push(env.REMINDER_DB.prepare(`UPDATE warehouse_recipients SET open_id=?,recipient_name=?,enabled=1,result_events='["合格","特采","退货"]',app_id=?,revision=revision+1,
      enabled_at=CASE WHEN ? THEN ? ELSE enabled_at END,baseline_at=CASE WHEN ? THEN 0 ELSE baseline_at END,last_success_at=CASE WHEN ? THEN 0 ELSE last_success_at END
      WHERE id=? AND EXISTS(SELECT 1 FROM warehouse_role_control WHERE write_nonce=?)`).bind(body.openId,body.recipientName.trim(),bot.app_id,Number(recipientReset),time,Number(recipientReset),Number(recipientReset),id,nonce));
    else compatibility.push(env.REMINDER_DB.prepare(`INSERT INTO warehouse_recipients(id,factory_code,app_id,open_id,recipient_name,enabled,enabled_at)
      SELECT ?,'STTH',?,?,?,1,? WHERE EXISTS(SELECT 1 FROM warehouse_role_control WHERE write_nonce=?)`).bind(id,bot.app_id,body.openId,body.recipientName.trim(),time,nonce));
  }
  const result=await env.REMINDER_DB.batch([
    env.REMINDER_DB.prepare('UPDATE warehouse_role_control SET write_nonce=? WHERE id=1 AND EXISTS(SELECT 1 FROM warehouse_settings WHERE revision=?)').bind(nonce,old.revision),
    ...compatibility,
    env.REMINDER_DB.prepare(`UPDATE warehouse_settings SET enabled=?,app_id=?,revision=revision+1,last_error='',
      open_id=?,recipient_name=?,enabled_at=CASE WHEN ? THEN ? ELSE enabled_at END,baseline_at=CASE WHEN ? THEN 0 ELSE baseline_at END,last_success_at=CASE WHEN ? THEN 0 ELSE last_success_at END
      WHERE id=1 AND revision=? AND EXISTS(SELECT 1 FROM warehouse_role_control WHERE write_nonce=?)`).bind(Number(body.enabled),bot.app_id,body.openId??old.open_id,body.recipientName??old.recipient_name,Number(reset),time,Number(reset),Number(reset),old.revision,nonce),
    env.REMINDER_DB.prepare(`UPDATE warehouse_recipients SET baseline_at=0,last_success_at=0,enabled_at=? WHERE ? AND EXISTS(SELECT 1 FROM warehouse_role_control WHERE write_nonce=?)`).bind(time,Number(reset),nonce)
  ]);
  if(!result[1+compatibility.length].meta?.changes)throw new ReminderError('SETTINGS_CHANGED',409);
  return publicWarehouseSettings(await readWarehouseSettings(env));
}
export async function loadCompletedInspections(env,config,instant) {
  const budget={used:0,limit:12},options={budget,retries:0};
  const factories=await listReminderFactories(env,options),factory=factories.find(row=>row.code===config.factory_code);
  if(!factory)throw new ReminderError('FACTORY_UNAVAILABLE',503);
  const from=Math.max(config.enabled_at,(config.last_success_at||config.enabled_at)-2*86400),start=localDate(from*1000,'Asia/Bangkok'),end=localDate(instant,'Asia/Bangkok');
  const merged=new Map();
  for(const status of ['1','3']){
    let totalExpected;const rows=[],seen=new Set();
    for(let page=1;page<=10;page++){
      const data=await queryQms(env,'/qmsSupplierQuality/iqc/documents/selectPage',{pageSize:'2000',pageNum:String(page),sort:'done_date',order:'desc',
        'searchParams[factoryCode]':config.factory_code,'searchParams[inspectionStatus]':status,'searchParams[doneDateStart]':start,'searchParams[doneDateEnd]':end},options);
      const total=Number(data?.total),batch=data?.resultData;
      if(data?.total==null||!Number.isSafeInteger(total)||total<0||total>1000||!Array.isArray(batch)||totalExpected!==undefined&&total!==totalExpected)throw new ReminderError('QMS_INVALID_PAGE',503);
      totalExpected=total;
      for(const row of batch){
        if(typeof row?.orderNumber!=='string'||!row.orderNumber||seen.has(row.orderNumber))throw new ReminderError('QMS_INVALID_PAGE',503);
        seen.add(row.orderNumber);
        if(row.factoryCode&&row.factoryCode!==config.factory_code||![factory.name,'泰国协创','协创泰国','SHARETRONIC Thailand'].includes(row.factoryName)||row.doneDate<start||row.doneDate>end)throw new ReminderError('FACTORY_DATA_MISMATCH',503);
        rows.push(row);
      }
      if(rows.length>total||!batch.length&&rows.length<total)throw new ReminderError('QMS_INCOMPLETE_PAGE',503);
      if(rows.length===total)break;if(page===10)throw new ReminderError('QMS_PAGE_LIMIT',503);
    }
    for(const row of rows)merged.set(row.orderNumber,row);
  }
  return [...merged.values()].filter(isFinalInspection).sort((a,b)=>a.orderNumber.localeCompare(b.orderNumber));
}
export function warehouseMessage(rows,{test=false,recipientName=''}={}) {
  const plain=content=>({tag:'div',text:{tag:'plain_text',content}}),resultNames={'合格':'ผ่าน','特采':'ยอมรับเป็นกรณีพิเศษ','退货':'ไม่ผ่าน / คืนสินค้า'};
  const title=(test?'模拟测试 / ทดสอบจำลอง · ':'')+'IQC 检验完成通知 / แจ้งผลตรวจวัสดุเสร็จสิ้น';
  const instructions={'合格':'请按仓库流程办理入库。\nโปรดดำเนินการรับเข้าตามขั้นตอนคลังสินค้า','特采':'请核实特采审批及附加条件后按授权处理。\nตรวจสอบการอนุมัติและเงื่อนไขการยอมรับพิเศษก่อนดำเนินการ','退货':'请隔离物料，按质量处理流程执行，勿按合格品入库。\nโปรดแยกกักวัสดุและดำเนินการตามขั้นตอนคุณภาพ ห้ามรับเข้าเป็นสินค้าผ่าน'};
  const elements=[plain('仓管 / ผู้รับผิดชอบคลัง：'+safe(recipientName)),plain('SHARETRONIC Thailand · '+rows.length+' 批 / ล็อต'),
    ...(test?[plain('仅为模拟测试，无需执行真实入库。\nทดสอบจำลองเท่านั้น ไม่ต้องรับเข้าจริง')]:[])];
  for(const row of rows)elements.push(plain(`单号 / เลขที่เอกสาร：${safe(row.orderNumber,80)}\n料号 / รหัสวัสดุ：${safe(row.materialNumber,80)}\n物料 / วัสดุ：${safe(row.materialName)}\n数量 / จำนวน：${safe(row.qty,30)}\n结果 / ผลตรวจ：${safe(row.syncInspectionResultName)} / ${resultNames[row.syncInspectionResultName]}\n完成日期 / วันที่เสร็จ：${safe(row.doneDate,10)}\n${instructions[row.syncInspectionResultName]}`));
  elements.push({tag:'button',text:{tag:'plain_text',content:'查看检验记录 / ดูบันทึกการตรวจ'},type:'primary',behaviors:[{type:'open_url',default_url:'https://iqc.namecheap.xin/#overview'}]});
  return {msg_type:'interactive',content:{schema:'2.0',config:{enable_forward:false,summary:{content:title}},header:{template:'blue',title:{tag:'plain_text',content:title}},body:{elements}}};
}
export async function runWarehouseCycle(env,{clock=()=>Date.now(),fetchImpl=fetch,config}={}) {
  const db=env.REMINDER_DB,result={sent:0,failed:0,baseline:false};let owner;
  try {
    config=config||await readWarehouseSettings(env);const time=epoch(clock);
    if(!config?.enabled){
      await db.prepare(`UPDATE warehouse_role_deliveries SET status=CASE WHEN uncertain=1 THEN 'uncertain' ELSE 'cancelled' END,payload='',error_code='SETTINGS_CHANGED' WHERE status IN ('pending','retry','sending') AND lease_until<=?`).bind(time).run();
      return {...result,disabled:true};
    }
    owner=randomUUID();
    const locked=await db.prepare('UPDATE warehouse_settings SET lease_owner=?,lease_until=? WHERE id=1 AND enabled=1 AND revision=? AND lease_until<=? RETURNING id').bind(owner,time+180,config.revision,time).first();
    if(!locked){owner='';return {...result,busy:true};}
    const bot=await readSettings(env);
    if(config.app_id!==bot.app_id||!bot.appSecret||bot.verified_key!==credentialKey(bot.app_id,bot.appSecret))throw new ReminderError('CONNECTION_NOT_VERIFIED',503);
    const recipients=config.recipients.filter(row=>row.enabled&&row.app_id===bot.app_id&&row.factory_code===config.factory_code);
    const rows=recipients.length?await loadCompletedInspections(env,config,new Date(clock())):[];
    const byOrder=new Map(rows.map(row=>[row.orderNumber,row]));
    const prior=(await db.prepare('SELECT * FROM warehouse_role_observations WHERE recipient_id IN(SELECT value FROM json_each(?)) AND order_number IN(SELECT value FROM json_each(?))')
      .bind(JSON.stringify(recipients.map(row=>row.id)),JSON.stringify(rows.map(row=>row.orderNumber))).all()).results;
    const known=new Map(prior.map(row=>[row.recipient_id+'\n'+row.order_number,row])),statements=[];
    for(const recipient of recipients){
      const events=JSON.parse(recipient.result_events);
      const detected=rows.filter(row=>known.get(recipient.id+'\n'+row.orderNumber)?.signature!==signature(row));
      const fresh=recipient.baseline_at?detected.slice(0,20):detected,selected=fresh.filter(row=>events.includes(row.syncInspectionResultName));
      const guard='EXISTS(SELECT 1 FROM warehouse_settings WHERE enabled=1 AND revision=? AND lease_owner=?) AND EXISTS(SELECT 1 FROM warehouse_recipients WHERE id=? AND revision=? AND enabled=1)';
      const guardValues=[config.revision,owner,recipient.id,recipient.revision];
      if(recipient.baseline_at)for(let i=0;i<selected.length;i+=10){
        const batch=selected.slice(i,i+10),id=randomUUID(),scope=batch.map(row=>({order:row.orderNumber,signature:signature(row)}));
        statements.push(db.prepare(`INSERT INTO warehouse_role_deliveries(id,recipient_id,recipient_revision,config_revision,app_id,open_id,recipient_name,total,scope,payload,created_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(id,recipient.id,recipient.revision,config.revision,bot.app_id,recipient.open_id,recipient.recipient_name,batch.length,JSON.stringify(scope),
          encrypt(env,encodeDeliveryMessage(warehouseMessage(batch,{recipientName:recipient.recipient_name}))),time,...guardValues));
      }
      const updates=fresh.map(row=>({order:row.orderNumber,signature:signature(row),version:(known.get(recipient.id+'\n'+row.orderNumber)?.version||0)+1}));
      statements.push(db.prepare(`INSERT INTO warehouse_role_observations(recipient_id,order_number,signature,version,last_seen_at)
        SELECT ?,json_extract(value,'$.order'),json_extract(value,'$.signature'),json_extract(value,'$.version'),? FROM json_each(?) WHERE ${guard}
        ON CONFLICT(recipient_id,order_number) DO UPDATE SET signature=excluded.signature,version=excluded.version,last_seen_at=excluded.last_seen_at`).bind(recipient.id,time,JSON.stringify(updates),...guardValues));
      statements.push(db.prepare(`UPDATE warehouse_recipients SET baseline_at=CASE WHEN baseline_at=0 THEN ? ELSE baseline_at END,last_success_at=?
        WHERE id=? AND revision=? AND ${guard}`).bind(time,time,recipient.id,recipient.revision,...guardValues));
      if(!recipient.baseline_at)result.baseline=true;
    }
    statements.push(db.prepare(`UPDATE warehouse_settings SET baseline_at=CASE WHEN baseline_at=0 THEN ? ELSE baseline_at END,last_success_at=?,last_checked_at=?,last_error='' WHERE id=1 AND enabled=1 AND revision=? AND lease_owner=?`).bind(time,time,time,config.revision,owner));
    await db.batch(statements);
    await db.batch([
      db.prepare(`UPDATE warehouse_role_deliveries SET status=CASE WHEN uncertain=1 THEN 'uncertain' ELSE 'cancelled' END,payload='',error_code='SETTINGS_CHANGED'
        WHERE status IN ('pending','retry','sending') AND lease_until<=? AND (config_revision<>? OR app_id<>? OR NOT EXISTS(SELECT 1 FROM warehouse_recipients r
          WHERE r.id=recipient_id AND r.revision=recipient_revision AND r.enabled=1))`).bind(time,config.revision,bot.app_id),
      db.prepare(`UPDATE warehouse_role_deliveries SET status=CASE WHEN uncertain=1 THEN 'uncertain' ELSE 'failed' END,payload='',error_code='RETRY_WINDOW_ENDED' WHERE status IN ('retry','sending') AND lease_until<=? AND (attempts>=6 OR first_attempt_at<?)`).bind(time,time-3300),
      db.prepare('DELETE FROM warehouse_role_deliveries WHERE created_at<?').bind(time-90*86400)
    ]);
    const jobs=(await db.prepare(`SELECT * FROM warehouse_role_deliveries WHERE status IN ('pending','retry','sending') AND config_revision=? AND app_id=? AND lease_until<=? AND next_attempt_at<=?
      ORDER BY created_at,id LIMIT 2`).bind(config.revision,bot.app_id,time,time).all()).results;
    const client=createFeishuClient(bot.app_id,bot.appSecret,{fetchImpl,now:clock});
    for(const job of jobs){
      const recipient=recipients.find(row=>row.id===job.recipient_id&&row.revision===job.recipient_revision);if(!recipient)continue;
      let payload=job.payload,total=job.total;
      if(!job.attempts){
        const selected=JSON.parse(job.scope).filter(item=>byOrder.has(item.order)&&signature(byOrder.get(item.order))===item.signature&&JSON.parse(recipient.result_events).includes(byOrder.get(item.order).syncInspectionResultName)).map(item=>byOrder.get(item.order));
        if(!selected.length){await db.prepare(`UPDATE warehouse_role_deliveries SET status='cancelled',payload='' WHERE id=? AND attempts=0`).bind(job.id).run();continue;}
        total=selected.length;payload=encrypt(env,encodeDeliveryMessage(warehouseMessage(selected,{recipientName:recipient.recipient_name})));
      }
      const sendTime=epoch(clock),claimed=await db.prepare(`UPDATE warehouse_role_deliveries SET status='sending',attempts=attempts+1,lease_until=?,payload=?,total=?,first_attempt_at=CASE WHEN first_attempt_at=0 THEN ? ELSE first_attempt_at END
        WHERE id=? AND status IN ('pending','retry','sending') AND lease_until<=? AND attempts<6 AND (first_attempt_at=0 OR first_attempt_at>=?)
        AND EXISTS(SELECT 1 FROM warehouse_settings WHERE enabled=1 AND revision=? AND lease_owner=?)
        AND EXISTS(SELECT 1 FROM warehouse_recipients WHERE id=? AND revision=? AND enabled=1)
        AND EXISTS(SELECT 1 FROM reminder_settings WHERE app_id=? AND verified_key=?) RETURNING *`)
        .bind(sendTime+120,payload,total,sendTime,job.id,sendTime,sendTime-3300,config.revision,owner,recipient.id,recipient.revision,bot.app_id,bot.verified_key).first();
      if(!claimed)continue;
      try {
        const messageId=await client.send(job.open_id,decodeDeliveryMessage(decrypt(env,claimed.payload)),job.id);
        await db.prepare(`UPDATE warehouse_role_deliveries SET status='sent',sent_at=?,message_id=?,payload='',lease_until=0,error_code='' WHERE id=?`).bind(epoch(clock),messageId,job.id).run();result.sent++;
      }catch(error){
        const uncertain=Boolean(claimed.uncertain||error.uncertain||!error.code),retry=Boolean((error.retryable||!error.code)&&claimed.attempts<6&&epoch(clock)-claimed.first_attempt_at<3300);
        await db.prepare(`UPDATE warehouse_role_deliveries SET status=?,uncertain=?,next_attempt_at=?,lease_until=0,error_code=?,payload=CASE WHEN ? THEN payload ELSE '' END WHERE id=? AND status='sending'`)
          .bind(retry?'retry':uncertain?'uncertain':'failed',Number(uncertain),epoch(clock)+Math.min(600,60*2**(claimed.attempts-1)),error.code||'DELIVERY_STATE_ERROR',Number(retry),job.id).run();result.failed++;
      }
    }
    return result;
  }catch(error){
    const code=error.code||'WAREHOUSE_SERVICE_ERROR';try{await db.prepare('UPDATE warehouse_settings SET last_checked_at=?,last_error=? WHERE id=1').bind(epoch(clock),code).run();}catch{}
    return {...result,error:code};
  }finally{if(owner)await db.prepare(`UPDATE warehouse_settings SET lease_owner='',lease_until=0 WHERE id=1 AND lease_owner=?`).bind(owner).run();}
}
