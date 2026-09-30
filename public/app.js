import { contextUsage, quotaForModel } from '/telemetry.js';
// Native selects remain the state source; the visible UI has keyboard-accessible lists.
const pickers = new Map();
function installPicker(select, heading) {
  select.classList.add('native-select'); select.tabIndex=-1; select.setAttribute('aria-hidden','true');
  const wrapper=document.createElement('span');wrapper.className='custom-picker';select.after(wrapper);
  const trigger=document.createElement('button');trigger.type='button';trigger.className='picker-trigger';trigger.setAttribute('aria-label',select.getAttribute('aria-label'));trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const value=document.createElement('span'),arrow=document.createElement('span');arrow.className='picker-arrow';arrow.textContent='⌄';trigger.append(value,arrow);
  const panel=document.createElement('div');panel.className='picker-panel';panel.hidden=true;panel.id=select.id+'Options';trigger.setAttribute('aria-controls',panel.id);
  const title=document.createElement('div');title.className='picker-heading';title.textContent=heading;
  const list=document.createElement('div');list.className='picker-list';list.setAttribute('role','listbox');list.setAttribute('aria-label',heading);panel.append(title,list);wrapper.append(trigger,panel);
  let signature='';
  function close(focus=false){panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
  function open(){if(trigger.disabled)return;for(const p of pickers.values())p.close();panel.hidden=false;trigger.setAttribute('aria-expanded','true');(list.querySelector('[aria-selected="true"]:not(:disabled)')||list.querySelector('button:not(:disabled)'))?.focus();}
  function sync(){
    trigger.disabled=select.disabled;value.textContent=select.selectedOptions[0]?.textContent||'불러오는 중…';
    if(trigger.disabled)close();
    const items=[...select.options].map(o=>({value:o.value,label:o.textContent,disabled:o.disabled,description:o.dataset.description||''}));
    const next=JSON.stringify(items);
    if(next!==signature){signature=next;list.replaceChildren();for(const item of items){
      const button=document.createElement('button');button.type='button';button.className='picker-option';button.setAttribute('role','option');button.dataset.value=item.value;button.disabled=item.disabled;
      const text=document.createElement('span');text.className='picker-option-text';const name=document.createElement('strong');name.textContent=item.label;text.append(name);
      if(item.description){const detail=document.createElement('small');detail.textContent=item.description;text.append(detail);}
      const check=document.createElement('span');check.className='picker-check';check.textContent='✓';button.append(text,check);
      button.onclick=()=>{select.value=item.value;close(true);select.dispatchEvent(new Event('change',{bubbles:true}));};list.append(button);
    }}
    for(const b of list.children)b.setAttribute('aria-selected',String(b.dataset.value===select.value));
  }
  trigger.onclick=()=>panel.hidden?open():close();
  trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}};
  panel.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();close(true);return;}
    if(e.key==='Tab'){close();return;}
    const buttons=[...list.querySelectorAll('button:not(:disabled)')];const i=buttons.indexOf(document.activeElement);
    const target=e.key==='ArrowDown'?(i+1)%buttons.length:e.key==='ArrowUp'?(i-1+buttons.length)%buttons.length:e.key==='Home'?0:e.key==='End'?buttons.length-1:null;
    if(target!==null){e.preventDefault();buttons[target]?.focus();}
  };
  document.addEventListener('click',e=>{if(!wrapper.contains(e.target))close();});
  const picker={sync,close};pickers.set(select.id,picker);sync();return picker;
}
function syncPickers(){for(const picker of pickers.values())picker.sync();}

