'use strict';
function normalizeBatchDetail(detail){
  if(!detail?.batch||!Array.isArray(detail.batch.plan)||!Array.isArray(detail.stages))throw new Error('云端服务返回的数据不完整，请重新启动程序。');
  const effective=detail.curve_plan||detail.batch.plan;
  if(!Array.isArray(detail.completed_stages)){
    const plannedEnds=[];let finish=ms(detail.batch.start_time);
    for(const stage of effective){finish+=stage.hours*3600000;plannedEnds.push(finish);}
    detail.completed_stages=detail.stages.flatMap((stage,i)=>{
      const end=detail.stages[i+1]?.start_time||(detail.batch.status==='completed'?detail.batch.end_time:null);
      const plan=effective[stage.stage_index];if(!end||!plan)return [];
      const actualHours=(ms(end)-ms(stage.start_time))/3600000,delta=(ms(end)-plannedEnds[stage.stage_index])/3600000;
      return [{stage_index:stage.stage_index,name:plan.name,start_time:stage.start_time,end_time:end,planned_start:new Date(plannedEnds[stage.stage_index]-plan.hours*3600000).toISOString(),planned_end:new Date(plannedEnds[stage.stage_index]).toISOString(),planned_hours:plan.hours,actual_hours:actualHours,finish_delta_hours:delta,duration_delta_hours:actualHours-plan.hours,status:delta>1/3600?'late':delta< -1/3600?'early':'ontime'}];
    });
  }
  if(!Array.isArray(detail.water_plan))detail.water_plan=detail.batch.plan.map((_,i)=>({start:i===1||i===2?1000:3000,end:i===1||i===2?1000:3000,unit:'ppmv',kind:'upper'}));
  if(!Array.isArray(detail.curve_plan))detail.curve_plan=structuredClone(detail.batch.plan);
  if(!Array.isArray(detail.curve_overrides))detail.curve_overrides=detail.batch.plan.map(()=>null);
  detail.concentrations={water:[],ammonia:[],inlet_water:[],...(detail.concentrations||{})};
  detail.inlet_water_limit_ppmv??=200;
  for(const kind of ['water','ammonia','inlet_water'])if(!Array.isArray(detail.concentrations[kind]))detail.concentrations[kind]=[];
  return detail;
}
