export function installCodexUpdateUI({ api, onUpdated }) {
  const entry = document.createElement('button');
  entry.className = 'update-entry'; entry.type = 'button'; entry.textContent = 'Codex CLI 업데이트';
  document.querySelector('.sidebar-bottom').append(entry);
  const banner = document.createElement('div'); banner.className = 'release-banner'; banner.hidden = true; banner.setAttribute('role', 'status');
  const label = document.createElement('span'), view = document.createElement('button'); view.textContent = '확인';
  banner.append(label, view); document.querySelector('.composer-area').prepend(banner);
  const dialog = document.createElement('dialog'); dialog.className = 'update-dialog'; dialog.setAttribute('aria-labelledby', 'codexUpdateTitle');
  dialog.innerHTML = `<div class="update-heading"><span class="update-symbol">↻</span><button type="button" data-close aria-label="Codex 업데이트 창 닫기">×</button></div><h2 id="codexUpdateTitle">Codex CLI 업데이트</h2><p data-version class="update-version"></p><p data-message role="status"></p><progress data-progress aria-label="Codex 업데이트 진행 중" hidden></progress><p data-detail class="update-detail"></p><div class="update-actions"><button type="button" data-check>버전 확인</button><button type="button" data-install>지금 업데이트</button><button type="button" data-session>이번 실행 건너뛰기</button><button type="button" data-skip>이 버전 건너뛰기</button></div><small class="update-footnote">이 PC에서 웹챗이 사용하는 Codex CLI를 업데이트합니다. 설치 후 연결과 모델 목록을 갱신합니다. 터미널의 건너뛰기 설정과는 별도로 저장됩니다.</small>`;
  document.body.append(dialog);
  const el = key => dialog.querySelector('[data-' + key + ']');
  let data, pending = false, timer, polling = false, completed = null;
  const draft = () => !!document.getElementById('prompt')?.value.trim() || !!document.getElementById('attachments')?.children.length;
  function render() {
    if (!data) return;
    const working = data.installing || pending;
    entry.textContent = `Codex ${data.currentVersion || 'CLI'}${data.available ? ' · 새 버전' : ''}`;
    entry.classList.toggle('has-update', data.available);
    el('version').textContent = `현재 ${data.currentVersion || '확인 불가'}${data.latestVersion ? ' → 정식 ' + data.latestVersion : ''}`;
    el('message').textContent = data.error || data.status?.message || (!data.enabled ? 'Codex 업데이트 확인이 꺼져 있습니다.' : data.available ? '새 Codex 버전을 설치할 수 있습니다.' : data.latestVersion ? '사용 중인 버전보다 새로운 정식 버전이 없습니다.' : 'Codex 최신 버전을 확인해 주세요.');
    el('detail').textContent = working ? '창을 닫아도 설치는 계속됩니다.' : data.busy ? '진행 중인 대화·승인·로그인·업데이트를 먼저 마쳐 주세요.' : draft() ? '입력 중인 메시지와 첨부 파일을 먼저 보내거나 비워 주세요.' : !data.canInstall ? 'npm 경로를 확인하지 못했습니다. 터미널에서 npm.cmd install -g @openai/codex로 업데이트한 뒤 웹챗 서버를 다시 시작해 주세요.' : '이번 실행 건너뛰기는 웹 서버 재시작까지, 이 버전 건너뛰기는 다음 정식 버전이 나올 때까지 알림을 숨깁니다.';
    el('progress').hidden = !data.installing;
    el('check').disabled = working || data.checking || !data.enabled;
    el('install').hidden = !data.available; el('install').disabled = working || data.checking || data.busy || draft() || !data.canInstall || !data.enabled;
    for (const key of ['session', 'skip']) { el(key).hidden = !data.available; el(key).disabled = working; }
    banner.hidden = !data.available || data.dismissed || working;
    label.textContent = `Codex ${data.latestVersion} 업데이트가 있습니다`;
  }
  async function action(route, body) {
    pending = true; render();
    try { data = await api('/api/codex-update/' + route, body); }
    catch (e) { if (data) data.error = e.message; }
    finally { pending = false; render(); poll(); }
  }
  function open() { render(); if (!dialog.open) dialog.showModal(); poll(); }
  entry.onclick = view.onclick = open;
  el('close').onclick = () => dialog.close();
  el('check').onclick = () => action('check', {});
  el('install').onclick = () => { if (!draft()) action('install', { version: data.latestVersion }); };
  el('session').onclick = () => action('dismiss', { action: 'session', version: data.latestVersion });
  el('skip').onclick = () => action('dismiss', { action: 'version', version: data.latestVersion });
  async function poll() {
    clearTimeout(timer);
    if (polling) return;
    polling = true;
    try {
      data = await api('/api/codex-update'); render();
      if (data.status?.phase === 'complete' && completed !== data.currentVersion) { completed = data.currentVersion; await onUpdated(); }
    } catch { /* Keep the last state while the web server reconnects. */ }
    finally { polling = false; timer = setTimeout(poll, data?.installing || dialog.open ? 2000 : 30000); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  document.getElementById('prompt').addEventListener('input', render);
  poll();
}
