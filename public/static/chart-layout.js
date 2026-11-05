'use strict';

const trendChannels=[
  {name:'一床层热点',axis:0,color:'#3478ed'},
  {name:'二床层热点',axis:0,color:'#15a998'},
  {name:'三床层热点',axis:0,color:'#9166dc'},
  {name:'系统压力',axis:1,color:'#e09b37'},
  {name:'出塔水汽浓度',axis:2,color:'#439fd1'},
  {name:'一床层升温速率',axis:3,color:'#3478ed'},
  {name:'二床层升温速率',axis:3,color:'#15a998'},
  {name:'三床层升温速率',axis:3,color:'#9166dc'},
  {name:'系统升压速率',axis:4,color:'#bd8131'},
  {name:'氨水浓度',axis:5,color:'#9a73d5'},
  {name:'进塔水汽浓度',axis:2,color:'#d15c83'}
];

function ensureTrendChannels(){
  for(let i=0;i<trendChannels.length;i++)if(state.channels[i]===undefined)state.channels[i]=i===10;
}

function trendLayoutSpec(){
  ensureTrendChannels();
  const active=[...new Set(trendChannels.filter((_,i)=>state.channels[i]).map(channel=>channel.axis))];
  const left=active.filter(axis=>axis===0||axis===3),right=active.filter(axis=>axis!==0&&axis!==3);
  if(!left.length&&right.length)left.push(right.shift());
  const small=window.innerWidth<600,lane=small?46:52,edge=8;
  return {active,left,right,lane,
    minWidth:Math.max(260,(small?170:300)+(left.length+right.length)*lane+edge*2),
    grid:{left:left.length?left.length*lane+edge:edge,right:right.length?right.length*lane+edge:edge,top:22,bottom:88}};
}

function visibleTrendSeries(){
  return (state.trendSources?.[0]||[]).filter(series=>series.role==='stage'||state.channels[series.channel]&&
    (series.role==='annotation'?state.visibility!=='plan':state.visibility==='both'||series.role===state.visibility));
}

function trendTimeWindow(){
  const zoom=state.zoom||{start:0,end:100},span=state.chartEnd-state.chartStart;
  if(zoom.startValue!=null&&zoom.endValue!=null)return [Number(zoom.startValue),Number(zoom.endValue)];
  return [state.chartStart+span*(zoom.start??0)/100,state.chartStart+span*(zoom.end??100)/100];
}

function visibleAxisValues(series,axisIndex,from,to){
  const values=[];
  for(const line of series){
    if((line.yAxisIndex??0)!==axisIndex||line.role==='stage'||line.role==='annotation')continue;
    let previous=null;
    for(const item of line.data||[]){
      const point=Array.isArray(item)?item:item?.value;
      if(!point||point[0]==null||point[1]==null||!Number.isFinite(Number(point[1]))){previous=null;continue;}
      const x=Number(point[0]),y=Number(point[1]);
      if(x>=from&&x<=to)values.push(y);
      if(previous&&x>previous[0])for(const edge of [from,to]){
        if(previous[0]<edge&&x>edge)values.push(previous[1]+(y-previous[1])*(edge-previous[0])/(x-previous[0]));
      }
      previous=[x,y];
    }
    for(const area of line.markArea?.data||[]){
      if(area[0]?.xAxis<=to&&area[1]?.xAxis>=from)for(const edge of area)if(Number.isFinite(edge.yAxis))values.push(edge.yAxis);
    }
  }
  return values;
}

function fittedAxisRange(values,index){
  if(index===3)return {min:-50,max:50,interval:25};
  if(!values.length)return {min:0,max:index===2?3000:1};
  const low=Math.min(...values),high=Math.max(...values),minimum=[5,.05,50,1,.01,state.ammoniaPlotUnit==='mg/L'?5:1][index];
  const padding=Math.max((high-low)*.08,Math.abs(high)*.015,minimum);
  const positive=index===1||index===2||index===5||index===0&&low>=0;
  const a=positive?Math.max(0,low-padding):low-padding,b=high+padding,rawStep=(b-a)/4;
  const magnitude=10**Math.floor(Math.log10(rawStep)),step=[1,2,2.5,5,10].find(value=>value>=rawStep/magnitude)*magnitude;
  return {min:Number((Math.floor(a/step)*step).toPrecision(10)),max:Number((Math.ceil(b/step)*step).toPrecision(10)),interval:step};
}

