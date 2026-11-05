'use strict';

function latestReadingTime(){
  const detail=state.detail;
  const times=[...detail.samples,...Object.values(detail.concentrations||{}).flat()].map(row=>ms(row.timestamp));
  return times.length?Math.max(...times):null;
}

function nextReadingTime(){
  const last=latestReadingTime();
  return (last??ms(state.detail.batch.start_time))+30*60000;
}

function recentReadingRows(){
  const detail=state.detail,end=latestReadingTime();if(end==null)return {start:null,end:null,rows:[]};
  const start=end-2*3600000,grouped=new Map();
  const getRow=timestamp=>{const time=ms(timestamp);if(time<start||time>end)return null;if(!grouped.has(time))grouped.set(time,{timestamp,thermal:null,water:[],ammonia:[],inlet_water:[]});return grouped.get(time);};
  for(const sample of detail.samples){const row=getRow(sample.timestamp);if(row)row.thermal=sample;}
  for(const kind of ['water','ammonia','inlet_water'])for(const sample of detail.concentrations?.[kind]||[]){const row=getRow(sample.timestamp);if(row)row[kind].push(sample);}
  return {start,end,rows:[...grouped.values()].sort((a,b)=>ms(a.timestamp)-ms(b.timestamp))};
}

function recentConcentrationCell(records,kind){
  return records.length?records.map(row=>`<div class="recent-chemical" title="${esc(row.note||'')}"><b>${num(kind!=='ammonia'?row.ppmv:row.value,kind!=='ammonia'?2:3)}</b>${row.outside_limit?' <span class="pill red">超限</span>':''}${kind==='ammonia'?` <span>${esc(ammoniaUnits[row.unit]||row.unit)}</span>`:''}<small>${esc(row.point||'未标明采样点')}${row.note?' · '+esc(row.note):''}</small></div>`).join(''):'<span class="muted">—</span>';
}

function recentDataPanel(){
  const data=recentReadingRows(),archived=state.detail.batch.status==='completed',age=data.end==null?null:(Date.now()-data.end)/60000;
  const status=data.end==null?'待录入':age<0?'含未来时间记录':archived?'已归档':age>60?'数据过期':'已保存';
  return `<section class="panel recent-data-panel" id="recent-data-panel"><div class="panel-header"><div><div class="section-title">${icon('data')}最近两小时数据 <span class="pill ${age>60&&!archived?'amber':'blue'}">${status}</span></div><p>${data.end==null?'暂无实测记录；首次新增时间默认为批次开工后30分钟。':`${fmt(data.start,false,true)} — ${fmt(data.end,false,true)} · 按最后一条实测记录回看两小时，不插值、不补齐空值。`}</p></div><button class="btn primary small" data-action="next-reading">${icon('plus')}添加新数据</button></div>
    <div class="table-wrap recent-data-table"><table><thead><tr><th>采样时间 / 北京时间</th>${names.map((name,index)=>`<th style="color:${colors[index]}">${name} / ${index===3?'MPa':'℃'}</th>`).join('')}<th style="color:#439fd1">出塔水汽浓度 / ppmv</th><th style="color:#d15c83">进塔水汽浓度 / ppmv（≤200）</th><th style="color:#9a73d5">氨水浓度 / 采样点</th></tr></thead><tbody>${data.rows.map(row=>`<tr><td class="numeric">${fmt(row.timestamp,false,true)}</td>${keys.map((key,index)=>`<td class="numeric">${num(row.thermal?.[key],index===3?3:1)}</td>`).join('')}<td>${recentConcentrationCell(row.water,'water')}</td><td>${recentConcentrationCell(row.inlet_water,'inlet_water')}</td><td>${recentConcentrationCell(row.ammonia,'ammonia')}</td></tr>`).join('')||'<tr><td colspan="8" class="empty-small">暂无实际数据，点击“添加新数据”开始记录。</td></tr>'}</tbody></table></div>
    <div class="recent-data-footer">${data.end==null?'新增首条读数':`下次默认采样时间：${fmt(nextReadingTime(),false,true)}（最后一条记录 + 30 分钟）`}${archived?' · 已归档批次仅允许在归档时间内补录。':''}</div></section>`;
}
