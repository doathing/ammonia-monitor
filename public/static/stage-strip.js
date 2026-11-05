'use strict';
function chartTextSize(){return window.innerWidth<600?11:document.fullscreenElement||$('.fullscreen-fallback')?14:12;}
function chartTimeLabel(value){return `{elapsed|${num((value-state.chartStart)/3600000,1)}h}\n{actual|${fmt(value,true)}}`;}
function timeAxisStyle(){
  const size=chartTextSize();
  return {color:'#6f839f',fontSize:size,fontWeight:700,lineHeight:size+6,margin:12,hideOverlap:true,formatter:chartTimeLabel,
    rich:{elapsed:{fontSize:size,fontWeight:700,color:'#607b9f',lineHeight:size+6},actual:{fontSize:Math.max(10,size-1),fontWeight:600,color:'#7f90a7',lineHeight:size+6}}};
}
function processGridLayout(){
  return trendLayoutSpec().grid;
}
function compactStageName(stage){return stage.name;}
function stageDeviationShort(stage){return !stage.completed?'进行中':stage.completion.status==='ontime'?'按期':`${stage.completion.finish_delta_hours>0?'+':'−'}${Math.round(Math.abs(stage.completion.finish_delta_hours)*100)/100}h`;}
function stageStripMarkup(){
  const ranges=actualStageRanges();
  return `<div class="stage-alignment-track" aria-label="与实际曲线分区等宽的阶段条">${ranges.map(stage=>{
    const status=stage.completed?finishDeltaText(stage.completion):'进行中';
    const shortStatus=stageDeviationShort(stage);
    return `<button class="stage-aligned-segment ${stage.completed?stage.completion.status:'ongoing'}" data-stage-index="${stage.stage_index}" data-focus-time="${esc(stage.end_time)}" title="${esc(stage.name)} · ${status} · ${fmt(stage.start_time)} → ${fmt(stage.end_time)}" aria-label="${esc(stage.name)} ${status}"><b class="stage-full-label">${esc(stage.name)}</b><span class="stage-full-status">${status}</span><span class="stage-short-status">${shortStatus}</span></button>`;
  }).join('')}</div>`;
}
function updateStageStrip(){
  const chart=state.charts?.[0],host=$('#completed-stage-legend'),track=$('.stage-alignment-track',host||document);
  if(!chart||chart.isDisposed()||!host||!track)return;
  const chartBox=$('#chart-0').getBoundingClientRect(),hostBox=host.getBoundingClientRect(),grid=chart.getOption().grid[0];
  const left=Number(grid.left),right=chart.getWidth()-Number(grid.right);
  if(!Number.isFinite(left)||!Number.isFinite(right)||right<=left)return;
  track.style.marginLeft=`${chartBox.left-hostBox.left+left}px`;
  track.style.width=`${right-left}px`;
  const ranges=new Map(actualStageRanges().map(stage=>[stage.stage_index,stage]));
  const backgrounds=['#edf4fb','#edf7f3','#f3eff9','#faf5e9'];
  const textColors=['#517aa3','#4d8b78','#856aa8','#a68543'];
  let requiredHeight=window.innerWidth<600?76:88;
  $$('.stage-aligned-segment',track).forEach(button=>{
    const index=Number(button.dataset.stageIndex),stage=ranges.get(index);
    if(!stage){button.hidden=true;return;}
    const from=chart.convertToPixel({xAxisIndex:0},ms(stage.start_time)),to=chart.convertToPixel({xAxisIndex:0},ms(stage.end_time));
    const clippedLeft=Math.max(left,from),clippedRight=Math.min(right,to),width=clippedRight-clippedLeft;
    button.hidden=!Number.isFinite(width)||width<=0;
    if(button.hidden)return;
    button.style.left=`${clippedLeft-left}px`;button.style.width=`${width}px`;
    button.style.backgroundColor=backgrounds[index%4];button.style.color=textColors[index%4];
    button.classList.toggle('compact',width<108);button.classList.toggle('narrow',width<55);
    button.dataset.plotStart=String(clippedLeft);button.dataset.plotEnd=String(clippedRight);
    const label=$('.stage-full-label',button),status=$(width<108?'.stage-short-status':'.stage-full-status',button);
    requiredHeight=Math.max(requiredHeight,Math.min(180,label.scrollHeight+status.scrollHeight+32));
  });
  const changed=track.style.height!==`${requiredHeight}px`;
  track.style.height=`${requiredHeight}px`;host.style.minHeight=`${requiredHeight}px`;
  $$('.stage-aligned-segment',track).forEach(button=>button.style.height=`${requiredHeight}px`);
  if(changed)requestAnimationFrame(()=>{if(!chart.isDisposed()&&state.charts[0]===chart)resizeTrendCharts();});
}