function trendAxes(series){
  const layout=trendLayoutSpec(),size=Math.max(10,Math.min(11,chartTextSize()-1)),[from,to]=trendTimeWindow();
  const titles=['热点温度 / ℃','系统压力 / MPa','水汽 / ppmv','升温速率 / ℃/h','升压速率 / MPa/h',`氨水 / ${ammoniaUnits[state.ammoniaPlotUnit]||'质量分数 %'}`];
  const inks=['#6482ac','#d39333','#439fd1','#687fa4','#b7823b','#9a73d5'];
  return titles.map((name,index)=>{
    const onLeft=layout.left.includes(index),slot=(onLeft?layout.left:layout.right).indexOf(index),show=layout.active.includes(index);
    return {id:`process-axis-${index}`,type:'value',show,scale:true,name,position:onLeft?'left':'right',offset:Math.max(0,slot)*layout.lane,
      nameLocation:'middle',nameRotate:onLeft?90:270,nameGap:window.innerWidth<600?35:39,
      nameTextStyle:{color:inks[index],fontSize:size,fontWeight:700},
      ...fittedAxisRange(visibleAxisValues(series,index,from,to),index),splitNumber:4,
      axisLabel:{color:inks[index],fontSize:size,fontWeight:600,hideOverlap:true,margin:4,
        formatter:value=>Math.abs(value)>=1000?`${Number((value/1000).toPrecision(4))}k`:value!==0&&Math.abs(value)<.001?value.toExponential(1):Number(value.toPrecision(5)).toLocaleString('en-US',{maximumFractionDigits:index===4?4:index===1?3:2})},
      axisLine:{show:false},axisTick:{show:false},axisPointer:{show},
      splitLine:{show:index===(layout.active[0]??-1),lineStyle:{color:'#edf2fa',type:'dashed'}}};
  });
}

function sizeTrendSurface(){
  const viewport=$('#trend-viewport'),surface=$('#trend-surface');if(!viewport||!surface)return;
  const layout=trendLayoutSpec();viewport.closest('.workspace')?.classList.toggle('expanded-trend',layout.active.length>=4);
  surface.style.width=Math.max(viewport.clientWidth,layout.minWidth)+'px';
  surface.style.setProperty('--plot-height',`${Math.min(610,440+Math.max(0,layout.active.length-2)*30)}px`);
}

function updateTrendLayout(){
  const chart=state.charts[0];if(!chart||chart.isDisposed())return;
  sizeTrendSurface();chart.resize();
  const series=visibleTrendSeries().map(line=>structuredClone(line)),layout=trendLayoutSpec();
  const zones=series.find(line=>line.role==='stage');
  if(zones){
    zones.yAxisIndex=layout.active[0]??0;
    zones.markArea.label={show:false};
    zones.markArea.data.forEach(area=>{area[0].label={show:false};});
  }
  chart.setOption({grid:layout.grid,yAxis:trendAxes(series),series},{replaceMerge:['series','yAxis']});
  chart.setOption({graphic:state.channels.some(Boolean)?curveLabelGraphics(chart,series):[{id:'select-curves-hint',type:'text',left:'center',top:'middle',style:{text:'请勾选需要查看的曲线',fill:'#8b9db7',fontSize:14}}]},
    {replaceMerge:['graphic']});
  $('#water-point-select')?.closest('.water-point-control')?.classList.toggle('hidden',!state.channels[4]);
  $('#inlet-water-point-select')?.closest('.inlet-water-point-control')?.classList.toggle('hidden',!state.channels[10]);
  $('#ammonia-controls')?.classList.toggle('hidden',!state.channels[9]);
  updateStageStrip();if(state.cursor!=null)cursorReadout(state.cursor);
}
