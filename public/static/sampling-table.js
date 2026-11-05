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
    ${r.note?`<div class="sample-note">${esc(r.note)}</div>`:''}<button class="text-btn" data-action="edit-concentration" data-kind="${kind}" data-id="${esc(r.id)}">编辑${kind==='water'?'出塔水汽':kind==='inlet_water'?'进塔水汽':'氨水'}</button></div>`).join('');
}

function samplingRows(query=''){
  const rows=samplingGroups(state.detail,query);
  return rows.map(row=>{const s=row.thermal;return `<tr data-sampling-time="${ms(row.timestamp)}"><td class="numeric">${fmt(row.timestamp,false,true)}</td><td class="numeric">${num(hours(row.timestamp))}</td>
    ${keys.map((key,j)=>`<td class="numeric">${num(s?.[key],j===3?3:1)}</td>`).join('')}
    ${['water','inlet_water','ammonia'].map(kind=>`<td>${samplingChemicalCell(row[kind],kind)}</td>`).join('')}
    <td class="numeric muted">${s?.rates?.values?s.rates.values.map((v,j)=>num(v,j===3?3:1)).join(' / '):'—'}</td>
    <td>${s?`<div class="row-actions"><button class="text-btn" data-action="edit-sample" data-id="${esc(s.id)}">编辑温压</button><button class="text-btn" data-action="mark-sample" data-id="${esc(s.id)}">标记</button></div>`:'<span class="muted">—</span>'}</td></tr>`;}).join('')||`<tr><td colspan="11" class="empty-small">${query.trim()?'没有符合筛选条件的采样记录。':'暂无采样记录，可录入温压、浓度或导入历史数据。'}</td></tr>`;
}

function unifiedDataView(){
  const d=state.detail,count=samplingGroups(d).length,chemicals=Object.values(d.concentrations||{}).flat().length;
  return `<section class="panel sampling-panel"><div class="data-tools"><div><div class="section-title">${icon('data')}采样记录 <span class="pill blue">${count} 个采样时间</span></div><p>最新数据在最上面 · 同一时刻合并显示，缺项显示“—” · 温压 ${d.samples.length} 条 / 浓度 ${chemicals} 条</p></div>
    <div class="sampling-tools"><input type="search" id="data-search" placeholder="筛选时间、采样点或备注" aria-label="筛选采样记录"><button class="btn small" data-action="sample">${icon('plus')}温压读数</button><button class="btn small" data-action="water">出塔水汽</button><button class="btn small" data-action="inlet-water">进塔水汽</button><button class="btn small" data-action="ammonia">氨水</button><button class="btn small" data-action="export">${icon('download')}导出 / 备份</button></div></div>
    <div class="table-wrap sampling-table"><table><thead><tr><th>采样时间 / 北京时间 ↓</th><th>累计 h</th>${names.map((name,j)=>`<th style="color:${colors[j]}">${name} / ${j===3?'MPa':'℃'}</th>`).join('')}<th>出塔水汽浓度</th><th>进塔水汽浓度</th><th>氨水浓度 / 采样点</th><th>速率 ℃/h · MPa/h</th><th>温压操作</th></tr></thead><tbody id="sample-table">${samplingRows()}</tbody></table></div>
    <div class="table-note"><span>浓度保留独立采样点、原值、温压基准和备注；同一时刻多个采样点分别显示和编辑。速率采用近2小时线性拟合。</span></div></section>`;
}

function bindSamplingFilter(){$('#data-search')?.addEventListener('input',event=>{$('#sample-table').innerHTML=samplingRows(event.target.value);});}
