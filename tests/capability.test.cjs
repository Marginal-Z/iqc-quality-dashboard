const {test}=require('node:test');const assert=require('node:assert/strict');
const modules=Promise.all([import('../server/capability.mjs'),import('../server/quality.mjs')]);
const spec={standardValue:'10',downValue:'.5',upValue:'.5',downSymbol:'-',upSymbol:'+'};
const matrix=values=>({header:[{prop:'rowName',label:'项目'},{prop:'0',label:'Width',unit:'mm'}],data:[{rowName:'Standard',0:spec},...values.map(value=>({0:value}))]});
const record={id:'doc1',orderNumber:'LOT-1',materialNumber:'MAT-1',supplierCode:'V1',createDate:'2026-11-10',doneDate:'2026-11-11',inspectionStatus:'1',taskKey:'close',syncInspectionResultName:'合格'};
function envFixture(rows=[record],alter=()=>{}){
  const calls=[];return {calls,env:{QMS_PROXY:{async fetch(request){const body=await request.json();calls.push(body);let data;
    if(body.path.endsWith('/factory'))data=[{code:'STTH',name:'泰国协创'}];
    else if(body.path.endsWith('selectPage'))data={total:rows.length,resultData:rows};
    else if(body.path.includes('documents/getById'))data={id:'doc1',materialId:'mat1',doneFlag:'1',taskKey:'close',syncInspectionResult:'1',criticalDimensionJson:JSON.stringify(matrix([9.8,9.9,10,10.1,10.2]))};
    else data={factoryCode:'STTH',materialNumber:'MAT-1',supplierCode:'V1'};
    alter(body,data);return Response.json({status:'200',data});}}}};
}
const filter={factoryCode:'STTH',materialNumber:'MAT-1',startDate:'2026-11-01',endDate:'2026-11-30'};
test('dimension parsing follows QMS reversed tolerance signs, preserves zero and rejects executable expressions',async()=>{
  const [{dimensionGroups}]=await modules;const m=matrix(['0',10]);m.data[0][0]={standardValue:'10',downSymbol:'+',downValue:'.5',upSymbol:'-',upValue:'.5'};
  const groups=dimensionGroups({criticalDimensionJson:JSON.stringify(m)},record);assert.deepEqual(groups[0].spec,{target:10,lsl:9.5,usl:10.5});assert.deepEqual(groups[0].values,[0,10]);
  m.data[0][0].downSymbol=';global.bad=true';assert.equal(dimensionGroups({criticalDimensionJson:m},record)[0].spec,null);
  m.data[0][0]=spec;m.data[1][0]='1e999';assert.equal(dimensionGroups({criticalDimensionJson:m},record)[0].invalid,1);
});
test('capability uses subgroup Rbar/d2 and distinct overall sample deviation without deleting outliers',async()=>{
  const [{dimensionGroups,analyzeCapability}]=await modules;
  const groups=[...dimensionGroups({criticalDimensionJson:matrix([9,10,11])},record),...dimensionGroups({criticalDimensionJson:matrix([10,11,12])},{...record,orderNumber:'LOT-2'})];
  const [result]=analyzeCapability(groups);assert.equal(result.n,6);assert.equal(result.mean,10.5);assert.ok(Math.abs(result.within-2/1.693)<1e-12);assert.ok(Math.abs(result.overall-Math.sqrt(1.1))<1e-12);
  assert.equal(result.cpk,0);assert.equal(result.outside,4);assert.equal(result.samples.length,6);assert.ok(result.issues.includes('smallSample'));assert.notEqual(result.within,result.overall);
});
test('suppliers, units and changed specifications never share a capability study',async()=>{
  const [{dimensionGroups,analyzeCapability}]=await modules;const groups=dimensionGroups({criticalDimensionJson:matrix([9.9,10.1])},record);
  groups.push({...groups[0],supplier:'V2'},{...groups[0],unit:'cm'},{...groups[0],spec:{target:10,lsl:8,usl:12}});
  assert.equal(analyzeCapability(groups).length,4);
});
test('missing samples, unsupported subgroups and zero variation do not produce misleading indices',async()=>{
  const [{dimensionGroups,analyzeCapability}]=await modules;
  for(const values of [[null,10],['PASS',10],[10,10],[10]]){const [result]=analyzeCapability(dimensionGroups({criticalDimensionJson:matrix(values)},record));assert.equal(result.cpk,null);assert.ok(result.issues.length);assert.ok(!JSON.stringify(result).includes('Infinity'));}
  const [negative]=analyzeCapability(dimensionGroups({criticalDimensionJson:matrix([11,12,13])},record));assert.ok(negative.cpk<0);
});
test('a complete passed-record report verifies factory and material identity through QMS detail',async()=>{
  const [, {capabilityReport}]=await modules;const f=envFixture();const result=await capabilityReport(f.env,filter);
  assert.equal(result.included,1);assert.equal(result.projects[0].n,5);assert.equal(f.calls.length,4);assert.equal(result.passedOnly,true);assert.equal(f.calls[1].query['searchParams[syncInspectionResult]'],'1');
  assert.ok(f.calls.every(call=>!call.path.includes('http')));
});
test('empty dimensions and unfinished passed records are disclosed rather than given fictitious capability',async()=>{
  const [, {capabilityReport}]=await modules;
  const f=envFixture([record],(body,data)=>{if(body.path.includes('documents/getById'))data.criticalDimensionJson=JSON.stringify({header:[{prop:'rowName',label:'项目'}],data:[{rowName:'标准'}]});});
  const empty=await capabilityReport(f.env,filter);assert.equal(empty.missing,1);assert.equal(empty.projects.length,0);
  const unfinished=envFixture([{...record,taskKey:'audit_leader'}]);assert.equal((await capabilityReport(unfinished.env,filter)).notFinal,1);assert.equal(unfinished.calls.length,2);
});
test('scope mismatches, incomplete pages and excessive studies fail closed',async()=>{
  const [, {capabilityReport}]=await modules;
  for(const alter of [(body,data)=>{if(body.path.includes('documentsMaterial'))data.factoryCode='OTHER';},(body,data)=>{if(body.path.endsWith('selectPage'))data.resultData=[];},(body,data)=>{if(body.path.endsWith('selectPage'))data.total=21;}]){
    const f=envFixture([record],alter);await assert.rejects(capabilityReport(f.env,filter));
  }
  await assert.rejects(capabilityReport(envFixture().env,{...filter,startDate:'2026-99-99'}),error=>error.code==='INVALID_CAPABILITY_FILTER');
  await assert.rejects(capabilityReport(envFixture().env,{...filter,materialNumber:'../secret'}),error=>error.code==='INVALID_CAPABILITY_FILTER');
});
test('QMS server-capped pages are all loaded before publishing a study',async()=>{
  const [, {capabilityReport}]=await modules;const f=envFixture([record,{...record,id:'doc2',orderNumber:'LOT-2',taskKey:'audit_leader'}],(body,data)=>{
    if(body.path.endsWith('selectPage'))data.resultData=[data.resultData[Number(body.query.pageNum)-1]];
  });
  const result=await capabilityReport(f.env,filter);assert.equal(result.scanned,2);assert.equal(result.included,1);assert.equal(result.notFinal,1);assert.equal(f.calls.length,5);
});
