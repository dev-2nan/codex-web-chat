// Copied to the private data directory before installation, so this code survives replacement.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateBundle, checkManaged, snapshotManaged, applyManaged, restoreManaged } from './update-package.mjs';

const exec=promisify(execFile);
const job=JSON.parse(readFileSync(process.argv[2],'utf8'));
const statusFile=path.join(job.data,'updater','status.json');
function status(phase,message) {
  writeFileSync(statusFile+'.tmp',JSON.stringify({phase,message,version:job.version,at:Date.now(),pid:process.pid}));renameSync(statusFile+'.tmp',statusFile);
}
const git=async args=>(await exec('git',['-C',job.root,...args],{windowsHide:true,timeout:120000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();
let launched, previous, snapshot, changed=false;
async function start(version) {
  const out=openSync(path.join(job.data,'server.log'),'a'),err=openSync(path.join(job.data,'server-error.log'),'a');
  const instance=job.id+'-'+version;
  launched=spawn(process.execPath,[path.join(job.root,'server.mjs')],{cwd:job.root,windowsHide:true,detached:true,stdio:['ignore',out,err],env:{...process.env,CODEX_WEB_DATA_DIR:job.data,CODEX_WEB_PORT:String(job.port),CODEX_WEB_UPDATE_PROBE:instance}});
  closeSync(out);closeSync(err);
  let spawnError;launched.on('error',e=>{spawnError=e;});
  let healthySince=0;
  for(let i=0;i<100;i++) {
    if(spawnError) throw spawnError;
    if(launched.exitCode!==null) throw new Error('새 서버가 시작 중 종료되었습니다.');
    try {
      const health=await (await fetch(job.origin+'/health',{signal:AbortSignal.timeout(700)})).json();
      if(health.version===version&&health.updateProbe===instance) {
        healthySince ||= Date.now();if(Date.now()-healthySince>1000) {launched.unref();return;}
      } else healthySince=0;
    } catch {healthySince=0;}
    await delay(200);
  }
  throw new Error('서버 시작 확인 시간이 초과되었습니다.');
}
async function stopLaunched() {
  if(launched&&launched.exitCode===null) {
    const exited=new Promise(resolve=>launched.once('exit',resolve));launched.kill();await Promise.race([exited,delay(5000)]);
    if(launched.exitCode===null) throw new Error('새 서버가 종료되지 않아 자동 복구를 중단했습니다.');
  }
}
try {
  const bytes=readFileSync(job.packageFile),bundle=validateBundle(bytes,job.version,job.digest);
  if(job.mode==='git') {
    if(await git(['status','--porcelain']) || await git(['rev-parse','HEAD'])!==job.oldHead) throw new Error('설치 폴더의 Git 상태가 변경되었습니다.');
  } else {previous=checkManaged(job.root,bundle);snapshot=snapshotManaged(job.root,bundle);writeFileSync(path.join(job.directory,'backup.json'),JSON.stringify(snapshot));}
  process.send?.({ready:true});
  // The parent explicitly authorizes replacement only after its HTTP response is sent.
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('서버 종료 준비 시간이 초과되었습니다.')),15000);
    process.once('message',m=>{clearTimeout(timer);m==='go'?resolve():reject(new Error('업데이트가 취소되었습니다.'));});
    process.once('disconnect',()=>{clearTimeout(timer);reject(new Error('서버가 설치를 시작하지 못했습니다.'));});
  });
  status('installing','서버를 다시 시작하고 있습니다…');
  process.send?.({starting:true});
  process.disconnect?.();
  for(let i=0;i<100;i++) {
    let alive=true;try {process.kill(job.parentPid,0);} catch {alive=false;}
    if(!alive) break;
    if(i===99) throw new Error('이전 서버가 종료되지 않았습니다.');
    await delay(100);
  }
  status('installing','파일을 설치하고 있습니다…');
  if(job.mode==='git') {
    if(await git(['status','--porcelain'])||await git(['rev-parse','HEAD'])!==job.oldHead) throw new Error('설치 직전 로컬 변경을 감지했습니다.');
    changed=true;await git(['-c','core.hooksPath='+job.directory,'merge','--ff-only','--no-edit','--no-overwrite-ignore',job.commit]);
  } else {checkManaged(job.root,bundle);changed=true;applyManaged(job.root,bundle,previous);}
  status('restarting','새 버전을 시작하고 있습니다…');
  await start(job.version);
  status('complete',`v${job.version} 업데이트를 완료했습니다.`);
} catch(e) {
  const reason=e.message;
  try {
    // If the original process is still alive, it owns the application; never start a duplicate.
    let parentAlive=true;try{process.kill(job.parentPid,0);}catch{parentAlive=false;}
    if(parentAlive) {status('failed',reason);process.send?.({error:reason});}
    else {
      status('rollback','이전 버전으로 복구하고 있습니다…');await stopLaunched();
      if(changed) {
        if(job.mode==='git') {
          const head=await git(['rev-parse','HEAD']);
          if(head===job.commit)await git(['reset','--keep',job.oldHead]);
          else if(head!==job.oldHead)throw new Error('Git HEAD가 변경되어 수동 복구가 필요합니다.');
        } else restoreManaged(job.root,snapshot);
      }
      await start(job.oldVersion);
      status('failed',`업데이트 실패 · 이전 버전으로 복구했습니다. ${reason}`);
    }
  } catch(rollbackError) {status('failed',`자동 복구 확인이 필요합니다. ${reason} / ${rollbackError.message}. 백업: ${job.directory}`);}
} finally {if(process.connected)process.disconnect();}