let interactionUI=null,serverErrorShown=null;
const dismissedNotices=new Set();
const $ = id => document.getElementById(id);
let catalog, catalogError=null, settingSaving=false, draft=null, usageLoading=false;
const effortNames={none:'None · 추론 없음',minimal:'Minimal · 최소',low:'Low · 가볍게',medium:'Medium · 균형 있게',high:'High · 깊게',xhigh:'Extra high · 더 깊게',max:'Max · 최대',ultra:'Ultra · 최대 + 자동 위임'};
const number=new Intl.NumberFormat('ko-KR');
const effortDescriptions={low:'간단한 질문과 빠른 작업에',medium:'속도와 깊이의 균형',high:'복잡한 문제를 더 깊게 검토',xhigh:'더 많은 추론이 필요한 작업에',max:'가장 어려운 문제를 충분히 검토',ultra:'최대 추론과 자동 작업 위임'};
function selectedSettings(){return chat?.selection || (chat?.model?{model:chat.model,effort:chat.effort}:null) || draft || catalog?.defaults;}
function options(select,items,value){
  const signature=JSON.stringify(items);
  if(select.dataset.options!==signature){select.replaceChildren(...items.map(x=>{const o=document.createElement('option');o.value=x.value;o.textContent=x.label;o.disabled=!!x.disabled;o.dataset.description=x.description||'';return o;}));select.dataset.options=signature;}
  select.value=value||'';
}
function renderTelemetry(){
  const selection=selectedSettings();
  if(catalog){
    const models=catalog.models.map(x=>({value:x.model,label:x.displayName,description:x.description}));
    if(selection?.model&&!models.some(x=>x.value===selection.model))models.unshift({value:selection.model,label:selection.model+' · 목록에 없음',disabled:true});
    options($('modelSelect'),models,selection?.model);
    const model=catalog.models.find(x=>x.model===selection?.model);
    const efforts=(model?.supportedReasoningEfforts||[]).map(x=>({value:x.reasoningEffort,label:effortNames[x.reasoningEffort]||x.reasoningEffort,description:effortDescriptions[x.reasoningEffort]}));
    if(!efforts.some(x=>x.value===selection?.effort))efforts.unshift({value:selection?.effort||'',label:selection?.effort||'기본값 · 미확인',disabled:true});
    options($('effortSelect'),efforts,selection?.effort);
    $('effortSelect').title=model?.supportedReasoningEfforts.find(x=>x.reasoningEffort===selection?.effort)?.description||'모델이 답변을 추론하는 강도';
    $('modelSelect').disabled=!!chat?.active||sending||settingSaving;
    $('effortSelect').disabled=$('modelSelect').disabled||!model;
  }else if(selection?.model){
    options($('modelSelect'),[{value:selection.model,label:selection.model}],selection.model);
    options($('effortSelect'),[{value:selection.effort||'',label:effortNames[selection.effort]||selection.effort||'기본값 · 미확인'}],selection.effort);
  }
  const pending=chat?.selection&&(chat.selection.model!==chat.model||chat.selection.effort!==chat.effort);
  $('settingsStatus').textContent=settingSaving?'저장 중…':catalogError?'모델 목록 조회 실패':chat?.active?'응답 중 · 설정 유지':pending?'다음 메시지부터 적용':chat?'이 대화에 저장됨':'새 대화에 적용';
  $('settingsStatus').hidden=!settingSaving&&!catalogError&&!chat?.active&&!pending;
  $('settingsStatus').title=pending?`최근 사용: ${chat.model||'미확인'} · ${chat.effort||'기본값'}`:chat?.responseModel&&chat.responseModel!==chat.model?`최근 응답 실제 모델: ${chat.responseModel}`:'모델과 effort는 대화별로 저장됩니다.';
  const context=chat?.context||contextUsage(chat?.tokenUsage);
  const previousModel=chat?.usageModel&&selection?.model!==chat.usageModel;
  $('contextValue').textContent=context.percent===null?'—':`${context.percent.toFixed(1)}%`;
  $('contextCaption').textContent=previousModel?'이전 모델 기준 사용':context.percent!==null?'사용 중':current?'측정값 없음':'응답 후 표시';
  $('contextBar').value=context.percent||0;
  $('contextBar').classList.toggle('warning',(context.percent||0)>=80);
  $('contextDetail').textContent=context.used!==null?`${number.format(context.used)} / ${context.capacity!==null?number.format(context.capacity):'미확인'} tokens`:'대화가 사용하는 기억 공간';
  $('contextDetail').title='최근 모델 요청의 토큰 수 기준이며 누적 사용량과 다릅니다. 자동 압축 후 줄어들 수 있습니다.'+(chat?.usageUpdatedAt?'\n마지막 측정: '+new Date(chat.usageUpdatedAt).toLocaleString('ko-KR'):'');
  const quota=quotaForModel(state?.quotaSnapshot,selection?.model);
  $('weeklyValue').textContent=quota.remainingPercent===null?'—':`${Number(quota.remainingPercent.toFixed(1))}%`;
  $('weeklyCaption').textContent=quota.remainingPercent===null?(usageLoading?'조회 중…':'제공되지 않음'):'남음';
  $('weeklyBar').value=quota.remainingPercent||0;
  $('weeklyBar').classList.toggle('warning',quota.remainingPercent!==null&&quota.remainingPercent<=20);
  $('quotaScope').textContent=quota.shared?'계정 공통':quota.label;
  const reset=quota.resetsAt?new Date(quota.resetsAt*1000):null;
  const overdue=reset&&reset.getTime()<Date.now();
  $('weeklyDetail').textContent=reset?(overdue?'갱신 확인 필요 · ':'')+reset.toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 초기화':quota.remainingPercent!==null?'초기화 시각이 제공되지 않았습니다':usageLoading?'Codex 계정의 실제 한도를 조회합니다':'계정에서 주간 한도를 제공하지 않았습니다';
  $('weeklyDetail').title=state?.quotaUpdatedAt?'마지막 전체 조회: '+new Date(state.quotaUpdatedAt).toLocaleString('ko-KR'):'조회된 한도가 없습니다';
  $('telemetryNote').textContent=catalogError?'모델 목록을 불러오지 못했습니다. ↻ 버튼으로 다시 시도해 주세요.':state?.quotaError?(state.quotaUpdatedAt?'한도 조회 실패 · 마지막 확인값입니다.':'한도를 조회하지 못했습니다.')+' ↻ 버튼으로 다시 시도해 주세요.':overdue?'표시된 초기화 시각이 지났습니다. 새로고침해 실제 잔여량을 확인하세요.':chat?.metadataError?'기존 대화 정보를 확인하지 못했습니다. 다음 응답에서 다시 측정합니다.':'';
  syncPickers();
}
async function loadCatalog(force=false){try{catalog=await api('/api/catalog'+(force?'?refresh=1':''));catalogError=null;}catch(e){catalogError=e.message;}renderTelemetry();}
async function refreshUsage(force=false){
  if(usageLoading)return;usageLoading=true;$('refreshUsage').disabled=true;renderTelemetry();
  try{const usage=await api('/api/usage'+(force?'?refresh=1':''));Object.assign(state,usage);renderTelemetry();}catch(e){$('telemetryNote').textContent='한도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';}
  finally{usageLoading=false;$('refreshUsage').disabled=false;renderTelemetry();}
}
async function changeSettings(changeModel){
  if(!catalog||chat?.active||sending||settingSaving)return;
  const model=catalog.models.find(x=>x.model===$('modelSelect').value);if(!model)return;
  const selection={model:model.model,effort:changeModel?model.defaultReasoningEffort:$('effortSelect').value};
  settingSaving=true;controls();renderTelemetry();
  try{
    if(current){const result=await api('/api/settings',{id:current,selection});chat.selection=result.selection;}
    else{draft=selection;localStorage.setItem('codex-new-settings',JSON.stringify(draft));}
    error('');
  }catch(e){error(e.message);}finally{settingSaving=false;controls();renderTelemetry();}
}
try{draft=JSON.parse(localStorage.getItem('codex-new-settings'));}catch{}
let state, current = localStorage.getItem('codex-chat'), chat, sending=false, refreshing=false, again=false, lastRender='', requestRender='';
let attached=[],uploading=false;
const fileSize=n=>n>=1024*1024?(n/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
function attachmentChip(file,removable=false){
  const el=document.createElement('div');el.className='attachment-chip';
  if(file.image){const img=document.createElement('img');img.src='/api/attachment?id='+encodeURIComponent(file.id);img.alt=file.name;el.append(img);}
  else{const icon=document.createElement('span');icon.className='attachment-icon';icon.textContent='▤';el.append(icon);}
  const detail=document.createElement('span');detail.className='attachment-info';const name=document.createElement('a');name.textContent=file.name;name.href='/api/attachment?id='+encodeURIComponent(file.id);name.target='_blank';name.rel='noopener';name.title=file.name;const size=document.createElement('small');size.textContent=fileSize(file.size);detail.append(name,size);el.append(detail);
  if(removable){const remove=document.createElement('button');remove.type='button';remove.className='attachment-remove';remove.textContent='×';remove.setAttribute('aria-label',file.name+' 첨부 취소');remove.disabled=sending;remove.onclick=()=>{attached=attached.filter(x=>x.id!==file.id);renderAttachments();controls();};el.append(remove);}
  return el;
}
function renderAttachments(){ $('attachments').replaceChildren(...attached.map(x=>attachmentChip(x,true)));$('attachments').hidden=!attached.length; }
async function addFiles(list){
  if(!state||sending||uploading||chat?.active)return;
  if(!state.acceptFiles){error('첨부 기능을 사용하려면 서버를 재시작해 주세요.');return;}
  const files=[...list];if(!files.length)return;
  if(attached.length+files.length>10){error('한 메시지에 최대 10개까지 첨부할 수 있습니다.');return;}
  if(files.some(x=>x.size>20*1024*1024)){error('파일당 최대 20 MB입니다.');return;}
  if([...attached,...files].reduce((n,x)=>n+x.size,0)>30*1024*1024){error('첨부 파일의 합계는 최대 30 MB입니다.');return;}
  uploading=true;controls();error('');$('uploadStatus').hidden=false;
  try{for(const file of files){
    $('uploadStatus').textContent=file.name+' 업로드 중…';
    const res=await fetch('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Codex-Token':state.csrf},body:file});
    const result=await res.json();if(!res.ok)throw new Error(result.error||'파일을 첨부하지 못했습니다.');attached.push(result);renderAttachments();
  }}catch(e){error(e.message);}finally{uploading=false;$('uploadStatus').hidden=true;$('fileInput').value='';controls();}
}
const escape = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function format(text) {
  return String(text||'').split(/(```[\s\S]*?(?:```|$))/g).map(part=>{
    if(part.startsWith('```')) return '<pre><code>'+escape(part.replace(/^```[^\n]*\n?/, '').replace(/```$/,''))+'</code></pre>';
    return escape(part).replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }).join('');
}
async function api(url,data) {
  const res=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':state.csrf},body:JSON.stringify(data)});
  const value=await res.json(); if(!res.ok) throw new Error(value.error||'연결할 수 없습니다.'); return value;
}
function error(message){$('error').textContent=message||'';$('error').hidden=!message;}
function choose(id){if(sending||settingSaving||uploading)return;current=id;chat=null;attached=[];renderAttachments();lastRender='';localStorage.setItem('codex-chat',id||'');$('sidebar').classList.remove('open');error('');refresh();$('prompt').focus();}
function controls(){const active=!!chat?.active;$('working').hidden=!active;$('stop').hidden=!active;$('send').hidden=active;$('send').disabled=sending||settingSaving||uploading||(!$('prompt').value.trim()&&!attached.length);$('attachButton').disabled=!state?.acceptFiles||sending||uploading||active;$('attachButton').title=state&&!state.acceptFiles?'첨부 기능을 사용하려면 서버를 재시작해 주세요.':'이미지·파일 첨부 · 파일당 20 MB, 최대 10개';$('newChat').disabled=sending||settingSaving||uploading;$('chatTitle').textContent=chat?.title||'새 대화';}
function renderMessages(){
  const signature=JSON.stringify(chat?.items||[]);if(signature===lastRender)return;lastRender=signature;
  const scroll=$('scroll'),nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<140;
  const openTools=new Set([...document.querySelectorAll('details.tool[open]')].map(el=>el.dataset.id));
  const focused=document.activeElement;const keepFocus=focused?.closest('.request-card')&&$('messages').contains(focused);const caret=keepFocus&&typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
  $('messages').replaceChildren();
  for(const item of chat?.items||[]){
    if(item.type==='userMessage'||item.type==='agentMessage'){
      const user=item.type==='userMessage';const text=user?(item.displayText??(item.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n')):item.text;
      const el=document.createElement('article');el.className='message '+(user?'user':'assistant');
      if(user){
        if(item.attachments?.length){const files=document.createElement('div');files.className='attachment-list';files.append(...item.attachments.map(x=>attachmentChip(x)));el.append(files);}
        if(text){const content=document.createElement('div');content.textContent=text;el.append(content);}
      }else{
        const name=document.createElement('div');name.className='speaker';name.textContent='✳ Codex';el.append(name);
        const content=document.createElement('div');content.className='message-body';content.innerHTML=format(text);el.append(content);
        if(item.questions?.length&&interactionUI)el.append(interactionUI.question(item,current));
        const copy=document.createElement('button');copy.className='copy';copy.textContent='복사';copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);copy.textContent='복사됨';}catch{error('복사하지 못했습니다. 텍스트를 선택해 복사해 주세요.');}};el.append(copy);
      }$('messages').append(el);
    }else if(item.type!=='reasoning'||item.summary?.length){
      const el=document.createElement('details');el.className='tool';el.dataset.id=item.id;el.open=openTools.has(item.id);
      const labels={commandExecution:'명령 실행',fileChange:'파일 수정',mcpToolCall:'도구 사용',webSearch:'웹 검색',plan:'작업 계획',reasoning:'추론 요약',webNotice:'처리 안내',dynamicToolCall:'연결 도구',collabAgentToolCall:'하위 에이전트',subAgentActivity:'하위 작업',contextCompaction:'컨텍스트 압축',imageGeneration:'이미지 생성',imageView:'이미지 확인',sleep:'대기',enteredReviewMode:'검토 시작',exitedReviewMode:'검토 완료',hookPrompt:'훅 안내',functionCallOutput:'도구 결과'};
      const summary=document.createElement('summary');summary.textContent=(labels[item.type]||('작업 · '+item.type))+(item.status?' · '+({inProgress:'진행 중',completed:'완료',failed:'실패',declined:'거절'}[item.status]||item.status):'');
      const content=document.createElement('pre');content.textContent=item.command?item.command+'\n'+(item.aggregatedOutput||''):item.text||(item.type==='reasoning'?item.summary.join('\n'):null)||JSON.stringify(item.result||item.error||item.changes||item.contentItems||item.arguments||item.action||item,(key,value)=>typeof value==='string'&&value.length>20000?value.slice(0,20000)+'\n…긴 출력 일부 생략':value,2);el.append(summary,content);$('messages').append(el);
    }
  }
  if(keepFocus&&document.contains(focused)&&!focused.disabled){focused.focus({preventScroll:true});if(caret)focused.setSelectionRange(...caret);}
  if(nearBottom&&!keepFocus)scroll.scrollTop=scroll.scrollHeight;
}
function renderRequests(){
  if(interactionUI){interactionUI.render($('requests'));return;}
  const list=(state.requests||[]).filter(r=>r.params.threadId===current);const signature=JSON.stringify(list);if(signature===requestRender)return;requestRender=signature;$('requests').replaceChildren();
  for(const r of list){
    const el=document.createElement('div');el.className='request';
    const title=document.createElement('strong');title.textContent=r.method==='item/tool/requestUserInput'?'답변이 필요해요':'작업을 진행해도 될까요?';el.append(title);
    const fields={};
    if(r.method==='item/tool/requestUserInput'){
      for(const q of r.params.questions||[]){const label=document.createElement('label');label.textContent=q.question;let field;
        if(q.options?.length){field=document.createElement('select');for(const option of q.options){const o=document.createElement('option');o.value=option.label;o.textContent=option.label+(option.description?' — '+option.description:'');field.append(o);}const other=document.createElement('option');other.value='__other';other.textContent='직접 입력';field.append(other);const input=document.createElement('input');input.placeholder='직접 답변 입력';input.hidden=true;field.onchange=()=>input.hidden=field.value!=='__other';label.append(field,input);fields[q.id]=()=>field.value==='__other'?input.value:field.value;
        }else{field=document.createElement('input');field.type=q.isSecret?'password':'text';label.append(field);fields[q.id]=()=>field.value;}el.append(label);
      }
    }else{const pre=document.createElement('pre');pre.textContent=[r.params.reason,r.params.command,r.params.cwd,r.params.grantRoot,r.params.permissions?JSON.stringify(r.params.permissions,null,2):''].filter(Boolean).join('\n');el.append(pre);}
    const reply=async accept=>{try{await api('/api/reply',{id:r.id,accept,answers:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v()]))});refresh();}catch(e){error(e.message);}};
    const accept=document.createElement('button');accept.textContent=r.method==='item/tool/requestUserInput'?'답변 보내기':'허용';accept.onclick=()=>reply(true);el.append(accept);
    if(r.method!=='item/tool/requestUserInput'){const decline=document.createElement('button');decline.textContent='거절';decline.onclick=()=>reply(false);el.append(decline);}
    $('requests').append(el);
  }
}
async function refresh(){
  if(refreshing){again=true;return;}refreshing=true;
  try{
    state=await api('/api/state');$('folder').title=state.cwd;$('fileInput').accept=state.acceptFiles||'';
    if(current&&!state.chats.some(x=>x.id===current))current=null;
    const selected=current;
    const next=selected?await api('/api/chat?id='+encodeURIComponent(selected)):null;
    if(current!==selected){again=true;return;}chat=next;
    $('history').replaceChildren();
    if(!state.chats.length){const empty=document.createElement('p');empty.className='empty-history';empty.textContent='첫 대화를 시작해 보세요';$('history').append(empty);}
    for(const c of state.chats){const b=document.createElement('button');b.className='history-item'+(c.id===current?' selected':'');const count=(state.requests||[]).filter(r=>(r.threadId||r.params.threadId||r.params.conversationId)===c.id).length;b.textContent=(count?'[확인 '+count+'] ':c.active?'● ':'')+c.title;b.title=c.title;b.onclick=()=>choose(c.id);$('history').append(b);}
    $('welcome').hidden=!!current;renderMessages();renderRequests();controls();renderTelemetry();renderInteractionStatus();
    const serverError=chat?.error||state.failure;if(serverError){error(serverError);serverErrorShown=serverError;}else if(serverErrorShown){if($('error').textContent===serverErrorShown)error('');serverErrorShown=null;}
  }catch(e){error(e.message);}finally{refreshing=false;if(again){again=false;setTimeout(refresh,80);}}
}
$('composer').onsubmit=async e=>{
  e.preventDefault();const text=$('prompt').value.trim();if((!text&&!attached.length)||sending||settingSaving||uploading||chat?.active)return;sending=true;controls();renderAttachments();renderTelemetry();error('');
  try{const selection=selectedSettings();const result=await api('/api/message',{id:current,text,attachments:attached.map(x=>x.id),...(selection?.model&&selection?.effort?{selection}:{})});current=result.id;localStorage.setItem('codex-chat',current);attached=[];renderAttachments();$('prompt').value='';$('prompt').style.height='auto';await refresh();$('scroll').scrollTop=$('scroll').scrollHeight;}
  catch(e){error(e.message);}finally{sending=false;controls();renderAttachments();renderTelemetry();$('prompt').focus();}
};
$('prompt').oninput=()=>{$('prompt').style.height='auto';$('prompt').style.height=Math.min($('prompt').scrollHeight,180)+'px';controls();};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('composer').requestSubmit();}};
$('newChat').onclick=()=>choose(null);
$('menu').onclick=()=>$('sidebar').classList.toggle('open');
$('scroll').onclick=()=>$('sidebar').classList.remove('open');
$('stop').onclick=async()=>{try{await api('/api/stop',{id:current});}catch(e){error(e.message);}};
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('prompt').value=b.dataset.prompt;$('prompt').dispatchEvent(new Event('input'));$('prompt').focus();});
async function boot(){await refresh();const events=new EventSource('/api/events');let timer;events.onmessage=()=>{if(!timer)timer=setTimeout(()=>{timer=null;refresh();},80);};events.onerror=()=>error('연결을 다시 시도하고 있습니다. 계속 연결되지 않으면 바탕화면 바로가기를 다시 열어 주세요.');events.onopen=()=>{error('');refresh();};try{const account=await api('/api/account');$('account').textContent=account.loggedIn?'Codex 연결됨':'Codex 로그인 필요';if(!account.loggedIn)error('Codex 로그인이 필요합니다. 설치된 Codex 앱에서 로그인해 주세요.');}catch(e){$('account').textContent='연결 확인 필요';error(e.message);}$('prompt').focus();}
$('modelSelect').onchange=()=>changeSettings(true);
document.addEventListener('click',event=>{
  document.querySelectorAll('.usage-item[open]').forEach(item=>{if(!item.contains(event.target))item.open=false;});
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')document.querySelectorAll('.usage-item[open]').forEach(item=>{item.open=false;item.querySelector('summary').focus();});
});
$('effortSelect').onchange=()=>changeSettings(false);
installPicker($('modelSelect'),'모델 선택');installPicker($('effortSelect'),'추론 강도');
$('attachButton').onclick=()=>$('fileInput').click();
$('fileInput').onchange=()=>addFiles($('fileInput').files);
$('prompt').addEventListener('paste',e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();addFiles(files);}});
let dragDepth=0;
document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('composer').classList.add('drag-over');}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('composer').classList.remove('drag-over');}});
document.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();dragDepth=0;$('composer').classList.remove('drag-over');addFiles(e.dataTransfer.files);}});
$('refreshUsage').onclick=async()=>{await Promise.allSettled([refreshUsage(true),loadCatalog(true)]);};
try { const {createInteractionUI}=await import('/interactions.js');interactionUI=createInteractionUI({api,refresh,getState:()=>state,getChat:()=>chat,getCurrent:()=>current,onError:error}); } catch {}
import('/updates.js').then(({installUpdateUI})=>installUpdateUI({api})).catch(()=>{});
import('/codex-updates.js').then(({installCodexUpdateUI})=>installCodexUpdateUI({api,onUpdated:()=>Promise.allSettled([loadCatalog(true),refreshUsage(true),refresh()])})).catch(()=>{});
await boot();
await Promise.allSettled([loadCatalog(),refreshUsage()]);
setInterval(()=>{if(!document.hidden)Promise.allSettled([refreshUsage(),loadCatalog()]);},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)Promise.allSettled([refreshUsage(),loadCatalog()]);});

