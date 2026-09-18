import { randomUUID } from 'node:crypto';

export const interactionError = (message, statusCode=400) => Object.assign(new Error(message),{statusCode});
export const requestThread = r => r.params?.threadId || r.params?.conversationId || null;
export const questionMethods = ['item/tool/requestUserInput','tool/requestUserInput'];
const approvalMethods = ['item/commandExecution/requestApproval','item/fileChange/requestApproval','execCommandApproval','applyPatchApproval'];
export const supportedRequests = [...approvalMethods,...questionMethods,'item/permissions/requestApproval','mcpServer/elicitation/request'];
export const safeWebUrl = value => { try { const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null; } catch { return null; } };
const own=(o,k)=>Object.hasOwn(o||{},k);

// The app advertises standard MCP forms only. Unknown schema constraints fail closed.
export function checkFormSchema(schema) {
  if(schema?.type!=='object'||!schema.properties||typeof schema.properties!=='object'||Array.isArray(schema.properties))throw interactionError('지원하지 않는 MCP 입력 양식입니다. 연결 도구에서 처리하거나 취소해 주세요.');
  const top=['type','properties','required','$schema','title','description','additionalProperties'];
  if(Object.keys(schema).some(k=>!top.includes(k))||schema.additionalProperties===true)throw interactionError('지원하지 않는 MCP 양식 조건입니다.');
  if(Object.keys(schema.properties).length>50)throw interactionError('입력 항목이 너무 많습니다.');
  for(const s of Object.values(schema.properties)) {
    const keys=['type','title','description','default','enum','enumNames','oneOf','minLength','maxLength','format','minimum','maximum','minItems','maxItems','items'];
    if(!s||Object.keys(s).some(k=>!keys.includes(k))||!['string','number','integer','boolean','array'].includes(s.type))throw interactionError('이 양식의 필드 형식은 아직 지원하지 않습니다.');
    if(s.format&&!['email','uri','date','date-time'].includes(s.format))throw interactionError('지원하지 않는 입력 형식입니다.');
    if(s.type==='array' && !(s.items?.enum||s.items?.anyOf))throw interactionError('선택형 목록만 지원합니다.');
    if(s.oneOf&&!s.oneOf.every(x=>typeof x.const==='string'))throw interactionError('지원하지 않는 선택 항목입니다.');
    if(s.type==='array' && ((s.items.type!==undefined&&s.items.type!=='string')||Object.keys(s.items).some(k=>!['type','enum','anyOf'].includes(k))))throw interactionError('지원하지 않는 목록 조건입니다.');
  }
}
export function validateForm(schema,content) {
  checkFormSchema(schema);
  if(!content||typeof content!=='object'||Array.isArray(content))throw interactionError('양식 값을 입력해 주세요.');
  if(Object.keys(content).some(k=>!own(schema.properties,k)))throw interactionError('알 수 없는 양식 항목입니다.');
  for(const key of schema.required||[])if(!own(content,key))throw interactionError(`${key}: 필수 항목입니다.`);
  for(const [key,v] of Object.entries(content)) {
    const s=schema.properties[key];const fail=()=>{throw interactionError(`${s.title||key}: 입력값을 확인해 주세요.`);};
    if(s.type==='string') {
      if(typeof v!=='string'||v.length<(s.minLength??0)||v.length>(s.maxLength??50000))fail();
      const choices=s.enum||s.oneOf?.map(x=>x.const);if(choices&&!choices.includes(v))fail();
      if(s.format==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail();
      if(s.format==='uri'){try{new URL(v);}catch{fail();}}
      if(['date','date-time'].includes(s.format)&&!Number.isFinite(Date.parse(v)))fail();
    } else if(s.type==='boolean'){if(typeof v!=='boolean')fail();}
    else if(['number','integer'].includes(s.type)){if(typeof v!=='number'||!Number.isFinite(v)||(s.type==='integer'&&!Number.isInteger(v))||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity))fail();}
    else {
      const choices=s.items.enum||s.items.anyOf?.map(x=>x.const);
      if(!Array.isArray(v)||new Set(v).size!==v.length||v.length<(s.minItems??0)||v.length>(s.maxItems??100)||v.some(x=>!choices.includes(x)))fail();
    }
  }
  return content;
}
export function requestActions(r) {
  const p=r.params||{};
  if(approvalMethods.includes(r.method))return ['accept','acceptForSession',...(r.method==='item/commandExecution/requestApproval'&&p.proposedExecpolicyAmendment?['execPolicy']:[]),...(r.method==='item/commandExecution/requestApproval'?(p.proposedNetworkPolicyAmendments||[]).map((_,i)=>'network:'+i):[]),'decline','cancel'];
  if(r.method==='item/permissions/requestApproval')return ['accept','acceptForSession','decline'];
  if(questionMethods.includes(r.method))return ['answer','skip'];
  if(r.method==='mcpServer/elicitation/request')return ['accept','decline','cancel'];
  return [];
}
export function responseFor(r,data) {
  const p=r.params||{};const action=data.action;
  if(!requestActions(r).includes(action))throw interactionError('이 요청에서 지원하지 않는 선택입니다.');
  if(questionMethods.includes(r.method)) {
    if(action==='skip')return {answers:{}};
    const answers=Object.create(null);
    for(const q of p.questions||[]) {
      const answer=data.answers?.[q.id];
      if(typeof answer!=='string'||!answer.trim()||answer.length>50000)throw interactionError(`${q.header||q.question}: 답변을 입력해 주세요.`);
      if(q.options?.length&&!q.isOther&&!q.options.some(o=>o.label===answer))throw interactionError('제시된 선택지 중에서 골라 주세요.');
      answers[q.id]={answers:[answer]};
    }
    return {answers};
  }
  if(r.method==='item/permissions/requestApproval') {
    if(data.permissionKeys!==undefined&&!Array.isArray(data.permissionKeys))throw interactionError('권한 선택 형식이 올바르지 않습니다.');
    const permissions=Object.fromEntries(Object.entries(p.permissions||{}).filter(([key,value])=>value!=null&&data.permissionKeys?.includes(key)));
    if(data.permissionKeys?.some(k=>!own(p.permissions,k)))throw interactionError('요청되지 않은 권한입니다.');
    if(action!=='decline'&&!Object.keys(permissions).length)throw interactionError('허용할 권한을 선택해 주세요.');
    return {permissions:action==='decline'?{}:permissions,scope:action==='acceptForSession'?'session':'turn'};
  }
  if(r.method==='mcpServer/elicitation/request') {
    if(action!=='accept')return {action,content:null,_meta:null};
    if(p.mode==='url'){if(!safeWebUrl(p.url))throw interactionError('안전하게 열 수 없는 주소입니다.');return {action,content:null,_meta:null};}
    if(p.mode!=='form')throw interactionError('이 확장 MCP 양식은 지원하지 않습니다. 취소 후 연결 도구에서 진행해 주세요.');
    return {action,content:validateForm(p.requestedSchema,data.content),_meta:null};
  }
  if(['execCommandApproval','applyPatchApproval'].includes(r.method))return {decision:{accept:'approved',acceptForSession:'approved_for_session',decline:{denied:{rejection:'User declined in web UI'}},cancel:'abort'}[action]};
  if(action==='execPolicy')return {decision:{acceptWithExecpolicyAmendment:{execpolicy_amendment:p.proposedExecpolicyAmendment}}};
  if(action.startsWith('network:'))return {decision:{applyNetworkPolicyAmendment:{network_policy_amendment:p.proposedNetworkPolicyAmendments[Number(action.split(':')[1])]}}};
  return {decision:action};
}

