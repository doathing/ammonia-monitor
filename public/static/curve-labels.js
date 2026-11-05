'use strict';

// Project the visible part of a segment onto the nearest point to the label.
function nearestCurvePoint(start,end,target,bounds){
  let lo=0,hi=1;
  const delta=[end[0]-start[0],end[1]-start[1]];
  const limits=[[bounds.left,bounds.right],[bounds.top,bounds.bottom]];
  for(let i=0;i<2;i++){
    const [min,max]=limits[i];
    if(!delta[i]){
      if(start[i]<min||start[i]>max)return null;
      continue;
    }
    const a=(min-start[i])/delta[i],b=(max-start[i])/delta[i];
    lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
    if(lo>hi)return null;
  }
  const length=delta[0]**2+delta[1]**2;
  const projection=length?((target[0]-start[0])*delta[0]+(target[1]-start[1])*delta[1])/length:0;
  const t=Math.max(lo,Math.min(hi,projection));
  return [start[0]+delta[0]*t,start[1]+delta[1]*t];
}

function curveLabelSegments(chart,lines,from,to){
  const xStart=chart.convertToPixel({xAxisIndex:0},from);
  const xStep=(chart.convertToPixel({xAxisIndex:0},to)-xStart)/(to-from);
  const segments=[];
  for(const line of lines){
    const axis={yAxisIndex:line.yAxisIndex??0},yZero=chart.convertToPixel(axis,0);
    const yStep=chart.convertToPixel(axis,1)-yZero;
    const pixel=(x,y)=>[xStart+(x-from)*xStep,yZero+y*yStep];
    let previous=null;
    for(const item of line.data||[]){
      const point=Array.isArray(item)?item:item?.value;
      if(!point||point[0]==null||point[1]==null){previous=null;continue;}
      const current=pixel(Number(point[0]),Number(point[1]));
      if(!current.every(Number.isFinite)){previous=null;continue;}
      segments.push([previous??current,current]);
      previous=current;
    }
    for(const area of line.markArea?.data||[]){
      const height=(area[0]?.yAxis+area[1]?.yAxis)/2;
      const start=pixel(area[0]?.xAxis,height),end=pixel(area[1]?.xAxis,height);
      if(start.every(Number.isFinite)&&end.every(Number.isFinite))segments.push([start,end]);
    }
  }
  return segments;
}

function curveLabelAnchor(segments,target,bounds){
  let nearest=null,distance=Infinity;
  for(const [start,end] of segments){
    const point=nearestCurvePoint(start,end,target,bounds);
    if(!point)continue;
    const squared=(point[0]-target[0])**2+(point[1]-target[1])**2;
    if(squared<distance){distance=squared;nearest=point;}
  }
  return nearest;
}

function curveLabelCard(entries,bounds,size,planned){
  if(!entries.length)return null;
  const plotWidth=bounds.right-bounds.left,plotHeight=bounds.bottom-bounds.top;
  const insetX=Math.min(42,plotWidth*.045),insetY=Math.min(24,plotHeight*.06);
  const padding=9,heading=22,rowHeight=size+8;
  const rows=Math.max(1,Math.floor((plotHeight/2-insetY-heading-padding)/rowHeight));
  const columns=Math.ceil(entries.length/rows);
  const columnWidth=Math.min(Math.max(...entries.map(entry=>entry.width))+29,(plotWidth/2-insetX-2*padding)/columns);
  if(columnWidth<26)return null;
  const width=columnWidth*columns+2*padding;
  const height=heading+Math.min(rows,entries.length)*rowHeight+padding;
  const x=planned?bounds.left+insetX:bounds.right-insetX-width;
  const y=planned?bounds.top+insetY:bounds.bottom-insetY-height;
  const children=[
    {type:'rect',z:9,shape:{x,y,width,height,r:7},style:{fill:'rgba(255,255,255,.96)',stroke:'#e0e7ef',lineWidth:1}},
    {type:'text',z:10,style:{x:x+padding,y:y+7,text:planned?'计划':'实际',fontSize:size-1,fontWeight:600,fill:'#526680',verticalAlign:'top'}}
  ];
  entries.forEach((entry,index)=>{
    const textX=x+padding+Math.floor(index/rows)*columnWidth;
    const rowY=y+heading+(index%rows+.5)*rowHeight;
    const edge=[planned?x+width:x,rowY];
    const anchor=curveLabelAnchor(entry.segments,edge,bounds);
    const stroke={stroke:entry.color,lineWidth:1.4,...(planned?{lineDash:[4,3]}:{})};
    if(anchor){
      const distance=Math.hypot(anchor[0]-edge[0],anchor[1]-edge[1]);
      children.push({type:'line',z:8,shape:{x1:anchor[0],y1:anchor[1],x2:edge[0],y2:edge[1]},
        style:{...stroke,lineWidth:1,opacity:distance>180?.23:.42}});
      children.push({type:'circle',z:8,shape:{cx:anchor[0],cy:anchor[1],r:1.7},
        style:{fill:entry.color,opacity:.7}});
    }
    children.push({type:'line',z:10,shape:{x1:textX,y1:rowY,x2:textX+14,y2:rowY},style:stroke});
    children.push({type:'text',z:10,style:{x:textX+20,y:rowY,text:entry.text,fontSize:size-1,
      fontFamily:'"Segoe UI","Microsoft YaHei",sans-serif',fill:'#34465e',
      width:columnWidth-24,overflow:'truncate',ellipsis:'…',verticalAlign:'middle'}});
  });
  return {id:planned?'curve-label-card-plan':'curve-label-card-actual',type:'group',silent:true,children};
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
  const entries={plan:[],actual:[]};
  for(const group of groups.values()){
    const segments=curveLabelSegments(chart,group.lines,from,to);
    const center=[(bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2];
    if(!curveLabelAnchor(segments,center,bounds))continue;
    const line=group.lines[0];
    const text=group.channel===9?`氨水 · ${line.name}`:trendChannels[group.channel].name;
    entries[group.role].push({segments,text,color:line.lineStyle?.color||trendChannels[group.channel].color,width:measure.measureText(text).width});
  }
  return [curveLabelCard(entries.plan,bounds,size,true),curveLabelCard(entries.actual,bounds,size,false)].filter(Boolean);
}
