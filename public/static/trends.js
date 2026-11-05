'use strict';

function renderMonitor(){
  ensureTrendChannels();
  return `${recentDataPanel()}<div class="workspace">
    <section class="panel trend-panel"><div id="process-chart-panel" class="process-chart-panel">
      <div class="panel-header"><div><div class="section-title">${icon('chart')}升温还原综合趋势</div><p>勾选曲线显示对应纵轴 · 刻度自适应（1k=1000） · 点击空白处全屏</p></div>
        <div class="chart-controls">
          <select id="curve-visibility" aria-label="曲线显示"><option value="both" ${state.visibility==='both'?'selected':''}>计划 + 实际</option><option value="actual" ${state.visibility==='actual'?'selected':''}>仅实际</option><option value="plan" ${state.visibility==='plan'?'selected':''}>仅计划</option></select>
          <select id="chart-range" aria-label="图表时间范围"><option value="all">全程</option><option value="24">最近 24h</option><option value="8">最近 8h</option><option value="2">最近 2h</option><option value="custom">自定义时间段</option></select>
          <button class="btn small" data-action="time-range">设置时间段</button><button class="btn small" data-action="trend-axes">纵轴设置</button><button class="btn small" data-action="actual-data">录入实际数据</button><button class="btn small" data-action="curve-note">＋说明</button><button class="btn small" data-action="fullscreen" aria-label="全屏综合趋势">⛶ 全屏</button>
        </div>
      </div>${stagePanel()}
      <div class="combined-legend">${trendChannels.map((channel,index)=>`<label><input type="checkbox" data-channel="${index}" ${state.channels[index]?'checked':''}><span class="legend-line ${index>=5&&index<=8?'rate-legend-line':''}" style="--c:${channel.color}"></span>${channel.name}</label>`).join('')}<span class="muted">实线：实际　虚线：计划　浅色分区：实际阶段</span></div>
      <div class="curve-point-controls"><span class="water-point-control ${state.channels[4]?'':'hidden'}">${waterPointSelector()}</span><span class="inlet-water-point-control ${state.channels[10]?'':'hidden'}">${waterPointSelector('inlet_water')}</span><span id="ammonia-controls" class="${state.channels[9]?'':'hidden'}"><label>氨水单位 <select id="ammonia-plot-unit" aria-label="氨水曲线单位"><option value="%">质量分数 %</option><option value="g/L">g/L</option><option value="mg/L">mg/L</option></select></label><span id="ammonia-point-key"></span></span></div>
      <div id="trend-viewport" class="trend-viewport"><div id="trend-surface" class="trend-surface">
        <div id="completed-stage-legend" class="completed-stage-legend stage-legend-top">${completedLegend()}</div>
        <div class="chart combined-chart" id="chart-0" role="img" tabindex="0" aria-label="床层温度、压力、出塔水汽、进塔水汽、升温升压速率与氨水浓度综合趋势"></div>
      </div></div>
    </div><div class="chart-legend"><span class="legend-item"><i class="legend-dashed"></i>计划从开工时刻绘制；速率为近2小时拟合值；氨水按同单位分采样点绘线</span><span class="muted">水汽仅绘实际曲线，计划浓度见游标；文字说明保留</span></div></section>
    <aside class="panel timeline-panel"><div class="panel-header"><div class="section-title">${icon('clock')}事件时间线 <span class="pill">${state.detail.timeline.length}</span></div><button class="text-btn" data-action="event">${icon('plus')}事件</button></div><div class="timeline-filter">${[['all','全部'],['operation','现场操作'],['annotation','标记'],['stage','阶段']].map(([value,name])=>`<button class="filter-chip ${state.filter===value?'active':''}" data-filter="${value}">${name}</button>`).join('')}</div><div class="timeline-list" id="timeline-list">${timelineItems()}</div><div class="timeline-footer">${icon('check')}点击事件定位趋势 · 悬停可编辑</div></aside>
  </div>`;
}