function renderInteractionStatus(){
  const pending=(state?.requests||[]).filter(r=>!r.threadId||r.threadId===current||!state.chats.some(c=>c.id===r.threadId));
  const questions=(chat?.items||[]).filter(x=>x.questions?.length&&!x.questionReply);
  const flags=chat?.threadStatus?.activeFlags||[];
  $('interactionBanner').hidden=!(pending.length||questions.length||flags.length);
  $('interactionBanner').textContent=pending.length?`확인이 필요한 요청 ${pending.length}개 · 클릭해서 보기`:questions.length?`답변할 수 있는 질문 ${questions.length}개 · 클릭해서 보기`:flags.includes('waitingOnApproval')?'권한 승인을 기다리고 있습니다':'사용자 입력을 기다리고 있습니다';
  $('working').hidden=!chat?.active;
  if(chat?.active)$('working').textContent=pending.length?'선택 또는 승인을 기다리고 있어요…':flags.length?'사용자 확인을 기다리고 있어요…':'Codex가 작업하고 있어요…';
  const notices=(state?.notices||[]).filter(x=>(!x.threadId||x.threadId===current)&&!dismissedNotices.has(x.id)).slice(-5);
  $('notices').replaceChildren(...notices.map(x=>{const row=document.createElement('div');row.className='notice-row';const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=x.message.split(' · ')[0].split('\n')[0].slice(0,120);const pre=document.createElement('pre');pre.textContent=x.message;details.append(summary,pre);const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','안내 닫기');close.onclick=()=>{dismissedNotices.add(x.id);renderInteractionStatus();};row.append(details,close);return row;}));$('notices').hidden=!notices.length;
  $('serverUpdate').hidden=!!state?.interactionVersion;
  $('loginLink').hidden=!state?.login?.url;
  if(state?.login?.url){try{const u=new URL(state.login.url);if(['https:','http:'].includes(u.protocol))$('loginLink').href=u.href;}catch{}}
  $('cancelLogin').hidden=!state?.login;
}
$('interactionBanner').onclick=()=>{const target=$('requests').firstElementChild||document.querySelector('.request-card[data-awaiting="true"]');target?.scrollIntoView({behavior:'smooth',block:'center'});target?.querySelector('button,input,select')?.focus({preventScroll:true});};
$('reconnect').onclick=async()=>{try{await refresh();const a=await api('/api/account');$('account').textContent=a.loggedIn?'Codex 연결됨':'Codex 로그인 필요';error('');await Promise.allSettled([loadCatalog(true),refreshUsage(true)]);}catch(e){error(e.message);}};
$('loginButton').onclick=async()=>{try{await api('/api/login',{action:'start'});await refresh();}catch(e){error(e.message);}};
$('cancelLogin').onclick=async()=>{try{await api('/api/login',{action:'cancel'});await refresh();}catch(e){error(e.message);}};
