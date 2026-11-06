'use strict';

function samplingGroups(detail=state.detail,query=''){
  const grouped=new Map();
  const get=timestamp=>{const time=ms(timestamp);if(!grouped.has(time))grouped.set(time,{timestamp,thermal:null,water:[],inlet_water:[],ammonia:[]});return grouped.get(time);};
  for(const sample of detail.samples||[])get(sample.timestamp).thermal=sample;
  for(const kind of ['water','inlet_water','ammonia'])for(const sample of detail.concentrations?.[kind]||[])get(sample.timestamp)[kind].push(sample);
  const term=query.trim().toLowerCase();
  return [...grouped.values()].sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)).filter(row=>!term||[
    fmt(row.timestamp,false,true),...['water','inlet_water','ammonia'].flatMap(kind=>row[kind].flatMap(r=>[r.point,r.note,concentrationNames[kind]]))
  ].join(' ').toLowerCase().includes(term));
}

function samplingChemicalCell(records,kind){
  if(!records.length)return '<span class="muted">—</span>';
  return records.map(r=>`<div class="sampling-chemical"><div><strong>${num(kind==='ammonia'?r.value:r.ppmv,kind==='ammonia'?3:2)}</strong> ${kind==='ammonia'?esc(ammoniaUnits[r.unit]||r.unit):'ppmv'}${r.outside_limit?' <span class="pill red">超限</span>':''}</div>
    <small>${esc(r.point||'未标明采样点')}</small>${kind==='water'?`<small>原值 ${num(r.value,4)} g/m³<br>${num(r.temperature_c,2)}℃ / ${num(r.pressure_kpa,3)}kPa（绝压）</small>`:''}
    ${r.note?`<div class="sample-note">${esc(r.note)}</div>`:''}</div>`).join('');
}

function samplingRowRecords(row){
  const records=row.thermal?[{kind:'sample',id:row.thermal.id,label:'温压读数'}]:[];
  for(const kind of ['water','inlet_water','ammonia']){
    for(const record of row[kind]){
      const unit=kind==='ammonia'?ammoniaUnits[record.unit]||record.unit:'ppmv';
      const value=kind==='ammonia'?record.value:record.ppmv;
      records.push({kind,id:record.id,label:`${concentrationNames[kind]} · ${record.point||'未标明采样点'} · ${num(value,kind==='ammonia'?3:2)} ${unit}`});
    }
  }
  return records;
}

function samplingRecordButton(record,operation,label,small=false){
  const action=record.kind==='sample'?`${operation}-sample`:`${operation}-concentration`;
  return `<button type="button" class="${small?'text-btn':'btn'}" data-action="${action}" data-kind="${record.kind}" data-id="${esc(record.id)}">${esc(label)}</button>`;
}

function samplingRowActions(row){
  const records=samplingRowRecords(row);
  const timestamp=ms(row.timestamp);
  const action=(operation,label)=>records.length===1?samplingRecordButton(records[0],operation,label,true):
    `<button type="button" class="text-btn" data-action="${operation}-sampling-row" data-time="${timestamp}">${label}</button>`;
  const mark=row.thermal?`<button class="text-btn" data-action="mark-sample" data-id="${esc(row.thermal.id)}">标记</button>`:'';
  return `<div class="row-actions"><button type="button" class="text-btn" data-action="edit-sampling-row" data-time="${timestamp}">编辑</button>${action('delete','删除')}${mark}</div>`;
}