function initTrendCharts(){
  if(state.range==='custom'&&!state.zoom)state.range='all';
  ensureTrendChannels();
  const d=state.detail,plan=d.curve_plan||d.batch.plan,grid=d.reference_grid,start=ms(d.batch.start_time),plannedEnd=start+plan.reduce((n,stage)=>n+stage.hours,0)*3600000;
  const chemistry=Object.values(d.concentrations||{}).flat();
  const end=Math.max(start+3600000,ms(d.view_time),plannedEnd,...d.samples.map(row=>ms(row.timestamp)),...chemistry.map(row=>ms(row.timestamp)));
  state.chartStart=start;state.chartEnd=end;
  const sample=(j,rate=false)=>({id:`actual-${j}-${rate}`,name:`${trendChannels[rate?j+5:j].name} · 实际`,channel:rate?j+5:j,role:'actual',type:'line',
    yAxisIndex:rate?(j===3?4:3):(j===3?1:0),data:d.samples.map(row=>[ms(row.timestamp),rate?row.rates.values[j]:row[keys[j]],row.id]),
    showSymbol:false,symbol:'none',symbolSize:0,connectNulls:false,lineStyle:{width:rate?1.8:2.2,color:colors[j],type:'solid'},itemStyle:{color:colors[j]},z:5});
  const combined=[...keys.map((_,j)=>sample(j)),...keys.map((_,j)=>sample(j,true))];
  for(let j=0;j<3;j++)for(let i=0;i<plan.length;i++){
    const stage=plan[i],spec=stage.temps[j],points=grid.filter(point=>point.reference?.stage_index===i);if(!points.length)continue;
    const a=ms(points[0].timestamp),b=ms(points.at(-1).timestamp);
    combined.push({id:`plan-temp-${j}-${i}`,channel:j,role:'plan',name:`${names[j]} · 计划${spec.kind==='upper'?'上限':spec.kind==='approx'?'约值':'参考'}`,type:'line',yAxisIndex:0,
      data:points.map(point=>[ms(point.timestamp),spec.kind==='upper'?spec.end:point.reference.temps[j].value]),showSymbol:false,silent:true,lineStyle:{color:colors[j],width:1.6,type:'dashed',opacity:.58},
      markArea:{silent:true,itemStyle:{color:colors[j]+'12'},data:spec.kind==='band'?[[{xAxis:a,yAxis:spec.start},{xAxis:b,yAxis:spec.end}]]:[]},z:1});
    const range=stage.rates[j];
    if(range)combined.push({id:`plan-rate-${j}-${i}`,channel:j+5,role:'plan',name:`${names[j]}原表速率`,type:'line',yAxisIndex:3,
      data:[[a,range[0]],[b,range[0]],[null,null],[a,range[1]],[b,range[1]]],showSymbol:false,silent:true,lineStyle:{color:colors[j],width:1,type:'dashed',opacity:.5},
      markArea:{silent:true,itemStyle:{color:colors[j]+'0c'},data:[[{xAxis:a,yAxis:range[0]},{xAxis:b,yAxis:range[1]}]]},z:1});
  }
  combined.push({id:'plan-pressure',channel:3,role:'plan',name:'系统压力 · 计划参考',type:'line',yAxisIndex:1,data:grid.map(point=>[ms(point.timestamp),point.reference?.pressure??null]),showSymbol:false,silent:true,lineStyle:{width:1.7,type:'dashed',color:colors[3],opacity:.65}});
  combined.push({id:'plan-pressure-rate',channel:8,role:'plan',name:'由阶段压力和时长推算',type:'line',yAxisIndex:4,data:grid.map(point=>[ms(point.timestamp),point.reference?.pressure_rate??null]),showSymbol:false,silent:true,lineStyle:{width:1.2,type:'dashed',color:colors[3],opacity:.6}});
  combined.push(actualStageArea(),...annotationTextSeries());
  ensureWaterPoint();
  for(const line of concentrationSeries('water').filter(line=>line.name===state.waterPoint))combined.push({...line,id:'actual-water-'+line.id,channel:4,role:'actual',yAxisIndex:2,name:'水汽 · '+line.name});
  const inletPoint=ensureWaterPoint('inlet_water');
  for(const line of concentrationSeries('inlet_water').filter(line=>line.name===inletPoint))combined.push({...line,id:'actual-inlet-water-'+line.id,channel:10,role:'actual',yAxisIndex:2,name:'进塔水汽 · '+line.name});
  const ammonia=concentrationSeries('ammonia');
  for(const line of ammonia)combined.push({...line,channel:9,role:'actual',yAxisIndex:5});
  state.trendSources=[combined];sizeTrendSurface();
  const chart=echarts.init($('#chart-0'),null,{renderer:'canvas'});state.charts=[chart];
  chart.setOption({backgroundColor:'#ffffff',animation:false,textStyle:{fontFamily:'"Segoe UI","Microsoft YaHei",sans-serif',fontSize:chartTextSize(),fontWeight:600},
    grid:processGridLayout(),yAxis:trendAxes(visibleTrendSeries()),
    tooltip:{trigger:'axis',className:'process-hover-tooltip',axisPointer:{type:'cross',label:{backgroundColor:'#5b7293',fontSize:chartTextSize(),fontWeight:700,formatter:point=>point.axisDimension==='x'?fmt(point.value,true):num(point.value,3)}},confine:true,backgroundColor:'#fffffff5',borderColor:'#dfe7f3',textStyle:{color:'#536b8c',fontSize:14,fontWeight:600},formatter:params=>params[0]?mainTooltip(Number(params[0].axisValue)):''},
    xAxis:{type:'time',min:start,max:end,axisLine:{lineStyle:{color:'#e7edf6'}},axisTick:{show:false},axisLabel:timeAxisStyle(),splitLine:{show:false},axisPointer:{show:true,snap:false}},
    dataZoom:[{type:'inside',filterMode:'none',zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false},{type:'slider',height:12,bottom:8,borderColor:'transparent',backgroundColor:'#f2f5fa',fillerColor:'#b7cced66',handleSize:12,handleStyle:{color:'#a0b9df',borderWidth:0},showDetail:false,brushSelect:false}],series:[]});
  chart.on('updateAxisPointer',event=>{const axis=event.axesInfo?.find(axis=>axis.axisDim==='x');if(axis)cursorReadout(axis.value);});
  chart.on('datazoom',()=>{const zoom=chart.getOption().dataZoom[0];state.zoom=state.range==='custom'?{startValue:zoom.startValue,endValue:zoom.endValue}:{start:zoom.start,end:zoom.end};updateTrendLayout();});
  chart.on('finished',updateStageStrip);
  chart.on('click',point=>{
    if(!state.canEdit)return;
    if(point.event?.event&&point.seriesId!=='stage-zones')point.event.event.ammoniaDataHit=true;
    if(point.seriesId?.startsWith('actual-inlet-water-')&&point.value?.[2]){const row=d.concentrations.inlet_water.find(row=>row.id===point.value[2]);if(row)concentrationModal('inlet_water',row);return;}
    if(point.seriesId?.startsWith('actual-water-')&&point.value?.[2]){const row=d.concentrations.water.find(row=>row.id===point.value[2]);if(row)concentrationModal('water',row);return;}
    if(point.seriesId?.startsWith('chem-ammonia-')&&point.value?.[2]){const row=d.concentrations.ammonia.find(row=>row.id===point.value[2]);if(row)concentrationModal('ammonia',row);return;}
    if(point.seriesId?.startsWith('actual-')&&Array.isArray(point.value)&&point.value[2]){
      const sample=d.samples.find(row=>row.id===point.value[2]),index=Number(point.seriesId.split('-')[1]);
      if(sample&&point.seriesId.endsWith('-false'))eventModal({timestamp:sample.timestamp,kind:'annotation',channel:keys[index],value:sample[keys[index]],title:'',description:''});
    }
  });
  chart.getZr().on('click',event=>{const point=[event.offsetX,event.offsetY];setTimeout(()=>{if(!document.fullscreenElement&&!$('.fullscreen-fallback')&&!event.event?.ammoniaDataHit&&!chart.isDisposed()&&chart.containPixel({gridIndex:0},point))toggleTrendFullscreen().catch(error=>toast(error.message,true));},0);});
  bindChartContextMenu(chart);
  $('#chart-0').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();toggleTrendFullscreen().catch(error=>toast(error.message,true));}};
  $$('[data-channel]').forEach(input=>{input.onchange=()=>{state.channels[Number(input.dataset.channel)]=input.checked;applyCurveVisibility();};});
  $('#process-progress').outerHTML=stagePanel();
  if($('#water-point-select'))$('#water-point-select').onchange=event=>{state.waterPoint=event.target.value;disposeCharts();initCharts();};
  if($('#inlet-water-point-select'))$('#inlet-water-point-select').onchange=event=>{state.inletWaterPoint=event.target.value;disposeCharts();initCharts();};
  $('#completed-stage-legend').innerHTML=completedLegend();$('#chart-range').value=state.range;
  $('#ammonia-plot-unit').value=state.ammoniaPlotUnit;
  $('#ammonia-plot-unit').onchange=event=>{state.ammoniaPlotUnit=event.target.value;disposeCharts();initCharts();};
  $('#ammonia-point-key').innerHTML=ammonia.map(line=>`<span style="color:${line.lineStyle.color}">━ ${esc(line.name)}</span>`).join(' ');
  applyCurveVisibility();
  if(state.zoom)chart.dispatchAction({type:'dataZoom',...state.zoom});else setRange(state.range);
  cursorReadout(state.cursor!=null&&state.cursor>=start&&state.cursor<=end?state.cursor:ms(d.samples.at(-1)?.timestamp||d.view_time));
}

