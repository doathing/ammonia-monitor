import test from 'node:test';
import assert from 'node:assert/strict';
import {restrictBatchStore} from '../lib/monitor/batch-access.mjs';
import {handle} from '../lib/monitor/service.mjs';
import {newDoc} from '../lib/monitor/domain.mjs';

const target=newDoc({name:'1261升温还原',start_time:'2026-11-01T08:00:00+08:00',initial:[20,21,22]});
const other=newDoc({name:'1261升温还原（催化剂厂家计划）',start_time:'2026-11-01T08:00:00+08:00',initial:[20,21,22]});
const targetId=target.batch.id,otherId=other.batch.id;
const guest={username:'guest',canEdit:false},admin={username:'admin',canEdit:true};
let fetched=[];
const store={
  async list(){return [target,other].map(d=>({id:d.batch.id,name:d.batch.name}));},
  async get(id){fetched.push(id);const doc=[target,other].find(d=>d.batch.id===id);return doc?{doc:structuredClone(doc),version:'test'}:null;},
  async create(){throw new Error('should not mutate');},async save(){throw new Error('should not mutate');},
};
test('guest sees exactly the configured batch, not similarly named batches',async()=>{
  const scoped=restrictBatchStore(store,guest,targetId);
  assert.deepEqual(await scoped.list(),[{id:targetId,name:'1261升温还原'}]);
  fetched=[];assert.equal(await scoped.get(otherId),null);assert.deepEqual(fetched,[]);
  assert((await scoped.get(targetId)).doc.batch.id===targetId);
  await assert.rejects(scoped.create(),e=>e.status===403);
  await assert.rejects(scoped.save(),e=>e.status===403);
});
test('all detail and export routes reject direct requests for another batch',async()=>{
  for(const suffix of ['', '/export/backup','/export/samples','/export/events','/export/concentrations']){
    const r=await handle(new Request(`https://monitor.test/api/batches/${otherId}${suffix}`),restrictBatchStore(store,guest,targetId),{});
    assert.equal(r.status,404,suffix);
  }
  const list=await handle(new Request('https://monitor.test/api/batches'),restrictBatchStore(store,guest,targetId),{});
  assert.deepEqual((await list.json()).map(b=>b.id),[targetId]);
  const backup=await handle(new Request(`https://monitor.test/api/batches/${targetId}/export/backup`),restrictBatchStore(store,guest,targetId),{});
  assert.equal(backup.status,200);
  assert.equal((await backup.json()).batch.id,targetId);
});
test('admin retains both batches and their exports',async()=>{
  assert.equal(restrictBatchStore(store,admin,targetId),store);
  assert.equal((await restrictBatchStore(store,admin,targetId).list()).length,2);
  const r=await handle(new Request(`https://monitor.test/api/batches/${otherId}/export/backup`),restrictBatchStore(store,admin,targetId),{});
  assert.equal(r.status,200);
});
test('name fallback is exact, missing or ambiguous targets expose no other batch',async()=>{
  assert.deepEqual((await restrictBatchStore(store,guest).list()).map(b=>b.id),[targetId]);
  assert.deepEqual(await restrictBatchStore(store,guest,'missing-id').list(),[]);
  const ambiguous={...store,list:async()=>[{id:'a',name:'1261升温还原'},{id:'b',name:'1261升温还原'}]};
  assert.deepEqual(await restrictBatchStore(ambiguous,guest).list(),[]);
  const missing={...store,list:async()=>[{id:otherId,name:other.batch.name}]};
  assert.deepEqual(await restrictBatchStore(missing,guest).list(),[]);
});
