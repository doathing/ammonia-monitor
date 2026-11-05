'use strict';

function currentPlan(detail=state.detail){return detail.curve_plan||detail.batch.plan;}

function planView(){
  const detail=state.detail,plan=currentPlan();
  return `<div class="info-box">下表每个阶段均可点击“编辑参数”，修改阶段名称、时长、三个床层的计划温度与升温速率、压力、水汽及氨冷温度。累计小时按各段时长自动计算；保存后计划曲线、对比参考和完成偏差同步重算。原始计划快照保留，修改记入事件时间线。</div>
    <div class="plan-actions"><p>当前计划 · 总计 ${num(plan.reduce((sum,stage)=>sum+stage.hours,0),1)}h · 原始计划快照保留</p><div>${detail.batch.status==='draft'?'<button class="btn small" data-action="edit-plan">编辑原始草稿</button> <button class="btn primary small" data-action="start">启动批次</button>':''}<button class="btn small" data-action="water-plan">设置计划出塔水汽</button> <button class="btn small" data-action="source-plan">查看默认原计划</button></div></div>
    ${planTable(plan,{waterPlan:detail.water_plan,showWater:true,editableCurves:true})}
    <section class="panel plan-stages"><div class="panel-header"><div class="section-title">${icon('clock')}实际阶段记录</div>${detail.batch.status==='active'&&detail.stages.length<10?'<button class="text-btn" data-action="stage">完成本阶段</button>':''}</div><div class="table-wrap"><table><thead><tr><th>阶段</th><th>实际开始时间</th><th>实际持续时间</th><th>操作</th></tr></thead><tbody>${detail.stages.map((stage,index)=>`<tr><td>${esc(plan[stage.stage_index].name)}</td><td class="numeric">${fmt(stage.start_time)}</td><td>${num((ms(detail.stages[index+1]?.start_time||detail.view_time)-ms(stage.start_time))/3600000)}h ${!detail.stages[index+1]&&detail.batch.status==='active'?'（进行中）':''}</td><td>${index?`<button class="text-btn" data-action="edit-stage" data-id="${index}">修正时间</button>`:'开工时间'}</td></tr>`).join('')||'<tr><td colspan="4">等待启动</td></tr>'}</tbody></table></div></section>`;
}

function planTable(plan,{waterPlan=[],showWater=false,editableCurves=false}={}){
  let cumulative=0,originalCumulative=0;
  return `<section class="panel"><div class="table-wrap"><table class="reduction-plan-table"><thead><tr><th rowspan="2">阶段</th><th rowspan="2">本期 / 累计 h</th><th colspan="2" style="color:${colors[0]}">一床层</th><th colspan="2" style="color:${colors[1]}">二床层</th><th colspan="2" style="color:${colors[2]}">三床层</th><th rowspan="2">计划压力 MPa</th>${showWater?'<th rowspan="2" class="water-plan-column">计划出塔水汽 ppmv</th><th rowspan="2" class="inlet-water-plan-column">计划进塔水汽 ppmv</th>':''}<th rowspan="2">氨冷温度</th>${editableCurves?'<th rowspan="2">编辑</th>':''}</tr><tr><th>计划热点 ℃</th><th>计划 ℃/h</th><th>计划热点 ℃</th><th>计划 ℃/h</th><th>计划热点 ℃</th><th>计划 ℃/h</th></tr></thead><tbody>${plan.map((stage,index)=>{
    cumulative+=stage.hours;const custom=editableCurves&&state.detail.curve_overrides?.[index],original=editableCurves?state.detail.batch.plan[index]:null;originalCumulative+=original?.hours||stage.hours;
    const old=text=>custom?`<small>原计划：${esc(text)}</small>`:'';
    return `<tr data-plan-stage="${index}"><td class="plan-curve-cell">${esc(stage.name)}${old(original?.name)}</td><td class="numeric plan-curve-cell">${num(stage.hours,1)} / ${num(cumulative,1)}${old(`${num(original?.hours,1)} / ${num(originalCumulative,1)}`)}</td>${stage.temps.map((spec,j)=>`<td class="plan-curve-cell">${esc(spec.label)}${old(original?.temps[j].label)}</td><td class="numeric plan-curve-cell">${rangeLabel(stage.rates[j])}${old(rangeLabel(original?.rates[j]))}</td>`).join('')}<td class="plan-curve-cell">${esc(stage.pressure_label)}${old(original?.pressure_label)}</td>${showWater?`<td class="water-plan-column numeric">${plannedWaterLabel(waterPlan[index])}</td><td class="inlet-water-plan-column numeric">≤${state.detail.inlet_water_limit_ppmv}</td>`:''}<td class="plan-curve-cell">${esc(stage.ammonia)}${old(original?.ammonia)}</td>${editableCurves?`<td><button class="btn small" data-action="curve-stage" data-stage="${index}">编辑参数</button></td>`:''}</tr>`;
  }).join('')}</tbody></table></div><div class="table-note">${editableCurves?'所有当前参数可在“编辑参数”中填写；累计小时由各阶段时长自动重算。计划升温速率要求可独立编辑，与温差/时长推算的轨迹斜率分开保存。':'默认原计划按2026年11月4日确认表设置，共10阶段、127小时。'}</div></section>`;
}

