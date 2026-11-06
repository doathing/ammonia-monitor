import * as D from './domain.mjs';
import demo from './demo.json' with {type:'json'};
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const ok={ok:true};
const HEADERS=['时间（北京时间）','一床层热点温度（℃）','二床层热点温度（℃）','三床层热点温度（℃）','系统压力（MPa）'];
const order=doc=>{doc.samples.sort((a,b)=>D.millis(a.timestamp)-D.millis(b.timestamp));doc.stages.sort((a,b)=>a.stage_index-b.stage_index);doc.events.sort((a,b)=>D.millis(a.timestamp)-D.millis(b.timestamp));return doc;};
function summary(doc){const {id,name,start_time,status,end_time,demo}=doc.batch;return {id,name,start_time,status,end_time,demo};}
function sampleWrite(doc,v,id=null,replace=false){const s=D.sample(v);D.checkTime(doc.batch,s);const duplicate=doc.samples.find(x=>D.millis(x.timestamp)===D.millis(s.timestamp)&&x.id!==id);if(duplicate){if(!replace)D.fail('此时间已有读数，请修改时间或明确选择更新已有记录',409);id=duplicate.id;}const row={...s,id:id||D.uid(),batch_id:doc.batch.id},i=doc.samples.findIndex(x=>x.id===row.id);if(i<0)doc.samples.push(row);else doc.samples[i]=row;return row;}
function concentrationWrite(doc,kind,v,id=null,replace=false){const c=D.concentration(kind,v);D.checkTime(doc.batch,c);const duplicate=doc.concentrations.find(x=>x.id!==id&&x.kind===kind&&D.millis(x.timestamp)===D.millis(c.timestamp)&&x.point===c.point&&x.unit===c.unit);if(duplicate){if(!replace)D.fail('此时间已有同采样点同单位浓度，请修改时间或明确更新',409);id=duplicate.id;}const row={...c,id:id||D.uid(),batch_id:doc.batch.id},i=doc.concentrations.findIndex(x=>x.id===row.id);if(i<0)doc.concentrations.push(row);else doc.concentrations[i]=row;return row;}
function numericCell(v){D.ensure(v!=null&&(typeof v==='number'||typeof v==='string'&&v.trim()),'数值不能为空');return Number(v);}
function editSamplingRow(doc,payload){
  const original=D.millis(D.timestamp(payload.original_timestamp));
  const timestamp=D.timestamp(payload.timestamp);
  D.checkTime(doc.batch,{timestamp});
  const originalSample=doc.samples.find(row=>D.millis(row.timestamp)===original);
  const originalChemistry=doc.concentrations.filter(row=>D.millis(row.timestamp)===original);
  const chemistry=payload.concentrations;
  D.ensure(Array.isArray(chemistry)&&chemistry.every(row=>row&&typeof row==='object'),'浓度数据格式无效');
  const ids=chemistry.filter(row=>row.id!=null).map(row=>row.id);
  const originals=new Map(originalChemistry.map(row=>[row.id,row.kind]));
  D.ensure((payload.sample?.id??null)===(originalSample?.id??null)&&
    ids.length===originals.size&&new Set(ids).size===ids.length&&
    chemistry.every(row=>row.id==null||(originals.has(row.id)&&originals.get(row.id)===row.kind)),
    '此时刻的采样记录已变更，请刷新后重试',409);
  D.ensure(originalSample||originalChemistry.length,'采样记录不存在',404);
  if(payload.sample)sampleWrite(doc,{...payload.sample,timestamp},originalSample?.id);
  doc.concentrations=doc.concentrations.filter(row=>!originals.has(row.id));
  for(const row of chemistry)concentrationWrite(doc,row.kind,{...row,timestamp},row.id);
}
function imports(doc,body){D.ensure(Array.isArray(body.rows)&&body.rows.length<=10000,'最多导入10000条');const keys=['timestamp',...D.CHANNELS],mapping=body.mapping;D.ensure(mapping&&Object.keys(mapping).length===5&&keys.every(k=>Number.isInteger(mapping[k])&&mapping[k]>=0&&mapping[k]<=49)&&new Set(Object.values(mapping)).size===5,'请选择五个互不重复的映射列');D.ensure(body.policy==null||['keep','replace'].includes(body.policy),'重复策略无效');const valid=[],errors=[],duplicates=[],seen=new Set(doc.samples.map(s=>s.timestamp));body.rows.forEach((row,i)=>{try{const s=D.sample(Object.fromEntries(keys.map(k=>[k,k==='timestamp'?row[mapping[k]]:numericCell(row[mapping[k]])])));D.checkTime(doc.batch,s);if(seen.has(s.timestamp))duplicates.push(i+2);seen.add(s.timestamp);valid.push(s);}catch(e){errors.push({row:i+2,message:e.message});}});return {valid,errors,duplicates};}
export function restore(payload){
  D.ensure(payload?.format==='ammonia-monitor'&&[1,2,3,4,5,6].includes(payload.version),'不支持的备份格式');const b=payload.batch;
  const doc=D.newDoc({name:String(b.name).slice(0,90)+' · 恢复',start_time:b.start_time,initial:b.initial,start:false});
  D.ensure(['draft','active','completed'].includes(b.status),'无效批次状态');Object.assign(doc.batch,{status:b.status,plan:D.plan(b.plan),end_time:b.end_time?D.timestamp(b.end_time):null,demo:b.demo?1:0});
  D.ensure((b.status==='completed')===!!doc.batch.end_time,'结束状态与结束时间不一致');
  D.ensure(Array.isArray(payload.stages)&&payload.stages.length<=10,'阶段无效');
  doc.stages=payload.stages.map((s,i)=>{D.ensure(s.stage_index===i,'阶段顺序无效');return {stage_index:i,start_time:D.timestamp(s.start_time),batch_id:doc.batch.id};});
  D.ensure(doc.stages.every((s,i)=>!i||D.millis(s.start_time)>D.millis(doc.stages[i-1].start_time)),'阶段时间顺序无效');
  D.ensure(b.status==='draft'?doc.stages.length===0:doc.stages.length>0&&doc.stages[0].start_time===doc.batch.start_time,'缺少开工阶段或草稿含阶段');
  if(doc.batch.end_time)D.ensure(D.millis(doc.batch.end_time)>=D.millis(doc.batch.start_time)&&doc.stages.every(s=>D.millis(s.start_time)<=D.millis(doc.batch.end_time)),'结束时间无效');
  D.ensure(Array.isArray(payload.samples)&&payload.samples.length<=10000,'读数无效或过多');for(const s of payload.samples)sampleWrite(doc,s);
  D.ensure(Array.isArray(payload.events)&&payload.events.length<=10000,'事件无效或过多');doc.events=payload.events.map(e=>({...D.event(e),id:D.uid(),batch_id:doc.batch.id}));
  const cs=payload.version>=2?payload.concentrations:[];D.ensure(Array.isArray(cs)&&cs.length<=10000,'浓度无效或过多');for(const c of cs)concentrationWrite(doc,c.kind,c);
  doc.water_plan=payload.version>=3?D.waterPlan(payload.water_plan):D.waterLimits();doc.curve_overrides=payload.version>=4?D.overrides(payload.curve_overrides):Array(10).fill(null);return order(doc);
}
function backup(doc){return {format:'ammonia-monitor',version:6,exported_at:D.now(),...doc,concentrations:doc.concentrations.map(D.publicConcentration)};}
function csv(headers,rows,filename){const cell=v=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return new Response('\ufeff'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n'),{headers:{'content-type':'text/csv;charset=utf-8','content-disposition':`attachment; filename="${filename}"`,'cache-control':'no-store'}});}
export async function handle(request,store,files){try{
  const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean),method=request.method;
  if(method!=='GET'&&request.headers.get('origin'))D.ensure(request.headers.get('origin')===url.origin,'不接受其他网站的数据写入',403);
  const body=async()=>{try{return await request.json();}catch{D.fail('请求数据格式错误');}};
  if(url.pathname==='/api/health')return json({ok:true,app:'ammonia-monitor',api_version:4,backend_revision:'sites-v1',time:D.now(),storage:'cloud'});
  if(url.pathname==='/api/source-plan'&&method==='GET')return json(D.sourcePlan());
  if(url.pathname==='/api/import/inspect'&&method==='POST')return json(await files.inspect(await request.formData()));
  if(parts[1]==='templates'&&method==='GET')return parts[2]==='csv'?csv(HEADERS,[],'readings-template.csv'):await files.template(HEADERS);
  if(url.pathname==='/api/restore'&&method==='POST'){const file=(await request.formData()).get('file');D.ensure(file&&file.size<=10*1024*1024,'备份不能超过10MB');let payload;try{payload=JSON.parse(await file.text());}catch{D.fail('备份JSON格式错误');}const doc=restore(payload);await store.create(doc,summary(doc));return json({id:doc.batch.id});}
  if(url.pathname==='/api/demo'&&method==='POST'){const existing=(await store.list()).find(b=>b.demo);if(existing)return json({id:existing.id});const doc=restore(demo);doc.batch.name='演示 · 127小时还原全程';await store.create(doc,summary(doc));return json({id:doc.batch.id});}
  if(url.pathname==='/api/batches'){
    if(method==='GET')return json(await store.list());
    if(method==='POST'){const doc=D.newDoc(await body());await store.create(doc,summary(doc));return json({id:doc.batch.id});}
  }
  D.ensure(parts[1]==='batches'&&parts[2],'接口不存在',404);
  const id=parts[2],stored=await store.get(id);D.ensure(stored,'批次不存在',404);const doc=order(stored.doc),b=doc.batch,kind=parts[3],key=parts[4];
  if(method==='GET'){
    if(!kind)return json(D.detail(doc));
    if(kind==='export'){
      if(key==='backup')return new Response(JSON.stringify(backup(doc),null,2),{headers:{'content-type':'application/json','content-disposition':'attachment; filename="ammonia-backup.json"','cache-control':'no-store'}});
      if(key==='samples')return csv(HEADERS,doc.samples.map(s=>[s.timestamp,...D.CHANNELS.map(k=>s[k])]),'readings.csv');
      if(key==='events')return csv(['时间（北京时间）','类型','标题','说明','关联通道','标记值'],D.timeline(doc).reverse().map(e=>['timestamp','kind','title','description','channel','value'].map(k=>e[k])),'events.csv');
      if(key==='concentrations')return csv(['时间（北京时间）','类型','采样点','输入浓度','输入单位','水汽浓度ppmv','换算基准','温度℃','绝对压力kPa','备注'],doc.concentrations.map(D.publicConcentration).map(c=>[c.timestamp,{water:'出塔水汽浓度',inlet_water:'进塔水汽浓度',ammonia:'氨水'}[c.kind],c.point,c.value,c.unit,c.ppmv,c.basis,c.temperature_c,c.pressure_kpa,c.note]),'concentrations.csv');
    }D.fail('接口不存在',404);
  }
  let result=ok;
  if(kind==='plan'&&method==='PUT'){D.ensure(b.status==='draft','仅草稿可修改计划快照',409);b.plan=D.plan(await body());}
  else if(kind==='water-plan'&&method==='PUT'){doc.water_plan=D.waterPlan(await body());doc.events.push({id:D.uid(),batch_id:id,timestamp:D.now(),kind:'operation',title:'更新计划出塔水汽浓度',description:'按阶段设置；g/m³统一以0℃、101.325kPa绝压换算。',channel:null,value:null});}
  else if(kind==='curve-plan'&&method==='PUT'){
    const i=Number(key);D.ensure(Number.isInteger(i)&&i>=0&&i<10,'计划阶段不存在');const payload=await body(),before=D.effective(b.plan,doc.curve_overrides)[i];doc.curve_overrides[i]=D.curve(payload);
    if(payload&&Object.hasOwn(payload,'water'))doc.water_plan[i]=D.waterTarget(payload.water);
    const after=D.effective(b.plan,doc.curve_overrides)[i];doc.events.push({id:D.uid(),batch_id:id,timestamp:D.now(),kind:'operation',title:(payload?'修改阶段参数':'恢复原计划参数')+' · '+after.name,description:'修改前：'+JSON.stringify(before)+'\n修改后：'+JSON.stringify(after)+'\n原始计划快照保留。',channel:null,value:null});result={ok:true,changed:true};
  }else if(kind==='start'&&method==='POST'){D.ensure(b.status==='draft','仅草稿可以启动',409);b.status='active';doc.stages=[{batch_id:id,stage_index:0,start_time:b.start_time}];}
  else if(kind==='complete'&&method==='POST'){
    D.ensure(b.status==='active','仅运行中批次可以结束',409);const time=D.timestamp((await body()).timestamp),latest=Math.max(D.millis(b.start_time),...doc.samples.map(s=>D.millis(s.timestamp)),...doc.stages.map(s=>D.millis(s.start_time)),...doc.concentrations.map(s=>D.millis(s.timestamp)));
    D.ensure(D.millis(time)>=latest&&D.millis(time)<=Date.now(),'完成时间不能早于已有读数或阶段，也不能晚于当前时间');b.status='completed';b.end_time=time;
  }else if(kind==='samples'){
    const index=key?doc.samples.findIndex(s=>s.id===key):-1;if(key)D.ensure(index>=0,'读数不存在',404);
    if(method==='POST'&&!key)sampleWrite(doc,await body());else if(method==='PUT'&&key)sampleWrite(doc,await body(),key);else if(method==='DELETE'&&key)doc.samples.splice(index,1);else D.fail('接口不存在',404);
  }else if(kind==='concentrations'){
    const cid=parts[5],index=cid?doc.concentrations.findIndex(c=>c.id===cid&&c.kind===key):-1;if(cid)D.ensure(index>=0,'浓度记录不存在',404);
    if(method==='POST'&&!cid)result=D.publicConcentration(concentrationWrite(doc,key,await body()));else if(method==='PUT'&&cid)concentrationWrite(doc,key,await body(),cid);else if(method==='DELETE'&&cid)doc.concentrations.splice(index,1);else D.fail('接口不存在',404);
  }else if(kind==='sampling-row'&&!key&&method==='PUT'){
    editSamplingRow(doc,await body());
  }else if(kind==='cursor-readings'&&method==='POST'){
    const v=await body(),time=D.timestamp(v.timestamp);D.ensure(v.sample||v.water||v.ammonia||v.inlet_water,'请至少填写一组实测数据');
    if(v.sample)sampleWrite(doc,{...v.sample,timestamp:time},null,!!v.replace);
    let count=0;for(const k of ['water','ammonia','inlet_water'])if(v[k]){concentrationWrite(doc,k,{...v[k],timestamp:time},null,!!v.replace);count++;}result={ok:true,sample:!!v.sample,concentrations:count};
  }else if(kind==='events'){
    const index=key?doc.events.findIndex(e=>e.id===key):-1;if(key)D.ensure(index>=0,'事件不存在',404);
    if(method==='DELETE'&&key)doc.events.splice(index,1);else if(method==='POST'&&!key||method==='PUT'&&key){const e={...D.event(await body()),id:key||D.uid(),batch_id:id};if(key)doc.events[index]=e;else doc.events.push(e);result={id:e.id};}else D.fail('接口不存在',404);
  }else if(kind==='stages'){
    const time=D.timestamp((await body()).timestamp),t=D.millis(time),i=method==='POST'?doc.stages.length:Number(key);D.ensure(t<=Date.now(),'不能确认未来阶段');
    if(method==='POST'){D.ensure(b.status==='active'&&i<10,'当前不能切换阶段',409);D.ensure(t>D.millis(doc.stages.at(-1).start_time),'阶段开始时间必须晚于上一阶段');doc.stages.push({batch_id:id,stage_index:i,start_time:time});}
    else if(method==='PUT'){D.ensure(Number.isInteger(i)&&i>0&&i<doc.stages.length,'首阶段固定为开工时间，请选择已确认的后续阶段');D.ensure(t>D.millis(doc.stages[i-1].start_time)&&(!doc.stages[i+1]||t<D.millis(doc.stages[i+1].start_time))&&(!b.end_time||t<=D.millis(b.end_time)),'修正后的阶段时间必须保持先后顺序');doc.stages[i].start_time=time;}else D.fail('接口不存在',404);
  }else if(kind==='import'&&method==='POST'){
    const v=await body(),preview=imports(doc,v);if(key==='preview')return json({valid_count:preview.valid.length,errors:preview.errors,duplicates:preview.duplicates,preview:preview.valid.slice(0,8),units:'℃ / MPa',timezone:'UTC+08:00（北京时间）'});
    D.ensure(!key,'接口不存在',404);D.ensure(!preview.errors.length,`有${preview.errors.length}行异常，未写入任何数据`);let written=0;for(const s of preview.valid){if(v.policy!=='replace'&&doc.samples.some(x=>x.timestamp===s.timestamp))continue;sampleWrite(doc,s,null,v.policy==='replace');written++;}result={written,skipped:preview.valid.length-written};
  }else D.fail('接口不存在',404);
  order(doc);await store.save(doc,stored.version,summary(doc));return json(result);
}catch(e){const status=e.status||(e instanceof TypeError?422:500);if(status===500)console.error('Monitor API error',e);return json({detail:status===500?'云端服务暂时不可用，请稍后重试；未确认成功的操作请刷新核对。':e.message},status);}}
