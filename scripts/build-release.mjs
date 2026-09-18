import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { hash, validPath, bundleManifest } from '../lib/update-package.mjs';

const root=process.cwd(), pkg=JSON.parse(readFileSync('package.json','utf8'));
execFileSync('git',['diff','--quiet']);execFileSync('git',['diff','--cached','--quiet']);
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(validPath).map(name=>{
  if(lstatSync(path.join(root,name)).isSymbolicLink())throw new Error('Release files must not be symlinks: '+name);
  const bytes=readFileSync(path.join(root,name));return {path:name,sha256:hash(bytes),data:bytes.toString('base64')};
});
const bundle={schema:1,version:pkg.version,commit,files};
const output=path.join(root,'dist');mkdirSync(output,{recursive:true});
const filename=`codex-web-chat-v${pkg.version}.update.json`;
const bytes=Buffer.from(JSON.stringify(bundle));writeFileSync(path.join(output,filename),bytes);
writeFileSync(path.join(output,'SHA256SUMS.txt'),`${hash(bytes)}  ${filename}\n`);
const install=path.join(output,'codex-web-chat');mkdirSync(install,{recursive:true});
for(const file of files) {const target=path.join(install,file.path);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,Buffer.from(file.data,'base64'));}
writeFileSync(path.join(install,'.release-manifest.json'),JSON.stringify(bundleManifest(bundle)));
console.log(`Built ${filename} (${bytes.length} bytes), commit ${commit}`);