function curveStageModal(index){
  if(!requireBatch()||!Number.isInteger(index)||!currentPlan()[index])return;
  const detail=state.detail,plan=currentPlan(),stage=plan[index],custom=detail.curve_overrides?.[index],water=detail.water_plan?.[index];
  const offset=plan.slice(0,index).reduce((sum,item)=>sum+item.hours,0);
  const options=[['ramp','起终值线性变化'],['target','固定温度']];
  const hasLegacyTemperatures=stage.temps.some(spec=>!['ramp','target'].includes(spec.kind));
  modal(`编辑阶段参数 · ${stage.name}`,`<form id="curve-stage-form"><p class="modal-copy">本阶段计划起点为累计 ${num(offset,1)}h。修改时长会重算后续累计时间、计划曲线及完成偏差；实测记录和原始计划快照保留。曲线形式可选择起终值线性变化或固定温度；固定温度按设定值绘制，起始值保留作为记录。${hasLegacyTemperatures?'本阶段原有的上限、范围或约值在保存时将转换为固定温度，设定值使用原结束温度。':''}</p>
    <div class="form-grid"><label class="field">阶段名称<textarea name="stage-name" required maxlength="80" rows="2" aria-describedby="stage-name-hint">${esc(stage.name)}</textarea><small id="stage-name-hint">按 Enter 换行，最多 80 个字符。</small></label><label class="field">本阶段时长 / h<input name="stage-hours" required type="number" step="any" min="0.01" max="1000" value="${stage.hours}"></label><div class="field full"><small id="stage-cumulative-preview"></small></div></div>
    ${stage.temps.map((spec,j)=>`<fieldset class="cursor-reading-group"><legend style="color:${colors[j]}">${names[j]} · 计划温度与升温速率</legend><div class="form-grid"><label class="field">曲线形式<select name="curve-kind-${j}">${options.map(([value,label])=>`<option value="${value}" ${(spec.kind==='ramp'?'ramp':'target')===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label class="field">起始温度 ℃<input type="number" step="any" min="-273.15" name="curve-start-${j}" value="${spec.start??''}" placeholder="可填写；线性变化留空使用初温 ${detail.batch.initial[j]}℃"></label><label class="field">结束温度 / 设定值 ℃<input type="number" required step="any" min="-273.15" name="curve-end-${j}" value="${spec.end}"></label><div class="field curve-slope"><span>轨迹参考斜率 · 温差/时长推算</span><b id="curve-slope-${j}"></b></div><label class="field">计划升温速率下限 / ℃/h<input name="stage-rate-min-${j}" type="number" min="0" step="any" value="${stage.rates[j]?.[0]??''}" placeholder="留空=未规定"></label><label class="field">计划升温速率上限 / ℃/h<input name="stage-rate-max-${j}" type="number" min="0" step="any" value="${stage.rates[j]?.[1]??''}" placeholder="留空采用下限"></label></div></fieldset>`).join('')}
    <fieldset class="cursor-reading-group"><legend>系统压力 · 计划曲线</legend><div class="form-grid"><label class="field">起始压力 / MPa<input type="number" required min="0" step="any" name="curve-pressure-start" value="${stage.pressure[0]}"></label><label class="field">结束压力 / MPa<input type="number" required min="0" step="any" name="curve-pressure-end" value="${stage.pressure[1]}"></label><label class="field checkbox"><input type="checkbox" name="stage-pressure-approx" ${stage.pressure_label.includes('约')?'checked':''}>压力标为约值</label><div class="field curve-slope"><span>参考升压速率 · 压力差/时长推算</span><b id="curve-pressure-slope"></b></div></div></fieldset>
    <fieldset class="cursor-reading-group"><legend>计划出塔水汽与氨冷温度</legend><div class="form-grid"><label class="field">计划出塔水汽形式<select name="stage-water-kind"><option value="unset" ${!water?'selected':''}>未设置</option><option value="upper" ${water?.kind==='upper'?'selected':''}>上限 ≤</option><option value="ramp" ${water?.kind==='ramp'?'selected':''}>起终值变化参考</option></select></label><label class="field stage-water-values">水汽单位<select name="stage-water-unit"><option value="ppmv" ${water?.unit!=='g/m3'?'selected':''}>ppmv</option><option value="g/m3" ${water?.unit==='g/m3'?'selected':''}>g/m³（标准状态）</option></select></label><label class="field stage-water-values">水汽上限 / 起始值<input name="stage-water-start" type="number" step="any" min="0" value="${water?.start??''}"></label><label class="field stage-water-end-field">水汽结束值<input name="stage-water-end" type="number" step="any" min="0" value="${water?.end??''}"></label><label class="field full">氨冷温度 / 备注<input name="stage-ammonia" maxlength="120" value="${esc(stage.ammonia)}" placeholder="例如：−10～−15℃"></label></div></fieldset>
    ${formFooter('保存阶段参数',custom?'<button type="button" class="btn danger left" id="reset-curve-stage">恢复原阶段参数（保留水汽）</button>':'')}</form>`,true);
  const update=()=>{
    const duration=Number($('[name="stage-hours"]').value);
    $('#stage-cumulative-preview').textContent=`本阶段累计终点：${num(offset+duration,2)}h；后续阶段自动顺延。`;
    for(let j=0;j<3;j++){
      const kind=$(`[name="curve-kind-${j}"]`).value,start=$(`[name="curve-start-${j}"]`),end=$(`[name="curve-end-${j}"]`);
      const slope=kind==='ramp'&&end.value!==''&&duration>0?(Number(end.value)-(start.value===''?detail.batch.initial[j]:Number(start.value)))/duration:kind==='target'?0:null;
      $(`#curve-slope-${j}`).textContent=slope==null?'填写起终温度和有效时长后计算':`${num(slope,3)} ℃/h`;
    }
    const a=$('[name="curve-pressure-start"]').value,b=$('[name="curve-pressure-end"]').value;
    $('#curve-pressure-slope').textContent=a===''||b===''||!(duration>0)?'填写起终压力和时长后计算':`${num((Number(b)-Number(a))/duration,4)} MPa/h`;
    const kind=$('[name="stage-water-kind"]').value;
    $$('.stage-water-values').forEach(node=>node.classList.toggle('hidden',kind==='unset'));
    $('.stage-water-end-field').classList.toggle('hidden',kind!=='ramp');
    $('[name="stage-water-start"]').required=kind!=='unset';$('[name="stage-water-end"]').required=kind==='ramp';
  };
  $('#curve-stage-form').addEventListener('input',update);$('#curve-stage-form').addEventListener('change',update);update();
  const save=async payload=>{await api(batchPath(`/curve-plan/${index}`),{method:'PUT',body:payload});closeModal();await refresh();toast(payload?'阶段参数已保存，计划曲线、累计时间及偏差已更新':'已恢复原阶段参数，计划出塔水汽保持当前设置');};
  if($('#reset-curve-stage'))$('#reset-curve-stage').onclick=async()=>{try{await save(null);}catch(error){$('#form-error').textContent=error.message;}};
  wireForm(async form=>{
    const temps=[0,1,2].map(j=>{
      const kind=form.get(`curve-kind-${j}`),raw=form.get(`curve-start-${j}`),start=raw===''?null:Number(raw),end=Number(form.get(`curve-end-${j}`));
      const label=kind==='ramp'?`${start==null?'常温':start}–${end}`:String(end);
      return {kind,start,end,strict:false,label};
    });
    const rates=[0,1,2].map(j=>{const a=form.get(`stage-rate-min-${j}`),b=form.get(`stage-rate-max-${j}`);if(a===''&&b==='')return null;if(a==='')throw new Error(`第${j+1}床层请先填写升温速率下限，或上下限都留空。`);return [Number(a),b===''?Number(a):Number(b)];});
    const kind=form.get('stage-water-kind'),start=form.get('stage-water-start');
    const water=kind==='unset'?null:{kind,unit:form.get('stage-water-unit'),start:Number(start),end:kind==='upper'?Number(start):Number(form.get('stage-water-end'))};
    await save({name:form.get('stage-name'),hours:Number(form.get('stage-hours')),temps,rates,pressure:[Number(form.get('curve-pressure-start')),Number(form.get('curve-pressure-end'))],pressure_approx:form.has('stage-pressure-approx'),water,ammonia:form.get('stage-ammonia')});
  });
}
