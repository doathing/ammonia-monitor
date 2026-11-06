import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handle,restore} from '../lib/monitor/service.mjs';
import * as D from '../lib/monitor/domain.mjs';
import demo from '../lib/monitor/demo.json' with {type:'json'};
import {files} from '../lib/monitor/files.mjs';

class MemoryStore {
  docs=new Map();
  async list(){return [...this.docs.values()].map(x=>structuredClone(x.summary));}
  async create(doc,summary){assert(!this.docs.has(doc.batch.id));this.docs.set(doc.batch.id,{doc:structuredClone(doc),summary,version:D.uid()});}
  async get(id){const item=this.docs.get(id);return item?structuredClone(item):null;}
  async save(doc,version,summary){D.ensure(this.docs.get(doc.batch.id).version===version,'concurrent modification',409);this.docs.set(doc.batch.id,{doc:structuredClone(doc),summary,version:D.uid()});}
}
const store=new MemoryStore();
async function api(path,method='GET',body){const response=await handle(new Request('https://monitor.test/api'+path,{method,...(body instanceof FormData?{body}:body!==undefined?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})}),store,files);return {response,status:response.status,data:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.arrayBuffer()};}
const start='2026-10-01T08:00:00+08:00';let id;
test('source plan and calculations match original Python program',()=>{
  const doc=restore(demo),actual=D.detail(doc);
  const expected=JSON.parse(fs.readFileSync(new URL('./source-parity.json',import.meta.url),'utf8'));
  assert.deepEqual(actual.source_plan,expected.source_plan);
  assert.deepEqual(actual.curve_plan,expected.curve_plan);
  assert.deepEqual(actual.water_plan,expected.water_plan);
  assert.equal(actual.samples.length,259);
  for(let i=0;i<expected.samples.length;i++){
    const a=actual.samples[i],b=expected.samples[i];
    assert.equal(Date.parse(a.timestamp),Date.parse(b.timestamp));
    assert.deepEqual(a.reference,b.reference);
    for(let j=0;j<4;j++)if(b.rates.values[j]==null)assert.equal(a.rates.values[j],null);else assert(Math.abs(a.rates.values[j]-b.rates.values[j])<1e-9);
    assert.deepEqual(a.comparisons,b.comparisons);
  }
  assert.deepEqual(actual.completed_stages.map(s=>[s.stage_index,s.finish_delta_hours,s.duration_delta_hours,s.status]),expected.completed_stages.map(s=>[s.stage_index,s.finish_delta_hours,s.duration_delta_hours,s.status]));
  for(const kind of ['water','ammonia','inlet_water']){
    assert.equal(actual.concentrations[kind].length,expected.concentrations[kind].length);
    actual.concentrations[kind].forEach((c,i)=>{if(kind==='water')assert.equal(c.ppmv,expected.concentrations[kind][i].ppmv);});
  }
});
test('batch, atomic cursor validation, concentrations and duplicate handling',async()=>{
  let r=await api('/batches','POST',{name:'云端验收',start_time:start,initial:[20,21,22]});assert.equal(r.status,200);id=r.data.id;
  r=await api(`/batches/${id}/cursor-readings`,'POST',{timestamp:'2026-10-01T08:30:00+08:00',sample:{t1:30,t2:31,t3:32,pressure:5},water:{value:1,basis:'standard0',temperature_c:0,pressure_kpa:101.325},ammonia:{value:101,unit:'%',point:'出口'}});
  assert.equal(r.status,422);assert.equal((await api(`/batches/${id}`)).data.samples.length,0);
  const payload={timestamp:'2026-10-01T08:30:00+08:00',sample:{t1:30,t2:31,t3:32,pressure:5},inlet_water:{value:250},water:{value:1,basis:'standard0',temperature_c:0,pressure_kpa:101.325},ammonia:{value:10,unit:'%',point:'出口',note:'云端记录'}};
  r=await api(`/batches/${id}/cursor-readings`,'POST',payload);assert.equal(r.status,200);
  assert.equal((await api(`/batches/${id}/cursor-readings`,'POST',payload)).status,409);
  assert.equal((await api(`/batches/${id}/cursor-readings`,'POST',{...payload,replace:true})).status,200);
  const detail=(await api(`/batches/${id}`)).data;assert.equal(detail.samples.length,1);assert.equal(detail.concentrations.inlet_water[0].outside_limit,true);
  assert.equal(detail.concentrations.ammonia[0].note,'云端记录');
});
test('combined correction validates and saves the whole sampling row atomically',async()=>{
  const created=await api('/batches','POST',{name:'整行修正验收',start_time:start,initial:[20,21,22]});
  const path='/batches/'+created.data.id;
  const t='2026-10-01T08:30:00+08:00',moved='2026-10-01T08:45:00+08:00';
  assert.equal((await api(path+'/cursor-readings','POST',{timestamp:t,sample:{t1:30,t2:31,t3:32,pressure:5},ammonia:{value:10,unit:'%',point:'出口'}})).status,200);
  const before=(await api(path)).data;
  const entry=before.concentrations.ammonia[0];
  const edit={original_timestamp:t,timestamp:moved,sample:{...before.samples[0],t1:40},
    concentrations:[{...entry,value:101},{kind:'inlet_water',unit:'ppmv',value:180}]};
  assert.equal((await api(path+'/sampling-row','PUT',edit)).status,422);
  assert.equal((await api(path)).data.samples[0].t1,30);
  edit.concentrations[0].value=12;
  assert.equal((await api(path+'/sampling-row','PUT',edit)).status,200);
  const after=(await api(path)).data;
  assert.equal(after.samples[0].t1,40);
  assert.equal(D.millis(after.samples[0].timestamp),D.millis(moved));
  assert.equal(after.concentrations.ammonia[0].id,entry.id);
  assert.equal(after.concentrations.ammonia[0].value,12);
  assert.equal(D.millis(after.concentrations.ammonia[0].timestamp),D.millis(moved));
  assert.equal(after.concentrations.inlet_water[0].value,180);
  assert.equal((await api(path+'/sampling-row','PUT',edit)).status,409);
});
test('plan overrides, audit filtering and snapshot preservation',async()=>{
  const before=(await api(`/batches/${id}`)).data;
  const stage=structuredClone(before.curve_plan[0]);Object.assign(stage,{name:'自定阶段\n第二行',hours:8,water:{start:500,end:500,unit:'ppmv',kind:'upper'}});
  assert.equal((await api(`/batches/${id}/curve-plan/0`,'PUT',stage)).status,200);
  const after=(await api(`/batches/${id}`)).data;
  assert.equal(after.curve_plan[0].hours,8);assert.equal(after.batch.plan[0].hours,6);assert.equal(after.water_plan[0].start,500);assert.equal(after.timeline.filter(e=>e.kind==='operation').length,0);
  assert.equal((await api(`/batches/${id}/curve-plan/0`,'PUT',null)).status,200);
  assert.equal((await api(`/batches/${id}`)).data.curve_plan[0].hours,6);
});
test('event editing, actual stages and completed batch time constraints',async()=>{
  const eid=(await api(`/batches/${id}/events`,'POST',{timestamp:start,title:'操作',description:'记录'})).data.id;
  assert.equal((await api(`/batches/${id}/events/${eid}`,'PUT',{timestamp:start,title:'修正操作'})).status,200);
  assert.equal((await api(`/batches/${id}/stages`,'POST',{timestamp:'2026-10-01T15:00:00+08:00'})).status,200);
  assert.equal((await api(`/batches/${id}/stages/1`,'PUT',{timestamp:'2026-10-01T07:00:00+08:00'})).status,422);
  assert.equal((await api(`/batches/${id}/complete`,'POST',{timestamp:'2026-10-01T14:00:00+08:00'})).status,422);
  assert.equal((await api(`/batches/${id}/complete`,'POST',{timestamp:'2026-10-01T16:00:00+08:00'})).status,200);
  assert.equal((await api(`/batches/${id}/samples`,'POST',{timestamp:'2026-10-01T17:00:00+08:00',t1:30,t2:30,t3:30,pressure:5})).status,422);
});
test('CSV and Excel templates, parsing, duplicate import and backup restore',async()=>{
  const wb=await files.template(['时间','一床','二床','三床','压力']);assert(wb.status===200);
  const ExcelJS=(await import('exceljs')).default;const book=new ExcelJS.Workbook();await book.xlsx.load(await wb.arrayBuffer());book.worksheets[0].addRow(['2026-10-01 09:00:00',50,51,52,5.1]);const content=await book.xlsx.writeBuffer();
  const form=new FormData();form.append('file',new File([content],'records.xlsx'));
  const inspected=await api('/import/inspect','POST',form);assert.equal(inspected.status,200);
  const body={rows:inspected.data.rows,mapping:{timestamp:0,t1:1,t2:2,t3:3,pressure:4}};
  assert.equal((await api(`/batches/${id}/import/preview`,'POST',body)).data.valid_count,1);
  assert.equal((await api(`/batches/${id}/import`,'POST',body)).data.written,1);
  assert.equal((await api(`/batches/${id}/import`,'POST',body)).data.written,0);
  assert.equal((await api(`/batches/${id}/import`,'POST',{...body,policy:'replace'})).data.written,1);
  const backup=(await api(`/batches/${id}/export/backup`)).data;
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/cloud-backup.json',JSON.stringify(backup));
  const f=new FormData();f.append('file',new File([JSON.stringify(backup)],'backup.json'));
  const restored=await api('/restore','POST',f);assert.equal(restored.status,200);assert.notEqual(restored.data.id,id);
  assert.equal((await api(`/batches/${restored.data.id}`)).data.samples.length,2);
  for(let version=1;version<=6;version++){const doc=restore({...backup,version});assert.equal(doc.samples.length,2);if(version===1)assert.equal(doc.concentrations.length,0);}
});
test('cross-origin writes rejected and optimistic concurrency rejects lost update',async()=>{
  const r=await handle(new Request('https://monitor.test/api/batches',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}),store,files);assert.equal(r.status,403);
  const a=await store.get(id),b=await store.get(id);await store.save(a.doc,a.version,a.summary);await assert.rejects(store.save(b.doc,b.version,b.summary),/concurrent/);
});
