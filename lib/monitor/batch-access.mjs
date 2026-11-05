import {ensure} from './domain.mjs';

// Scope reads before retrieving a document, covering details and every export.
// An explicit ID keeps the selected batch stable when an admin renames it.
export function restrictBatchStore(store,user,configuredId=''){
  if(user.canEdit)return store;
  let allowed;
  const visible=()=>allowed??=(async()=>{
    const batches=await store.list();
    if(configuredId)return batches.filter(batch=>batch.id===configuredId);
    const matches=batches.filter(batch=>String(batch.name).trim()==='1261升温还原');
    // Without a configured ID, ambiguity or a missing target must fail closed.
    return matches.length===1?matches:[];
  })();
  return {
    list:visible,
    async get(id){return (await visible()).some(batch=>batch.id===id)?store.get(id):null;},
    async create(){ensure(false,'当前账号只有查看权限。',403);},
    async save(){ensure(false,'当前账号只有查看权限。',403);},
  };
}
