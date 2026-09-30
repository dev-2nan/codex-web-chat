import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodexUpdater, npmInstallation } from '../lib/codex-updater.mjs';

function fixture(overrides={}) {
  const data=mkdtempSync(path.join(tmpdir(),'codex-cli-updater-'));
  const root=path.join(data,'node_modules/@openai/codex');mkdirSync(path.join(root,'bin'),{recursive:true});
  const bin=path.join(root,'bin/codex.js');writeFileSync(bin,'');
  const packageVersion=version=>writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@openai/codex',version}));
  packageVersion('0.100.0');
  let time=100000,latest='0.101.0',calls=0,busy=false;
  const events=[];
  const options={data,bin,isBusy:()=>busy,disconnect:async()=>events.push('disconnect'),reconnect:async()=>events.push('reconnect'),
    installation:()=>({...npmInstallation(bin),npm:path.join(data,'npm-cli.js')}),now:()=>time,
    fetchFn:async()=>{calls++;return {ok:true,json:async()=>({name:'@openai/codex',version:latest})};},
    run:async(command,args)=>{if(args[1]==='root')return {stdout:path.join(data,'node_modules')};if(args[1]==='--version')return {stdout:'codex-cli '+latest};events.push(args);packageVersion(latest);return {stdout:''};},...overrides};
  const updater=createCodexUpdater(options);
  return {updater,options,events,bin,packageVersion,calls:()=>calls,tick:()=>time+=86400001,latest:v=>latest=v,busy:v=>busy=v};
}

test('CLI checks are daily, stable-only and independent of saved skip choices',async()=>{
  const f=fixture();let s=await f.updater.check();assert.equal(s.available,true);assert.equal(s.currentVersion,'0.100.0');
  await f.updater.check();await f.updater.check(true);assert.equal(f.calls(),1);
  f.updater.dismiss('session','0.101.0');assert.equal(f.updater.state().dismissed,true);
  assert.equal(createCodexUpdater(f.options).state().dismissed,false);
  f.updater.dismiss('version','0.101.0');assert.equal(createCodexUpdater(f.options).state().dismissed,true);
  f.latest('0.102.0');f.tick();s=await f.updater.check();assert.equal(s.dismissed,false);assert.equal(s.latestVersion,'0.102.0');
  f.latest('0.103.0-beta.1');f.tick();s=await f.updater.check();assert.equal(s.latestVersion,'0.102.0');assert.ok(s.error);
});

test('offline and disabled checks preserve the installed CLI and never start an installer',async()=>{
  const f=fixture({fetchFn:async()=>{throw new Error('offline');}});
  assert.match((await f.updater.check()).error,/offline/);assert.deepEqual(f.events,[]);
  const disabled=createCodexUpdater({...f.options,enabled:false});await disabled.check();
  await assert.rejects(disabled.install('0.101.0'),/비활성화/);
});

test('concurrent version checks share a request and both return usable state',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.updater.check(),f.updater.check(true)]);
  assert.equal(a.latestVersion,'0.101.0');assert.equal(b.latestVersion,'0.101.0');assert.equal(f.calls(),1);
});

test('installation rejects busy work, unknown versions, command injection and stale UI choices',async()=>{
  const f=fixture();await f.updater.check();f.busy(true);
  await assert.rejects(f.updater.install('0.101.0'),/진행 중/);f.busy(false);
  for(const version of ['latest','0.102.0','0.101.0; whoami',null])await assert.rejects(f.updater.install(version),/새 버전/);
  assert.throws(()=>f.updater.dismiss('version','0.102.0'),/다시 확인/);assert.deepEqual(f.events,[]);
});

test('installation locks before yielding, pins the checked npm version and reconnects after verification',async()=>{
  const f=fixture();await f.updater.check();
  const operation=f.updater.install('0.101.0');assert.equal(f.updater.locked(),true);
  await assert.rejects(f.updater.install('0.101.0'),/진행 중/);
  const s=await operation;assert.equal(s.status.phase,'complete');assert.equal(s.currentVersion,'0.101.0');assert.equal(s.available,false);assert.equal(f.updater.locked(),false);
  assert.equal(f.events[0],'disconnect');assert.equal(f.events[2],'reconnect');
  assert.ok(f.events[1].includes('@openai/codex@0.101.0'));assert.ok(f.events[1].includes('--ignore-scripts'));
  assert.equal(f.events[1][f.events[1].indexOf('--prefix')+1],f.options.data);
});

test('a different npm root never disconnects or replaces the running CLI',async()=>{
  const f=fixture({run:async()=>({stdout:tmpdir()})});await f.updater.check();
  const s=await f.updater.install('0.101.0');assert.equal(s.status.phase,'failed');assert.deepEqual(f.events,[]);assert.equal(s.currentVersion,'0.100.0');
});

test('failed installation attempts reconnect and keeps npm credentials out of the UI',async()=>{
  const f=fixture();const original=f.options.run;
  const u=createCodexUpdater({...f.options,run:async(c,args)=>{if(args[1]==='root')return original(c,args);throw new Error('secret-token');}});
  await u.check();const s=await u.install('0.101.0');assert.equal(s.status.phase,'failed');assert.doesNotMatch(JSON.stringify(s),/secret-token/);
  assert.deepEqual(f.events,['disconnect','reconnect']);assert.equal(u.locked(),false);
});

test('version verification and failed reconnection cannot report successful installation',async()=>{
  const f=fixture();const original=f.options.run;
  const u=createCodexUpdater({...f.options,run:async(c,args)=>args[1]==='root'?original(c,args):{stdout:''}});
  await u.check();assert.equal((await u.install('0.101.0')).status.phase,'failed');
  const broken=createCodexUpdater({...f.options,reconnect:async()=>{throw new Error('offline');}});
  assert.equal((await broken.install('0.101.0')).status.phase,'failed');assert.equal(broken.locked(),false);
});

test('unknown CLI distributions are not treated as a managed npm installation',()=>{
  assert.equal(npmInstallation('missing-file'),null);
  const f=fixture();assert.equal(npmInstallation(f.bin).version,'0.100.0');
  writeFileSync(path.join(path.dirname(path.dirname(f.bin)),'package.json'),JSON.stringify({name:'other',version:'0.100.0'}));
  assert.equal(npmInstallation(f.bin),null);
});

test('npm success with an old native binary cannot report successful installation',async()=>{
  const f=fixture();const original=f.options.run;
  const u=createCodexUpdater({...f.options,run:async(c,args)=>args[1]==='--version'?{stdout:'codex-cli 0.100.0'}:original(c,args)});
  await u.check();assert.equal((await u.install('0.101.0')).status.phase,'failed');assert.equal(f.events.at(-1),'reconnect');
});
