'use strict';

// Clip a segment to the plot and return the visible point closest to the target.
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

// A coarse occupancy map lets labels favor gaps between visible curves.
const curveLabelCell=8;
function curveLabelSamples(segments,bounds,ink){
  const candidates=new Map();
  for(const [start,end] of segments){
    const a=nearestCurvePoint(start,end,start,bounds);
    if(!a)continue;
    const b=nearestCurvePoint(start,end,end,bounds);
    const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4));
    for(let i=0;i<=steps;i++){
      const x=a[0]+(b[0]-a[0])*i/steps,y=a[1]+(b[1]-a[1])*i/steps;
      ink.add(Math.floor(x/curveLabelCell)+','+Math.floor(y/curveLabelCell));
      candidates.set(Math.floor(x/20)+','+Math.floor(y/16),[x,y]);
    }
  }
  return [...candidates.values()];
}

function curveLabelBox(points,width,height,bounds,ink,placed){
  let best=null;
  const middle=(bounds.left+bounds.right)/2;
  for(const [px,py] of points){
    const x=Math.max(bounds.left,Math.min(bounds.right-width,px-width/2));
    for(const offset of [6,12,20])for(const side of [-1,1]){
      const y=side<0?py-offset-height:py+offset;
      if(y<bounds.top||y+height>bounds.bottom)continue;
      if(placed.some(b=>x<b.x+b.width+4&&x+width+4>b.x&&y<b.y+b.height+4&&y+height+4>b.y))continue;
      let crossings=0,nearby=0;
      for(let col=Math.floor((x-6)/curveLabelCell);col<=Math.floor((x+width+6)/curveLabelCell);col++){
        for(let row=Math.floor((y-6)/curveLabelCell);row<=Math.floor((y+height+6)/curveLabelCell);row++){
          if(!ink.has(col+','+row))continue;
          if(col*curveLabelCell<x+width&&(col+1)*curveLabelCell>x&&row*curveLabelCell<y+height&&(row+1)*curveLabelCell>y)crossings++;
          else nearby++;
        }
      }
      const score=crossings*100+nearby*2+offset*.4+Math.abs(px-middle)*.006;
      if(!best||score<best.score)best={x,y,width,height,score};
    }
  }
  return best;
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
  const ink=new Set(),entries=[],placed=[];
  for(const group of groups.values()){
    const segments=curveLabelSegments(chart,group.lines,from,to);
    const points=curveLabelSamples(segments,bounds,ink);
    if(group.role!=='actual'||!points.length)continue;
    const line=group.lines[0];
    const name=group.channel===9?`氨水 · ${line.name}`:trendChannels[group.channel].name;
    entries.push({key:group.key,points,text:name,color:line.lineStyle?.color||trendChannels[group.channel].color});
  }
  const height=size+8,graphics=[];
  // Place curves with fewer available anchors first.
  entries.sort((a,b)=>a.points.length-b.points.length);
  for(const entry of entries){
    const textWidth=measure.measureText(entry.text).width+2;
    const width=Math.min(Math.ceil(textWidth)+14,bounds.right-bounds.left);
    const labelSize=size*Math.min(1,Math.max(1,width-14)/textWidth);
    const box=curveLabelBox(entry.points,width,height,bounds,ink,placed);
    if(!box)continue;
    placed.push(box);
    graphics.push({id:`curve-label-${entry.key}`,type:'group',silent:true,children:[
      {type:'rect',z:9,shape:{x:box.x,y:box.y,width,height,r:3},style:{fill:'rgba(255,255,255,.91)'}},
      {type:'text',z:10,style:{x:box.x+7,y:box.y+height/2,text:entry.text,
        font:`600 ${labelSize}px "Segoe UI","Microsoft YaHei",sans-serif`,
        fill:entry.color,verticalAlign:'middle'}}
    ]});
  }
  return graphics;
}
