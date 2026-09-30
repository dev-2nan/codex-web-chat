import { existsSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { newer } from './update-package.mjs';

const exec = promisify(execFile);
const readJSON = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const stable = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
const fail = message => Object.assign(new Error(message), { statusCode: 409 });
const registry = 'https://registry.npmjs.org';

// Resolve the npm installation that owns this web chat's CLI, not another npm on PATH.
export function npmInstallation(bin, platform = process.platform) {
  try {
    const entry = realpathSync(bin);
    const root = path.dirname(path.dirname(entry));
    const pkg = readJSON(path.join(root, 'package.json'));
    if (pkg?.name !== '@openai/codex' || !stable(pkg.version) || path.basename(entry) !== 'codex.js') return null;
    const modules = path.dirname(path.dirname(root));
    if (path.basename(modules) !== 'node_modules') return null;
    const parent = path.dirname(modules);
    const prefix = platform !== 'win32' && path.basename(parent) === 'lib' ? path.dirname(parent) : parent;
    const candidates = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      path.join(modules, 'npm/bin/npm-cli.js'), path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
    return { root, prefix, version: pkg.version, npm: candidates.find(existsSync) || null };
  } catch { return null; }
}

export function createCodexUpdater({ data, bin, isBusy, disconnect, reconnect, changed = () => {},
  enabled = true, fetchFn = fetch, installation = () => npmInstallation(bin), run = exec, now = Date.now }) {
  const file = path.join(data, 'codex-updater.json');
  let cache = readJSON(file) || {}, sessionSkip = null, checking = null, installing = false, status = null, error = null;
  let attemptedAt = 0;
  const save = () => { writeFileSync(file + '.tmp', JSON.stringify(cache)); renameSync(file + '.tmp', file); };
  function state() {
    const local = installation();
    const available = !!local && stable(cache.latestVersion) && newer(cache.latestVersion, local.version);
    return { currentVersion: local?.version || null, latestVersion: cache.latestVersion || null, checkedAt: cache.checkedAt || null,
      enabled, available, dismissed: available && (sessionSkip === cache.latestVersion || cache.skippedVersion === cache.latestVersion),
      canInstall: !!local?.npm, busy: !!isBusy(), checking: !!checking, installing, status, error };
  }
  function setStatus(phase, message) { status = { phase, message }; changed(); }
  async function check(force = false) {
    if (checking) { await checking; return state(); }
    if (!enabled || installing || (attemptedAt && now() - attemptedAt < 60000) || (!force && cache.checkedAt && now() - cache.checkedAt < 86400000)) return state();
    attemptedAt = now();
    checking = (async () => {
      try {
        const response = await fetchFn(registry + '/@openai%2fcodex/latest', { signal: AbortSignal.timeout(10000), redirect: 'error' });
        if (!response.ok) throw new Error('npm 버전 조회 실패 (' + response.status + ')');
        const pkg = await response.json();
        if (pkg.name !== '@openai/codex' || !stable(pkg.version)) throw new Error('Codex 정식 버전 정보를 확인하지 못했습니다.');
        cache = { ...cache, latestVersion: pkg.version, checkedAt: now() }; save(); error = null;
      } catch (e) { error = e.message; }
    })();
    try { await checking; } finally { checking = null; changed(); }
    return state();
  }
  function dismiss(action, version) {
    if (!['session', 'version'].includes(action) || !state().available || version !== cache.latestVersion) throw fail('새 버전 정보를 다시 확인해 주세요.');
    if (action === 'session') sessionSkip = version;
    else { cache.skippedVersion = version; save(); }
    changed(); return state();
  }
  async function install(version) {
    if (!enabled) throw fail('Codex 업데이트가 비활성화되어 있습니다.');
    if (installing || checking || isBusy()) throw fail('진행 중인 대화·승인·로그인·업데이트를 먼저 마쳐 주세요.');
    const local = installation();
    if (!local?.npm) throw fail('npm 설치 경로를 확인하지 못했습니다. 터미널에서 Codex를 업데이트해 주세요.');
    if (!stable(version) || version !== cache.latestVersion || !newer(version, local.version)) throw fail('설치할 새 버전을 다시 확인해 주세요.');
    installing = true; error = null; setStatus('installing', 'Codex 업데이트를 준비하고 있습니다…');
    let disconnected = false;
    try {
      const options = { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 };
      const result = await run(process.execPath, [local.npm, 'root', '-g', '--prefix', local.prefix], options);
      if (realpathSync(path.join(result.stdout.trim(), '@openai/codex')) !== realpathSync(local.root)) throw fail('웹챗이 사용하는 Codex와 npm 설치 경로가 다릅니다.');
      await disconnect(); disconnected = true;
      setStatus('installing', `Codex ${version}을 설치하고 있습니다…`);
      await run(process.execPath, [local.npm, 'install', '-g', '--prefix', local.prefix, '@openai/codex@' + version,
        '--registry=' + registry, '--ignore-scripts', '--no-audit', '--no-fund'], options);
      if (installation()?.version !== version) throw fail('설치 후 Codex 버전을 확인하지 못했습니다.');
      const binary = await run(process.execPath, [bin, '--version'], options);
      if (binary.stdout.trim() !== 'codex-cli ' + version) throw fail('실행 중인 Codex 바이너리의 버전이 설치 대상과 다릅니다.');
      setStatus('reconnecting', '새 Codex에 연결하고 모델 목록을 갱신합니다…');
      await reconnect(); disconnected = false;
      setStatus('complete', `Codex ${version} 업데이트와 재연결을 완료했습니다.`);
    } catch (e) {
      // npm errors can include configuration or registry credentials; expose only a fixed recovery message.
      error = 'Codex 업데이트를 완료하지 못했습니다. 다른 Codex 터미널을 닫고 다시 시도하거나, 터미널에서 npm.cmd install -g @openai/codex를 실행해 주세요.';
      if (disconnected) { try { await reconnect(); } catch { error += ' Codex 연결도 복구되지 않았습니다.'; } }
      setStatus('failed', error);
    } finally { installing = false; changed(); }
    return state();
  }
  return { state, check, dismiss, install, locked: () => installing };
}
