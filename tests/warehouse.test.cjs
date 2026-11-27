const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');
const modules=Promise.all([import('./auth-fixture.mjs'),import('../server/reminders/store.mjs'),import('../server/reminders/warehouse.mjs')]);let serial=0;
async function fixture(t){
  const [{database},store,warehouse]=await modules,db=database(':memory:',new URL('../server/reminders/schema.sql','file://'+__filename.replaceAll('\\','/')));t.after(()=>db.close());
  let instant=Date.parse('2026-11-27T03:00:00Z');const state={db,rows:[],messages:[],accepted:new Map(),queries:[],clock:()=>instant,advance:seconds=>{instant+=seconds*1000;}};
  const env={REMINDER_DB:db,REMINDER_ENCRYPTION_KEY:randomBytes(32).toString('base64'),QMS_PROXY:{async fetch(request){const body=await request.json();state.queries.push(body);
    if(body.path.endsWith('/factory'))return Response.json({status:200,data:[{code:'STTH',name:'泰国协创'}]});
    if(state.failQms&&body.query['searchParams[inspectionStatus]']==='3')return new Response(null,{status:503});
    if(state.onQuery)await state.onQuery();const rows=state.rows.filter(row=>row.inspectionStatus===body.query['searchParams[inspectionStatus]']);
    return Response.json({status:200,data:{total:rows.length,resultData:rows}});}}};state.env=env;
  const appId='cli_warehouse_test_'+ ++serial,secret='Synthetic_warehouse_secret_only_123';
  await store.saveSettings(env,{revision:0,appId,appSecret:secret,enabled:false,factories:[],dailyStart:'00:00',recipients:[]},'fixture',[{code:'STTH'}],Math.floor(instant/1000));
  await db.prepare('UPDATE reminder_settings SET verified_key=? WHERE id=1').bind(store.credentialKey(appId,secret)).run();
  state.fetchImpl=async(url,init)=>{assert.equal(new URL(url).hostname,'open.feishu.cn');assert.equal(init.redirect,'manual');const body=JSON.parse(init.body);
    if(url.includes('tenant_access_token'))return Response.json({code:0,tenant_access_token:'synthetic',expire:7200});
    if(state.reject)return Response.json({code:230001,msg:'private error'});
    state.messages.push(body);state.accepted.set(body.uuid,body);if(state.dropAck){state.dropAck=false;throw new Error('accepted, connection dropped');}
    return Response.json({code:0,data:{message_id:'om_'+body.uuid}});};
  state.enable=async()=>{const settings=await warehouse.readWarehouseSettings(env);return warehouse.saveWarehouseSettings(env,{revision:settings.revision,enabled:true,factoryCode:'STTH',recipientName:'Warehouse fixture',openId:'ou_warehouse_fixture'},Math.floor(instant/1000));};
  state.run=()=>warehouse.runWarehouseCycle(env,{clock:state.clock,fetchImpl:state.fetchImpl});return state;
}
const row=(order,result='合格',extra={})=>({orderNumber:order,materialNumber:'MAT-'+order,materialName:'Synthetic material',qty:10,doneDate:'2026-11-27',inspectionStatus:'1',taskKey:'close',syncInspectionResultName:result,factoryName:'泰国协创',...extra});
test('first activation baselines history; new final results reach only the warehouse without an open website',async t=>{
  const f=await fixture(t);f.rows=[row('OLD')];await f.enable();assert.equal((await f.run()).baseline,true);assert.equal(f.messages.length,0);
  f.advance(60);f.rows.push(row('PASS'),row('SPECIAL','特采'),row('FAIL','退货'),row('PENDING','合格',{taskKey:'audit_leader'}));
  assert.equal((await f.run()).sent,1);assert.equal(f.messages[0].receive_id,'ou_warehouse_fixture');assert.equal(f.messages[0].msg_type,'interactive');
  const card=f.messages[0].content;for(const term of ['PASS','SPECIAL','FAIL','ยอมรับ','ไม่ผ่าน'])assert.ok(card.includes(term));assert.ok(!card.includes('MAT-OLD'));assert.ok(!card.includes('MAT-PENDING'));
  f.advance(60);await f.run();assert.equal(f.messages.length,1);
});
test('final-state checks ignore unfinished results, cancellations and missing final results',async t=>{
  const f=await fixture(t);await f.enable();await f.run();f.advance(60);
  f.rows=[row('REVIEW','特采',{taskKey:'mrb'}),row('CANCEL','合格',{taskKey:'cancel'}),row('EMPTY','')];await f.run();assert.equal(f.messages.length,0);
  f.rows=[row('DONE','退货',{inspectionStatus:'3'})];await f.run();assert.equal(f.messages.length,1);
});
test('result corrections create one new notification; an unchanged poll cannot resend it',async t=>{
  const f=await fixture(t);await f.enable();await f.run();f.rows=[row('CHANGE')];f.advance(60);await f.run();
  f.rows[0].syncInspectionResultName='退货';f.advance(60);await f.run();f.advance(60);await f.run();assert.equal(f.messages.length,2);
  assert.notEqual(f.messages[0].uuid,f.messages[1].uuid);
});
test('partial QMS failure or foreign-factory records never advance baseline or send messages',async t=>{
  const f=await fixture(t);await f.enable();f.rows=[row('FOREIGN','合格',{factoryName:'东莞协创'})];assert.ok((await f.run()).error);assert.equal((await f.db.prepare('SELECT baseline_at FROM warehouse_settings').first()).baseline_at,0);
  f.rows=[row('INCOMPLETE')];f.failQms=true;assert.ok((await f.run()).error);assert.equal(f.messages.length,0);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM warehouse_observations').first()).n,0);
});
test('parallel checks lease a single delivery and a lost acknowledgement retries an immutable UUID',async t=>{
  const f=await fixture(t);await f.enable();await f.run();f.rows=[row('NEW')];f.advance(60);f.dropAck=true;
  await Promise.all([f.run(),f.run()]);assert.equal(f.messages.length,1);const first=f.messages[0];
  f.advance(60);await f.run();assert.equal(f.messages.length,2);assert.deepEqual(f.messages[1],first);assert.equal(f.accepted.size,1);
  assert.equal((await f.db.prepare('SELECT status FROM warehouse_deliveries').first()).status,'sent');
});
test('an uncertain send cannot retry beyond the Feishu deduplication window',async t=>{
  const f=await fixture(t);await f.enable();await f.run();f.rows=[row('UNKNOWN')];f.advance(60);f.dropAck=true;await f.run();f.advance(3600);await f.run();
  assert.equal(f.messages.length,1);assert.equal((await f.db.prepare('SELECT status FROM warehouse_deliveries').first()).status,'uncertain');
});
test('disabling during QMS reading prevents the first warehouse message',async t=>{
  const f=await fixture(t);await f.enable();await f.run();f.rows=[row('STOP')];f.advance(60);let changed=false;
  f.onQuery=async()=>{if(changed)return;changed=true;const [,,w]=await modules;const s=await w.readWarehouseSettings(f.env);await w.saveWarehouseSettings(f.env,{revision:s.revision,enabled:false,factoryCode:'STTH',recipientName:s.recipient_name,openId:s.open_id},Math.floor(f.clock()/1000));};
  await f.run();assert.equal(f.messages.length,0);
});
test('larger arrivals drain in bounded groups without duplicate or lost completions',async t=>{
  const f=await fixture(t);await f.enable();await f.run();f.rows=Array.from({length:45},(_,i)=>row('BULK-'+String(i).padStart(2,'0')));
  for(let i=0;i<4;i++){f.advance(60);await f.run();}assert.equal(f.messages.length,5);assert.equal(f.accepted.size,5);
  const delivered=await f.db.prepare("SELECT SUM(total) n FROM warehouse_deliveries WHERE status='sent'").first();assert.equal(delivered.n,45);
});
test('warehouse cards use plain text and cannot inject mentions, markup or instructions',async()=>{
  const [,,{warehouseMessage}]=await modules;const card=warehouseMessage([row('<at id="all">x</at>','特采',{materialName:'<script>alert(1)</script>'})],{recipientName:'Warehouse',test:true});
  const json=JSON.stringify(card);assert.ok(json.includes('模拟测试'));assert.ok(json.includes('ทดสอบจำลอง'));assert.ok(!json.includes('<at'));assert.ok(!json.includes('<script>'));assert.ok(json.includes('审批'));assert.ok(Buffer.byteLength(json)<28*1024);
});
test('the real scheduled entrypoint runs inspector and warehouse queues within a bounded D1 call budget',async t=>{
  const f=await fixture(t);await f.enable();await f.run();const [,store]=await modules,bot=await store.readSettings(f.env);
  await store.saveSettings(f.env,{revision:bot.revision,appId:bot.app_id,enabled:true,factories:['STTH'],dailyStart:'00:00',recipients:Array.from({length:6},(_,i)=>({factory_code:'STTH',inspector_name:'Inspector'+i,open_id:'ou_inspector_'+i}))},'fixture',[{code:'STTH'}],Math.floor(f.clock()/1000));
  f.rows=[...Array.from({length:20},(_,i)=>row('DONE-'+i)),...Array.from({length:6},(_,i)=>row('ACTIVE-'+i,'',{inspectionStatus:'0',taskKey:'inspect',inspectorName:'Inspector'+i,createDate:'2026-11-27'}))];f.advance(60);
  let calls=0;const prepare=f.db.prepare,batch=f.db.batch;
  const wrap=s=>({...s,bind(...args){return wrap(s.bind(...args));},async first(...args){calls++;return s.first(...args);},async all(...args){calls++;return s.all(...args);},async run(...args){calls++;return s.run(...args);}});
  f.db.prepare=sql=>wrap(prepare(sql));f.db.batch=async statements=>{calls++;return batch(statements);};
  const {createReminderWorker}=await import('../server/reminders/worker.mjs');const worker=createReminderWorker({clock:f.clock,fetchImpl:f.fetchImpl});await worker.scheduled({},f.env);
  assert.equal(f.messages.length,8);assert.ok(calls<=50,'D1 calls: '+calls);assert.ok(f.queries.length<=12,'QMS calls: '+f.queries.length);
});
