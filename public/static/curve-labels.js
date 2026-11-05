'use strict';

// Find a point on a visible line, respecting gaps and the current time window.
function curveLabelAnchor(lines,from,to,target){
  let best=null;
  const consider=(x,y,line)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<from||x>to)return;
    const distance=Math.abs(x-target);
    if(!best||distance<best.distance)best={x,y,line,distance};
  };
  for(const line of lines){
    let previous=null;
    for(const item of line.data||[]){
      const point=Array.isArray(item)?item:item?.value;
      if(!point||point[0]==null||point[1]==null||!Number.isFinite(Number(point[0]))||!Number.isFinite(Number(point[1]))){previous=null;continue;}
      const x=Number(point[0]),y=Number(point[1]);
      consider(x,y,line);
      if(previous&&x>previous[0]){
        const lo=Math.max(from,previous[0]),hi=Math.min(to,x);
        if(lo<=hi){const at=Math.max(lo,Math.min(hi,target));consider(at,previous[1]+(y-previous[1])*(at-previous[0])/(x-previous[0]),line);}
      }
      previous=[x,y];
    }
    // Legacy temperature bands may have no line values of their own.
    for(const area of line.markArea?.data||[]){
      const lo=Math.max(from,area[0]?.xAxis),hi=Math.min(to,area[1]?.xAxis);
      if(lo<=hi&&Number.isFinite(area[0].yAxis)&&Number.isFinite(area[1].yAxis))consider(Math.max(lo,Math.min(hi,target)),(area[0].yAxis+area[1].yAxis)/2,line);
    }
  }
  return best;
}

// Use opposite corners. Add columns inward when one stack cannot fit.
function curveLabelCorner(entries,bounds,height,planned){
  if(!entries.length)return [];
  const gap=5,plotWidth=bounds.right-bounds.left,plotHeight=bounds.bottom-bounds.top;
  const insetX=Math.min(80,plotWidth*.07),insetY=Math.min(36,plotHeight*.07);
  const rowsPerColumn=Math.max(1,Math.floor((plotHeight/2-insetY+gap)/(height+gap)));
  const columns=Math.ceil(entries.length/rowsPerColumn);
  const widestLabel=Math.max(...entries.map(entry=>entry.width));
  const columnWidth=Math.min(widestLabel,(plotWidth/2-insetX-gap*(columns-1))/columns);
  if(columnWidth<24)return [];
  const ordered=[...entries].sort((a,b)=>a.pixel[1]-b.pixel[1]);
  return ordered.map((entry,index)=>{
    const column=Math.floor(index/rowsPerColumn),row=index%rowsPerColumn;
    const count=Math.min(rowsPerColumn,entries.length-column*rowsPerColumn);
    const width=Math.min(entry.width,columnWidth);
    const x=planned?bounds.left+insetX+column*(columnWidth+gap):
      bounds.right-insetX-column*(columnWidth+gap)-width;
    const top=planned?bounds.top+insetY:bounds.bottom-insetY-height-(count-1)*(height+gap);
    return {...entry,box:{x,y:top+row*(height+gap),width}};
  });
}

function curveLabelGraphics(chart,series){
  const groups=new Map(),[from,to]=trendTimeWindow();
  for(const line of series){
    if(!['plan','actual'].includes(line.role)||!trendChannels[line.channel])continue;
    const key=`${line.role}-${line.channel}${line.channel===9?'-'+line.id:''}`;
    if(!groups.has(key))groups.set(key,{key,channel:line.channel,role:line.role,lines:[]});
    groups.get(key).lines.push(line);
  }
  const grid=chart.getOption().grid[0],bounds={left:Number(grid.left)+4,right:chart.getWidth()-Number(grid.right)-4,top:Number(grid.top)+4,bottom:chart.getHeight()-Number(grid.bottom)-4};
  const size=chartTextSize(),font=`600 ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;
  const measure=document.createElement('canvas').getContext('2d');measure.font=font;
  const entries={plan:[],actual:[]},height=size+12;
  for(const group of groups.values()){
    const fraction=group.role==='plan'?.32:.62;
    const anchor=curveLabelAnchor(group.lines,from,to,from+(to-from)*fraction);if(!anchor)continue;
    const pixel=[chart.convertToPixel({xAxisIndex:0},anchor.x),chart.convertToPixel({yAxisIndex:anchor.line.yAxisIndex||0},anchor.y)];
    if(pixel.some(value=>!Number.isFinite(value))||pixel[1]<bounds.top-4||pixel[1]>bounds.bottom+4)continue;
    const name=group.channel===9?`氨水 · ${anchor.line.name}`:trendChannels[group.channel].name;
    const text=group.channel===9?`氨水 · 实际 · ${anchor.line.name}`:`${name} · ${group.role==='plan'?'计划':'实际'}`,color=anchor.line.lineStyle?.color||trendChannels[group.channel].color;
    entries[group.role].push({key:group.key,pixel,text,color,width:measure.measureText(text).width+22});
  }
  const placed=[...curveLabelCorner(entries.plan,bounds,height,true),...curveLabelCorner(entries.actual,bounds,height,false)];
  return placed.map(({key,pixel,text,color,box})=>{
    const {width}=box;
    const endX=Math.max(box.x,Math.min(box.x+width,pixel[0])),endY=pixel[1]<box.y?box.y:pixel[1]>box.y+height?box.y+height:pixel[1];
    return {id:`curve-label-${key}`,type:'group',silent:true,children:[
      {type:'line',silent:true,z:8,shape:{x1:pixel[0],y1:pixel[1],x2:endX,y2:endY},style:{stroke:color,lineWidth:1.3,opacity:.85}},
      {type:'circle',silent:true,z:8,shape:{cx:pixel[0],cy:pixel[1],r:2.3},style:{fill:color}},
      {type:'rect',silent:true,z:9,shape:{x:box.x,y:box.y,width,height,r:3},style:{fill:'rgba(255,255,255,0.94)'}},
      {type:'text',silent:true,z:10,style:{x:box.x+7,y:box.y+6,text,fontSize:size,fontWeight:600,fontFamily:'"Segoe UI","Microsoft YaHei",sans-serif',fill:color,width:Math.max(0,width-14),overflow:'truncate',ellipsis:'…',verticalAlign:'top'}}
    ]};
  });
}
