'use strict';
const $ = (q, root=document) => root.querySelector(q);
const $$ = (q, root=document) => [...root.querySelectorAll(q)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg><use href="#i-${name}"/></svg>`;
const names = ['一床层热点','二床层热点','三床层热点','系统压力'];
const keys = ['t1','t2','t3','pressure'];
const colors = ['#3478ed','#15a998','#9166dc','#e09b37'];
const state = {canEdit:false,batchId:localStorage.getItem('ammonia-batch'), batches:[], detail:null, tab:'monitor', range:'all', visibility:'both', channels:[true,true,true,true,true], charts:[], filter:'all', zoom:null, importData:null, cursor:null};
const num = (v, digits=1) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(digits);
const signed = (v,digits=1) => v == null ? '—' : `${v>0?'+':''}${num(v,digits)}`;
const ms = t => new Date(t).getTime();
function fmt(t,short=false,seconds=false) {
  if(!t) return '—';
  const p = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(t));
  return short ? p.slice(5,seconds?19:16) : p.slice(0,seconds?19:16);
}
const localInput = (t=Date.now(),seconds=false) => fmt(t,false,seconds).replace(' ','T');
const isoInput = t => t.length===16 ? `${t}:00+08:00` : /[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}+08:00`;
const hours = t => (ms(t)-ms(state.detail.batch.start_time))/3600000;
function toast(message,error=false) {const t=$('#toast');t.textContent=message;t.className=`visible${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='',4200);}
async function api(path,options={}) {
  const init={...options};
  if((options.method||'GET')!=='GET'&&!state.canEdit)throw new Error('当前账号只有查看权限。');
  if(options.body!==undefined && !(options.body instanceof FormData)){init.body=JSON.stringify(options.body);init.headers={'Content-Type':'application/json',...options.headers};}
  const response=await fetch(path,init);
  if(response.status===401){location.replace('/');throw new Error('请重新登录。');}
  if(!response.ok){let data;try{data=await response.json();}catch{data={detail:`请求失败 ${response.status}`};}throw new Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail));}
  return response.json();
}
const batchPath = suffix => `/api/batches/${state.batchId}${suffix}`;
function statusPill(status) {return `<span class="pill ${status==='active'?'green':status==='completed'?'blue':'amber'}">${{active:'记录中',completed:'已归档',draft:'草稿'}[status]||status}</span>`;}
function disposeCharts(){state.charts.forEach(c=>c.dispose());state.charts=[];}
let loadGeneration=0;
async function loadBatches(preferred) {
  state.batches=await api('/api/batches');
  state.batchId=preferred||state.batchId;
  if(!state.batches.some(b=>b.id===state.batchId))state.batchId=state.batches[0]?.id||null;
  $('#batch-select').innerHTML=state.batches.length?state.batches.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}${b.demo?' · 演示':''}</option>`).join(''):'<option value="">尚无批次</option>';
  $('#batch-select').value=state.batchId||'';
  if(state.batchId)localStorage.setItem('ammonia-batch',state.batchId);
  await refresh();
}
async function refresh() {
  const generation=++loadGeneration;
  if(!state.batchId){state.detail=null;render();return;}
  const detail=normalizeBatchDetail(await api(batchPath('')));
  if(generation!==loadGeneration)return;
  state.detail=detail;
  if(state.tab==='monitor'&&(document.fullscreenElement?.id==='process-chart-panel'||$('.fullscreen-fallback'))){
    state.deferRender=true;disposeCharts();initCharts();return;
  }
  render();
}
function render(){
  disposeCharts();
  const title={monitor:['升温还原监测','跟踪三床层热点与系统压力，让还原过程清晰可见。','监测总览'],data:['读数与数据','每次读数即时保存，历史数据随时回看、修正和导出。','读数与数据'],plan:['还原计划','原表要求与推算参考分开展示，保留每个批次的独立基准。','还原计划'],help:['使用指南','从第一条读数到完整时间线，按现场节奏记录。','使用指南']}[state.tab];
  $('#page-title').innerHTML=`${title[0]}<span class="heading-dot">.</span>`;$('#page-subtitle').textContent=title[1];$('#crumb').textContent=title[2];
  $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.tab===state.tab));
  $('#batch-status').innerHTML=state.detail?statusPill(state.detail.batch.status):'';
  $('#demo-banner').hidden=!state.detail?.batch.demo;
  $('#demo-banner').innerHTML='<b>演示批次 / SIMULATED DATA</b>　全部读数为模拟值，包含一层还原主期延期 2 小时；用于体验曲线、标记与时间线。实际监测请新建批次。';
  const content=$('#content');
  if(state.tab==='help'){content.innerHTML=helpView();return;}
  if(!state.detail){content.innerHTML=`<div class="empty-state"><div class="empty-symbol">NH₃</div><h2>从一个还原批次开始</h2><p>${state.canEdit?'填写开工时间与初始温度，或先体验完整的 127 小时演示。':'暂无可查看的批次，请等待编辑账号创建或恢复数据。'}</p><div class="empty-actions"><button class="btn primary" data-action="batch">${icon('plus')}新建还原批次</button><button class="btn" data-action="demo">查看演示</button></div></div>`;return;}
  if(state.tab==='data'){content.innerHTML=dataView()+concentrationTable();bindDataFilter();return;}
  if(state.tab==='plan'){content.innerHTML=planView()+waterPlanSection();return;}
  if(state.detail.batch.status==='draft'){content.innerHTML=`<div class="empty-state"><div class="empty-symbol">01</div><h2>计划就绪，等待开工</h2><p>开工时间 ${fmt(state.detail.batch.start_time)}，初始温度 ${state.detail.batch.initial.map(v=>num(v)).join(' / ')}℃。<br>可先查看、调整计划；启动后快照将锁定。</p><div class="empty-actions"><button class="btn primary" data-action="start">启动本批次</button><button class="btn" data-action="show-plan">查看还原计划</button></div></div>`;return;}
  content.innerHTML=monitorView();initCharts();
}
function rangeLabel(range,unit=''){return !range?'未规定':range[0]===range[1]?`${num(range[0],range[0]%1?1:0)}${unit}`:`${num(range[0],range[0]%1?1:0)}–${num(range[1],range[1]%1?1:0)}${unit}`;}
function targetLabel(spec){if(!spec)return '未规定';return spec.kind==='ramp'?`${num(spec.value)}℃（插值）`:`${spec.label}℃`;}
function comparisonText(sample,ref,j){
  if(!sample||!ref)return '暂无对比';
  if(j===3)return `${ref.pressure_label?.includes('约')?'约值':'参考'} ${num(ref.pressure,2)} · Δ ${signed(sample.pressure-ref.pressure,2)} MPa`;
  const s=ref.temps[j],v=sample[keys[j]];
  if(s.kind==='upper')return `${s.label}℃ · 距上限 ${signed(v-s.end)}℃`;
  if(s.kind==='band')return `${s.label}℃ · ${v>=s.start&&v<=s.end?'范围内':'范围外'}`;
  return `${s.kind==='approx'?'约值':'参考'} ${num(s.value)}℃ · Δ ${signed(v-s.value)}℃`;
}
function stageDurationText(seconds){
  seconds=Math.max(0,Math.floor(seconds));
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
  if(hours)return `${hours}小时${minutes?` ${minutes}分钟`:''}`;
  return minutes?`${minutes}分钟`:seconds?`${seconds}秒`:'0分钟';
}
function stageProgressSummary(detail=state.detail){
  const actual=detail.stages.at(-1),index=actual?.stage_index??0,stage=currentPlan(detail)[index];
  const start=ms(actual?.start_time||detail.batch.start_time),now=ms(detail.view_time),completed=detail.batch.status==='completed';
  const waiting=!completed&&(detail.batch.status==='draft'||now<start),planSeconds=stage.hours*3600;
  const elapsedSeconds=Math.max(0,(now-start)/1000),difference=elapsedSeconds-planSeconds,overdue=!waiting&&difference>0;
  const remainingLabel=waiting?'距离开始':completed?(difference>0?'超出计划':difference<0?'提前完成':'计划差值'):overdue?'已超计划':'计划剩余';
  const remainingSeconds=waiting?Math.max(0,(start-now)/1000):Math.abs(difference);
  return {stage,index,start,plannedEnd:start+planSeconds*1000,waiting,completed,overdue,
    caption:completed?'归档阶段':'当前阶段',status:completed?'已归档':waiting?'待开始':overdue?'已超计划':'进行中',
    elapsedSeconds,planSeconds,percentage:elapsedSeconds/planSeconds*100,
    total:stageDurationText((now-ms(detail.batch.start_time))/1000),
    metrics:[{key:'elapsed',label:completed?'实际用时':'已进行',value:stageDurationText(elapsedSeconds)},
      {key:'planned',label:'计划时长',value:stageDurationText(planSeconds)},
      {key:'remaining',label:remainingLabel,value:stageDurationText(remainingSeconds)}]};
}
function stagePanel(){
  const progress=stageProgressSummary(),{stage,index,waiting,completed,overdue}=progress;
  const percentage=Math.max(0,Math.min(100,progress.percentage));
  return `<section id="process-progress" class="in-chart-progress ${waiting?'is-waiting':overdue?'is-overdue':''}">
    <div class="stage-overview"><div class="section-title">${icon('clock')}实际还原进程 <span class="stage-run-status">${progress.status}</span></div><span class="stage-total">累计还原 <b>${progress.total}</b></span></div>
    <div class="stage-progress-main"><div class="current-stage"><small class="current-stage-caption">${progress.caption}</small><strong class="current-stage-name">${esc(stage.name)}</strong></div>
      <dl class="stage-time-metrics">${progress.metrics.map(metric=>`<div class="stage-time-metric metric-${metric.key}"><dt>${metric.label}</dt><dd id="stage-${metric.key}-value">${metric.value}</dd></div>`).join('')}</dl></div>
    <div class="stage-time-track"><div class="stage-progress-heading"><span>${waiting?'本阶段尚未开始':'本阶段用时 / 计划时长'}</span><b>${Math.round(progress.percentage)}%</b></div><div class="stage-duration-track" role="progressbar" aria-label="本阶段计划时长使用比例" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percentage)}" aria-valuetext="${esc(progress.metrics.map(metric=>metric.label+' '+metric.value).join('，'))}"><span style="width:${percentage}%"></span></div></div>
    <div class="stage-progress-footer"><div class="stage-dates"><span>本阶段开始 <b>${fmt(progress.start)}</b></span><span>计划结束 <b>${fmt(progress.plannedEnd)}</b></span></div>${state.detail.batch.status==='active'?`<button class="btn primary small" data-action="${index<9?'stage':'complete'}" ${waiting?'disabled':''}>${index<9?'完成本阶段':'完成本阶段并归档'} ${icon('arrow')}</button>`:''}</div>
  </section>`;
}
function monitorView(){return renderMonitor();}
function timelineItems(){
  const items=state.detail.timeline.filter(e=>state.filter==='all'||e.kind===state.filter);
  return items.length?items.map(e=>`<article class="timeline-item ${esc(e.kind)}" data-focus-time="${esc(e.timestamp)}"><time>${fmt(e.timestamp,true)} <span class="muted">· ${signed(hours(e.timestamp))}h</span></time><h4>${esc(e.title)}${e.kind==='annotation'?'<span class="pill blue">标记</span>':''}</h4><p>${esc(e.description)}</p>${e.kind==='stage'?(e.stage_index>0?`<button class="icon-btn event-edit" data-action="edit-stage" data-id="${e.stage_index}" title="修正阶段开始时间">${icon('edit')}</button>`:''):`<button class="icon-btn event-edit" data-action="edit-event" data-id="${esc(e.id)}" title="编辑事件">${icon('edit')}</button>`}</article>`).join(''):'<div class="empty-small">还没有这类事件<br>添加现场操作，开始串起时间线。</div>';
}
function getReference(time){
  const d=state.detail,t=ms(time),batch={...d.batch,plan:d.curve_plan||d.batch.plan};
  if(t<ms(batch.start_time)||batch.status==='draft')return null;
  let index=0,start=ms(batch.start_time);
  for(let j=0;j<batch.plan.length-1;j++){if(t<start+batch.plan[j].hours*3600000)break;start+=batch.plan[j].hours*3600000;index++;}
  const stage=batch.plan[index],fraction=Math.max(0,Math.min(1,(t-start)/(stage.hours*3600000)));
  return {stage_index:index,name:stage.name,temps:stage.temps.map((value,j)=>({...value,value:value.kind==='ramp'?(value.start??batch.initial[j])+(value.end-(value.start??batch.initial[j]))*fraction:['target','approx'].includes(value.kind)?value.end:null})),pressure:stage.pressure[0]+(stage.pressure[1]-stage.pressure[0])*fraction,pressure_rate:fraction<1?(stage.pressure[1]-stage.pressure[0])/stage.hours:0,rates:stage.rates};
}
function initCharts(){initTrendCharts();}
function cursorReadout(time){renderCursorReading(time);}
function setRange(value){
  if(value==='custom'){timeRangeModal();return;}
  state.range=value;state.zoom=null;
  const end=ms(state.detail.view_time),start=state.chartStart,max=state.chartEnd;
  const lo=value==='all'?start:Math.max(start,end-Number(value)*3600000),hi=value==='all'?max:Math.max(lo+1800000,end);
  state.charts[0]?.dispatchAction({type:'dataZoom',startValue:lo,endValue:hi});
}
function timeRangeModal(){
  if(!state.charts[0])return;
  const zoom=state.charts[0].getOption().dataZoom[0];
  const lo=Number(zoom.startValue??state.chartStart),hi=Number(zoom.endValue??state.chartEnd);
  // Restore the select if the dialog is cancelled after selecting its custom option.
  $('#chart-range').value=state.range;
  modal('设置查看时间段',`<form><p class="modal-copy">按北京时间选择起止时间。可查看范围：${fmt(state.chartStart,false,true)} 至 ${fmt(state.chartEnd,false,true)}。</p><div class="form-grid"><label class="field full">开始时间 · 北京时间<input type="datetime-local" name="range_start" required step="1" value="${localInput(lo,true)}"></label><label class="field full">结束时间 · 北京时间<input type="datetime-local" name="range_end" required step="1" value="${localInput(hi,true)}"></label></div>${formFooter('应用时间段')}</form>`);
  wireForm(async form=>{
    const start=ms(isoInput(form.get('range_start'))),end=ms(isoInput(form.get('range_end')));
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new Error('结束时间必须晚于开始时间。');
    if(start<state.chartStart||end>state.chartEnd)throw new Error('请选择上述可查看范围内的时间。');
    state.range='custom';state.zoom={startValue:start,endValue:end};
    state.charts[0].dispatchAction({type:'dataZoom',startValue:start,endValue:end});
    $('#chart-range').value='custom';closeModal();updateTrendLayout();
    toast('已切换查看时间段');
  });
}
function focusTime(t){
  const time=ms(t);state.charts[0]?.dispatchAction({type:'dataZoom',startValue:Math.max(state.chartStart,time-3*3600000),endValue:Math.min(state.chartEnd,time+3*3600000)});
  cursorReadout(time);state.charts[0]?.dispatchAction({type:'showTip',x:state.charts[0].convertToPixel({xAxisIndex:0},time),y:120});
}
function dataView(){
  const d=state.detail;
  return `<section class="panel"><div class="data-tools"><div><div class="section-title">${icon('data')}采样记录 <span class="pill blue">${d.samples.length} 条</span></div></div><div><input type="search" id="data-search" placeholder="按日期或时间筛选" aria-label="筛选采样记录"><button class="btn small" data-action="export">${icon('download')}导出 / 备份</button></div></div><div class="table-wrap"><table><thead><tr><th>采样时间 / 北京时间</th><th>累计 h</th><th style="color:${colors[0]}">一床层 ℃</th><th style="color:${colors[1]}">二床层 ℃</th><th style="color:${colors[2]}">三床层 ℃</th><th>压力 MPa</th><th>速率 ℃/h · MPa/h</th><th>操作</th></tr></thead><tbody id="sample-table">${dataRows(d.samples)}</tbody></table></div><div class="table-note"><span>速率采用最近 2 小时线性拟合；阶段切换后重新积累。</span><span>所有编辑即时保存到云端</span></div></section>`;
}
function dataRows(samples){return samples.length?[...samples].reverse().map(s=>`<tr><td class="numeric">${fmt(s.timestamp,false,true)}</td><td class="numeric">${num(hours(s.timestamp))}</td>${keys.map((k,j)=>`<td class="numeric">${num(s[k],j===3?3:1)}</td>`).join('')}<td class="numeric muted">${s.rates.values.map((r,j)=>num(r,j===3?3:1)).join(' / ')}</td><td><div class="row-actions"><button class="text-btn" data-action="edit-sample" data-id="${esc(s.id)}">编辑</button><button class="text-btn" data-action="mark-sample" data-id="${esc(s.id)}">标记</button></div></td></tr>`).join(''):'<tr><td colspan="8" class="empty-small">暂无读数。手动录入或导入文件后，即可查看趋势。</td></tr>';}
function bindDataFilter(){$('#data-search')?.addEventListener('input',e=>{$('#sample-table').innerHTML=dataRows(state.detail.samples.filter(s=>fmt(s.timestamp).includes(e.target.value.trim())));});}
function helpView(){return `<div class="help-grid">${[
  ['01','建立现场批次','填写名称、北京时间开工时间、三个床层各自初始温度。可以先保存为草稿，在还原计划中调整参数；启动时锁定本批次计划。演示数据完全独立。'],
  ['02','每半小时记录一次','点击“录入读数”填写三个热点温度和系统压力。使用实际采样时间，可补录；超过60分钟没有新读数，概览显示数据过期，并保留最后采样时间。'],
  ['03','读懂计划与完成偏差','计划曲线固定从开工时间绘制，阶段整段色带显示已完成及提前、延期时间。速率使用最近2小时线性拟合，至少两个不同时间点、跨度达到30分钟，且不跨实际阶段。未规定的速率不作判断。'],
  ['04','查看综合趋势与操作时间线','温度、压力、水汽、升温与升压速率、氨水浓度均在同一大图，勾选后显示对应纵轴与游标读数，刻度随时间缩放调整。曲线较多时趋势区域自动加宽。点击空白处全屏，Ctrl＋滚轮缩放。“录入实际数据”和右键共用同一窗口；“＋事件”可记录任意时间的操作，点击时间线定位趋势。'],
  ['05','导入、导出与备份','使用CSV或.xlsx文件，第一行为表头，时间和四项读数各一列。导入时选择列映射，核对℃、MPa与北京时间，再预览。异常行会阻止整批写入，重复时间默认保留已有值。'],
  ['06','保存与恢复','数据保存在当前私有网站的云端数据库，可跨电脑访问。导出的JSON备份包含本批次计划、读数、阶段和事件；恢复时新建独立批次，不覆盖现有数据。水汽、氨水可独立采样，在浓度曲线上方录入；水汽默认0℃、101.325kPa绝压，氨水默认质量分数%，采样点和备注在浓度表中编辑。']
].map(([n,title,text])=>`<article class="panel help-card"><div class="step-number">${n}</div><h3>${title}</h3><p>${text}</p></article>`).join('')}</div><div class="info-box amber" style="margin-top:20px">本程序接收人工读数并展示对比，不自动采集现场仪表、不向设备写入指令。图中的插值线与推算升压速率均标明来源；原表中不一致的温度、时长与速率不会被自动修改。</div>`;}

