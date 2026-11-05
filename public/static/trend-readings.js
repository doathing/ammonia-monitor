'use strict';
function readingAt(rows,time,fields){
  if(!rows.length)return null;
  const t=ms(time);let lo=0,hi=rows.length;
  while(lo<hi){const middle=(lo+hi)>>1;if(ms(rows[middle].timestamp)<t)lo=middle+1;else hi=middle;}
  const right=rows[lo],left=rows[lo-1];
  if(right&&ms(right.timestamp)===t)return {row:right,kind:'实测',source:right.timestamp};
  if(left&&right){const f=(t-ms(left.timestamp))/(ms(right.timestamp)-ms(left.timestamp));const row={timestamp:new Date(t).toISOString()};for(const key of fields)row[key]=left[key]+(right[key]-left[key])*f;return {row,kind:'曲线插值',source:`${fmt(left.timestamp,true,true)} → ${fmt(right.timestamp,true,true)}`};}
  const row=left||right;return {row,kind:'最近采样',source:row.timestamp};
}
function cursorSnapshot(time){
  ensureWaterPoint();
  const thermal=readingAt(state.detail.samples,time,keys),groups=new Map();
  for(const row of state.detail.concentrations?.water||[]){const point=row.point||'未标明采样点';if(!groups.has(point))groups.set(point,[]);groups.get(point).push(row);}
  const water=[...groups].filter(([point])=>point===state.waterPoint).map(([point,rows])=>({point,...readingAt(rows,time,['ppmv'])}));
  return {thermal,water,plan:waterPlanValue(time),upper:state.detail.water_plan?.[getReference(time)?.stage_index]?.kind==='upper',stage:(state.detail.completed_stages||[]).find(stage=>ms(stage.start_time)<=time&&time<=ms(stage.end_time))};
}
function sourceLabel(reading){return reading.kind==='曲线插值'?`${reading.kind} ${reading.source}`:`${reading.kind} ${fmt(reading.source,true,true)}`;}
function actualWaterRequirement(time){
  const actual=state.detail.stages.filter(stage=>ms(stage.start_time)<=ms(time)).at(-1);if(!actual)return null;
  const target=state.detail.water_plan?.[actual.stage_index];if(!target||target.kind!=='upper')return null;
  return {name:currentPlan()[actual.stage_index].name,value:target.unit==='g/m3'?target.start/18.0153*8.31446261815324*273.15/101325*1e6:target.start};
}
function mainTooltip(time){
  const rows=selectedCursorReadings(time),showActual=state.visibility!=='plan',showPlan=state.visibility!=='actual';
  const visible=rows.filter(row=>showActual||row.channel!==9);
  return `<div class="process-tooltip-inner ${showActual&&showPlan?'both':'single'}"><b>${fmt(time,false,true)}</b><span class="tooltip-sub process-elapsed">升温还原已进行 ${num(hours(time),2)} 小时</span><div class="tooltip-reading-header"><span>参数</span>${showActual?'<span>实际</span>':''}${showPlan?'<span>计划</span>':''}</div>${visible.map(row=>`<div class="tooltip-reading"><span style="color:${row.color}">${esc(row.label)}${showActual&&row.note?`<small>${esc(row.note)}</small>`:''}</span>${showActual?`<b class="cursor-actual-value" title="${esc(row.source||'暂无读数')}">${cursorValueLabel(row)} ${esc(row.unit)}${row.outside?' · 超限':''}</b>`:''}${showPlan?`<b class="cursor-plan-value" title="${esc(row.plan?.source||'暂无计划')}">${plannedCursorValueLabel(row)}</b>`:''}</div>`).join('')||`<span class="tooltip-sub">${state.channels.some(Boolean)?'当前勾选的曲线暂无计划数据':'请勾选需要查看的曲线'}</span>`}${showActual?visible.filter(row=>row.source&&(row.channel>=4||row.source.startsWith('最近'))).map(row=>`<span class="tooltip-sub">${esc(row.label)} · ${esc(row.source)}</span>`).join(''):''}</div>`;
}
function selectedCursorReadings(time){
  const snapshot=cursorSnapshot(time),thermal=snapshot.thermal,water=snapshot.water[0],rate=rateReadingAt(time),reference=getReference(time),rows=[];
  const planSource=reference?`计划 · ${reference.name}`:'';
  for(let j=0;j<4;j++)if(state.channels[j]){
    const spec=reference?.temps[j];
    rows.push({channel:j,label:names[j],color:colors[j],value:thermal?.row[keys[j]],unit:j===3?'MPa':'℃',digits:j===3?3:1,source:thermal?sourceLabel(thermal):'',plan:{value:j===3?reference?.pressure:spec?.value,label:spec?.kind==='upper'?`${spec.strict?'<':'≤'}${num(spec.end,1)}`:spec?.kind==='band'?`${num(spec.start,1)}–${num(spec.end,1)}`:spec?.kind==='approx'?`约${num(spec.end,1)}`:null,source:planSource}});
  }
  if(state.channels[4]){
    const limit=water?actualWaterRequirement(water.row.timestamp):null;
    rows.push({channel:4,label:'出塔水汽浓度',color:'#439fd1',value:water?.row.ppmv,unit:'ppmv',digits:2,source:water?`${water.point} · ${sourceLabel(water)}`:'',outside:!!limit&&water.row.ppmv>limit.value,plan:{value:snapshot.plan,label:snapshot.plan!=null&&snapshot.upper?`≤${num(snapshot.plan,2)}`:null,missing:reference?'未设置':'—',source:planSource}});
  }
  if(state.channels[10]){
    const point=ensureWaterPoint('inlet_water'),records=(state.detail.concentrations.inlet_water||[]).filter(row=>(row.point||'未标明采样点')===point),reading=readingAt(records,time,['ppmv']),limit=state.detail.inlet_water_limit_ppmv;
    rows.push({channel:10,label:'进塔水汽浓度',color:'#d15c83',value:reading?.row.ppmv,unit:'ppmv',digits:2,source:reading?`${point} · ${sourceLabel(reading)}`:'',outside:reading?.row.ppmv>limit,plan:{value:reference?limit:null,label:reference?`≤${num(limit,2)}`:null,source:'进塔水汽浓度上限'}});
  }
  for(let j=0;j<4;j++)if(state.channels[j+5])rows.push({channel:j+5,label:trendChannels[j+5].name,color:trendChannels[j+5].color,value:rate?.values[j],unit:j===3?'MPa/h':'℃/h',digits:j===3?3:1,rate:true,source:rate?sourceLabel(rate):'',plan:{value:j===3?reference?.pressure_rate:null,label:j<3&&reference?.rates[j]?rangeLabel(reference.rates[j]):null,missing:reference&&j<3?'未规定':'—',source:planSource}});
  if(state.channels[9]){
    const grouped=new Map();for(const record of state.detail.concentrations?.ammonia||[])if(record.unit===state.ammoniaPlotUnit){if(!grouped.has(record.point))grouped.set(record.point,[]);grouped.get(record.point).push(record);}
    let i=0;for(const [point,records] of grouped){const reading=readingAt(records,time,['value']);rows.push({channel:9,label:`氨水 · ${point}`,color:['#9a73d5','#d79a4c','#53b6ab','#6b92d0'][i++%4],value:reading?.row.value,unit:ammoniaUnits[state.ammoniaPlotUnit]||'%',digits:3,note:reading?.row.note||'',source:reading?sourceLabel(reading):''});}
    if(!grouped.size)rows.push({channel:9,label:'氨水浓度',color:'#9a73d5',value:null,unit:ammoniaUnits[state.ammoniaPlotUnit]||'%',digits:3});
  }
  return rows;
}
function cursorValueLabel(row){return row.value==null&&row.rate?'待积累':num(row.value,row.digits);}
function plannedCursorValueLabel(row){
  const plan=row.plan;if(!plan||plan.value==null&&plan.label==null)return esc(plan?.missing||'—');
  return `${esc(plan.label??num(plan.value,row.digits))} ${esc(row.unit)}`;
}
function renderCursorReading(time){
  time=Number(time);if(Number.isFinite(time))state.cursor=time;
}
function resizeTrendCharts(){
  if(!state.charts[0]||!state.trendSources?.[0])return;
  const areas=actualStageArea(),index=state.trendSources[0].findIndex(series=>series.id===areas.id);
  if(index>=0)state.trendSources[0][index]=areas;
  state.charts[0].setOption({xAxis:{axisLabel:timeAxisStyle()}});updateTrendLayout();
}
function annotationTextSeries(){
  return keys.flatMap((key,j)=>{const rows=state.detail.events.filter(event=>event.kind==='annotation'&&event.channel===key&&event.value!=null);return rows.length?[{id:`annotation-text-${j}`,channel:j,role:'annotation',name:'文字说明',type:'scatter',yAxisIndex:j===3?1:0,data:rows.map(event=>({name:event.title,value:[ms(event.timestamp),event.value]})),symbolSize:0,silent:true,label:{show:true,formatter:'{b}',position:'top',color:'#7187a7',fontSize:chartTextSize(),fontWeight:700,opacity:1,distance:8},z:6}]:[];});
}
function addCurveNote(){
  if(!requireBatch())return;
  const time=state.cursor??ms(state.detail.view_time),reading=readingAt(state.detail.samples,time,keys);
  eventModal({timestamp:new Date(time).toISOString(),kind:'annotation',channel:'t1',value:reading?.kind==='曲线插值'?reading.row.t1:reading&&ms(reading.row.timestamp)===time?reading.row.t1:null,title:'',description:''});
}
