import original from './default-plan.json' with {type:'json'};
import aliases from './aliases.json' with {type:'json'};
export const CHANNELS=['t1','t2','t3','pressure'];
export const clone=x=>structuredClone(x);
export function fail(message,status=422){throw Object.assign(new Error(message),{status});}
export function ensure(ok,message,status=422){if(!ok)fail(message,status);}
export const uid=()=>crypto.randomUUID().replaceAll('-','');
export const normalize=s=>Object.entries(aliases).sort((a,b)=>b[0].length-a[0].length).reduce((s,[a,b])=>s.replaceAll(a,b),s);
export function timestamp(value){
  ensure(typeof value==='string'&&value.trim(),'时间须为日期时间');
  let s=value.trim().replace(' ','T');
  if(!/[zZ]|[+-]\d\d:\d\d$/.test(s))s+='+08:00';
  const d=Date.parse(s);ensure(Number.isFinite(d),'无效的日期时间');return iso(Math.floor(d/1000)*1000);
}
export function iso(ms){return new Date(ms+8*3600000).toISOString().replace('.000Z','Z').replace('Z','+08:00');}
export const now=()=>iso(Math.floor(Date.now()/1000)*1000);
export const millis=s=>Date.parse(s);
export function finite(v,min=-Infinity,max=Infinity){ensure(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,'数值无效或超出允许范围');return v;}
export function text(v,max=4000,required=false){ensure(typeof v==='string'&&v.length<=max&&(!required||v.trim()),'文字为空或超过长度限制');return normalize(v);}
export function pair(v){ensure(Array.isArray(v)&&v.length===2,'范围必须包含起终值');v.forEach(n=>finite(n,0));ensure(v[1]>=v[0],'上限不得小于下限');return v;}
export function temperatures(values){ensure(Array.isArray(values)&&values.length===3,'须填写三个床层温度');return values.map(v=>{
  ensure(v&&['ramp','upper','band','target','approx'].includes(v.kind),'温度类型无效');
  const end=finite(v.end,-273.15),start=v.start==null?null:finite(v.start,-273.15);
  ensure(start==null||end>=start,'温度终值须不小于起值');ensure(v.kind!=='band'||start!=null,'范围温度必须有下限');
  return {kind:v.kind,start,end,label:text(v.label,80,true),strict:!!v.strict};
});}
export function rates(values){ensure(Array.isArray(values)&&values.length===3,'须提供三床层速率');return values.map(v=>v==null?null:pair(v));}
export function plan(values){ensure(Array.isArray(values)&&values.length===10,'计划必须保留10个阶段');return values.map(s=>({
  name:text(s.name,80,true),hours:finite(s.hours,Number.MIN_VALUE,1000),temps:temperatures(s.temps),rates:rates(s.rates),
  pressure:pair(s.pressure),pressure_label:text(s.pressure_label,120),ammonia:text(s.ammonia,120),
}));}
export const sourcePlan=()=>clone(original);
export function curve(v){if(v==null)return null;const out={temps:temperatures(v.temps),pressure:pair(v.pressure)};
  for(const key of ['name','hours','rates','ammonia','pressure_approx'])if(v[key]!=null)out[key]=key==='hours'?finite(v[key],Number.MIN_VALUE,1000):key==='rates'?rates(v[key]):key==='pressure_approx'?!!v[key]:text(v[key],key==='name'?80:120,key==='name');
  return out;
}
export function overrides(v){ensure(Array.isArray(v)&&v.length===10,'须提供10个阶段的曲线设置');return v.map(curve);}
export function effective(base,values){return clone(base).map((s,i)=>{const v=values[i];if(!v)return s;
  const unchanged=s.pressure.every((p,j)=>p===v.pressure[j]);
  Object.assign(s,v);if(!unchanged||v.pressure_approx!=null)s.pressure_label=(v.pressure_approx?'约':'')+(s.pressure[0]===s.pressure[1]?s.pressure[0]:s.pressure.join('–'));return s;
});}
export function waterPpmv(c,t,p){finite(c,0);finite(t,-273.15+Number.EPSILON);finite(p,Number.MIN_VALUE);ensure(t> -273.15,'温度须高于绝对零度');const ppm=c/18.0153*8.31446261815324*(t+273.15)/(p*1000)*1e6;ensure(Number.isFinite(ppm)&&ppm<=1e6,'水汽换算超过100%体积分数');return ppm;}
export const waterLimits=()=>Array.from({length:10},(_,i)=>({start:[1,2].includes(i)?1000:3000,end:[1,2].includes(i)?1000:3000,unit:'ppmv',kind:'upper'}));
export function waterTarget(v){if(v==null)return null;ensure(['ppmv','g/m3'].includes(v.unit)&&['upper','ramp'].includes(v.kind),'计划水汽类型无效');const out={start:finite(v.start,0),end:finite(v.end,0),unit:v.unit,kind:v.kind};ensure(v.kind!=='upper'||v.start===v.end,'上限须为单个值');for(const n of [v.start,v.end])v.unit==='g/m3'?waterPpmv(n,0,101.325):finite(n,0,1e6);return out;}
export function waterPlan(v){ensure(Array.isArray(v)&&v.length===10,'须提供10个阶段的水汽设置');return v.map(waterTarget);}
export function stageAt(batch,stages,when,alignment='actual'){
  const time=millis(when),elapsed=(time-millis(batch.start_time))/3600000;if(elapsed<0)return null;
  if(alignment==='original'){let offset=0;for(let i=0;i<batch.plan.length;i++){const s=batch.plan[i];if(elapsed<offset+s.hours||i===batch.plan.length-1)return [i,elapsed-offset,iso(millis(batch.start_time)+offset*3600000)];offset+=s.hours;}}
  const s=stages.filter(s=>millis(s.start_time)<=time).at(-1);return s?[s.stage_index,(time-millis(s.start_time))/3600000,s.start_time]:null;
}
export function reference(batch,stages,when,alignment='actual'){
  const at=stageAt(batch,stages,when,alignment);if(!at)return null;const [i,hours,start]=at,s=batch.plan[i],f=Math.min(1,Math.max(0,hours/s.hours));
  return {stage_index:i,name:s.name,stage_start:start,hours,overdue:Math.max(0,hours-s.hours),temps:s.temps.map((v,j)=>({...v,value:v.kind==='ramp'?(v.start??batch.initial[j])+(v.end-(v.start??batch.initial[j]))*f:['target','approx'].includes(v.kind)?v.end:null})),rates:s.rates,pressure:s.pressure[0]+(s.pressure[1]-s.pressure[0])*f,pressure_rate:hours<s.hours?(s.pressure[1]-s.pressure[0])/s.hours:0,pressure_label:s.pressure_label,ammonia:s.ammonia};
}
export function compare(value,s){if(value==null||s==null)return {status:'unknown',delta:null};let delta=value-(s.value??s.end),status='reference';
  if(s.kind==='approx')status='approx';if(s.kind==='upper')status=(s.strict?value>=s.end:value>s.end)?'outside':'within';if(s.kind==='band'){delta=value<s.start?value-s.start:value>s.end?value-s.end:0;status=delta?'outside':'within';}return {status,delta};
}
export function ratesAt(samples,stages,when){const end=millis(when),stage=stages.filter(s=>millis(s.start_time)<=end).at(-1),lo=Math.max(end-7200000,stage?millis(stage.start_time):-Infinity),selected=samples.filter(s=>millis(s.timestamp)>=lo&&millis(s.timestamp)<=end);
  const values=[null,null,null,null];if(selected.length<2)return {values,count:selected.length,span_hours:0,start:null,end:iso(end)};
  const times=selected.map(s=>(millis(s.timestamp)-millis(selected[0].timestamp))/3600000),span=times.at(-1);
  if(span>=.5){const mean=times.reduce((a,b)=>a+b,0)/times.length,denom=times.reduce((a,x)=>a+(x-mean)**2,0);CHANNELS.forEach((k,j)=>{const ym=selected.reduce((a,s)=>a+s[k],0)/selected.length;values[j]=selected.reduce((a,s,i)=>a+(times[i]-mean)*(s[k]-ym),0)/denom;});}
  return {values,count:selected.length,span_hours:span,start:selected[0].timestamp,end:selected.at(-1).timestamp};
}
export function plannedWater(batch,values,when){const at=stageAt(batch,[],when,'original');if(!at)return null;const [i,h]=at,v=values[i];if(!v)return null;const n=v.start+(v.end-v.start)*Math.min(1,Math.max(0,h/batch.plan[i].hours));return v.unit==='g/m3'?waterPpmv(n,0,101.325):n;}
export function completed(batch,stages){let start=millis(batch.start_time);return batch.plan.flatMap((s,i)=>{const end=start+s.hours*3600000,a=stages.find(x=>x.stage_index===i),next=stages.find(x=>x.stage_index===i+1),finish=next?.start_time||(a&&batch.status==='completed'?batch.end_time:null);const result=[];
  if(a&&finish){const duration=(millis(finish)-millis(a.start_time))/3600000,delta=(millis(finish)-end)/3600000;result.push({stage_index:i,name:s.name,start_time:a.start_time,end_time:finish,planned_start:iso(start),planned_end:iso(end),planned_hours:s.hours,actual_hours:duration,finish_delta_hours:delta,duration_delta_hours:duration-s.hours,status:delta>1/3600?'late':delta< -1/3600?'early':'ontime'});}start=end;return result;});}
