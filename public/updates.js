export function installUpdateUI({api}) {
  const $=id=>document.getElementById(id);
  const button=document.createElement('button');button.className='update-entry';button.id='updateEntry';button.type='button';button.textContent='↻ 업데이트';document.querySelector('.sidebar-bottom').append(button);
  const banner=document.createElement('div');banner.className='release-banner';banner.hidden=true;banner.setAttribute('role','status');
  const label=document.createElement('span'),view=document.createElement('button'),later=document.createElement('button');view.textContent='자세히';later.textContent='나중에';banner.append(label,view,later);document.querySelector('.composer-area').prepend(banner);
  const dialog=document.createElement('dialog');dialog.className='update-dialog';dialog.setAttribute('aria-labelledby','updateTitle');
  dialog.innerHTML=`<div class="update-heading"><span class="update-symbol">↻</span><button type="button" id="closeUpdate" aria-label="업데이트 창 닫기">×</button></div><p class="eyebrow">KEEP YOUR WORKSPACE FRESH</p><h2 id="updateTitle">더 좋아진 작업 공간</h2><p id="updateVersion" class="update-version"></p><p id="updateMessage" role="status"></p><progress id="updateProgress" aria-label="업데이트 진행 중" hidden></progress><p id="updateDetail" class="update-detail"></p><details id="releaseDetails"><summary>이번 버전의 변경 사항</summary><pre id="releaseNotes"></pre><a id="releaseLink" target="_blank" rel="noopener noreferrer">GitHub에서 보기 ↗</a></details><div class="update-actions"><button type="button" id="checkUpdate">업데이트 확인</button><button type="button" id="installUpdate">설치하고 다시 시작</button></div><small class="update-footnote">대화와 첨부 파일은 이 PC에 그대로 보관됩니다.</small>`;
  document.body.append(dialog);
  let data=null,installing=false,checking=false,requestPending=false,startedAt=0,startVersion=null,pollTimer;
  const active=new Set(['downloading','preparing','installing','restarting','rollback']);
  const hasDraft=()=>!!$('prompt')?.value.trim()||!!$('attachments')?.children.length;
  function render() {
    if(!data)return;
    const working=installing||active.has(data.status?.phase),v=data.release?.version;
    button.textContent=`↻ v${data.currentVersion}${data.available?' · 새 업데이트':''}`;button.classList.toggle('has-update',data.available);
    $('updateVersion').textContent=`현재 v${data.currentVersion}${v?` → 정식 v${v}`:''}`;
    $('updateMessage').textContent=working?(data.status?.message||'서버가 다시 연결되기를 기다리고 있습니다…'):data.status?.phase==='failed'?data.status.message:data.error||(!data.enabled?'자동 업데이트가 꺼져 있습니다.':data.available?'새 버전을 설치할 수 있습니다.':data.release?'최신 정식 버전을 사용하고 있습니다.':'발행된 정식 릴리스가 아직 없습니다.');
    $('updateProgress').hidden=!working;
    $('updateDetail').textContent=working?'창을 닫아도 설치는 계속됩니다.':data.busy?'진행 중인 대화·승인·로그인을 먼저 마쳐 주세요.':hasDraft()?'입력 중인 메시지와 첨부 파일을 먼저 보내거나 비워 주세요.':data.mode==='unmanaged'?'자동 설치를 위해 공식 ZIP 또는 Git으로 설치해 주세요.':data.available&&!data.release.installable?'검증 가능한 설치 파일을 준비 중입니다. 나중에 다시 확인해 주세요.':data.checkedAt?`마지막 확인 · ${new Date(data.checkedAt).toLocaleString('ko-KR')} · 하루 한 번 자동 확인`:'';
    $('checkUpdate').disabled=working||checking||!data.enabled;$('checkUpdate').textContent=checking?'확인 중…':'업데이트 확인';
    $('installUpdate').hidden=!data.available;$('installUpdate').disabled=working||checking||data.busy||hasDraft()||!data.release?.installable||data.mode==='unmanaged'||!data.enabled;
    $('releaseDetails').hidden=!data.release;$('releaseNotes').textContent=data.release?.notes||'등록된 변경 사항이 없습니다.';if(data.release)$('releaseLink').href=data.release.url;
    banner.hidden=!data.available||localStorage.getItem('codex-update-later')===v||working;label.textContent=`✧ v${v} 업데이트가 준비됐어요`;
  }
  function open(){render();if(!dialog.open)dialog.showModal();poll();}
  button.onclick=view.onclick=open;later.onclick=()=>{localStorage.setItem('codex-update-later',data.release.version);render();};$('closeUpdate').onclick=()=>dialog.close();
  $('checkUpdate').onclick=async()=>{checking=true;render();try{data=await api('/api/update/check',{});}catch(e){data.error=e.message;}finally{checking=false;render();}};
  $('installUpdate').onclick=async()=>{
    if(hasDraft())return;installing=true;requestPending=true;startedAt=Date.now();startVersion=data.currentVersion;render();poll();
    try {await api('/api/update/install',{});}catch(e){installing=false;data.status={phase:'failed',message:e.message};render();}finally{requestPending=false;}
  };
  async function poll() {
    clearTimeout(pollTimer);
    try {
      const next=await api('/api/update');
      if(installing&&!requestPending&&['complete','failed'].includes(next.status?.phase)&&next.status.at>=startedAt) {
        installing=false;if(next.currentVersion!==startVersion){location.reload();return;}
      }
      data=next;render();
    }catch{if(installing)$('updateMessage').textContent='서버를 다시 시작하고 있습니다. 연결되면 화면이 새로고침됩니다…';}
    if(installing&&Date.now()-startedAt>300000){installing=false;$('updateMessage').textContent='설치 상태를 확인해 주세요. 연결이 돌아오지 않으면 바탕화면 바로가기를 다시 열어 주세요.';$('updateProgress').hidden=true;}
    pollTimer=setTimeout(poll,installing?1000:dialog.open?3000:30000);
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});poll();
}
