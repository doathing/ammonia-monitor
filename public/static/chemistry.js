'use strict';
// Defaults explicitly confirmed by the operator; every stored record keeps its own basis/unit.
const concentrationNames={water:'出塔水汽浓度',inlet_water:'进塔水汽浓度',ammonia:'氨水浓度'};
const chemistryDefaults={waterBasis:'standard0',ammoniaUnit:'%'};
const chemistryDefaultRevision='standard0-percent-v1';
// Apply the confirmed defaults once even when an older browser remembered other choices.
// Subsequent deliberate selections are still remembered; historical records are untouched.
if(localStorage.getItem('ammonia-concentration-defaults')!==chemistryDefaultRevision){
  localStorage.setItem('ammonia-water-basis',chemistryDefaults.waterBasis);
  localStorage.setItem('ammonia-liquid-unit',chemistryDefaults.ammoniaUnit);
  localStorage.setItem('ammonia-concentration-defaults',chemistryDefaultRevision);
}
const basisNames={standard0:'标准状态 · 0℃ / 101.325kPa',ambient25:'常温基准 · 25℃ / 101.325kPa',custom:'自定义体积基准温压'};
const ammoniaUnits={'%':'质量分数 %','g/L':'g/L','mg/L':'mg/L'};

function concentrationSeries(kind){
  let rows=state.detail.concentrations?.[kind]||[];
  if(kind==='ammonia'){
    const units=[...new Set(rows.map(r=>r.unit))];
    if(state.ammoniaPlotBatch!==state.batchId||!state.ammoniaPlotUnit){state.ammoniaPlotBatch=state.batchId;state.ammoniaPlotUnit=units[0]||chemistryDefaults.ammoniaUnit||'%';}
    rows=rows.filter(r=>r.unit===state.ammoniaPlotUnit);
  }
  const groups=new Map();
  for(const row of rows){const key=row.point||'未标明采样点';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return [...groups].map(([point,records],i)=>({id:`chem-${kind}-${i}`,name:point,type:'line',showSymbol:false,symbol:'none',symbolSize:0,connectNulls:false,
    data:records.map(r=>[ms(r.timestamp),kind==='water'||kind==='inlet_water'?r.ppmv:r.value,r.id]),
    lineStyle:{width:2,color:kind==='inlet_water'?'#d15c83':kind==='water'?['#439fd1','#53b6ab','#8d87d6'][i%3]:['#9a73d5','#d79a4c','#53b6ab','#6b92d0'][i%4]},
    itemStyle:{color:kind==='inlet_water'?'#d15c83':kind==='water'?['#439fd1','#53b6ab','#8d87d6'][i%3]:['#9a73d5','#d79a4c','#53b6ab','#6b92d0'][i%4]}}));
}
function ammoniaAxes(axis){return {...axis,min:0,name:ammoniaUnits[state.ammoniaPlotUnit]||'%'};}
function concentrationTooltip(kind,params){
  const rows=state.detail.concentrations?.[kind]||[];
  return `<div class="chart-tooltip">${params.map(p=>{const r=rows.find(r=>r.id===p.value?.[2]);if(!r)return '';return `<div><b>${esc(r.point||'未标明采样点')}</b> · ${fmt(r.timestamp,false,true)}<br>${kind==='water'?`${num(r.value,4)} g/m³ → <b>${num(r.ppmv,2)} ppmv</b><br>${esc(basisNames[r.basis])} · ${num(r.temperature_c,2)}℃ / ${num(r.pressure_kpa,3)} kPa（绝压）`:`<b>${num(r.value,3)} ${r.kind==='inlet_water'?'ppmv':esc(ammoniaUnits[r.unit])}</b>`}${r.note?`<br>备注：${esc(r.note)}`:''}</div>`;}).filter(Boolean).join('<hr style="border:0;border-top:1px solid #e9eef7">')}</div>`;
}
function concentrationTable(){
  const chemical=state.detail.concentrations||{water:[],ammonia:[],inlet_water:[]};
  const records=[...chemical.water,...chemical.ammonia,...(chemical.inlet_water||[])].sort((a,b)=>ms(b.timestamp)-ms(a.timestamp));
  return `<section class="panel chemistry-records"><div class="panel-header"><div class="section-title">${icon('data')}浓度采样记录 <span class="pill blue">${records.length} 条</span></div><div class="chemistry-toolbar"><button class="btn small" data-action="water">${icon('plus')}出塔水汽</button><button class="btn small" data-action="inlet-water">${icon('plus')}进塔水汽</button><button class="btn small" data-action="ammonia">${icon('plus')}氨水</button><a class="btn small" href="${batchPath('/export/concentrations')}" download>${icon('download')}浓度 CSV</a></div></div><div class="table-wrap"><table><thead><tr><th>采样时间 / 北京时间</th><th>类型</th><th>采样点</th><th>输入浓度</th><th>水汽 ppmv</th><th>体积基准温压</th><th>备注</th><th>操作</th></tr></thead><tbody>${records.map(r=>`<tr><td class="numeric">${fmt(r.timestamp,false,true)}</td><td>${esc(concentrationNames[r.kind])}${r.outside_limit?' <span class="pill red">超限</span>':''}</td><td>${esc(r.point||'未标明')}</td><td class="numeric">${num(r.value,4)} <span class="unit-label">${r.kind==='water'?'g/m³':r.kind==='inlet_water'?'ppmv':esc(ammoniaUnits[r.unit])}</span></td><td class="numeric">${num(r.ppmv,2)}</td><td>${r.kind==='water'?`${num(r.temperature_c,2)}℃ / ${num(r.pressure_kpa,3)}kPa（绝压）`:'—'}</td><td class="sample-note">${esc(r.note)}</td><td><button class="text-btn" data-action="edit-concentration" data-kind="${r.kind}" data-id="${r.id}">编辑</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty-small">暂无浓度采样，出塔水汽、进塔水汽和氨水可独立录入。</td></tr>'}</tbody></table></div><div class="chemistry-notes">出塔水汽保留原始 g/m³ 与换算温压，ppmv 为理想气体体积分数估算。进塔水汽直接填写ppmv，上限200ppmv，超过上限仍按实测保存并标记。氨水不同单位不自动换算，图中可选择查看单位，同一单位下不同采样点分别绘线。</div></section>`;
}
function concentrationModal(kind,record){
  if(!requireStarted())return;
  const editing=!!record?.id,isWater=kind==='water',isInlet=kind==='inlet_water';
  const basis=record?.basis||localStorage.getItem('ammonia-water-basis')||chemistryDefaults.waterBasis;
  const unit=record?.unit||localStorage.getItem('ammonia-liquid-unit')||chemistryDefaults.ammoniaUnit;
  const points=[...new Set((state.detail.concentrations?.[kind]||[]).map(r=>r.point).filter(Boolean))];
  modal(`${editing?'编辑':'录入'}${concentrationNames[kind]}`,
  `<form><p class="modal-copy">${isWater?'输入出塔水汽质量浓度 g/m³，选择这一个立方米气体所对应的温压基准，换算为 ppmv。此压力为绝对压力，不自动采用合成塔系统压力。':isInlet?'直接填写进塔水汽浓度ppmv，上限200ppmv。超过上限仍按实测保存并标记超限。':'选择浓度单位，填写采样点名称。不同采样点分别绘线，备注将显示在图表读数和记录表中。'}</p><div class="form-grid">
    <label class="field full">采样时间 · 北京时间<input type="datetime-local" name="timestamp" step="1" required value="${localInput(record?.timestamp||(state.detail.batch.status==='completed'?state.detail.view_time:Date.now()),true)}"></label>
    <label class="field">${isWater?'出塔水汽浓度 / g/m³':isInlet?'进塔水汽浓度 / ppmv':'氨水浓度'}<input name="value" type="number" step="any" min="0" required value="${record?.value??''}" ${isInlet?'max="1000000"':''} placeholder="填写实测浓度"></label>
    ${isWater?`<label class="field">g/m³ 的体积温压基准<select name="basis" required><option value="">请选择基准</option>${Object.entries(basisNames).map(([v,n])=>`<option value="${v}" ${basis===v?'selected':''}>${n}</option>`).join('')}</select></label><label class="field">基准温度 / ℃<input type="number" name="temperature_c" step="any" min="-273.149" required value="${record?.temperature_c??''}"></label><label class="field">基准绝对压力 / kPa<input type="number" name="pressure_kpa" step="any" min="0.000001" required value="${record?.pressure_kpa??''}"><small>101.325 kPa = 1 标准大气压</small></label><div class="conversion-preview" id="water-preview">选择温压基准并输入浓度后显示换算结果。</div>`:isInlet?'<input type="hidden" name="unit" value="ppmv">':`<label class="field">浓度单位<select name="unit" required><option value="">请选择单位</option>${Object.entries(ammoniaUnits).map(([v,n])=>`<option value="${v}" ${unit===v?'selected':''}>${n}</option>`).join('')}</select></label>`}
    <label class="field full">采样点名称${isWater||isInlet?'（可选）':''}<input name="point" list="chemical-points" maxlength="120" ${isWater||isInlet?'':'required'} value="${esc(record?.point||'')}" placeholder="例如：一床层出口 / 水分离器出口"><datalist id="chemical-points">${points.map(p=>`<option value="${esc(p)}">`).join('')}</datalist></label>
    <label class="field full">备注<textarea name="note" maxlength="4000" placeholder="说明是哪个位置取样、采样操作或其他情况…">${esc(record?.note||'')}</textarea></label>
  </div>${formFooter(editing?'保存浓度修正':'保存浓度记录',editing?`<button type="button" class="btn danger left" data-action="delete-concentration" data-kind="${kind}" data-id="${record.id}">删除记录</button>`:'')}</form>`);
  if(isWater){
    const select=$('[name="basis"]'),temperature=$('[name="temperature_c"]'),pressure=$('[name="pressure_kpa"]');
    const preview=()=>{
      const value=$('[name="value"]').value,t=temperature.value,p=pressure.value;
      if(!select.value||value===''||t===''||p===''||Number(t)<=-273.15||Number(p)<=0){$('#water-preview').textContent='填写浓度并确认温压基准后换算。';return;}
      const ppm=Number(value)/18.0153*8.31446261815324*(Number(t)+273.15)/(Number(p)*1000)*1e6;
      $('#water-preview').innerHTML=ppm>1e6?'结果超过100%体积分数，请核对输入。':`<strong>${num(ppm,2)}</strong> ppmv <span class="muted">· ${num(Number(t),2)}℃ / ${num(Number(p),3)}kPa（绝压）<br>按理想气体估算；g/m³ 与温压须为同一体积基准。</span>`;
    };
    const changeBasis=()=>{if(select.value==='standard0'||select.value==='ambient25'){temperature.value=select.value==='standard0'?0:25;pressure.value=101.325;temperature.readOnly=true;pressure.readOnly=true;}else{temperature.readOnly=false;pressure.readOnly=false;if(!record&&!select.value){temperature.value='';pressure.value='';}}preview();};
    select.addEventListener('change',changeBasis);$$('#modal input').forEach(el=>el.addEventListener('input',preview));changeBasis();
  }
  wireForm(async form=>{
    const payload={timestamp:isoInput(form.get('timestamp')),value:Number(form.get('value')),point:form.get('point'),note:form.get('note')};
    if(isWater)Object.assign(payload,{unit:'g/m3',basis:form.get('basis'),temperature_c:Number(form.get('temperature_c')),pressure_kpa:Number(form.get('pressure_kpa'))});else payload.unit=form.get('unit');
    await api(batchPath(`/concentrations/${kind}${editing?'/'+record.id:''}`),{method:editing?'PUT':'POST',body:payload});
    if(isWater){localStorage.setItem('ammonia-water-basis',payload.basis);state.waterPoint=payload.point||'未标明采样点';state.waterPointBatch=state.batchId;}else if(isInlet){state.inletWaterPoint=payload.point||'未标明采样点';state.inletWaterPointBatch=state.batchId;}else{localStorage.setItem('ammonia-liquid-unit',payload.unit);state.ammoniaPlotUnit=payload.unit;state.ammoniaPlotBatch=state.batchId;}
    closeModal();await refresh();toast('浓度记录已保存，曲线已更新');
  });
}
async function deleteConcentration(kind,id){
  if(!confirm('确认删除这条浓度记录？'))return;
  await api(batchPath(`/concentrations/${kind}/${id}`),{method:'DELETE'});closeModal();await refresh();toast('浓度记录已删除');
}
