'use strict';

function exportTextLines(context,text,width){
  const lines=[];
  for(const paragraph of String(text||'').split('\n')){
    let line='';
    for(const character of paragraph){
      if(line&&context.measureText(line+character).width>width){lines.push(line);line='';}
      line+=character;
    }
    lines.push(line);
  }
  return lines;
}

async function trendExportCanvas(chart){
  chart.dispatchAction({type:'hideTip'});updateStageStrip();
  // Snapshot the chart and its HTML progress information together, before decoding the PNG.
  const width=chart.getWidth(),chartHeight=chart.getHeight(),ratio=2,padding=width<600?12:20;
  const chartPng=chart.getDataURL({type:'png',pixelRatio:ratio,backgroundColor:'#ffffff'});
  const progress=$('#process-progress'),stageName=$('.current-stage-name',progress)?.textContent||'';
  const stageCaption=$('.current-stage-caption',progress)?.textContent||'当前阶段';
  const summary=stageProgressSummary();
  const metrics=summary.metrics.map(metric=>`${metric.label} ${metric.value}`).join('　　');
  const status=summary.status;
  const note=`本阶段开始 ${fmt(summary.start)}　计划结束 ${fmt(summary.plannedEnd)}　累计还原 ${summary.total}`;
  const batchName=state.detail.batch.name;
  const selected=trendChannels.filter((_,index)=>state.channels[index]).map(channel=>({...channel}));
  const mode=$('#curve-visibility')?.selectedOptions[0]?.textContent||'';
  const strips=$$('.stage-aligned-segment').filter(node=>!node.hidden).map(node=>{
    const visible=selector=>$$(selector,node).find(child=>getComputedStyle(child).display!=='none')?.textContent||'';
    const style=getComputedStyle(node);
    return {left:Number(node.dataset.plotStart),right:Number(node.dataset.plotEnd),background:style.backgroundColor,color:style.color,
      label:visible('.stage-full-label'),fontSize:parseFloat(getComputedStyle($('.stage-full-label',node)).fontSize),status:visible('.stage-full-status,.stage-short-status')};
  });
  const stripHeight=strips.length?Math.max(76,$('#completed-stage-legend').offsetHeight):0;
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
  const font=(size,weight=500)=>`${weight} ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;
  context.font=font(12);
  const batchLines=exportTextLines(context,batchName,width-padding*2);
  context.font=font(14,700);
  const titleLines=exportTextLines(context,`实际还原进程 · ${stageCaption} · ${status}`,width-padding*2-24);
  context.font=font(22,800);
  const stageLines=exportTextLines(context,stageName,width-padding*2-48);
  const badgeWidth=Math.min(width-padding*2-24,Math.max(160,...stageLines.map(line=>context.measureText(line).width+24)));
  const badgeHeight=stageLines.length*30+16;
  context.font=font(14,700);
  const metricLines=exportTextLines(context,metrics,width-padding*2-24);
  context.font=font(11);
  const noteLines=exportTextLines(context,note,width-padding*2-24);
  const cardTop=46+batchLines.length*17,cardHeight=40+titleLines.length*21+badgeHeight+metricLines.length*22+noteLines.length*17;
  context.font=font(12,600);
  const legend=[];let legendX=padding,legendY=cardTop+cardHeight+20;
  for(const channel of selected){
    const itemWidth=context.measureText(channel.name).width+38;
    if(legendX>padding&&legendX+itemWidth>width-padding){legendX=padding;legendY+=24;}
    legend.push({...channel,x:legendX,y:legendY});legendX+=itemWidth;
  }
  const modeY=legendY+(selected.length?24:0);
  context.font=font(11);
  const modeLines=exportTextLines(context,`${mode} · 实线：实际　虚线：计划　浅色分区：实际阶段`,width-padding*2);
  const stripTop=modeY+modeLines.length*17+7,chartTop=stripTop+stripHeight;
  canvas.width=Math.ceil(width*ratio);canvas.height=Math.ceil((chartTop+chartHeight)*ratio);
  context.scale(ratio,ratio);context.fillStyle='#ffffff';context.fillRect(0,0,width,chartTop+chartHeight);
  context.textBaseline='top';context.fillStyle='#20354e';context.font=font(18,700);
  context.fillText('升温还原综合趋势',padding,16);
  const drawLines=(lines,x,y,lineHeight)=>lines.forEach((line,index)=>context.fillText(line,x,y+index*lineHeight));
  context.font=font(12);context.fillStyle='#73849e';drawLines(batchLines,padding,42,17);
  context.fillStyle='#f8faff';context.fillRect(padding,cardTop,width-padding*2,cardHeight);
  context.strokeStyle='#e5ecf7';context.strokeRect(padding+.5,cardTop+.5,width-padding*2-1,cardHeight-1);
  context.fillStyle='#20354e';context.font=font(14,700);drawLines(titleLines,padding+12,cardTop+12,21);
  const stageTop=cardTop+18+titleLines.length*21;
  context.fillStyle='#2563eb';context.fillRect(padding+12,stageTop,badgeWidth,badgeHeight);
  context.fillStyle='#ffffff';context.font=font(22,800);drawLines(stageLines,padding+24,stageTop+8,30);
  const metricTop=stageTop+badgeHeight+10;
  context.fillStyle='#314d73';context.font=font(14,700);drawLines(metricLines,padding+12,metricTop,22);
  context.fillStyle='#899ab2';context.font=font(11);drawLines(noteLines,padding+12,metricTop+metricLines.length*22,17);
  context.font=font(12,600);
  for(const item of legend){
    context.strokeStyle=item.color;context.lineWidth=2;context.beginPath();context.moveTo(item.x,item.y+7);context.lineTo(item.x+16,item.y+7);context.stroke();
    context.fillStyle=item.color;context.fillText(item.name,item.x+22,item.y);
  }
  context.font=font(11);context.fillStyle='#899ab2';drawLines(modeLines,padding,modeY,17);
  for(const strip of strips){
    const segmentWidth=strip.right-strip.left;
    context.save();context.beginPath();context.rect(strip.left,stripTop,segmentWidth,stripHeight);context.clip();
    context.fillStyle=strip.background;context.fillRect(strip.left,stripTop,segmentWidth-1,stripHeight);
    context.font=font(strip.fontSize,700);context.fillStyle=strip.color;context.textAlign='center';
    const lineHeight=strip.fontSize*1.35,lines=exportTextLines(context,strip.label,Math.max(1,segmentWidth-6)),statusLines=exportTextLines(context,strip.status,Math.max(1,segmentWidth-6));
    const textTop=stripTop+(stripHeight-((lines.length+statusLines.length)*lineHeight+8))/2;
    drawLines(lines,strip.left+segmentWidth/2,textTop,lineHeight);
    drawLines(statusLines,strip.left+segmentWidth/2,textTop+lines.length*lineHeight+8,lineHeight);context.restore();
  }
  const image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('图表图片生成失败，请重试'));image.src=chartPng;});
  context.drawImage(image,0,chartTop,width,chartHeight);
  return canvas;
}