export function sample(v){return {timestamp:timestamp(v.timestamp),...Object.fromEntries(CHANNELS.map((k,i)=>[k,finite(v[k],i===3?0:-273.15)]))};}
export function event(v){ensure(['operation','annotation'].includes(v.kind??'operation'),'事件类型无效');ensure(v.channel==null||CHANNELS.includes(v.channel),'无效通道');return {timestamp:timestamp(v.timestamp),kind:v.kind??'operation',title:text(v.title,120,true).trim(),description:text(v.description??''),channel:v.channel??null,value:v.value==null?null:finite(v.value)};}
export function concentration(kind,v){ensure(['water','ammonia','inlet_water'].includes(kind),'浓度类型无效');const out={timestamp:timestamp(v.timestamp),kind,value:finite(v.value,0),point:text(v.point??'',120).trim(),note:text(v.note??''),unit:v.unit??(kind==='water'?'g/m3':kind==='inlet_water'?'ppmv':null),basis:null,temperature_c:null,pressure_kpa:null};
  if(kind==='water'){ensure(out.unit==='g/m3'&&['standard0','ambient25','custom'].includes(v.basis),'水汽单位或基准无效');out.basis=v.basis;out.temperature_c=finite(v.temperature_c);out.pressure_kpa=finite(v.pressure_kpa);if(v.basis!=='custom')ensure(v.temperature_c===(v.basis==='standard0'?0:25)&&v.pressure_kpa===101.325,'预设基准温压不匹配');waterPpmv(out.value,out.temperature_c,out.pressure_kpa);}
  if(kind==='inlet_water'){ensure(out.unit==='ppmv','进塔水汽单位须为ppmv');finite(out.value,0,1e6);}
  if(kind==='ammonia'){ensure(out.point&&['%','g/L','mg/L'].includes(out.unit),'请填写采样点并选择氨水单位');if(out.unit==='%')finite(out.value,0,100);}return out;
}
export function publicConcentration(v){return {...v,...(v.kind==='water'?{ppmv:waterPpmv(v.value,v.temperature_c,v.pressure_kpa)}:v.kind==='inlet_water'?{ppmv:v.value,outside_limit:v.value>200}:{})};}
export function checkTime(batch,s){ensure(batch.status!=='draft','请先启动批次再录入读数');ensure(millis(s.timestamp)>=millis(batch.start_time),'读数时间不能早于开工时间');ensure(!batch.end_time||millis(s.timestamp)<=millis(batch.end_time),'读数时间不能晚于批次结束时间');}
export function isAudit(e){return e.kind==='system'||e.kind==='operation'&&((/^(修改阶段参数|恢复原计划参数|设置曲线|恢复原计划曲线) · /.test(e.title)&&e.description.includes('修改前：')&&e.description.includes('修改后：'))||['更新计划水汽浓度','更新计划出塔水汽浓度','更新计划金塔水汽浓度'].includes(e.title)&&e.description.startsWith('按阶段设置；')||e.title==='按确认表修订原计划'&&e.description.includes('修改前完整数据库备份：'));}
export function timeline(doc){const b=doc.batch,p=effective(b.plan,doc.curve_overrides);return [...doc.events.filter(e=>!isAudit(e)),...doc.stages.map(s=>({id:`stage-${s.stage_index}`,kind:'stage',timestamp:s.start_time,title:p[s.stage_index].name,description:s.stage_index?'实际阶段开始':'开工 · 实际阶段开始',stage_index:s.stage_index}))].sort((a,b)=>millis(b.timestamp)-millis(a.timestamp));}
export function detail(doc){const b=doc.batch,stages=doc.stages,samples=[...doc.samples].sort((a,b)=>millis(a.timestamp)-millis(b.timestamp)),curve_plan=effective(b.plan,doc.curve_overrides),cb={...b,plan:curve_plan},view_time=b.end_time||now(),latest=samples.at(-1),age=latest?(millis(view_time)-millis(latest.timestamp))/60000:null,grid=[];
  if(b.status!=='draft'){const start=millis(b.start_time),end=Math.max(millis(view_time),start+curve_plan.reduce((a,s)=>a+s.hours,0)*3600000),step=Math.max(900000,(end-start)/2000),points=new Set([start,end]);for(let t=start;t<end;t+=step)points.add(t);let t=start;for(const s of curve_plan){t+=s.hours*3600000;if(t<=end)points.add(t);}for(const t of [...points])if(t>start)points.add(t-1);for(const t of [...points].sort((a,b)=>a-b)){const when=iso(t);grid.push({timestamp:when,reference:reference(cb,stages,when,'original'),water_ppmv:plannedWater(cb,doc.water_plan,when),inlet_water_ppmv:200});}}
  return {...doc,batch:b,samples:samples.map(s=>{const ref=reference(cb,stages,s.timestamp,'original');return {...s,rates:ratesAt(samples,stages,s.timestamp),reference:ref,comparisons:CHANNELS.slice(0,3).map((k,j)=>compare(s[k],ref?.temps[j]))};}),concentrations:Object.fromEntries(['water','ammonia','inlet_water'].map(k=>[k,doc.concentrations.filter(c=>c.kind===k).sort((a,b)=>millis(a.timestamp)-millis(b.timestamp)).map(publicConcentration)])),timeline:timeline(doc),reference_grid:grid,view_time,current_reference:b.status==='draft'?null:reference(cb,stages,view_time,'original'),current_rates:ratesAt(samples,stages,view_time),freshness:latest==null?'none':age<0?'future':age>60?'stale':'fresh',age_minutes:age,source_plan:sourcePlan(),inlet_water_limit_ppmv:200,completed_stages:completed(cb,stages),curve_plan};
}
export function newDoc(v){const start=timestamp(v.start_time);ensure(Array.isArray(v.initial)&&v.initial.length===3,'须填写三床层初温');v.initial.forEach(n=>finite(n,-273.15));const id=uid();return {batch:{id,name:text(v.name,100,true).trim(),start_time:start,initial:v.initial,plan:sourcePlan(),status:v.start===false?'draft':'active',end_time:null,demo:0,created_at:now()},samples:[],events:[],stages:v.start===false?[]:[{batch_id:id,stage_index:0,start_time:start}],concentrations:[],water_plan:waterLimits(),curve_overrides:Array(10).fill(null)};}
