import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { contextUsage, validateSelection, mergeRateLimits } from './lib/telemetry.mjs';
import { createAttachmentStore, attachmentInput, attachmentError, MAX_FILE_BYTES, ACCEPT_FILES } from './lib/attachments.mjs';

import { InteractionBroker, interactionError, safeWebUrl, requestThread } from './lib/interactions.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CODEX_WEB_PORT || 43127);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA = process.env.CODEX_WEB_DATA_DIR || path.join(ROOT, '.data');
mkdirSync(DATA, { recursive: true });
const attachments = createAttachmentStore(DATA);
const INDEX = path.join(DATA, 'chats.json');
let chats = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : [];
const save = () => { writeFileSync(INDEX + '.tmp', JSON.stringify(chats)); renameSync(INDEX + '.tmp', INDEX); };
const csrf = randomBytes(32).toString('hex');
const clients = new Set(), pending = new Map(), loaded = new Set(), busy = new Set();
let child, ready, sequence = 0, failure = null;
let catalog = null, catalogPromise = null, quotaSnapshot = null, quotaPromise = null, quotaUpdatedAt = null, quotaError = null, quotaAttemptAt = 0;
const notices=[], connectionId=randomUUID();
let login=null;
const hydrated = new Set(), hydrating = new Map();
async function getCatalog() {
  if (catalog) return catalog;
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    await connect();
    const config = await rpc('config/read', { cwd: ROOT });
    let cursor, models = [];
    do { const page = await rpc('model/list', { limit: 100, ...(cursor ? { cursor } : {}) }); models.push(...page.data); cursor = page.nextCursor; } while (cursor);
    const preferred = models.find(x => x.model === config.config.model) || models.find(x => x.isDefault);
    const configuredEffort = config.config.model_reasoning_effort;
    catalog = { models, defaults: { model: config.config.model || preferred?.model || null,
      effort: configuredEffort || preferred?.defaultReasoningEffort || null } };
    return catalog;
  })().finally(() => { catalogPromise = null; });
  return catalogPromise;
}
async function getQuota(force = false) {
  if (quotaPromise) return quotaPromise;
  if (Date.now() - quotaAttemptAt < (force ? 10000 : 60000)) return;
  quotaAttemptAt = Date.now();
  quotaPromise = (async () => {
    try { await connect(); quotaSnapshot = await rpc('account/rateLimits/read'); quotaUpdatedAt = Date.now(); quotaError = null; }
    catch (e) { quotaError = e.message; }
    finally { broadcast(); }
  })().finally(() => { quotaPromise = null; });
  return quotaPromise;
}
async function hydrateChat(chat) {
  if (hydrated.has(chat.id) || chat.active || busy.has(chat.id)) return;
  if (hydrating.has(chat.id)) return hydrating.get(chat.id);
  const task = (async () => {
    try {
      await connect();
      const { thread } = await rpc('thread/read', { threadId: chat.id });
      if (thread.model) chat.model = thread.model;
      chat.effort = thread.reasoningEffort ?? chat.effort ?? null;
      // Older web chats predate token telemetry storage. Recover only their own
      // latest token_count from the rollout returned by the official thread API.
      if (!chat.tokenUsage && thread.path) {
        const stream = createReadStream(thread.path, { encoding: 'utf8' });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        stream.on('error', e => lines.close());
        for await (const line of lines) {
          let row; try { row = JSON.parse(line); } catch { continue; }
          const info = row.type === 'event_msg' && row.payload?.type === 'token_count' ? row.payload.info : null;
          if (info?.last_token_usage) {
            chat.tokenUsage = { last: { totalTokens: info.last_token_usage.total_tokens }, modelContextWindow: info.model_context_window };
            chat.usageUpdatedAt = Date.parse(row.timestamp) || null; chat.usageModel = chat.model;
          }
        }
      }
      chat.metadataError = null; hydrated.add(chat.id); save();
    } catch (e) { chat.metadataError = e.message; }
  })().finally(() => hydrating.delete(chat.id));
  hydrating.set(chat.id, task); return task;
}
const broadcast = () => { for (const res of clients) res.write(`data: ${JSON.stringify({ type: 'update' })}\n\n`); };
function notice(message,threadId=null) {
  const previous=notices.at(-1);if(previous?.message===message&&previous.threadId===threadId)return;
  const item={id:randomUUID(),message,threadId,at:Date.now()};notices.push(item);if(notices.length>50)notices.shift();broadcast();
}
const broker=new InteractionBroker(message=>send(message),()=>broadcast(),notice);
const send = message => child.stdin.write(JSON.stringify(message) + '\n');
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.')); }, 90000);
    pending.set(id, { resolve, reject, timer });
    try { send({ id, method, params }); } catch(e) { clearTimeout(timer);pending.delete(id);reject(e); }
  });
}
function stopped(message) {
  failure = message; ready = null; login=null; loaded.clear(); broker.clear(); busy.clear();
  catalog = null; hydrated.clear();
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
  pending.clear();
  for (const chat of chats) if (chat.active) { chat.active = null; chat.error = message; }
  save(); broadcast();
}
function connect() {
  if (ready) return ready;
  ready = (async () => {
    failure = null;
    const bin = process.env.CODEX_WEB_CLI || path.join(process.env.APPDATA || '', 'npm/node_modules/@openai/codex/bin/codex.js');
    if (!existsSync(bin)) throw new Error('Codex 설치 파일을 찾지 못했습니다. CODEX_WEB_CLI 설정을 확인해 주세요.');
    child = spawn(process.execPath, [bin, 'app-server'], { cwd: ROOT, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    const worker=child;
    child.on('error', e => {if(child===worker)stopped(e.message);});
    child.stdin.on('error',e=>{if(child===worker)stopped(e.message);});
    child.on('exit', () => {if(child===worker)stopped('Codex 연결이 종료되었습니다. 메시지를 다시 보내면 재연결합니다.');});
    child.stderr.on('data', () => {});
    createInterface({ input: child.stdout }).on('line', line => {
      if(child!==worker)return;
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.id !== undefined && !m.method) {
        const p = pending.get(m.id); if (!p) return;
        clearTimeout(p.timer); pending.delete(m.id);
        m.error ? p.reject(Object.assign(new Error(m.error.message),{rpcCode:m.error.code})) : p.resolve(m.result);
      } else if (m.method && m.id !== undefined) {
        broker.receive(m);
      } else event(m.method, m.params || {});
    });
    await rpc('initialize', {clientInfo:{name:'codex_web_local',title:'Codex 웹 대화',version:'1.3.0'},capabilities:{experimentalApi:true,requestAttestation:false}});
    send({method:'initialized',params:{}});
  })().catch(e => { ready = null; failure = e.message; throw e; });
  return ready;
}
function upsert(chat, item) {
  if (item.type === 'userMessage') {
    const submission = (chat.submissions || []).find(x => x.id === item.clientId);
    if (submission) { item.displayText = submission.text; item.attachments = submission.attachments; }
  }
  const previous=chat.items.find(x=>x.id===item.id);
  if(previous?.questionReply)item.questionReply=previous.questionReply;
  const i = chat.items.findIndex(x => x.id === item.id);
  if (i < 0) chat.items.push(item); else chat.items[i] = item;
}
function event(method, p) {
  if (method === 'account/rateLimits/updated') {
    quotaSnapshot = mergeRateLimits(quotaSnapshot, p.rateLimits); broadcast(); return;
  }
  if (method === 'serverRequest/resolved') { broker.resolved(p.requestId); return; }
  if(method==='account/login/completed'){login=null;catalog=null;notice(p.success?'Codex 로그인이 완료되었습니다.':('로그인 실패: '+(p.error||'다시 시도해 주세요.')));return;}
  if(method==='account/updated'){catalog=null;broadcast();return;}
  if(method==='mcpServer/oauthLogin/completed'){notice((p.success?'연결 도구 로그인 완료: ':'연결 도구 로그인 실패: ')+p.name+(p.error?' · '+p.error:''),p.threadId);return;}
  if(method==='modelProvider/authRecoveryStarted'||method==='modelProvider/authRecoveryCompleted'){notice(p.message,p.threadId);return;}
  if(method==='windowsSandbox/setupCompleted'){notice(p.success?'Windows 작업 환경 준비가 완료되었습니다.':'Windows 작업 환경 준비 실패 · '+(p.error||'Codex CLI에서 설정을 확인해 주세요.'));return;}
  if(['warning','guardianWarning','configWarning','deprecationNotice'].includes(method)){notice(p.message||p.summary||p.details||method,p.threadId);return;}
  if(method==='mcpServer/startupStatus/updated'&&p.status==='failed'){notice('연결 도구 시작 실패: '+(p.name||p.serverName||'MCP')+' · '+(p.error?.message||p.error||''));return;}
  if(method==='thread/started'&&p.thread.parentThreadId){
    const parent=chats.find(x=>x.id===p.thread.parentThreadId);if(parent&&!chats.some(x=>x.id===p.thread.id)){chats.push({id:p.thread.id,parentThreadId:parent.id,title:'하위 작업 · '+(p.thread.agentNickname||p.thread.id.slice(0,8)),items:[],active:null,updatedAt:Date.now()});loaded.add(p.thread.id);save();broadcast();}return;
  }
  const chat = chats.find(x => x.id === p.threadId); if (!chat) return;
  if(method==='thread/status/changed'){chat.threadStatus=p.status;if(['idle','notLoaded','systemError'].includes(p.status.type)){const previousTurn=chat.active;chat.active=null;if(previousTurn&&previousTurn!=='starting')broker.clear(chat.id,previousTurn);}save();broadcast();return;}
  if(['thread/closed','thread/deleted','thread/archived'].includes(method)){chat.active=null;loaded.delete(chat.id);broker.clear(chat.id);notice('Codex 대화 상태가 변경되었습니다: '+method,chat.id);save();return;}
  if(method==='item/autoApprovalReview/started'||method==='item/autoApprovalReview/completed'){upsert(chat,{id:'review-'+p.reviewId,type:'webNotice',text:'자동 승인 검토 · '+(p.review?.status||'진행 중')+'\n'+(p.review?.rationale||'')});save();broadcast();return;}
  if(method==='autoApprovalReview/strictReviewRequired'){notice('추가 승인 검토가 필요합니다. CLI 또는 계정 정책을 확인해 주세요.',chat.id);return;}
  if(method==='turn/plan/updated'){upsert(chat,{id:'plan-'+p.turnId,type:'plan',text:(p.explanation||'')+'\n'+p.plan.map(x=>'['+x.status+'] '+x.step).join('\n')});save();broadcast();return;}
  if(method==='item/fileChange/patchUpdated'){const item=chat.items.find(x=>x.id===p.itemId);if(item){item.changes=p.changes;save();broadcast();}return;}
  if(method==='item/commandExecution/outputDelta') {const item=chat.items.find(x=>x.id===p.itemId);if(item){item.aggregatedOutput=((item.aggregatedOutput||'')+p.delta).slice(-200000);broadcast();}return;}
  if(method==='item/commandExecution/terminalInteraction'){notice('명령이 대화형 터미널과 상호작용하고 있습니다. 웹에서 직접 터미널 키 입력이 필요한 작업은 CLI에서 이어서 진행해 주세요.',chat.id);return;}
  if(method==='item/mcpToolCall/progress'){const item=chat.items.find(x=>x.id===p.itemId);if(item){item.progress=p.message;broadcast();}return;}
  if (method === 'thread/tokenUsage/updated') {
    chat.tokenUsage = p.tokenUsage; chat.usageUpdatedAt = Date.now(); chat.usageModel = chat.responseModel || chat.model;
    save(); broadcast(); return;
  }
  if (method === 'thread/settings/updated') {
    chat.model = p.threadSettings.model; chat.effort = p.threadSettings.effort; save(); broadcast(); return;
  }
  if (method === 'model/rerouted') { chat.responseModel = p.toModel; save(); broadcast(); return; }
  if (method === 'turn/started') { chat.active = p.turn.id; chat.error = null; chat.turnStatus='inProgress'; }
  else if (method === 'turn/completed') {
    chat.active = null; chat.error = p.turn.error?.message || null;
    chat.turnStatus=p.turn.status;chat.threadStatus={type:'idle'};broker.clear(chat.id,p.turn.id);
  } else if (method === 'item/started' || method === 'item/completed') upsert(chat,p.item);
  else if (method === 'item/agentMessage/delta') {
    let item = chat.items.find(x=>x.id===p.itemId);
    if (!item) { item={id:p.itemId,type:'agentMessage',text:''}; chat.items.push(item); }
    item.text += p.delta;
  } else if (method === 'error') {chat.error = (p.willRetry?'자동 재시도 중 · ':'')+(p.error?.message || '응답 중 오류가 발생했습니다.');chat.errorInfo=p.error?.codexErrorInfo||null;}
  else return;
  chat.updatedAt=Date.now();
  if (method !== 'item/agentMessage/delta') save();
  broadcast();
}
const json = (res,status,value) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
async function body(req) {
  let value=''; for await (const chunk of req) { value+=chunk; if(value.length>200000) throw new Error('메시지가 너무 깁니다.'); }
  return JSON.parse(value || '{}');
}
const files = {'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/interactions.js':['interactions.js','text/javascript'],'/telemetry.js':['../lib/telemetry.mjs','text/javascript'],'/style.css':['style.css','text/css'],'/icon.svg':['icon.svg','image/svg+xml']};
const server = http.createServer(async (req,res) => {
  try {
    if(req.headers.host !== `127.0.0.1:${PORT}`) return json(res,403,{error:'허용되지 않은 주소입니다.'});
    if(req.headers.origin && req.headers.origin !== ORIGIN) return json(res,403,{error:'허용되지 않은 요청입니다.'});
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const url = new URL(req.url,ORIGIN);
    if(req.method==='GET' && url.pathname==='/health') return json(res,200,{app:'codex-web-chat',version:'1.3.0'});
    if(req.method==='GET' && url.pathname==='/api/state') return json(res,200,{csrf,cwd:ROOT,failure,chats:chats.map(x=>({id:x.id,title:x.title,updatedAt:x.updatedAt,active:x.active})),requests:broker.list(),notices,connectionId,interactionVersion:1,login,quotaSnapshot,quotaUpdatedAt,quotaError,acceptFiles:ACCEPT_FILES});
    if(req.method==='GET' && url.pathname==='/api/attachment') {
      const file=attachments.get(url.searchParams.get('id'));
      res.writeHead(200,{'Content-Type':file.type,'Cache-Control':'private, no-store','Content-Disposition':`${file.image?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`});
      createReadStream(file.path).on('error',()=>res.destroy()).pipe(res);return;
    }
    if(req.method==='POST' && url.pathname==='/api/upload') {
      if(req.headers['x-codex-token']!==csrf || req.headers['content-type']!=='application/octet-stream') return json(res,403,{error:'화면을 새로고침해 주세요.'});
      if(Number(req.headers['content-length'])>MAX_FILE_BYTES){req.resume();return json(res,413,{error:'파일당 최대 20 MB까지 첨부할 수 있습니다.'});}
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>MAX_FILE_BYTES)throw attachmentError('파일당 최대 20 MB입니다.',413);chunks.push(chunk);}
      return json(res,201,attachments.save(url.searchParams.get('name'),Buffer.concat(chunks)));
    }
    if(req.method==='GET' && url.pathname==='/api/catalog') return json(res,200,await getCatalog());
    if(req.method==='GET' && url.pathname==='/api/usage') {
      await getQuota(url.searchParams.get('refresh') === '1');
      return json(res,200,{quotaSnapshot,quotaUpdatedAt,quotaError});
    }
    if(req.method==='GET' && url.pathname==='/api/chat') {
      const chat=chats.find(x=>x.id===url.searchParams.get('id'));
      if(chat) await hydrateChat(chat);
      return json(res,chat?200:404,chat ? {...chat,context:contextUsage(chat.tokenUsage)} : {error:'대화를 찾을 수 없습니다.'});
    }
    if(req.method==='GET' && url.pathname==='/api/events') {
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
      res.write('data: {"type":"connected"}\n\n'); clients.add(res);
      const timer=setInterval(()=>res.write(': heartbeat\n\n'),20000);
      req.on('close',()=>{clients.delete(res);clearInterval(timer);}); return;
    }
    if(req.method==='GET' && url.pathname==='/api/account') { await connect(); const a=await rpc('account/read'); return json(res,200,{loggedIn:!!a.account,type:a.account?.type}); }
    if(req.method==='POST' && url.pathname.startsWith('/api/')) {
      if(req.headers['x-codex-token']!==csrf || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'화면을 새로고침해 주세요.'});
      const data=await body(req);
      if(url.pathname==='/api/reply') {
        const request=broker.reply(String(data.id),data);
        const chat=chats.find(x=>x.id===requestThread(request));
        if(chat){upsert(chat,{id:'reply-'+request.key,type:'webNotice',text:'요청 처리 · '+request.method+' · '+data.action});save();}
        return json(res,200,{ok:true});
      }
      await connect();
      if(url.pathname==='/api/login') {
        if(data.action==='cancel'){if(login?.loginId)await rpc('account/login/cancel',{loginId:login.loginId});login=null;broadcast();return json(res,200,{ok:true});}
        if(data.action!=='start')throw interactionError('로그인 동작을 확인해 주세요.');
        if(!login){const result=await rpc('account/login/start',{type:'chatgpt'});if(!safeWebUrl(result.authUrl))throw interactionError('로그인 주소를 확인하지 못했습니다.');login={loginId:result.loginId,url:result.authUrl};}
        broadcast();return json(res,200,{url:login.url});
      }
      if(url.pathname==='/api/question') {
        const chat=chats.find(x=>x.id===data.id);if(!chat)throw interactionError('대화를 찾을 수 없습니다.',404);
        const item=chat.items.find(x=>x.id===data.itemId&&x.type==='agentMessage'&&x.questions?.length);
        if(!item)throw interactionError('질문을 찾을 수 없습니다.',404);
        if(item.questionReply)throw interactionError('이미 답변했거나 건너뛴 질문입니다.',409);
        if(busy.has(chat.id))throw interactionError('전송 중입니다. 잠시 후 다시 시도해 주세요.',409);
        if(data.action==='dismiss'){item.questionReply={status:'skipped'};save();broadcast();return json(res,200,{ok:true});}
        if(!Array.isArray(data.answers)||data.answers.length!==item.questions.length||data.answers.some(x=>typeof x!=='string'||!x.trim()||x.length>10000))throw interactionError('모든 질문에 답을 선택하거나 입력해 주세요.');
        if(broker.list().some(r=>r.threadId===chat.id&&r.params.isBlocking!==false))throw interactionError('진행을 멈춘 승인·질문 요청에 먼저 답해 주세요.',409);
        busy.add(chat.id);
        try {
          if(!loaded.has(chat.id)){await rpc('thread/resume',{threadId:chat.id,cwd:ROOT,approvalPolicy:'on-request',sandbox:'workspace-write'});loaded.add(chat.id);}
          const text=item.questions.map((q,i)=>q.title+'\n답변: '+data.answers[i]).join('\n\n');
          const params={threadId:chat.id,clientUserMessageId:randomUUID(),input:[{type:'text',text,text_elements:[]}]};
          if(chat.active){if(chat.active==='starting')throw interactionError('작업 시작 중입니다. 잠시 후 답변해 주세요.',409);await rpc('turn/steer',{...params,expectedTurnId:chat.active});}
          else {chat.active='starting';broadcast();const result=await rpc('turn/start',{...params,...(chat.selection||{})});if(chat.active==='starting')chat.active=result.turn.status==='inProgress'?result.turn.id:null;}
          item.questionReply={status:'sent',answers:data.answers};save();broadcast();return json(res,200,{ok:true});
        } catch(e){if(chat.active==='starting')chat.active=null;throw e;} finally{busy.delete(chat.id);broadcast();}
      }
      if(url.pathname==='/api/settings') {
        const chat=chats.find(x=>x.id===data.id);
        if(!chat) return json(res,404,{error:'대화를 찾을 수 없습니다.'});
        if(chat.active || busy.has(chat.id)) return json(res,409,{error:'응답이 끝난 뒤 설정을 변경해 주세요.'});
        const {models}=await getCatalog();
        const selection=validateSelection(models,data.selection);
        if(chat.active || busy.has(chat.id)) return json(res,409,{error:'응답이 끝난 뒤 설정을 변경해 주세요.'});
        chat.selection=selection; save(); broadcast(); return json(res,200,{selection});
      }
      if(url.pathname==='/api/message') {
        if(typeof data.text!=='string' || data.text.length>50000) return json(res,400,{error:'메시지는 최대 50,000자입니다.'});
        const attached=attachments.resolve(data.attachments);
        if(!data.text.trim()&&!attached.length)return json(res,400,{error:'메시지나 첨부 파일을 추가해 주세요.'});
        let chat = data.id ? chats.find(x=>x.id===data.id) : null;
        if(data.id && !chat) return json(res,404,{error:'대화를 찾을 수 없습니다.'});
        const lock=chat?.id || 'new';
        if(busy.has(lock)||chat?.active) return json(res,409,{error:'현재 응답이 끝난 뒤 보내 주세요.'});
        busy.add(lock);
        try {
          const {models}=await getCatalog();
          const selected=data.selection || chat?.selection;
          const selection=selected ? validateSelection(models,selected) : null;
          const selectedModel=models.find(x=>x.model===(selection?.model||chat?.model||catalog.defaults.model));
          if(attached.some(x=>x.image)&&selectedModel?.inputModalities&&!selectedModel.inputModalities.includes('image'))throw attachmentError('선택한 모델은 이미지 입력을 지원하지 않습니다. 모델을 변경해 주세요.');
          const settings={cwd:ROOT,approvalPolicy:'on-request',sandbox:'workspace-write'};
          if(!chat) {
            const result=await rpc('thread/start',{...settings,...(selection?{model:selection.model,config:{model_reasoning_effort:selection.effort}}:{}),developerInstructions:'사용자에게 기본적으로 한국어로 쉽고 친절하게 답하세요.'});
            chat={id:result.thread.id,title:(data.text.trim()||attached[0].name).slice(0,40),updatedAt:Date.now(),items:[],active:null,error:null,model:result.model,effort:result.reasoningEffort,selection};
            chats.unshift(chat); loaded.add(chat.id); save();
          } else if(!loaded.has(chat.id)) {
            const resumed=await rpc('thread/resume',{threadId:chat.id,...settings});
            chat.model=resumed.model; chat.effort=resumed.reasoningEffort; loaded.add(chat.id);
          }
          hydrated.add(chat.id);
          chat.responseModel = null;
          chat.active='starting'; chat.error=null; broadcast();
          const clientId=randomUUID();
          if(attached.length){chat.submissions ||= [];chat.submissions.push({id:clientId,text:data.text.trim(),attachments:attached.map(({path,...file})=>file)});save();}
          const result=await rpc('turn/start',{threadId:chat.id,clientUserMessageId:clientId,...(selection||{}),input:attachmentInput(data.text,attached)});
          if(selection) { chat.model=selection.model; chat.effort=selection.effort; chat.selection=selection; }
          if(chat.active==='starting') chat.active=result.turn.status==='inProgress'?result.turn.id:null;
          save(); broadcast(); return json(res,200,{id:chat.id});
        } catch(e) { if(chat) { chat.active=null;chat.error=e.message;save();broadcast(); } throw e; }
        finally { busy.delete(lock); }
      }
      if(url.pathname==='/api/stop') {
        const chat=chats.find(x=>x.id===data.id);
        if(chat?.active && chat.active!=='starting') await rpc('turn/interrupt',{threadId:chat.id,turnId:chat.active});
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'알 수 없는 요청입니다.'});
    }
    if(req.method==='GET' && files[url.pathname]) {
      const [file,type]=files[url.pathname]; res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache'}); res.end(readFileSync(path.join(ROOT,'public',file))); return;
    }
    json(res,404,{error:'찾을 수 없습니다.'});
  } catch(e) { json(res,e.statusCode||500,{error:e.message}); }
});
for(const chat of chats){if(chat.active)chat.error='서버가 재시작되어 작업이 중단되었습니다. 이전 승인 요청은 만료되었습니다. 내용을 확인하고 다시 요청해 주세요.';chat.active=null;chat.threadStatus={type:'idle'};}
server.listen(PORT,'127.0.0.1',()=>console.log(`Codex Web: ${ORIGIN}`));
server.on('error',e=>{console.error(e.message);process.exit(1);});
process.on('SIGINT',()=>{child?.kill();server.close();process.exit();});
process.on('SIGTERM',()=>{child?.kill();server.close();process.exit();});
