'use strict';

function hideChartContextMenu(){$('#chart-context-menu')?.remove();}

function bindChartContextMenu(chart){
  chart.getDom().oncontextmenu=event=>{
    const box=chart.getDom().getBoundingClientRect(),point=[event.clientX-box.left,event.clientY-box.top];
    if(!chart.containPixel({gridIndex:0},point))return;
    event.preventDefault();event.stopPropagation();hideChartContextMenu();
    // Use the pointer location, never the nearest sample's timestamp.
    const time=Math.round(chart.convertFromPixel({xAxisIndex:0},point[0])/1000)*1000;
    if(!Number.isFinite(time))return;
    cursorReadout(time);chart.dispatchAction({type:'showTip',x:point[0],y:point[1]});
    const menu=document.createElement('div');
    menu.id='chart-context-menu';menu.className='chart-context-menu';menu.dataset.timestamp=new Date(time).toISOString();menu.setAttribute('role','menu');menu.setAttribute('aria-label','游标时间操作');
    menu.innerHTML=`<div class="context-time">${fmt(time,false,true)}<small>北京时间 · 累计 ${num(hours(time),2)}h</small></div>
      <button type="button" role="menuitem" data-context="event">${icon('plus')}在此时间添加事件</button>
      <button type="button" role="menuitem" data-context="readings">${icon('data')}在此时间录入实测数据</button>
      <button type="button" role="menuitem" data-context="export">${icon('download')}导出当前图表 PNG</button>`;
    $('#process-chart-panel').append(menu);
    menu.style.left=Math.max(8,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=Math.max(8,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-8))+'px';
    menu.onclick=async click=>{
      const button=click.target.closest('[data-context]');if(!button)return;
      click.stopPropagation();hideChartContextMenu();
      if(button.dataset.context==='event')eventModal({timestamp:new Date(time).toISOString(),kind:'operation'});
      else if(button.dataset.context==='readings')cursorReadingsModal(time);
      else {try{await exportTrendPng(chart);}catch(error){toast(error.message,true);}}
    };
    menu.onkeydown=key=>{
      const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
      if(key.key==='Escape'){key.preventDefault();key.stopPropagation();hideChartContextMenu();chart.getDom().focus();}
      if(key.key==='ArrowDown'||key.key==='ArrowUp'){key.preventDefault();buttons[(index+(key.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}
    };
    menu.querySelector('button').focus({preventScroll:true});
  };
}

async function exportTrendPng(chart){
  const canvas=await trendExportCanvas(chart);
  const link=document.createElement('a');
  link.href=canvas.toDataURL('image/png');
  link.download=`还原过程趋势-${fmt(Date.now(),false,true).replace(/[^0-9]/g,'')}.png`;
  (document.fullscreenElement||$('.fullscreen-fallback')||document.body).append(link);
  link.click();link.remove();toast('已导出 PNG，包含实际还原进程、阶段条及当前曲线');
}

function cursorReadingsModal(time,{source='cursor'}={}){
  if(!requireStarted())return;
  const points=kind=>[...new Set((state.detail.concentrations?.[kind]||[]).map(row=>row.point).filter(Boolean))];
  const pointField=(kind,title)=>`<label class="field">${title}<input name="${kind}_point" maxlength="120" list="cursor-${kind}-points" placeholder="填写采样点名称"><datalist id="cursor-${kind}-points">${points(kind).map(point=>`<option value="${esc(point)}">`).join('')}</datalist></label>`;
  modal(source==='next'?'添加新数据':'游标时间录入实测数据',`<form id="cursor-readings-form">
    <p class="modal-copy">${source==='next'?'时间默认为最后一条实测记录后30分钟；无记录时为开工后30分钟，可自行修改。':'时间已取自游标位置，可自行修改。'}按现场采样填写，留空的组不写入；温压组填写时须同时填写四项。${state.detail.batch.status==='completed'?'该批次已归档，补录时间须在批次开工与归档时间之间。':''}</p>
    <label class="field">采样时间 · 北京时间<input name="timestamp" type="datetime-local" step="1" required value="${localInput(time,true)}"></label>
    <fieldset class="cursor-reading-group"><legend>床层热点温度与系统压力</legend><div class="form-grid">${keys.map((key,index)=>`<label class="field">${names[index]} / ${index===3?'MPa':'℃'}<input name="${key}" type="number" step="any" min="${index===3?0:-273.15}" placeholder="填写实测值"></label>`).join('')}</div></fieldset>
    <fieldset class="cursor-reading-group"><legend>实际出塔水汽浓度</legend><div class="form-grid">
      <label class="field">出塔水汽浓度 / g/m³<input name="water_value" type="number" step="any" min="0" placeholder="填写实测浓度"></label>${pointField('water','出塔水汽采样点 · 可选')}
      <div class="conversion-preview" id="cursor-water-preview">标准状态：0℃、101.325kPa（绝压），输入后换算为 ppmv。</div>
      <label class="field full">出塔水汽备注<input name="water_note" maxlength="4000" placeholder="采样操作或现场情况"></label>
    </div></fieldset>
    <fieldset class="cursor-reading-group"><legend>进塔水汽浓度 · 上限 200 ppmv</legend><div class="form-grid">
      <label class="field">进塔水汽浓度 / ppmv<input name="inlet_water_value" type="number" step="any" min="0" max="1000000" placeholder="填写实测值；超过200会标记超限"></label>${pointField('inlet_water','进塔水汽采样点 · 可选')}
      <label class="field full">进塔水汽备注<input name="inlet_water_note" maxlength="4000" placeholder="采样操作或现场情况"></label>
    </div></fieldset>
    <fieldset class="cursor-reading-group"><legend>氨水浓度</legend><div class="form-grid">
      <label class="field">氨水质量分数 / %<input name="ammonia_value" type="number" step="any" min="0" max="100" placeholder="填写实测浓度"></label>${pointField('ammonia','氨水采样点 · 填浓度时必填')}
      <label class="field full">氨水备注<input name="ammonia_note" maxlength="4000" placeholder="说明哪个点的浓度及取样情况"></label>
    </div></fieldset>
    <label class="cursor-replace"><input type="checkbox" name="replace">更新此时间已存在的温压记录，以及同采样点、同单位浓度记录</label>
    ${formFooter('保存实测数据')}</form>`,true);
  $('[name="water_value"]',$('#modal')).oninput=event=>{
    $('#cursor-water-preview').textContent=event.target.value===''?'标准状态：0℃、101.325kPa（绝压），输入后换算为 ppmv。':`${num(Number(event.target.value)/18.0153*8.31446261815324*273.15/101325*1e6,2)} ppmv · 标准状态 0℃ / 101.325kPa（绝压）`;
  };
  wireForm(async form=>{
    const values=keys.map(key=>form.get(key)),hasSample=values.some(value=>value!=='');
    if(hasSample&&values.some(value=>value===''))throw new Error('温压组请同时填写三个床层温度和系统压力；也可全部留空，仅记录浓度。');
    const hasWater=form.get('water_value')!=='',hasAmmonia=form.get('ammonia_value')!=='',hasInletWater=form.get('inlet_water_value')!=='';
    if(!hasSample&&!hasWater&&!hasAmmonia&&!hasInletWater)throw new Error('请至少填写一组实测数据。');
    if(hasAmmonia&&!form.get('ammonia_point').trim())throw new Error('请填写氨水采样点名称。');
    const payload={timestamp:isoInput(form.get('timestamp')),replace:form.has('replace'),sample:hasSample?Object.fromEntries(keys.map(key=>[key,Number(form.get(key))])):null,
      water:hasWater?{value:Number(form.get('water_value')),point:form.get('water_point'),note:form.get('water_note'),unit:'g/m3',basis:'standard0',temperature_c:0,pressure_kpa:101.325}:null,
      ammonia:hasAmmonia?{value:Number(form.get('ammonia_value')),point:form.get('ammonia_point'),note:form.get('ammonia_note'),unit:'%'}:null,
      inlet_water:hasInletWater?{value:Number(form.get('inlet_water_value')),point:form.get('inlet_water_point'),note:form.get('inlet_water_note'),unit:'ppmv'}:null};
    await api(batchPath('/cursor-readings'),{method:'POST',body:payload});
    if(hasWater){state.waterPoint=payload.water.point.trim()||'未标明采样点';state.waterPointBatch=state.batchId;}
    if(hasAmmonia){state.ammoniaPlotUnit='%';state.ammoniaPlotBatch=state.batchId;}
    if(hasInletWater){state.inletWaterPoint=payload.inlet_water.point.trim()||'未标明采样点';state.inletWaterPointBatch=state.batchId;}
    closeModal();await refresh();toast('实测数据已保存，曲线与速率已更新');
  });
}

document.addEventListener('pointerdown',event=>{if(!event.target.closest('#chart-context-menu'))hideChartContextMenu();});
document.addEventListener('scroll',hideChartContextMenu,true);
window.addEventListener('resize',hideChartContextMenu);