function modal(title,html,wide=false){const dialog=$('#modal'),host=document.fullscreenElement||$('.fullscreen-fallback')||document.body;if(dialog.parentElement!==host)host.append(dialog);dialog.classList.toggle('wide',wide);$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;if(!dialog.open)dialog.showModal();$('input:not([type=hidden]),textarea,select',dialog)?.focus({preventScroll:true});}
function closeModal(){const dialog=$('#modal');dialog.close();document.body.append(dialog);state.importData=null;}
function formFooter(text,extra=''){return `<div class="form-error" id="form-error" role="alert"></div><div class="form-actions">${extra}<button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">${text}</button></div>`;}
function wireForm(fn){$('#modal form').addEventListener('submit',async event=>{event.preventDefault();const button=$('button[type=submit]',event.target);button.disabled=true;$('#form-error').textContent='';try{await fn(new FormData(event.target));}catch(e){$('#form-error').textContent=e.message;}finally{button.disabled=false;}});}
function requireBatch(){if(!state.detail){batchModal();return false;}return true;}
function requireStarted(){if(!requireBatch())return false;if(state.detail.batch.status==='draft'){toast('请先启动批次，再录入或导入读数',true);return false;}return true;}
function batchModal(){modal('新建还原批次',`<form><p class="modal-copy">使用实际开工时间与各床层起始温度。每个批次独立保存，不与演示数据混用。</p><div class="form-grid"><label class="field full">批次名称<input name="name" required maxlength="100" placeholder="例如：1号合成塔 · 首次还原"></label><label class="field full">开工时间 · 北京时间<input type="datetime-local" name="start_time" required value="${localInput()}"></label>${names.slice(0,3).map((n,j)=>`<label class="field">${n}起始温度 / ℃<input type="number" step="any" min="-273.15" name="t${j+1}" required placeholder="填写实测初始温度"></label>`).join('')}<label class="field checkbox full"><input type="checkbox" name="draft">先保存草稿，调整计划后再启动</label></div>${formFooter('创建批次')}</form>`);wireForm(async form=>{const b=await api('/api/batches',{method:'POST',body:{name:form.get('name'),start_time:isoInput(form.get('start_time')),initial:[1,2,3].map(j=>Number(form.get(`t${j}`))),start:!form.get('draft')}});closeModal();state.zoom=null;state.tab='monitor';await loadBatches(b.id);toast('批次已创建并保存到云端');});}
function sampleModal(sample){if(!requireStarted())return;const editing=!!sample?.id;modal(editing?'修正采样读数':'录入现场读数',`<form><p class="modal-copy">建议每半小时录入一次。请使用采样发生时的北京时间，保存后趋势与速率立即重算。</p><div class="form-grid"><label class="field full">采样时间<input type="datetime-local" name="timestamp" required step="1" value="${sample?localInput(sample.timestamp,true):localInput(Date.now(),true)}"></label>${names.map((n,j)=>`<label class="field">${n} / ${j===3?'MPa':'℃'}<input type="number" name="${keys[j]}" required step="any" min="${j===3?0:-273.15}" value="${sample?.[keys[j]]??''}" placeholder="填写实测值"></label>`).join('')}</div>${formFooter(editing?'保存修正':'保存读数',editing?'<button type="button" class="btn danger left" data-action="delete-sample" data-id="'+esc(sample.id)+'">删除读数</button>':'')}</form>`);wireForm(async form=>{const data={timestamp:isoInput(form.get('timestamp')),...Object.fromEntries(keys.map(k=>[k,Number(form.get(k))]))};await api(batchPath(`/samples${editing?'/'+sample.id:''}`),{method:editing?'PUT':'POST',body:data});closeModal();await refresh();toast(editing?'读数已修正，趋势已重算':'读数已保存');});}
function eventModal(event){if(!requireBatch())return;const editing=!!event?.id;modal(editing?'编辑事件 / 标记':event?.kind==='annotation'?'添加曲线标记':'添加现场事件',`<form><p class="modal-copy">按实际发生时间记录。事件与阶段切换会放在同一条时间线上。</p><div class="form-grid"><label class="field full">发生时间 · 北京时间<input name="timestamp" type="datetime-local" required step="1" value="${localInput(event?.timestamp||Date.now(),true)}"></label><label class="field">记录类型<select name="kind"><option value="operation" ${event?.kind!=='annotation'?'selected':''}>现场操作</option><option value="annotation" ${event?.kind==='annotation'?'selected':''}>曲线标记</option></select></label><label class="field">关联通道<select name="channel"><option value="">无关联通道</option>${keys.map((k,j)=>`<option value="${k}" ${event?.channel===k?'selected':''}>${names[j]}</option>`).join('')}</select></label><label class="field full">标题<input name="title" required maxlength="120" value="${esc(event?.title||'')}" placeholder="例如：调整加热负荷 / 开始保温"></label><label class="field full">文字说明<textarea name="description" maxlength="4000" placeholder="此时发生了什么，进行了哪些操作…">${esc(event?.description||'')}</textarea></label><label class="field full">标记数值 · 可选<input type="number" name="value" step="any" value="${event?.value??''}" placeholder="关联通道上的实测值；不填时只显示时间线"></label></div>${formFooter(editing?'保存修改':'保存事件',editing?`<button type="button" class="btn danger left" data-action="delete-event" data-id="${esc(event.id)}">删除事件</button>`:'')}</form>`);wireForm(async form=>{const data={timestamp:isoInput(form.get('timestamp')),kind:form.get('kind'),title:form.get('title'),description:form.get('description'),channel:form.get('channel')||null,value:form.get('value')===''?null:Number(form.get('value'))};await api(batchPath(`/events${editing?'/'+event.id:''}`),{method:editing?'PUT':'POST',body:data});closeModal();await refresh();toast('事件已保存到时间线');});}
function stageModal(index){if(!requireStarted())return;const d=state.detail,editing=Number.isInteger(index),next=editing?index:d.stages.length;if(next>=10){toast('已是最后阶段');return;}modal(editing?'修正实际阶段时间':'完成本阶段并进入下一阶段',`<form><div class="info-box">${editing?'修正后将按新的实际边界重算速率，阶段时间必须保持先后顺序。':'填写本阶段完成时间，同时作为下一阶段开始时间。图中将整段标记已完成，并显示相对计划完成时刻的提前或延期。'}</div><div class="form-grid"><label class="field full">${editing?'修正阶段':'即将进入'}<input value="${esc(currentPlan()[next].name)}" readonly></label><label class="field full">${editing?'实际阶段开始时间':'本阶段完成 / 下一阶段开始时间'} · 北京时间<input type="datetime-local" name="timestamp" required step="1" value="${localInput(editing?d.stages[index].start_time:Date.now(),true)}"></label></div>${formFooter(editing?'保存修正':'确认阶段完成')}</form>`);wireForm(async form=>{await api(batchPath(`/stages${editing?'/'+index:''}`),{method:editing?'PUT':'POST',body:{timestamp:isoInput(form.get('timestamp'))}});closeModal();await refresh();toast('阶段完成记录已保存，整段标记及时间偏差已更新');});}
function completeModal(){modal('结束并归档批次',`<form><p class="modal-copy">结束后保留全部读数、计划和时间线，可继续修正历史读数与添加说明。</p><label class="field">实际结束时间<input type="datetime-local" name="timestamp" required step="1" value="${localInput(Date.now(),true)}"></label>${formFooter('结束并归档')}</form>`);wireForm(async f=>{await api(batchPath('/complete'),{method:'POST',body:{timestamp:isoInput(f.get('timestamp'))}});closeModal();await loadBatches();toast('批次已归档');});}
function exportModal(){if(!requireBatch())return;modal('导出与备份',`<p class="modal-copy">备份只包含当前批次。恢复时创建独立副本，不覆盖已有记录。</p><div class="export-options">${[['concentrations','浓度记录 CSV','包含水汽原值、ppmv、换算温压及氨水采样点备注。'],['samples','采样读数 CSV','包含时间、三床层温度和系统压力。'],['events','完整时间线 CSV','包含操作、标记和实际阶段切换。'],['backup','完整批次 JSON 备份','包含计划、读数、阶段、事件以及全部浓度与备注。']].map(([kind,title,text])=>`<div class="export-option"><div><strong>${title}</strong><p>${text}</p></div><a class="btn small" href="${batchPath('/export/'+kind)}" download>${icon('download')}下载</a></div>`).join('')}<div class="export-option"><div><strong>从 JSON 备份恢复</strong><p>包含浓度、采样点和备注；兼容旧备份，恢复为独立批次。</p></div><button class="btn small" data-action="restore">选择备份</button></div></div>`);}
async function restoreModal(){modal('恢复批次备份',`<form><p class="modal-copy">恢复为独立副本，不会覆盖已有批次。</p><input class="file-input" name="file" type="file" accept=".json" required>${formFooter('恢复为新批次')}</form>`);wireForm(async form=>{const r=await api('/api/restore',{method:'POST',body:form});closeModal();state.zoom=null;await loadBatches(r.id);toast('备份已恢复为新批次');});}
function importModal(){if(!requireStarted())return;state.importData=null;modal('导入采样数据',`<p class="modal-copy">支持 CSV / Excel .xlsx，第一行为表头。单位必须为 ℃、MPa；无时区的时间按北京时间处理。最多10000行、10MB。</p><div style="display:flex;gap:9px;margin-bottom:16px"><a class="btn small" href="/api/templates/csv" download>CSV 空白模板</a><a class="btn small" href="/api/templates/xlsx" download>Excel 空白模板</a></div><input id="import-file" class="file-input" type="file" accept=".csv,.xlsx"><div id="import-settings"></div><div class="form-error" id="form-error" role="alert"></div>`,true);$('#import-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{const f=new FormData();f.append('file',file);const data=await api('/api/import/inspect',{method:'POST',body:f});state.importData=data;renderImportSettings();}catch(e){$('#form-error').textContent=e.message;}});}
function renderImportSettings(){
  const data=state.importData;
  const suggested=['时间','一床','二床','三床','压力'];
  $('#import-settings').innerHTML=`<div class="import-mapping">${['timestamp',...keys].map((k,j)=>{let n=data.headers.findIndex(h=>h.includes(suggested[j])||h===k);if(n<0)n=j;return `<label>${j===0?'时间':names[j-1]}<select data-map="${k}">${data.headers.map((h,i)=>`<option value="${i}" ${n===i?'selected':''}>${esc(h||'未命名列 '+(i+1))}</option>`).join('')}</select></label>`;}).join('')}</div><div class="form-grid"><label class="field">重复时间处理<select id="import-policy"><option value="keep">保留已有值（文件内重复保留首条）</option><option value="replace">覆盖已有值（文件内重复采用末条）</option></select></label><div class="field"><span>单位与时间</span><small>℃ / MPa · UTC+08:00 北京时间<br>不自动换算其他单位</small></div></div><div class="form-actions"><button class="btn" data-action="preview-import">检查并预览</button><button class="btn primary" id="commit-import" disabled data-action="commit-import">确认导入</button></div><div class="import-result" id="import-result"></div>`;
  $$('#import-settings select').forEach(s=>s.addEventListener('change',()=>{$('#commit-import').disabled=true;$('#import-result').innerHTML='列映射或策略已变化，请重新预览。';}));
}
function importBody(){return {rows:state.importData.rows,mapping:Object.fromEntries($$('[data-map]').map(s=>[s.dataset.map,Number(s.value)])),policy:$('#import-policy').value};}
async function previewImport(){const data=await api(batchPath('/import/preview'),{method:'POST',body:importBody()});$('#form-error').textContent='';$('#import-result').innerHTML=`<div class="import-stats"><span class="pill blue">有效 ${data.valid_count} 行</span><span class="pill ${data.errors.length?'red':'green'}">异常 ${data.errors.length} 行</span><span class="pill amber">重复 ${data.duplicates.length} 行</span></div>${data.errors.length?`<div class="info-box amber">${data.errors.slice(0,8).map(e=>`第 ${e.row} 行：${esc(e.message)}`).join('<br>')}${data.errors.length>8?'<br>仅显示前8条异常':''}</div>`:''}<div class="table-wrap"><table><thead><tr><th>北京时间</th>${names.map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${data.preview.map(s=>`<tr><td>${fmt(s.timestamp)}</td>${keys.map(k=>`<td>${s[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="modal-copy">预览前8行；确认单位为℃ / MPa，时间为北京时间。${data.errors.length?'存在异常，整批不会写入。':'确认后整批事务写入。'}</p>`;$('#commit-import').disabled=!!data.errors.length||!data.valid_count;}
function editPlanModal(){
  const plan=state.detail.batch.plan;
  modal('编辑草稿计划',`<p class="modal-copy">逐段调整时长、温度与速率。温度格式：常温～200、200～360、≤350、&lt;360、495～500、500、约475。范围温度在速率为0时按保温色带处理，其余按升温段处理。</p><form><div class="table-wrap"><table><thead><tr><th>阶段</th><th>时长 h</th><th>一床层 ℃ / ℃h</th><th>二床层 ℃ / ℃h</th><th>三床层 ℃ / ℃h</th><th>压力起 / 终 MPa</th></tr></thead><tbody>${plan.map((s,i)=>`<tr><td>${esc(s.name)}</td><td><input class="plan-input" type="number" step="any" min="0.01" required name="h-${i}" value="${s.hours}"></td>${s.temps.map((t,j)=>`<td><input class="plan-input" style="width:100px" required name="t-${i}-${j}" value="${esc(t.label)}"><br><input class="plan-input" style="width:100px;margin-top:5px" name="r-${i}-${j}" value="${s.rates[j]?rangeLabel(s.rates[j]):''}" placeholder="空白=未规定"></td>`).join('')}<td><input class="plan-input" required type="number" step="any" min="0" name="p0-${i}" value="${s.pressure[0]}"><br><input class="plan-input" style="margin-top:5px" required type="number" step="any" min="0" name="p1-${i}" value="${s.pressure[1]}"></td></tr>`).join('')}</tbody></table></div>${formFooter('保存草稿计划')}</form>`,true);
  const parseRange=text=>{const matches=text.replace(/[−–—～~]/g,'-').match(/\d+(?:\.\d+)?/g);if(!matches||matches.length>2)throw new Error(`范围无法识别：${text}`);return matches.length===1?[Number(matches[0]),Number(matches[0])]:matches.map(Number);};
  wireForm(async f=>{const updated=structuredClone(plan);for(let i=0;i<10;i++){const s=updated[i];s.hours=Number(f.get(`h-${i}`));for(let j=0;j<3;j++){const label=f.get(`t-${i}-${j}`).trim(),rt=f.get(`r-${i}-${j}`).trim();s.rates[j]=rt?parseRange(rt):null;const bounds=parseRange(label),end=bounds[1];let kind=label.includes('约')?'approx':/^[≤<]/.test(label)?'upper':label.includes('常温')?'ramp':bounds[0]!==bounds[1]?(s.rates[j]?.every(v=>v===0)?'band':'ramp'):'target';s.temps[j]={kind,start:kind==='ramp'&&label.includes('常温')?null:['ramp','band'].includes(kind)?bounds[0]:null,end,label,strict:label.startsWith('<')};}s.pressure=[Number(f.get(`p0-${i}`)),Number(f.get(`p1-${i}`))];if(s.pressure.some((v,j)=>v!==plan[i].pressure[j]))s.pressure_label=s.pressure[0]===s.pressure[1]?String(s.pressure[0]):s.pressure.join('–');}await api(batchPath('/plan'),{method:'PUT',body:updated});closeModal();await refresh();toast('草稿计划已保存');});
}
async function confirmDelete(kind,id){if(!confirm(`确认删除这条${kind==='sample'?'读数':'事件'}？删除后请从备份恢复。`))return;await api(batchPath(`/${kind==='sample'?'samples':'events'}/${id}`),{method:'DELETE'});closeModal();await refresh();toast('记录已删除');}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-tab]');if(nav){state.tab=nav.dataset.tab;render();return;}
  const filter=event.target.closest('[data-filter]');if(filter){state.filter=filter.dataset.filter;$$('[data-filter]').forEach(n=>n.classList.toggle('active',n.dataset.filter===state.filter));$('#timeline-list').innerHTML=timelineItems();return;}
  const action=event.target.closest('[data-action]');
  if(!action){const time=event.target.closest('[data-focus-time]');if(time)focusTime(time.dataset.focusTime);return;}
  const id=action.dataset.id;
  try{
    switch(action.dataset.action){
      case 'close':closeModal();break;
      case 'batch':batchModal();break;
      case 'sample':sampleModal();break;
      case 'time-range':timeRangeModal();break;
      case 'actual-data':cursorReadingsModal(state.cursor??ms(state.detail.view_time));break;
      case 'next-reading':cursorReadingsModal(nextReadingTime(),{source:'next'});break;
      case 'fullscreen':await toggleTrendFullscreen();break;
      case 'water':concentrationModal('water');break;
      case 'inlet-water':concentrationModal('inlet_water');break;
      case 'water-plan':waterPlanModal();break;
      case 'curve-stage':curveStageModal(Number(action.dataset.stage));break;
      case 'curve-note':addCurveNote();break;
      case 'ammonia':concentrationModal('ammonia');break;
      case 'edit-concentration':concentrationModal(action.dataset.kind,state.detail.concentrations[action.dataset.kind].find(r=>r.id===id));break;
      case 'delete-concentration':await deleteConcentration(action.dataset.kind,id);break;
      case 'edit-sample':sampleModal(state.detail.samples.find(s=>s.id===id));break;
      case 'mark-sample':{const s=state.detail.samples.find(s=>s.id===id);eventModal({timestamp:s.timestamp,kind:'annotation',channel:'t1',value:s.t1});break;}
      case 'event':eventModal();break;
      case 'edit-event':eventModal(state.detail.events.find(s=>s.id===id));break;
      case 'delete-sample':await confirmDelete('sample',id);break;
      case 'delete-event':await confirmDelete('event',id);break;
      case 'stage':stageModal();break;
      case 'edit-stage':stageModal(Number(id));break;
      case 'complete':completeModal();break;
      case 'start':await api(batchPath('/start'),{method:'POST'});await loadBatches();toast('批次已启动，计划快照已锁定');break;
      case 'show-plan':state.tab='plan';render();break;
      case 'source-plan':modal('默认原计划 · 2026年11月4日确认',planTable(state.detail.source_plan),true);break;
      case 'edit-plan':editPlanModal();break;
      case 'export':exportModal();break;
      case 'restore':await restoreModal();break;
      case 'import':importModal();break;
      case 'preview-import':await previewImport();break;
      case 'commit-import':{action.disabled=true;try{const r=await api(batchPath('/import'),{method:'POST',body:importBody()});closeModal();await refresh();toast(`已写入 ${r.written} 条，保留已有 ${r.skipped} 条`);}catch(e){action.disabled=false;throw e;}break;}
      case 'demo':{action.disabled=true;try{const r=await api('/api/demo',{method:'POST'});state.zoom=null;state.tab='monitor';await loadBatches(r.id);}finally{action.disabled=false;}break;}
    }
  }catch(e){if($('#modal').open&&$('#form-error'))$('#form-error').textContent=e.message;else toast(e.message,true);}
});
document.addEventListener('change',async event=>{try{if(event.target.id==='batch-select'){state.batchId=event.target.value;state.zoom=null;localStorage.setItem('ammonia-batch',state.batchId);await refresh();}if(event.target.id==='chart-range')setRange(event.target.value);if(event.target.id==='curve-visibility'){state.visibility=event.target.value;applyCurveVisibility();}}catch(e){toast(e.message,true);}});
$('#close-modal').addEventListener('click',closeModal);
$('#modal').addEventListener('cancel',event=>{event.preventDefault();closeModal();});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
window.addEventListener('resize',resizeTrendCharts);
function updateClock(){$('#wall-clock').textContent=fmt(Date.now());}updateClock();setInterval(updateClock,15000);
// Refresh time-dependent freshness and rates without interrupting a form or data edit.
setInterval(()=>{if(state.detail?.batch.status==='active'&&state.tab==='monitor'&&!$('#modal').open)refresh().catch(e=>toast(e.message,true));},60000);
startWorkspace().catch(e=>{$('#content').innerHTML=`<div class="empty-state"><h2>云端服务暂不可用</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">重新连接</button></div>`;});
