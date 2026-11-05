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

function curveLabelPosition(anchor,width,height,bounds,occupied){
  const candidates=[],add=(x,y)=>{
    x=Math.max(bounds.left,Math.min(bounds.right-width,x));
    y=Math.max(bounds.top,Math.min(bounds.bottom-height,y));
    if(occupied.some(box=>x<box.x+box.width+4&&x+width+4>box.x&&y<box.y+box.height+4&&y+height+4>box.y))return;
    const dx=Math.max(x-anchor[0],0,anchor[0]-x-width),dy=Math.max(y-anchor[1],0,anchor[1]-y-height);
    candidates.push({x,y,width,height,cost:dx*dx+dy*dy});
  };
  for(const dy of [-height-8,8,-2*height-12,height+12,-3*height-16,2*height+16]){
    for(const dx of [0,-width*.65,width*.65])add(anchor[0]-width/2+dx,anchor[1]+dy);
  }
  if(!candidates.length)for(let y=bounds.top;y+height<=bounds.bottom;y+=height+4){
    for(let x=bounds.left;x+width<=bounds.right;x+=Math.max(30,width/2))add(x,y);
  }
  candidates.sort((a,b)=>a.cost-b.cost);
  return candidates[0]||null;
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
  const graphics=[],occupied=[];
  for(const group of groups.values()){
    const fraction=group.role==='plan'?[.34,.24,.56,.72,.46,.28,.43,.58,.74,.6,.4][group.channel]:[.58,.68,.78,.42,.64,.37,.52,.67,.82,.5,.6][group.channel];
    const anchor=curveLabelAnchor(group.lines,from,to,from+(to-from)*fraction);if(!anchor)continue;
    const pixel=[chart.convertToPixel({xAxisIndex:0},anchor.x),chart.convertToPixel({yAxisIndex:anchor.line.yAxisIndex||0},anchor.y)];
    if(pixel.some(value=>!Number.isFinite(value))||pixel[1]<bounds.top-4||pixel[1]>bounds.bottom+4)continue;
    const name=group.channel===9?`氨水 · ${anchor.line.name}`:trendChannels[group.channel].name;
    const text=group.channel===9?`氨水 · 实际 · ${anchor.line.name}`:`${name} · ${group.role==='plan'?'计划':'实际'}`,color=anchor.line.lineStyle?.color||trendChannels[group.channel].color;
    const width=Math.min(measure.measureText(text).width+22,bounds.right-bounds.left),height=size+12;
    const box=curveLabelPosition(pixel,width,height,bounds,occupied);if(!box)continue;
    occupied.push(box);
    const endX=Math.max(box.x,Math.min(box.x+width,pixel[0])),endY=pixel[1]<box.y?box.y:pixel[1]>box.y+height?box.y+height:pixel[1];
    graphics.push({id:`curve-label-${group.key}`,type:'group',silent:true,children:[
      {type:'line',silent:true,z:8,shape:{x1:pixel[0],y1:pixel[1],x2:endX,y2:endY},style:{stroke:color,lineWidth:1,opacity:.65}},
      {type:'rect',silent:true,z:9,shape:{x:box.x,y:box.y,width,height,r:3},style:{fill:'rgba(255,255,255,0.94)'}},
      {type:'text',silent:true,z:10,style:{x:box.x+7,y:box.y+6,text,fontSize:size,fontWeight:600,fontFamily:'"Segoe UI","Microsoft YaHei",sans-serif',fill:color,width:Math.max(0,width-14),overflow:'truncate',ellipsis:'…',verticalAlign:'top'}}
    ]});
  }
  return graphics;
}
