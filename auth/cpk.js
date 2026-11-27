import { api, addTranslations, initForms, text, translate, message } from './client.js';
import { capabilityTranslations } from './cpk-i18n.js';
addTranslations(capabilityTranslations); initForms();
const $ = id => document.getElementById(id), charts = new Map(); let report = null, csrf = '', busy = false;
const fmt = value => value === null || !Number.isFinite(value) ? '—' : value !== 0 && (Math.abs(value)<.0001 || Math.abs(value)>1e6) ? value.toExponential(3) : value.toLocaleString(undefined,{maximumFractionDigits:5});
const date = value => value.toISOString().slice(0, 10);
const now = new Date(Date.now() + 7 * 3600000), previous = new Date(now); previous.setUTCDate(previous.getUTCDate() - 30);
$('startDate').value = date(previous); $('endDate').value = date(now);
function sourceSummary() { return `${text('scanned')}: ${report.scanned} · ${text('batchCount')}: ${report.included} · ${text('missingBatches')}: ${report.missing} · ${text('pendingExcluded')}: ${report.notFinal}`; }
function renderProject() {
  if (!report?.projects.length) return;
  const project = report.projects[Number($('project').value) || 0]; if (!project) return;
  $('histogram').setAttribute('aria-label',text('distribution'));$('sequence').setAttribute('aria-label',text('sequence'));
  $('reportSummary').textContent = sourceSummary(); $('issues').replaceChildren();
  for (const issue of project.issues) { const span = document.createElement('span'); span.textContent = text(issue); $('issues').append(span); }
  $('metrics').replaceChildren();
  for (const [key, value] of [['cpk', project.cpk], ['ppk', project.ppk], ['mean', project.mean], ['sampleCount', project.n]]) { const item = document.createElement('div'), label = document.createElement('dt'), number = document.createElement('dd'); label.textContent = text(key); number.textContent = fmt(value); item.append(label, number); $('metrics').append(item); }
  $('details').replaceChildren(); const row = $('details').insertRow();
  for (const value of [report.materialNumber, project.supplier, project.spec ? `${project.spec.lsl} – ${project.spec.usl} (${project.unit || text('unitUnknown')})` : text('missingSpec'), fmt(project.within), fmt(project.overall), fmt(project.cp), fmt(project.pp)]) row.insertCell().textContent = value;
  drawCharts(project);
}
function setChart(id, option) {
  const host = $(id); if (!window.echarts) { host.textContent = text('noData'); return; }
  if (!charts.has(id)) charts.set(id, window.echarts.init(host));
  charts.get(id).setOption({ animation: false, tooltip: { trigger: 'axis', renderMode: 'richText' }, ...option }, { notMerge: true });
}
function drawCharts(project) {
  const values = project.samples.map(row => row.value);
  if (!values.length) { for (const chart of charts.values()) chart.clear(); return; }
  let min = Math.min(...values), max = Math.max(...values); if (min === max) { const pad = Math.max(Math.abs(min) * .001, .001); min -= pad; max += pad; }
  const bins = Math.max(3, Math.min(14, Math.ceil(Math.sqrt(values.length)))), width = (max - min) / bins, counts = Array(bins).fill(0);
  values.forEach(value => counts[Math.min(bins - 1, Math.floor((value - min) / width))]++);
  const range = project.spec ? [Math.min(min, project.spec.lsl), Math.max(max, project.spec.usl)] : [min, max];
  const marks = project.spec ? [{xAxis:project.spec.lsl,name:'LSL'},{xAxis:project.spec.usl,name:'USL'}] : [];
  setChart('histogram', { grid:{left:65,right:30,top:30,bottom:60}, xAxis:{type:'value',min:range[0],max:range[1],name:project.unit||'',nameLocation:'middle',nameGap:30,axisLabel:{formatter:fmt}}, yAxis:{type:'value',minInterval:1,name:text('count'),nameLocation:'middle',nameGap:42}, series:[{type:'bar',barWidth:'75%',data:counts.map((count,index)=>[min+(index+.5)*width,count]),itemStyle:{color:'#1677ff'},markLine:{symbol:'none',data:marks,lineStyle:{color:'#f5222d'},label:{position:'insideEndTop',formatter:params=>params.name}}}] });
  setChart('sequence', { grid:{left:58,right:30,top:30,bottom:60}, xAxis:{type:'category',data:project.samples.map((row,index)=>String(index+1)),name:text('sampleCount'),nameLocation:'middle',nameGap:30}, yAxis:{type:'value',scale:true,min:range[0],max:range[1],axisLabel:{formatter:fmt}}, series:[{type:'line',data:values,symbolSize:6,lineStyle:{color:'#1677ff'},itemStyle:{color:'#1677ff'},markLine:{symbol:'none',data:marks.map(mark=>({yAxis:mark.xAxis,name:mark.name})),lineStyle:{color:'#f5222d'},label:{position:'insideEndTop',formatter:params=>params.name}}}] });
}
function renderReport() {
  $('analysis').hidden = !report?.projects.some(project=>project.n);
  if ($('analysis').hidden) { message($('cpkStatus'), text(report?.scanned ? 'noDimensions' : 'noRecords')); return; }
  const selected = $('project').value; $('project').replaceChildren();
  report.projects.forEach((project,index)=>{ const option = document.createElement('option'); option.value=String(index); option.textContent=`${project.project} · ${project.supplier} · ${project.spec ? project.spec.lsl+' – '+project.spec.usl : text('missingSpec')}`; $('project').append(option); });
  if ([...$('project').options].some(option=>option.value===selected)) $('project').value=selected;
  renderProject(); message($('cpkStatus'), `${text('updated')}: ${new Date(report.fetchedAt).toLocaleString()}`, true);
}
$('project').addEventListener('change',renderProject);
$('cpkForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(busy)return; busy=true; $('analyze').disabled=true; $('analysis').hidden=true; report=null; message($('cpkStatus'),text('busy'));
  try { report=await api('/api/quality/capability',{factoryCode:$('factory').value,materialNumber:$('material').value.trim(),startDate:$('startDate').value,endDate:$('endDate').value},csrf); renderReport(); }
  catch(error){ const key=error.code==='CAPABILITY_RANGE_TOO_LARGE'?'tooLarge':['INVALID_CAPABILITY_FILTER','INVALID_FACTORY'].includes(error.code)?'invalidFilter':['QMS_SCOPE_MISMATCH','QMS_INVALID_DETAIL','INVALID_DIMENSION_DATA','QMS_INVALID_PAGE'].includes(error.code)?'badData':'queryFailed'; message($('cpkStatus'),text(key)); }
  finally{busy=false;$('analyze').disabled=false;}
});
document.addEventListener('auth-language',()=>{translate();if(report)renderReport();else if(!busy)message($('cpkStatus'),text('initial'));});
const observer = new ResizeObserver(()=>{for(const chart of charts.values())chart.resize();}); observer.observe($('analysis'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)for(const chart of charts.values())chart.resize();});
window.addEventListener('pagehide',()=>{observer.disconnect();for(const chart of charts.values())chart.dispose();charts.clear();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
window.addEventListener('storage',event=>{if(event.key==='iqc_logout_event')location.replace('/login');});
try {
  const user=await api('/api/auth/me');csrf=user.csrfToken;const data=await api('/api/quality/factories');$('factory').replaceChildren();
  for(const factory of data.factories){const option=document.createElement('option');option.value=factory.code;option.textContent=factory.code==='STTH'?'SHARETRONIC Thailand':factory.name;$('factory').append(option);}
  if(data.factories.some(factory=>factory.code==='STTH'))$('factory').value='STTH';
  const factoryStyle=()=>$('factory').classList.toggle('factory-thailand',$('factory').value==='STTH');factoryStyle();$('factory').addEventListener('change',factoryStyle);
  $('factory').disabled=false;$('analyze').disabled=false;
}catch(error){if(error.code==='UNAUTHENTICATED')location.replace('/login?next=%2Fcpk');else message($('cpkStatus'),text('queryFailed'));}
