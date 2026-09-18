import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { hash, newer, validateBundle, bundleManifest, checkManaged, snapshotManaged, applyManaged, restoreManaged } from '../lib/update-package.mjs';
import { createUpdater } from '../lib/updater.mjs';

const temp=()=>mkdtempSync(path.join(tmpdir(),'codex-update-test-'));
const makeBundle=(version,entries,commit='a'.repeat(40))=>({schema:1,version,commit,files:Object.entries({'package.json':JSON.stringify({name:'codex-web-chat',version}),...entries}).map(([path,data])=>({path,data:Buffer.from(data).toString('base64'),sha256:hash(Buffer.from(data))}))});
function materialize(root,bundle){for(const f of bundle.files){const dest=path.join(root,f.path);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,Buffer.from(f.data,'base64'));}writeFileSync(path.join(root,'.release-manifest.json'),JSON.stringify(bundleManifest(bundle)));}
const validated=bundle=>{const bytes=Buffer.from(JSON.stringify(bundle));return validateBundle(bytes,bundle.version,'sha256:'+hash(bytes));};
test('stable versions, hashes and package paths are validated',()=>{
  assert.ok(newer('1.10.0','1.9.9'));assert.ok(!newer('1.4.0','1.4.0'));assert.ok(!newer('1.5.0-beta','1.4.0'));
  const b=makeBundle('2.0.0',{'server.mjs':'hello'});validated(b);
  for(const name of ['../.env','.data/chats.json','lib/../../auth.json','public/a:secret','public/CON.txt','public/evil.'])assert.throws(()=>validated(makeBundle('2.0.0',{'server.mjs':'hello',[name]:'bad'})));
  const bytes=Buffer.from(JSON.stringify(b));assert.throws(()=>validateBundle(bytes,b.version,'sha256:'+'0'.repeat(64)));
  assert.throws(()=>validated({...b,files:[...b.files,{...b.files[0],path:'Package.json'}]}));
});
test('managed update preserves user data, removes obsolete files, and restores complete backup',()=>{
  const root=temp(),old=makeBundle('1.0.0',{'server.mjs':'old','public/old.js':'obsolete'}),next=makeBundle('2.0.0',{'server.mjs':'new','public/new.js':'added'});
  materialize(root,old);mkdirSync(path.join(root,'.data'));writeFileSync(path.join(root,'.data','chats.json'),'private');writeFileSync(path.join(root,'.env'),'secret');
  const snapshot=snapshotManaged(root,next),previous=checkManaged(root,next);applyManaged(root,next,previous);
  assert.equal(readFileSync(path.join(root,'server.mjs'),'utf8'),'new');assert.ok(!existsSync(path.join(root,'public/old.js')));
  restoreManaged(root,snapshot);assert.equal(readFileSync(path.join(root,'server.mjs'),'utf8'),'old');assert.ok(!existsSync(path.join(root,'public/new.js')));
  assert.equal(readFileSync(path.join(root,'.data/chats.json'),'utf8'),'private');assert.equal(readFileSync(path.join(root,'.env'),'utf8'),'secret');
  writeFileSync(path.join(root,'server.mjs'),'local edit');assert.throws(()=>checkManaged(root,next),/수정/);
});
test('release checks are cached, stable-only, tolerate offline and block active work',async()=>{
  const root=temp(),data=path.join(root,'.data');mkdirSync(data);materialize(root,makeBundle('1.0.0',{'server.mjs':'old'}));
  let calls=0,busy=true;
  const release={tag_name:'v2.0.0',body:'notes',assets:[{name:'codex-web-chat-v2.0.0.update.json',state:'uploaded',size:200,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/dev-2nan/codex-web-chat/releases/download/v2.0.0/codex-web-chat-v2.0.0.update.json'}]};
  const config={root,data,port:40000,version:'1.0.0',isBusy:()=>busy,shutdown:()=>{throw Error('unexpected shutdown');}};
  const updater=createUpdater({...config,fetchFn:async()=>{calls++;return Response.json(release);}});
  const concurrent=await Promise.all([updater.check(),updater.check(true)]);assert.ok(concurrent.every(s=>s.available));
  await updater.check();await updater.check(true);assert.equal(calls,1);assert.equal(updater.state().available,true);
  await assert.rejects(updater.prepare(),/진행 중/);assert.equal(updater.locked(),false);
  busy=false;await assert.rejects(updater.prepare(),/SHA-256/);assert.equal(updater.locked(),false);assert.equal(updater.state().status.phase,'failed');assert.equal(readFileSync(path.join(root,'server.mjs'),'utf8'),'old');
  const offline=createUpdater({...config,fetchFn:()=>{throw Error('offline');}});assert.ok(offline.state().available);
  const cache=path.join(data,'updater/check.json');writeFileSync(cache,JSON.stringify({checkedAt:0}));
  const failure=createUpdater({...config,fetchFn:()=>{throw Error('offline');}});await failure.check();assert.equal(failure.state().error,'offline');
  writeFileSync(cache,JSON.stringify({checkedAt:0}));const beta=createUpdater({...config,fetchFn:async()=>Response.json({...release,prerelease:true})});await beta.check();assert.equal(beta.state().available,false);
  busy=false;const disabled=createUpdater({...config,enabled:false});await assert.rejects(disabled.prepare(),/비활성화/);
});

const fixtureServer=`import http from 'node:http';import {readFileSync} from 'node:fs';const version=JSON.parse(readFileSync(new URL('./package.json',import.meta.url))).version;http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'codex-web-chat',version,updateProbe:process.env.CODEX_WEB_UPDATE_PROBE,pid:process.pid}));}).listen(Number(process.env.CODEX_WEB_PORT),'127.0.0.1');`;
async function unusedPort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
for(const mode of ['release','git'])for(const fail of (mode==='git'?[false,true,'ignored']:[false,true]))test(`${mode} worker ${fail==='ignored'?'protects ignored local files':fail?'rolls back a failed startup':'installs and restarts'} without touching conversations`,{timeout:30000},async t=>{
  const root=temp(),data=path.join(root,'.data'),directory=path.join(data,'updater','job');mkdirSync(directory,{recursive:true});
  const old=makeBundle('1.0.0',{'server.mjs':fixtureServer}),next=makeBundle('2.0.0',{'server.mjs':fail===true?'throw new Error("broken startup")':fixtureServer,...(fail==='ignored'?{'public/user.txt':'release file'}:{})});materialize(root,old);
  writeFileSync(path.join(data,'chats.json'),'["private conversation"]');
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();let oldHead;
  if(mode==='git') {
    git(['init','--quiet']);git(['config','user.name','Update Test']);git(['config','user.email','test@example.invalid']);git(['config','core.autocrlf','false']);
    writeFileSync(path.join(root,'.gitignore'),'.data/\n.release-manifest.json\npublic/user.txt\n');git(['add','.']);git(['commit','-qm','old']);oldHead=git(['rev-parse','HEAD']);
    materialize(root,next);git(['add','.']);if(fail==='ignored')git(['add','-f','public/user.txt']);git(['commit','-qm','new']);next.commit=git(['rev-parse','HEAD']);git(['reset','--keep',oldHead]);
    if(fail==='ignored'){mkdirSync(path.join(root,'public'),{recursive:true});writeFileSync(path.join(root,'public/user.txt'),'private ignored file');}
  }
  const bytes=Buffer.from(JSON.stringify(next)),packageFile=path.join(directory,'package.json');writeFileSync(packageFile,bytes);
  for(const name of ['update-worker.mjs','update-package.mjs'])copyFileSync(path.resolve('lib',name),path.join(directory,name));
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});t.after(()=>parent.kill());
  const port=await unusedPort(),origin=`http://127.0.0.1:${port}`;
  const job={id:'test',root,data,directory,mode,port,origin,parentPid:parent.pid,oldVersion:'1.0.0',version:'2.0.0',oldHead,commit:next.commit,packageFile,digest:'sha256:'+hash(bytes)};
  const jobFile=path.join(directory,'job.json');writeFileSync(jobFile,JSON.stringify(job));
  const worker=spawn(process.execPath,[path.join(directory,'update-worker.mjs'),jobFile],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});let errors='';worker.stderr.on('data',c=>errors+=c);t.after(()=>worker.kill());
  await new Promise((resolve,reject)=>{worker.once('message',m=>m.ready?resolve():reject(Error(m.error)));worker.once('exit',()=>reject(Error(errors)));worker.once('error',reject);});
  const exited=new Promise(r=>parent.once('exit',r));parent.kill();await exited;worker.send('go');
  let result;
  for(let i=0;i<150;i++){try{result=JSON.parse(readFileSync(path.join(data,'updater/status.json'),'utf8'));}catch{}if(['complete','failed'].includes(result?.phase))break;await delay(100);}
  let health;try{health=await(await fetch(origin+'/health')).json();}finally{if(health?.pid)process.kill(health.pid);}
  assert.equal(result?.phase,fail?'failed':'complete',JSON.stringify(result)+' '+errors);assert.equal(health.version,fail?'1.0.0':'2.0.0');
  assert.equal(readFileSync(path.join(data,'chats.json'),'utf8'),'["private conversation"]');
  if(fail==='ignored')assert.equal(readFileSync(path.join(root,'public/user.txt'),'utf8'),'private ignored file');
  if(mode==='git'){assert.equal(git(['rev-parse','HEAD']),fail?oldHead:next.commit);assert.equal(git(['status','--porcelain']),'');}
});