function editSamplingRowModal(timestamp){
  if(!requireStarted())return;
  const row=samplingGroups().find(item=>ms(item.timestamp)===timestamp);
  if(!row)return toast('这条采样记录已更新，请刷新后重试',true);
  const concentrations=['water','inlet_water','ammonia'].flatMap(kind=>
    (row[kind].length?row[kind]:[null]).map(record=>({kind,record})));
  const fields=concentrations.map(({kind,record},i)=>{
    const unit=record?.unit||(kind==='water'?'g/m3':kind==='inlet_water'?'ppmv':'%');
    const unitLabel=kind==='water'?'g/m³':ammoniaUnits[unit]||unit;
    const point=record?.point?` · ${esc(record.point)}`:'';
    const basis=kind==='water'?`<small>换算基准 ${num(record?.temperature_c??0,2)}℃ / ${num(record?.pressure_kpa??101.325,3)} kPa（绝压）</small>`:'';
    const options=kind==='water'?`<details><summary>调整换算基准</summary><div class="form-grid">
      <label class="field">换算基准<select name="basis-${i}">${Object.entries(basisNames).map(([key,label])=>`<option value="${key}" ${(record?.basis||'standard0')===key?'selected':''}>${esc(label)}</option>`).join('')}</select></label>
      <label class="field">自定义温度 / ℃<input type="number" step="any" name="temperature-${i}" value="${record?.temperature_c??0}"></label>
      <label class="field">自定义绝对压力 / kPa<input type="number" step="any" name="pressure-${i}" value="${record?.pressure_kpa??101.325}"></label>
      </div></details>`:kind==='ammonia'?`<label class="field">浓度单位<select name="unit-${i}">${Object.entries(ammoniaUnits).map(([key,label])=>`<option value="${esc(key)}" ${unit===key?'selected':''}>${esc(label)}</option>`).join('')}</select></label>`:'';
    return `<fieldset class="cursor-reading-group"><legend>${esc(concentrationNames[kind])}${point}</legend>
      <div class="form-grid"><label class="field">浓度${kind==='ammonia'?'':' / '+esc(unitLabel)}<input type="number" name="concentration-${i}" min="0" step="any" value="${record?.value??''}" ${record?'required':''}>${basis}</label>
      <label class="field">采样点<input name="point-${i}" maxlength="120" value="${esc(record?.point||'')}" ${kind==='ammonia'&&record?'required':''}></label>
      <label class="field full">备注<input name="note-${i}" maxlength="4000" value="${esc(record?.note||'')}"></label></div>${options}</fieldset>`;
  }).join('');
  modal('修正采样读数',`<form><p class="modal-copy">可同时修改同一时刻的温压和各项浓度。没有实测值的项目可留空。修改采样时间会一起移动本行数据。</p>
    <label class="field">采样时间 · 北京时间<input name="timestamp" type="datetime-local" step="1" value="${localInput(row.timestamp,true)}" required></label>
    <fieldset class="cursor-reading-group"><legend>温压读数</legend><div class="form-grid">
      ${keys.map((key,i)=>`<label class="field">${names[i]} / ${i===3?'MPa':'℃'}<input type="number" name="${key}" step="any" min="${i===3?0:-273.15}" value="${row.thermal?.[key]??''}" ${row.thermal?'required':''}></label>`).join('')}
    </div></fieldset>${fields}${formFooter('保存修正')}</form>`,true);
  wireForm(async form=>{
    const thermal=keys.map(key=>form.get(key));
    const hasThermal=thermal.some(value=>value!=='');
    if(hasThermal&&thermal.some(value=>value===''))throw new Error('温压请同时填写三个床层温度和系统压力。');
    const sample=hasThermal?{id:row.thermal?.id,...Object.fromEntries(keys.map((key,i)=>[key,Number(thermal[i])]))}:null;
    const values=[];
    for(const [i,{kind,record}] of concentrations.entries()){
      const value=form.get(`concentration-${i}`);
      if(value==='')continue;
      const point=form.get(`point-${i}`).trim();
      if(kind==='ammonia'&&!point)throw new Error('请填写氨水采样点名称。');
      const entry={id:record?.id,kind,value:Number(value),point,note:form.get(`note-${i}`),
        unit:kind==='water'?'g/m3':kind==='inlet_water'?'ppmv':form.get(`unit-${i}`)};
      if(kind==='water'){
        const basis=form.get(`basis-${i}`);
        const temperature=form.get(`temperature-${i}`),pressure=form.get(`pressure-${i}`);
        if(basis==='custom'&&(temperature===''||pressure===''))throw new Error('请填写自定义换算温度和绝对压力。');
        Object.assign(entry,{basis,temperature_c:basis==='custom'?Number(temperature):basis==='ambient25'?25:0,
          pressure_kpa:basis==='custom'?Number(pressure):101.325});
      }
      values.push(entry);
    }
    await api(batchPath('/sampling-row'),{method:'PUT',body:{original_timestamp:row.timestamp,timestamp:isoInput(form.get('timestamp')),sample,concentrations:values}});
    closeModal();await refresh();toast('采样读数已修正，曲线与速率已更新');
  });
}

