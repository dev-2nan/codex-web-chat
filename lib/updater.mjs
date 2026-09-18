import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { REPO, MAX_PACKAGE, newer, validateBundle, checkManaged, manifestName } from './update-package.mjs';

const exec=promisify(execFile);
const headers={Accept:'application/vnd.github+json','User-Agent':'codex-web-chat-updater','X-GitHub-Api-Version':'2022-11-28'};
const readJSON=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return null;}};
const error=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const activePhases=new Set(['downloading','preparing','installing','restarting','rollback']);
export function createUpdater({root,data,port,version,isBusy,shutdown,changed=()=>{},fetchFn=fetch,enabled=true}) {
  const directory=path.join(data,'updater');mkdirSync(directory,{recursive:true});
  const cacheFile=path.join(directory,'check.json'),statusFile=path.join(directory,'status.json');
  let cache=readJSON(cacheFile)||{},operation=null,checking=null,maintenance=false,localStatus=null;
  const mode=existsSync(path.join(root,'.git'))?'git':existsSync(path.join(root,manifestName))?'release':'unmanaged';
  const git=async args=>(await exec('git',['-C',root,...args],{windowsHide:true,timeout:120000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();
  function writeStatus(phase,message) {localStatus={phase,message,at:Date.now(),pid:process.pid};writeFileSync(statusFile+'.tmp',JSON.stringify(localStatus));renameSync(statusFile+'.tmp',statusFile);changed();}
  function getStatus() {
    const status=readJSON(statusFile)||localStatus;
    if(status&&activePhases.has(status.phase)) {
      let alive=true;try{process.kill(status.pid,0);}catch{alive=false;}
      if(!alive)return {...status,phase:'failed',message:'업데이트가 중단되었습니다. 설치 폴더와 .data/updater의 백업을 확인해 주세요.'};
    }
    return status;
  }
  function locked() {return maintenance || (!!process.env.CODEX_WEB_UPDATE_PROBE&&activePhases.has(getStatus()?.phase));}
  function state() {
    const release=cache.release,available=!!release&&newer(release.version,version);
    return {currentVersion:version,available,mode,enabled,checking:!!checking,checkedAt:cache.checkedAt||null,error:cache.error||null,
      release:release?{version:release.version,url:release.url,notes:release.notes,installable:!!release.asset}:null,
      status:getStatus(),busy:isBusy(),maintenance:locked()};
  }
  async function check(force=false) {
    if(!enabled||operation)return state();
    if(checking){await checking;return state();}
    if(Date.now()-(cache.checkedAt||0)<(force?60000:86400000))return state();
    checking=(async()=>{
      try {
        const res=await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`,{headers,signal:AbortSignal.timeout(10000)});
        if(res.status===404) {cache.release=null;cache.error=null;}
        else {
          if(!res.ok)throw new Error(res.status===403||res.status===429?'GitHub 조회 한도에 도달했습니다. 나중에 다시 확인해 주세요.':`GitHub 연결 실패 (${res.status})`);
          const release=JSON.parse(await limitedBytes(res,1024*1024));
          if(release.draft||release.prerelease||!/^v\d+\.\d+\.\d+$/.test(release.tag_name))throw new Error('정식 릴리스 정보를 확인할 수 없습니다.');
          const v=release.tag_name.slice(1),name=`codex-web-chat-v${v}.update.json`;
          const asset=release.assets?.find(a=>a.name===name&&a.state==='uploaded'&&a.size>0&&a.size<=MAX_PACKAGE&&/^sha256:[a-f0-9]{64}$/.test(a.digest||'')&&a.browser_download_url===`https://github.com/${REPO}/releases/download/v${v}/${name}`);
          cache.release={version:v,url:`https://github.com/${REPO}/releases/tag/v${v}`,notes:String(release.body||'').slice(0,20000),asset:asset?{url:asset.browser_download_url,digest:asset.digest}:null};cache.error=null;
        }
      } catch(e) {cache.error=e.message;}
      cache.checkedAt=Date.now();writeFileSync(cacheFile,JSON.stringify(cache));
    })().finally(()=>{checking=null;changed();});
    await checking;return state();
  }
  async function prepare() {
    if(!enabled)throw error('업데이트가 비활성화되어 있습니다.');
    if(operation||locked())throw error('업데이트를 진행 중입니다.');
    if(isBusy())throw error('진행 중인 대화·승인·로그인을 마친 후 업데이트해 주세요.');
    const release=cache.release;
    if(!release||!newer(release.version,version)||!release.asset)throw error('설치할 정식 업데이트 패키지가 없습니다. 먼저 업데이트를 확인해 주세요.');
    if(mode==='unmanaged')throw error('공식 릴리스 ZIP 또는 Git으로 설치한 폴더에서 업데이트할 수 있습니다.');
    maintenance=true;writeStatus('downloading','업데이트를 다운로드하고 있습니다…');
    operation=(async()=>{
      const id=randomUUID(),jobDirectory=path.join(directory,id);mkdirSync(jobDirectory);
      const job={id,directory:jobDirectory,root,data:path.resolve(data),port,origin:`http://127.0.0.1:${port}`,mode,oldVersion:version,version:release.version,parentPid:process.pid,digest:release.asset.digest};
      const response=await fetchFn(release.asset.url,{signal:AbortSignal.timeout(60000),headers:{'User-Agent':headers['User-Agent']}});
      if(!response.ok)throw new Error(`다운로드 실패 (${response.status})`);
      const bytes=await limitedBytes(response,MAX_PACKAGE),bundle=validateBundle(bytes,release.version,release.asset.digest);job.commit=bundle.commit;
      job.packageFile=path.join(jobDirectory,'package.json');writeFileSync(job.packageFile,bytes);
      writeStatus('preparing','설치 파일과 로컬 변경 사항을 확인하고 있습니다…');
      if(mode==='git') {
        if(await git(['status','--porcelain']))throw new Error('로컬 수정·추가 파일이 있습니다. 변경 사항을 보존한 뒤 업데이트해 주세요.');
        job.oldHead=await git(['rev-parse','HEAD']);
        await git(['fetch','--no-tags',`https://github.com/${REPO}.git`,`refs/tags/v${release.version}`]);
        if(await git(['rev-parse','FETCH_HEAD^{commit}'])!==bundle.commit)throw new Error('릴리스 태그와 패키지의 커밋이 다릅니다.');
        await git(['merge-base','--is-ancestor',job.oldHead,bundle.commit]).catch(()=>{throw new Error('개발 커밋이 분기되어 있습니다. Git에서 변경 사항을 정리한 뒤 업데이트해 주세요.');});
      } else checkManaged(root,bundle);
      // An in-flight request could have started before maintenance was set.
      if(isBusy())throw new Error('진행 중인 요청이 있어 설치를 취소했습니다. 다시 시도해 주세요.');
      for(const name of ['update-worker.mjs','update-package.mjs'])copyFileSync(path.join(root,'lib',name),path.join(jobDirectory,name));
      const jobFile=path.join(jobDirectory,'job.json');writeFileSync(jobFile,JSON.stringify(job));
      const worker=spawn(process.execPath,[path.join(jobDirectory,'update-worker.mjs'),jobFile],{cwd:root,windowsHide:true,detached:true,stdio:['ignore','ignore','ignore','ipc']});
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('업데이트 도우미 준비 시간이 초과되었습니다.')),15000);
        worker.once('error',e=>{clearTimeout(timer);reject(e);});worker.once('exit',()=>{clearTimeout(timer);reject(new Error('업데이트 도우미가 종료되었습니다.'));});
        worker.once('message',m=>{clearTimeout(timer);m.ready?resolve():reject(new Error(m.error||'업데이트 준비 실패'));});
      });
      return ()=>{
        const fail=message=>{maintenance=false;operation=null;writeStatus('failed',message);};
        const timer=setTimeout(()=>fail('업데이트 도우미가 응답하지 않았습니다. 다시 시도해 주세요.'),15000);
        worker.once('message',m=>{clearTimeout(timer);if(m.starting){worker.unref();shutdown();}else fail(m.error||'설치를 시작하지 못했습니다.');});
        worker.send('go',err=>{if(err){clearTimeout(timer);fail(err.message);}});
      };
    })();
    try {return await operation;} catch(e){maintenance=false;operation=null;writeStatus('failed',e.message);throw e;}
  }
  return {state,check,prepare,locked};
}
export async function limitedBytes(response,max) {
  const chunks=[];let size=0;
  for await(const chunk of response.body) {size+=chunk.length;if(size>max)throw new Error('다운로드 크기가 허용 범위를 넘었습니다.');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
