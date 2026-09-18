const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const button=(text,fn,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
const webUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const actionNames={accept:'이번만 허용',acceptForSession:'이 세션 동안 허용',decline:'거절',cancel:'작업 취소',answer:'답변 보내기',skip:'답변 건너뛰기',execPolicy:'이 명령 규칙을 허용'};

function choiceField(q,index) {
  const group=el('fieldset','question-field');const title=q.question||q.title||q.header;group.append(el('legend','',title));
  const choices=el('div','question-options');const values=(q.options||[]).map(o=>typeof o==='string'?{label:o}:o);let selected=null;
  const input=el('input','question-input');input.type=q.isSecret?'password':'text';input.autocomplete='off';input.placeholder=values.length?'직접 답변 입력':'답변을 입력하세요';input.setAttribute('aria-label',title+' · 직접 입력');input.maxLength=10000;
  for(const option of values){const b=button('',()=>{selected=option.label;input.value='';for(const x of choices.children)x.setAttribute('aria-pressed',String(x===b));},'question-option');b.setAttribute('aria-pressed','false');b.append(el('strong','',option.label));if(option.description)b.append(el('small','',option.description));choices.append(b);}
  group.append(choices);
  if(!values.length||q.isOther!==false){group.append(input);input.oninput=()=>{selected=null;for(const b of choices.children)b.setAttribute('aria-pressed','false');};}
  return {node:group,key:q.id??String(index),read:()=>input.value.trim()||selected||''};
}
function schemaFields(schema) {
  const nodes=[],readers=[];
  for(const [key,s] of Object.entries(schema?.properties||{})){
    const field=el('fieldset','question-field');const required=schema.required?.includes(key);field.append(el('legend','',(s.title||key)+(required?' *':'')));if(s.description)field.append(el('p','request-help',s.description));
    const options=s.enum?.map((v,i)=>({value:v,label:s.enumNames?.[i]||v}))||s.oneOf?.map(x=>({value:x.const,label:x.title||x.const}));let read;
    if(s.type==='array'){
      const options=s.items?.enum?.map(v=>({value:v,label:v}))||s.items?.anyOf?.map(x=>({value:x.const,label:x.title||x.const}))||[];
      const inputs=options.map(o=>{const label=el('label','schema-checkbox');const input=el('input');input.type='checkbox';input.checked=s.default?.includes(o.value)||false;label.append(input,el('span','',o.label));field.append(label);return {input,value:o.value};});read=()=>inputs.filter(x=>x.input.checked).map(x=>x.value);
    }else if(options||s.type==='boolean'){
      const select=el('select');select.setAttribute('aria-label',s.title||key);select.append(el('option','','선택해 주세요'));select.options[0].value='';
      const choices=options||[{value:true,label:'예'},{value:false,label:'아니요'}];choices.forEach((o,i)=>{const option=el('option','',o.label);option.value=String(i);select.append(option);});if(s.default!==undefined){const i=choices.findIndex(x=>x.value===s.default);if(i>=0)select.value=String(i);}field.append(select);read=()=>select.value===''?undefined:choices[Number(select.value)].value;
    }else {
      const input=el('input');input.setAttribute('aria-label',s.title||key);input.type=['number','integer'].includes(s.type)?'number':s.format==='email'?'email':s.format==='date'?'date':'text';if(s.type==='integer')input.step='1';else if(s.type==='number')input.step='any';
      for(const [property,value] of [['min',s.minimum],['max',s.maximum],['minLength',s.minLength],['maxLength',s.maxLength]])if(value!==undefined)input[property]=value;
      if(s.default!==undefined)input.value=String(s.default);field.append(input);read=()=>input.value===''?undefined:input.type==='number'?Number(input.value):input.value;
    }
    nodes.push(field);readers.push([key,read]);
  }
  return {nodes,read:()=>Object.fromEntries(readers.map(([k,read])=>[k,read()]).filter(([,v])=>v!==undefined))};
}
export function createInteractionUI({api,refresh,getState,getChat,getCurrent,onError}) {
  const requestCards=new Map(),questionCards=new Map();
  function card(title,subtitle){const root=el('section','request-card');root.append(el('div','request-eyebrow',subtitle),el('h3','',title));const content=el('div','request-content'),actions=el('div','request-actions'),status=el('p','request-status');status.setAttribute('role','status');root.append(content,actions,status);return {root,content,actions,status};}
  function run(c,fn){if(c.busy)return;c.busy=true;c.status.textContent='전송 중…';for(const b of c.root.querySelectorAll('button,input,select'))b.disabled=true;
    Promise.resolve().then(fn).then(()=>{c.status.textContent='처리되었습니다.';return refresh();}).catch(e=>{c.status.textContent=e.message;onError(e.message);}).finally(()=>{c.busy=false;for(const b of c.root.querySelectorAll('button,input,select'))b.disabled=!!c.locked||b.dataset.unavailable==='true';});}
  function question(item,threadId){
    const key=threadId+':'+item.id;let c=questionCards.get(key);
    if(!c){c=card('선택하거나 직접 답해 주세요','CODEX 질문');const fields=item.questions.map(choiceField);c.content.append(...fields.map(x=>x.node));
      c.actions.append(button('답변 보내기',()=>run(c,async()=>{const answers=fields.map(x=>x.read());if(answers.some(x=>!x))throw new Error('모든 질문에 답변해 주세요.');await api('/api/question',{id:threadId,itemId:item.id,answers});}),'primary'),button('건너뛰기',()=>run(c,()=>api('/api/question',{id:threadId,itemId:item.id,action:'dismiss'}))));questionCards.set(key,c);
    }
    const disabled=!!item.questionReply||!getState()?.interactionVersion;c.locked=disabled;c.root.dataset.awaiting=String(!item.questionReply);
    for(const input of c.root.querySelectorAll('button,input'))input.disabled=disabled||!!c.busy;
    if(item.questionReply)c.status.textContent=item.questionReply.status==='sent'?'답변 전송 완료 · '+(item.questionReply.answers||[]).join(' / '):'건너뛴 질문';
    else if(!getState()?.interactionVersion)c.status.textContent='질문에 답하려면 웹 서버를 재시작해 주세요.';
    return c.root;
  }
  function request(r){
    if(requestCards.has(r.id)){const c=requestCards.get(r.id),related=getChat()?.items.find(x=>x.id===(r.params.itemId||r.params.callId));if(c.patch&&related?.changes)c.patch.textContent=JSON.stringify(related.changes,null,2);return c.root;}
    const p=r.params,asking=['item/tool/requestUserInput','tool/requestUserInput'].includes(r.method),mcp=r.method==='mcpServer/elicitation/request',permissions=r.method==='item/permissions/requestApproval';
    const c=card(asking?'답변이 필요해요':mcp?(p.mode==='url'?'연결 서비스에서 확인해 주세요':'연결 서비스가 정보를 요청했어요'):'작업 권한을 확인해 주세요',asking?(p.isBlocking===false?'작업을 계속하며 답변 대기':'답변을 기다리는 중'):mcp?'MCP · '+p.serverName:'승인 대기');requestCards.set(r.id,c);
    if(r.threadId&&r.threadId!==getCurrent())c.content.append(el('p','request-help','요청한 대화: '+(getState().chats.find(x=>x.id===r.threadId)?.title||r.threadId)));
    if(p.reason||p.message)c.content.append(el('p','request-message',p.reason||p.message));
    let fields=[],form,permissionInputs=[];
    if(asking){fields=(p.questions||[]).map(choiceField);c.content.append(...fields.map(x=>x.node));}
    else if(mcp){
      if(p.mode==='url'){const href=webUrl(p.url);if(href){const link=el('a','request-link','연결 페이지 열기 ↗');link.href=href;link.target='_blank';link.rel='noopener noreferrer';c.content.append(el('p','request-help',new URL(href).origin),link,el('p','request-help','새 창에서 직접 확인한 뒤 아래 완료 버튼을 누르세요.'));}else c.content.append(el('p','request-help','열 수 없는 주소입니다. 요청을 거절하거나 취소하세요.'));}
      else if(p.mode==='form'&&!r.formError){form=schemaFields(p.requestedSchema);c.content.append(...form.nodes);}
      else c.content.append(el('p','request-help',r.formError||'아직 지원하지 않는 확장 양식입니다. 취소 후 연결 도구에서 진행해 주세요.'));
    }else{
      const details=el('pre','approval-details');details.textContent=[Array.isArray(p.command)?p.command.join(' '):p.command,p.cwd?'작업 폴더: '+p.cwd:'',p.grantRoot?'허용 경로: '+p.grantRoot:'',p.networkApprovalContext?JSON.stringify(p.networkApprovalContext,null,2):'',p.fileChanges?JSON.stringify(p.fileChanges,null,2):''].filter(Boolean).join('\n');
      const related=getChat()?.items.find(x=>x.id===(p.itemId||p.callId));if(details.textContent)c.content.append(details);if(r.method==='item/fileChange/requestApproval'){c.patch=el('pre','approval-details',related?.changes?JSON.stringify(related.changes,null,2):'변경 내용은 작업 상세에서도 확인할 수 있습니다.');c.content.append(c.patch);}
      if(permissions){for(const [key,value] of Object.entries(p.permissions||{}).filter(([,v])=>v!=null)){const label=el('label','permission-choice'),input=el('input');input.type='checkbox';label.append(input,el('strong','',key==='network'?'네트워크 접근 허용':'파일 접근 허용'),el('pre','',JSON.stringify(value,null,2)));c.content.append(label);permissionInputs.push({key,input});}}
      if(p.proposedExecpolicyAmendment||p.proposedNetworkPolicyAmendments){const details=el('details','policy-details');details.append(el('summary','','향후 적용할 규칙 보기'),el('pre','',JSON.stringify({command:p.proposedExecpolicyAmendment,network:p.proposedNetworkPolicyAmendments},null,2)));c.content.append(details);}
      c.content.append(el('p','request-help','“이 세션 동안 허용”은 현재 요청보다 오래 유지됩니다. 규칙 허용은 표시된 명령·호스트에 대한 이후 요청에도 적용됩니다.'));
    }
    const actions=r.actions||(asking?['answer']:['accept','decline']);
    for(const action of actions){
      let title=actionNames[action]||'네트워크 규칙 '+(Number(action.split(':')[1])+1)+' 적용';
      if(mcp)title={accept:p.mode==='url'?'확인 완료':'입력 내용 전달',decline:'거절',cancel:'취소'}[action];
      if(permissions&&action==='accept')title='선택한 권한을 이번 작업에 허용';
      const b=button(title,()=>run(c,async()=>{
        const data={id:r.id,action};if(asking)data.answers=Object.fromEntries(fields.map(x=>[x.key,x.read()]));if(form)data.content=form.read();if(permissions)data.permissionKeys=permissionInputs.filter(x=>x.input.checked).map(x=>x.key);
        if(!getState().interactionVersion)data.accept=action==='accept'||action==='answer';await api('/api/reply',data);
      }),['accept','answer'].includes(action)?'primary':action==='cancel'?'danger':'');
      if(mcp&&action==='accept'&&(r.formError||(p.mode==='url'&&!webUrl(p.url))||!['url','form'].includes(p.mode))){b.disabled=true;b.dataset.unavailable='true';}
      c.actions.append(b);
    }
    return c.root;
  }
  function render(container){
    const state=getState();const list=(state.requests||[]).filter(r=>{const id=r.threadId||r.params.threadId||r.params.conversationId;return !id||id===getCurrent()||!state.chats.some(c=>c.id===id);});
    const liveIds=new Set((state.requests||[]).map(r=>r.id));for(const [key,c] of requestCards)if(!liveIds.has(key)){c.root.remove();requestCards.delete(key);}
    const wanted=list.map(request);for(const node of [...container.children])if(!wanted.includes(node))node.remove();for(const node of wanted)if(node.parentElement!==container)container.append(node);
    return list.length;
  }
  return {question,render};
}
