'use strict';
const readActions=new Set(['close','time-range','trend-axes','fullscreen','show-plan','source-plan','export','logout']);
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]'),context=event.target.closest('[data-context]');
  if(action?.dataset.action==='logout'){
    event.preventDefault();event.stopImmediatePropagation();
    fetch('/api/session/logout',{method:'POST'}).then(response=>{if(!response.ok)throw new Error('退出失败，请重试');location.replace('/');}).catch(e=>toast(e.message,true));return;
  }
  if(!state.canEdit&&(action&&!readActions.has(action.dataset.action)||context&&context.dataset.context!=='export')){
    event.preventDefault();event.stopImmediatePropagation();toast('当前账号只有查看权限。',true);
  }
},true);
async function startWorkspace(){
  const user=await api('/api/session/me');state.canEdit=user.canEdit;
  document.body.classList.toggle('access-viewer',!user.canEdit);
  $('#account-role').textContent=`${user.username} · ${user.canEdit?'编辑权限':'只读查看'}`;
  await loadBatches();
}
