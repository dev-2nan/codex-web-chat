import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const REPO = 'dev-2nan/codex-web-chat';
export const MAX_PACKAGE = 24 * 1024 * 1024;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const manifestName = '.release-manifest.json';
export function newer(a, b) {
  if (![a,b].every(v => /^\d+\.\d+\.\d+$/.test(v))) return false;
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  for(let i=0;i<3;i++) if(left[i]!==right[i]) return left[i]>right[i];
  return false;
}
export function validPath(name) {
  return typeof name==='string' && !name.split('/').some(p=>!p||p==='.'||p==='..'||p.endsWith('.')||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p)) &&
    /^(package\.json|server\.mjs|README\.md|RELEASE_NOTES\.md|LICENSE|launch\.ps1|install-shortcut\.ps1|(?:lib|public|test|scripts)\/[a-zA-Z0-9_./-]+)$/.test(name);
}
export function safePath(root, name) {
  if(!validPath(name) && name!==manifestName) throw new Error('허용되지 않은 업데이트 파일: '+name);
  let current=path.resolve(root);
  if(lstatSync(current).isSymbolicLink()) throw new Error('링크된 설치 폴더는 자동 업데이트할 수 없습니다.');
  for(const part of name.split('/')) {
    current=path.join(current,part);
    if(existsSync(current)&&lstatSync(current).isSymbolicLink()) throw new Error('링크된 파일은 자동 업데이트할 수 없습니다: '+name);
  }
  return current;
}
export function validateBundle(bytes, version, digest) {
  if(bytes.length>MAX_PACKAGE || !/^sha256:[a-f0-9]{64}$/.test(digest||'') || 'sha256:'+hash(bytes)!==digest) throw new Error('다운로드 파일의 SHA-256 검증에 실패했습니다.');
  const bundle=JSON.parse(bytes);
  if(bundle.schema!==1||bundle.version!==version||!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{40}$/.test(bundle.commit)||!Array.isArray(bundle.files)||bundle.files.length>500) throw new Error('지원하지 않는 업데이트 패키지입니다.');
  const seen=new Set();
  for(const file of bundle.files) {
    if(!validPath(file.path)||seen.has(file.path.toLowerCase())||typeof file.data!=='string'||hash(Buffer.from(file.data,'base64'))!==file.sha256) throw new Error('패키지 파일 검증 실패: '+file.path);
    seen.add(file.path.toLowerCase());
  }
  if(!seen.has('server.mjs')||!seen.has('package.json')) throw new Error('필수 실행 파일이 없습니다.');
  const pkg=JSON.parse(Buffer.from(bundle.files.find(f=>f.path==='package.json').data,'base64'));
  if(pkg.name!=='codex-web-chat'||pkg.version!==version) throw new Error('패키지 버전이 일치하지 않습니다.');
  return bundle;
}
export function bundleManifest(bundle) { return {schema:1,version:bundle.version,files:bundle.files.map(({path,sha256})=>({path,sha256}))}; }
export function checkManaged(root, bundle) {
  const file=safePath(root,manifestName);
  if(!existsSync(file)) throw new Error('관리형 ZIP 설치 정보가 없습니다. 공식 릴리스 ZIP을 새 폴더에 설치하거나 Git 설치를 사용해 주세요.');
  const previous=JSON.parse(readFileSync(file,'utf8'));
  if(previous.schema!==1||!Array.isArray(previous.files)) throw new Error('설치 정보가 올바르지 않습니다.');
  const old=new Map(previous.files.map(f=>[f.path,f]));
  for(const f of previous.files) {
    const local=safePath(root,f.path);
    if(!existsSync(local)||hash(readFileSync(local))!==f.sha256) throw new Error('직접 수정한 파일이 있어 업데이트를 중단했습니다: '+f.path);
  }
  for(const f of bundle.files) if(!old.has(f.path)&&existsSync(safePath(root,f.path))) throw new Error('기존 파일과 충돌합니다: '+f.path);
  return previous;
}
export function snapshotManaged(root, bundle) {
  const previous=checkManaged(root,bundle);
  return [...new Set([...previous.files.map(f=>f.path),...bundle.files.map(f=>f.path),manifestName])].map(name=>{
    const file=safePath(root,name);
    return {path:name,data:existsSync(file)?readFileSync(file).toString('base64'):null};
  });
}
export function applyManaged(root,bundle,previous) {
  for(const f of bundle.files) { const dest=safePath(root,f.path);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,Buffer.from(f.data,'base64')); }
  const next=new Set(bundle.files.map(f=>f.path));
  for(const f of previous.files) if(!next.has(f.path)) unlinkSync(safePath(root,f.path));
  writeFileSync(safePath(root,manifestName),JSON.stringify(bundleManifest(bundle)));
}
export function restoreManaged(root,snapshot) {
  for(const f of snapshot) {
    const dest=safePath(root,f.path);
    if(f.data===null) { if(existsSync(dest)) unlinkSync(dest); }
    else {mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,Buffer.from(f.data,'base64'));}
  }
}