function chooseSamplingRecord(timestamp,operation){
  const row=samplingGroups().find(item=>ms(item.timestamp)===timestamp);
  if(!row)return toast('这条采样记录已更新，请刷新后重试',true);
  const label=operation==='edit'?'编辑':'删除';
  const choices=samplingRowRecords(row).map(record=>samplingRecordButton(record,operation,record.label)).join('');
  modal(`选择要${label}的数据`,`<p class="modal-copy">${fmt(row.timestamp,false,true)} · 此时刻有多项数据，请选择其中一项。</p><div class="sampling-record-choices">${choices}</div>`);
}

function samplingRows(query=''){
  const rows=samplingGroups(state.detail,query);
  return rows.map(row=>{const s=row.thermal;return `<tr data-sampling-time="${ms(row.timestamp)}"><td class="numeric">${fmt(row.timestamp,false,true)}</td><td class="numeric">${num(hours(row.timestamp))}</td>
    ${keys.map((key,j)=>`<td class="numeric">${num(s?.[key],j===3?3:1)}</td>`).join('')}
    ${['water','inlet_water','ammonia'].map(kind=>`<td>${samplingChemicalCell(row[kind],kind)}</td>`).join('')}
    <td class="numeric muted">${s?.rates?.values?s.rates.values.map((v,j)=>num(v,j===3?3:1)).join(' / '):'—'}</td>
    <td>${samplingRowActions(row)}</td></tr>`;}).join('')||`<tr><td colspan="11" class="empty-small">${query.trim()?'没有符合筛选条件的采样记录。':'暂无采样记录，可录入温压、浓度或导入历史数据。'}</td></tr>`;
}

function unifiedDataView(){
  const d=state.detail,count=samplingGroups(d).length,chemicals=Object.values(d.concentrations||{}).flat().length;
  return `<section class="panel sampling-panel"><div class="data-tools"><div><div class="section-title">${icon('data')}采样记录 <span class="pill blue">${count} 个采样时间</span></div><p>最新数据在最上面 · 同一时刻合并显示，缺项显示“—” · 温压 ${d.samples.length} 条 / 浓度 ${chemicals} 条</p></div>
    <div class="sampling-tools"><input type="search" id="data-search" placeholder="筛选时间、采样点或备注" aria-label="筛选采样记录"><button class="btn primary small" data-action="next-reading">${icon('plus')}添加数据</button><button class="btn small" data-action="export">${icon('download')}导出 / 备份</button></div></div>
    <div class="table-wrap sampling-table"><table><thead><tr><th>采样时间 / 北京时间 ↓</th><th>累计 h</th>${names.map((name,j)=>`<th style="color:${colors[j]}">${name} / ${j===3?'MPa':'℃'}</th>`).join('')}<th>出塔水汽浓度</th><th>进塔水汽浓度</th><th>氨水浓度 / 采样点</th><th>速率 ℃/h · MPa/h</th><th>操作</th></tr></thead><tbody id="sample-table">${samplingRows()}</tbody></table></div>
    <div class="table-note"><span>浓度保留独立采样点、原值、温压基准和备注；同一时刻多个采样点分别显示和编辑。速率采用近2小时线性拟合。</span></div></section>`;
}

function bindSamplingFilter(){$('#data-search')?.addEventListener('input',event=>{$('#sample-table').innerHTML=samplingRows(event.target.value);});}