export class InteractionBroker {
  constructor(send,changed,notice){this.pending=new Map();this.send=send;this.changed=changed;this.notice=notice;}
  receive(m) {
    if(!supportedRequests.includes(m.method)) {
      const message=m.method==='account/chatgptAuthTokens/refresh'?'인증 갱신이 필요합니다. Codex에 다시 로그인해 주세요.':`웹에서 지원하지 않는 요청입니다: ${m.method}. Codex CLI에서 해당 작업을 진행해 주세요.`;
      if(m.method==='item/tool/call')this.send({id:m.id,result:{success:false,contentItems:[{type:'inputText',text:message}]}});
      else this.send({id:m.id,error:{code:-32601,message}});
      this.notice(message,requestThread(m));return;
    }
    const key=randomUUID();this.pending.set(key,{...m,key,receivedAt:Date.now()});this.changed();
  }
  list(){return [...this.pending.values()].map(({id,key,...r})=>{
    let formError=null;if(r.method==='mcpServer/elicitation/request'&&r.params.mode==='form'){try{checkFormSchema(r.params.requestedSchema);}catch(e){formError=e.message;}}
    return {...r,id:key,threadId:requestThread(r),actions:requestActions(r),formError};
  });}
  reply(key,data) {
    const r=this.pending.get(key);if(!r)throw interactionError('이미 처리되었거나 만료된 요청입니다. 화면을 새로고침해 주세요.',409);
    const result=responseFor(r,data);this.send({id:r.id,result});this.pending.delete(key);this.changed();return r;
  }
  resolved(id){for(const [key,r] of this.pending)if(r.id===id)this.pending.delete(key);this.changed();}
  clear(threadId,turnId){for(const [key,r] of this.pending)if(!threadId||(requestThread(r)===threadId&&(!turnId||r.params.turnId===turnId)))this.pending.delete(key);this.changed();}
}
