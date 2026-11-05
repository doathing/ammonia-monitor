'use strict';
function waterPlanValue(time){
  const reference=getReference(time);if(!reference)return null;
  const plan=currentPlan(),i=reference.stage_index,stage=plan[i],target=state.detail.water_plan?.[i];if(!target)return null;
  const offset=plan.slice(0,i).reduce((sum,s)=>sum+s.hours,0);
  const fraction=Math.max(0,Math.min(1,(hours(time)-offset)/stage.hours));
  const value=target.start+(target.end-target.start)*fraction;
  return target.unit==='g/m3'?value/18.0153*8.31446261815324*273.15/101325*1e6:value;
}
function waterPlanModal(){
  if(!requireBatch())return;
  const d=state.detail;
  modal('设置计划出塔水汽浓度',`<form><p class="modal-copy">现场确认：一层还原初期、一层还原主期（默认原计划累计6–23h）水汽≤1000ppmv，其余阶段≤3000ppmv。可按阶段修改上限，或改为变化参考；清空的阶段不绘线。g/m³按0℃、101.325kPa绝压换算。</p><div class="table-wrap"><table><thead><tr><th>阶段</th><th>类型</th><th>单位</th><th>上限 / 起始浓度</th><th>结束浓度（变化参考）</th></tr></thead><tbody>${currentPlan(d).map((s,i)=>{const value=d.water_plan?.[i];return `<tr><td>${esc(s.name)}</td><td><select name="water-kind-${i}" class="plan-input"><option value="upper" ${value?.kind!=='ramp'?'selected':''}>上限≤</option><option value="ramp" ${value?.kind==='ramp'?'selected':''}>变化参考</option></select></td><td><select name="water-unit-${i}" class="plan-input"><option value="g/m3" ${value?.unit!=='ppmv'?'selected':''}>g/m³</option><option value="ppmv" ${value?.unit==='ppmv'?'selected':''}>ppmv</option></select></td><td><input class="plan-input" type="number" step="any" min="0" name="water-start-${i}" value="${value?.start??''}" placeholder="未设置"></td><td><input class="plan-input" type="number" step="any" min="0" name="water-end-${i}" value="${value?.end??''}" placeholder="与起始相同"></td></tr>`;}).join('')}</tbody></table></div>${formFooter('保存水汽计划')}</form>`,true);
  $$('[name^="water-kind-"]').forEach(select=>{select.onchange=()=>{const index=select.name.split('-').at(-1);$(`[name="water-end-${index}"]`).disabled=select.value==='upper';};select.onchange();});
  wireForm(async form=>{
    const values=currentPlan(d).map((_,i)=>{const start=form.get(`water-start-${i}`),end=form.get(`water-end-${i}`)??'';if(start===''&&end==='')return null;if(start==='')throw new Error(`第${i+1}阶段请先填写起始浓度`);const kind=form.get(`water-kind-${i}`);return {start:Number(start),end:kind==='upper'?Number(start):end===''?Number(start):Number(end),unit:form.get(`water-unit-${i}`),kind};});
    await api(batchPath('/water-plan'),{method:'PUT',body:values});closeModal();await refresh();toast('计划出塔水汽浓度已保存');
  });
}
function finishDeltaText(stage,short=false){
  const delta=stage.finish_delta_hours;
  if(stage.status==='ontime')return short?'按期完成':'按期完成';
  const value=Math.abs(delta),rounded=Math.round(value*100)/100;
  return `${delta<0?'提前':'延期'}${rounded}h${short?'':'完成'}`;
}
function completedLegend(){
  return stageStripMarkup();
}

function plannedWaterLabel(value){
  if(!value)return '未设置';
  const convert=number=>value.unit==='g/m3'?number/18.0153*8.31446261815324*273.15/101325*1e6:number;
  return value.kind==='upper'?`≤${num(convert(value.start),0)}`:`${num(convert(value.start),1)} → ${num(convert(value.end),1)}`;
}
function waterPlanSection(){
  const d=state.detail;
  const completed=d.completed_stages||[];
  return `${completed.length?`<section class="panel plan-stages"><div class="panel-header"><div class="section-title">已完成阶段与计划偏差</div></div><div class="table-wrap"><table><thead><tr><th>阶段</th><th>计划完成</th><th>实际完成</th><th>完成时间偏差</th><th>本段实际 / 计划耗时</th></tr></thead><tbody>${completed.map(stage=>`<tr><td>${esc(stage.name)} 已完成</td><td>${fmt(stage.planned_end)}</td><td>${fmt(stage.end_time)}</td><td>${finishDeltaText(stage)}</td><td>${num(stage.actual_hours,2)} / ${num(stage.planned_hours,2)}h</td></tr>`).join('')}</tbody></table></div></section>`:''}`;
}