function applyCurveVisibility(){state.charts[0]?.dispatchAction({type:'hideTip'});updateTrendLayout();}

async function toggleTrendFullscreen(){
  const panel=$('#process-chart-panel');if(!panel)return;
  hideChartContextMenu();if($('#modal').open)closeModal();
  if(document.fullscreenElement)await document.exitFullscreen();
  else if(panel.classList.contains('fullscreen-fallback'))panel.classList.remove('fullscreen-fallback');
  else {try{if(!panel.requestFullscreen)throw new Error('unsupported');await panel.requestFullscreen();}catch{panel.classList.add('fullscreen-fallback');}}
  updateFullscreenUi();
}
function updateFullscreenUi(){
  hideChartContextMenu();const active=!!document.fullscreenElement||!!$('.fullscreen-fallback');
  const toastNode=$('#toast');if(toastNode)(active?(document.fullscreenElement||$('.fullscreen-fallback')):document.body).append(toastNode);
  if(!active&&$('#modal')?.parentElement!==document.body)document.body.append($('#modal'));
  if(!active&&state.deferRender){state.deferRender=false;render();}
  const button=$('[data-action="fullscreen"]');if(button){button.textContent=active?'⛶ 退出全屏':'⛶ 全屏';button.setAttribute('aria-label',active?'退出全屏综合趋势':'全屏综合趋势');}
  requestAnimationFrame(resizeTrendCharts);
}
document.addEventListener('fullscreenchange',updateFullscreenUi);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#modal').open&&!event.defaultPrevented&&$('.fullscreen-fallback')){$('.fullscreen-fallback').classList.remove('fullscreen-fallback');updateFullscreenUi();}});
