import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const base='http://127.0.0.1:43128';
let server;
test('local web server',async t=>{
  server=spawn(process.execPath,['server.mjs'],{windowsHide:true,env:{...process.env,CODEX_WEB_UPDATE_CHECK:'0',CODEX_WEB_PORT:'43128',CODEX_WEB_DATA_DIR:mkdtempSync(path.join(tmpdir(),'codex-web-test-')),CODEX_WEB_CLI:path.resolve('test/fake-codex.mjs')},stdio:'ignore'});
  t.after(()=>server?.kill());
  let started=false;
  for(let i=0;i<40;i++){try{await fetch(base+'/health');started=true;break;}catch{await delay(100);}}
  assert.ok(started,'Test server did not start');
await t.test('serves Korean app with restrictive browser policy',async()=>{
  const res=await fetch(base);assert.equal(res.status,200);assert.match(await res.text(),/Codex 웹 대화/);assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
await t.test('rejects foreign origins and rebinding hosts',async()=>{
  assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://untrusted.example'}})).status,403);
  const status=await new Promise((resolve,reject)=>http.get(base+'/api/state',{headers:{Host:'untrusted.example:43128'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(status,403);
});
await t.test('rejects missing or incorrect action token before starting Codex',async()=>{
  for(const token of ['', 'wrong'])assert.equal((await fetch(base+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':token},body:'{"text":"hello"}'})).status,403);
});
await t.test('does not expose project files or unknown conversations',async()=>{
  assert.equal((await fetch(base+'/server.mjs')).status,404);
  assert.equal((await fetch(base+'/.data/chats.json')).status,404);
  assert.equal((await fetch(base+'/api/chat?id=unknown')).status,404);
  const state=await(await fetch(base+'/api/state')).json();assert.deepEqual(state.chats,[]);assert.equal(state.csrf.length,64);
});
await t.test('update endpoints do not require Codex, and installation requires the action token',async()=>{
  const update=await(await fetch(base+'/api/update')).json();assert.match(update.currentVersion,/^\d+\.\d+\.\d+$/);assert.equal(update.enabled,false);
  assert.equal((await fetch(base+'/api/update/install',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const {csrf}=await(await fetch(base+'/api/state')).json();
  const response=await fetch(base+'/api/update/install',{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':csrf},body:'{}'});
  assert.equal(response.status,409);assert.match((await response.json()).error,/비활성화/);
});
await t.test('uploads require authentication and reach Codex with display metadata',async()=>{
  const state=await(await fetch(base+'/api/state')).json();
  const upload=token=>fetch(base+'/api/upload?name=notes.txt',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Codex-Token':token},body:'test document'});
  assert.equal((await upload('wrong')).status,403);
  const response=await upload(state.csrf);assert.equal(response.status,201);const file=await response.json();
  const download=await fetch(base+'/api/attachment?id='+file.id);assert.equal(await download.text(),'test document');assert.match(download.headers.get('content-disposition'),/^attachment/);
  const sent=await fetch(base+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':state.csrf},body:JSON.stringify({text:'',attachments:[file.id]})});
  assert.equal(sent.status,200);const {id}=await sent.json();
  let chat;
  for(let i=0;i<40;i++){chat=await(await fetch(base+'/api/chat?id='+id)).json();if(!chat.active)break;await delay(20);}
  const user=chat.items.find(x=>x.type==='userMessage');assert.equal(user.displayText,'');assert.equal(user.attachments[0].id,file.id);
  const params=JSON.parse(chat.items.at(-1).text);assert.match(params.input[1].text,/notes.txt/);
});
await t.test('Codex update routes require a token and remain independent from web releases',async()=>{
  const response=await fetch(base+'/api/codex-update');assert.equal(response.status,200);
  const update=await response.json();assert.equal(update.enabled,false);assert.equal(update.currentVersion,null);
  for(const action of ['check','dismiss','install'])assert.equal((await fetch(base+'/api/codex-update/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const {csrf}=await(await fetch(base+'/api/state')).json();
  const blocked=await fetch(base+'/api/codex-update/install',{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':csrf},body:JSON.stringify({version:'1.0.0'})});
  assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/비활성화/);
});
await t.test('model refresh replaces the cache and includes new models from later pages',async()=>{
  const get=async suffix=>(await(await fetch(base+'/api/catalog'+suffix)).json());
  const first=await get('');const cached=await get('');assert.deepEqual(first,cached);
  const fresh=await get('?refresh=1');assert.notEqual(fresh.models[0].description,first.models[0].description);
  assert.equal(fresh.models.find(x=>x.model==='gpt-6.1-sol').displayName,'GPT-6.1-Sol');
  const {csrf}=await(await fetch(base+'/api/state')).json();
  const sent=await fetch(base+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':csrf},body:JSON.stringify({text:'new model',selection:{model:'gpt-6.1-sol',effort:'ultra'}})});
  assert.equal(sent.status,200);const {id}=await sent.json();let chat;
  for(let i=0;i<40;i++){chat=await(await fetch(base+'/api/chat?id='+id)).json();if(!chat.active)break;await delay(20);}
  assert.equal(JSON.parse(chat.items.at(-1).text).model,'gpt-6.1-sol');
});
await t.test('settings reach Codex turns and stay isolated to the selected chat',async()=>{
  const state=await(await fetch(base+'/api/state')).json();
  const post=async(route,data)=>{const res=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':state.csrf},body:JSON.stringify(data)});return {status:res.status,data:await res.json()};};
  const catalog=await(await fetch(base+'/api/catalog')).json();assert.equal(catalog.defaults.effort,'high');
  const usage=await(await fetch(base+'/api/usage')).json();assert.equal(usage.quotaSnapshot.rateLimits.primary.usedPercent,83);
  const first=await post('/api/message',{text:'test',selection:{model:'test-a',effort:'high'}});assert.equal(first.status,200);
  const id=first.data.id;
  const getChat=async()=>await(await fetch(base+'/api/chat?id='+id)).json();
  for(let i=0;i<40;i++){if(!(await getChat()).active)break;await delay(20);}
  let chat=await getChat();assert.equal(chat.context.percent,25);assert.equal(chat.effort,'high');
  assert.equal((await post('/api/settings',{id,selection:{model:'test-b',effort:'ultra'}})).status,500);
  assert.equal((await post('/api/settings',{id,selection:{model:'test-b',effort:'low'}})).status,200);
  chat=await getChat();assert.equal(chat.model,'test-a');assert.equal(chat.selection.model,'test-b');
  assert.equal((await post('/api/message',{id,text:'continue'})).status,200);
  for(let i=0;i<40;i++){if(!(await getChat()).active)break;await delay(20);}
  chat=await getChat();const params=JSON.parse(chat.items.at(-1).text);
  assert.equal(params.model,'test-b');assert.equal(params.effort,'low');assert.equal(chat.model,'test-b');
  assert.equal((await post('/api/settings',{id:'other-chat',selection:{model:'test-a',effort:'low'}})).status,404);
});
await t.test('callbacks survive refresh, validate answers and reject duplicate replies',async()=>{
  const state=await(await fetch(base+'/api/state')).json();
  const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':state.csrf},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  for(const scenario of ['approval','file','choice','permission','form','url']){
    const sent=await post('/api/message',{text:'scenario:'+scenario});assert.equal(sent.status,200);let request;
    for(let i=0;i<40;i++){request=(await(await fetch(base+'/api/state')).json()).requests.find(x=>x.threadId===sent.data.id);if(request)break;await delay(20);}
    assert.ok(request,scenario);assert.equal((await(await fetch(base+'/api/state')).json()).requests.find(x=>x.id===request.id).id,request.id);
    assert.equal((await post('/api/reply',{id:request.id,action:'invalid'})).status,400);
    const data=scenario==='choice'?{action:'answer',answers:{style:'다른 방식',name:'테스터'}}:scenario==='permission'?{action:'accept',permissionKeys:['network']}:scenario==='form'?{action:'accept',content:{title:'보고서',count:3,confirmed:false,tags:['summary']}}:scenario==='url'?{action:'cancel'}:{action:'decline'};
    assert.equal((await post('/api/reply',{id:request.id,...data})).status,200);
    assert.equal((await post('/api/reply',{id:request.id,...data})).status,409);
  }
});
await t.test('async questions steer live turns and start idle turns, with duplicate protection',async()=>{
  const state=await(await fetch(base+'/api/state')).json();
  const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':state.csrf},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  for(const scenario of ['async-live','async-done']){
    const sent=await post('/api/message',{text:'scenario:'+scenario});let chat,item;
    for(let i=0;i<40;i++){chat=await(await fetch(base+'/api/chat?id='+sent.data.id)).json();item=chat.items.find(x=>x.questions?.length);if(item)break;await delay(20);}
    assert.ok(item);const data={id:chat.id,itemId:item.id,answers:['자세히','민트색으로']};
    assert.equal((await post('/api/question',{...data,answers:['']})).status,400);
    assert.equal((await post('/api/question',data)).status,200);
    assert.equal((await post('/api/question',data)).status,409);
    chat=await(await fetch(base+'/api/chat?id='+chat.id)).json();assert.equal(chat.items.find(x=>x.id===item.id).questionReply.status,'sent');
    if(scenario==='async-live')assert.ok(chat.items.some(x=>x.text?.includes('"steered":true')));
  }
});
await t.test('interruption expires callbacks, unsupported requests surface, and connection loss recovers',async()=>{
  let state=await(await fetch(base+'/api/state')).json();
  const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Codex-Token':state.csrf},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const sent=await post('/api/message',{text:'scenario:approval'});let request;
  for(let i=0;i<40;i++){state=await(await fetch(base+'/api/state')).json();request=state.requests.find(x=>x.threadId===sent.data.id);if(request)break;await delay(20);}
  await post('/api/stop',{id:sent.data.id});assert.equal((await post('/api/reply',{id:request.id,action:'accept'})).status,409);
  await post('/api/message',{text:'scenario:unknown'});
  for(let i=0;i<40;i++){state=await(await fetch(base+'/api/state')).json();if(state.notices.length)break;await delay(20);}
  assert.ok(state.notices.some(x=>x.message.includes('future/unsupported')));
  await post('/api/message',{text:'scenario:disconnect'});
  for(let i=0;i<40;i++){state=await(await fetch(base+'/api/state')).json();if(state.failure)break;await delay(20);}
  assert.ok(state.failure);assert.equal(state.requests.length,0);assert.ok(state.chats.every(x=>!x.active));
  assert.equal((await post('/api/message',{text:'reconnected'})).status,200);
});
});
