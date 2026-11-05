'use strict';
function actualStageIndex(time){return state.detail.stages.filter(stage=>ms(stage.start_time)<=ms(time)).at(-1)?.stage_index;}
function rateReadingAt(time){
  const rows=state.detail.samples;if(!rows.length)return null;
  const t=ms(time);let lo=0,hi=rows.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(ms(rows[mid].timestamp)<t)lo=mid+1;else hi=mid;}
  const right=rows[lo],left=rows[lo-1];
  if(right&&ms(right.timestamp)===t)return {values:right.rates.values,kind:'采样速率',source:right.timestamp};
  if(left&&right){
    const sameStage=actualStageIndex(left.timestamp)===actualStageIndex(right.timestamp);
    const f=(t-ms(left.timestamp))/(ms(right.timestamp)-ms(left.timestamp));
    return {values:keys.map((_,i)=>sameStage&&left.rates.values[i]!=null&&right.rates.values[i]!=null?left.rates.values[i]+(right.rates.values[i]-left.rates.values[i])*f:null),kind:'曲线插值',source:`${fmt(left.timestamp,true,true)} → ${fmt(right.timestamp,true,true)}`};
  }
  const row=left||right;return {values:row.rates.values,kind:'最近速率采样',source:row.timestamp};
}
function rateRows(reading){
  return keys.map((_,j)=>`<div class="tooltip-reading"><span style="color:${colors[j]}">${j<3?`${['一','二','三'][j]}床层升温速率`:'系统升压速率'}</span><b>${reading?.values[j]==null?'待积累':signed(reading.values[j],j===3?3:1)} ${j===3?'MPa/h':'℃/h'}</b></div>`).join('');
}
function rateTooltip(time){
  const reading=rateReadingAt(time);
  return `<div class="rate-tooltip-inner"><b>${fmt(time,false,true)}</b>${reading?`<span class="tooltip-sub">${esc(sourceLabel(reading))}</span>`:''}${rateRows(reading)}</div>`;
}
function renderRateCursor(time){
  time=Number(time);if(!Number.isFinite(time)||!$('#rate-cursor-values'))return;
  state.rateCursor=time;const reading=rateReadingAt(time);
  $('#rate-cursor-caption').textContent=`${fmt(time,false,true)} · ${reading?sourceLabel(reading):'暂无速率数据'}`;
  $('#rate-cursor-values').innerHTML=rateRows(reading);
}

function waterPointNames(kind='water'){return [...new Set((state.detail.concentrations?.[kind]||[]).map(row=>row.point||'未标明采样点'))];}
function ensureWaterPoint(kind='water'){
  const points=waterPointNames(kind),key=kind==='water'?'waterPoint':'inletWaterPoint',batchKey=key+'Batch';
  if(state[batchKey]!==state.batchId||!points.includes(state[key])){state[batchKey]=state.batchId;state[key]=points[0]||'';}
  return state[key];
}
function waterPointSelector(kind='water'){
  const selected=ensureWaterPoint(kind),points=waterPointNames(kind),inlet=kind==='inlet_water';
  return points.length>1?`<select id="${inlet?'inlet-water-point-select':'water-point-select'}" aria-label="${inlet?'进塔':'实际出塔'}水汽采样点">${points.map(point=>`<option value="${esc(point)}" ${point===selected?'selected':''}>${esc(point)}</option>`).join('')}</select>`:'';
}

function actualStageRanges(){
  const detail=state.detail;
  return detail.stages.flatMap((stage,i)=>{
    const end=detail.stages[i+1]?.start_time||detail.batch.end_time||detail.view_time;
    if(ms(end)<=ms(stage.start_time))return [];
    const completed=(detail.completed_stages||[]).find(done=>done.stage_index===stage.stage_index);
    return [{...stage,name:currentPlan(detail)[stage.stage_index].name,end_time:end,completed:!!completed,completion:completed}];
  });
}
function actualStageArea(){
  const fills=['rgba(106,164,218,0.075)','rgba(93,181,157,0.075)','rgba(160,132,206,0.075)','rgba(221,182,104,0.075)'];
  const inks=['#5b88b2','#599b88','#9178b3','#b19151'];
  return {id:'stage-zones',role:'stage',name:'实际还原阶段分区',type:'line',data:[],silent:true,z:0,markArea:{silent:true,itemStyle:{borderWidth:0},data:actualStageRanges().map(stage=>[{name:`${stage.stage_index+1}. ${compactStageName(stage)}\n${stageDeviationShort(stage)}`,xAxis:ms(stage.start_time),itemStyle:{color:fills[stage.stage_index%4]},label:{show:false,position:'insideTop',offset:[0,(stage.stage_index%2)*18],color:inks[stage.stage_index%4],fontSize:chartTextSize(),fontWeight:700,lineHeight:chartTextSize()+6}},{xAxis:ms(stage.end_time)}])}};
}
