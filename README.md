# Codex Web Chat

**터미널 대신 브라우저에서 사용하는, 내 PC의 Codex 채팅 화면.**

A local web chat interface for Codex CLI, with per-chat model controls, context usage, and quota tracking. Built with Node.js and vanilla JavaScript, with no application dependencies or build step.

현재 UI는 한국어이며, **Windows에서 설치·로그인·바탕화면 실행까지 검증**했습니다. OpenAI의 공식 제품이 아닌 커뮤니티 프로젝트입니다.

## 주요 기능

- 실시간 응답, 새 대화, 이전 대화 이어가기, 응답 중지
- 대화별 **모델 / reasoning effort** 선택 및 저장 — 사이트에 맞춘 메뉴, 키보드 탐색
- 이미지·문서·코드 첨부, 이미지 미리보기, 드래그 앤 드롭·이미지 붙여넣기
- 상단 **컨텍스트 사용률 / 주간 잔여 한도**와 가로 진행 막대
- 사용량을 클릭하면 토큰 수·초기화 시각·새로고침 버튼 표시
- Codex의 작업 승인과 사용자 질문을 브라우저에서 처리
- 바탕화면 바로가기로 서버를 백그라운드에서 시작하고 브라우저 열기
- GitHub 정식 릴리스 자동 확인, 웹에서 설치·재시작, 시작 실패 시 이전 버전 복구
- 추가 npm 패키지, DB 서버, Docker, 프런트엔드 빌드 불필요

## 승인·질문·연결 문제 대응

Codex CLI **0.155.0의 App Server 프로토콜**을 기준으로 처리합니다. 모델이 보내는 구조화된 질문과 실제 승인 요청을 구분하며, 질문이나 승인을 자동 제출하지 않습니다.

| 상황 | 웹에서의 동작 |
| --- | --- |
| 대화 중 선택형·직접 입력 질문 (`agentMessage.questions`) | 답변 카드로 표시. 작업 중에는 진행 중인 턴에 전달하고, 작업이 끝났으면 다음 턴을 시작합니다. 답변 완료·건너뛰기 상태는 대화에 저장합니다. |
| 답변을 기다리는 질문 (`item/tool/requestUserInput`) | 선택 버튼, 설명, 허용된 직접 입력, 비밀 입력란, 답변 건너뛰기. `tool/requestUserInput` 별칭도 처리합니다. |
| 명령 실행·파일 수정 승인 | 요청 내용과 경로 표시. 이번만 허용 / 세션 동안 허용 / 거절 / 취소를 구분합니다. |
| 제안된 명령·네트워크 규칙 | 서버가 실제 제안한 규칙만 선택할 수 있습니다. 브라우저가 임의의 더 넓은 규칙을 전달할 수 없습니다. |
| 추가 네트워크·파일 권한 | 요청된 권한 종류를 직접 체크하고 현재 턴 또는 세션 범위로 허용합니다. 요청되지 않은 권한은 추가하지 않습니다. |
| MCP 입력 양식 | 표준 `form`의 문자열, 숫자, 정수, 불리언, 단일·복수 선택과 필수값·범위를 검증합니다. |
| MCP 외부 확인 URL | 주소 출처와 새 창 링크를 표시합니다. 사용자가 직접 확인 완료 / 거절 / 취소합니다. 자동으로 외부 페이지를 열거나 제출하지 않습니다. |
| 여러 요청·다른 대화·하위 에이전트 | 대화별로 구분하고 사이드바 확인 개수와 입력창 위 알림으로 표시합니다. 알려진 부모의 하위 대화도 목록에 나타납니다. |
| 스트리밍 중 질문 입력 | 입력값·선택·포커스를 유지합니다. 단, 브라우저를 수동 새로고침하면 **아직 전송하지 않은** 폼 입력값은 초기화됩니다. |
| 새로고침·여러 탭 | 아직 유효한 승인 요청을 다시 표시합니다. 먼저 처리된 요청의 중복 답변은 서버에서 거절합니다. |
| 중지·요청 해소·Codex 연결 종료 | 만료된 요청을 제거합니다. 프로세스 재시작 뒤 이전 요청 ID로 승인할 수 없습니다. |
| 자동 승인 검토·거절·경고·재시도 | 승인 검토 결과·이유, 경고, 재시도·오류 상태를 표시합니다. 계정·조직 정책을 우회하지 않습니다. |
| 로그인 필요·연결 장애 | 사이드바 **연결 관리**에서 연결 재확인, ChatGPT 로그인 링크 발급 및 로그인 취소를 제공합니다. 실제 로그인은 본인이 브라우저에서 완료합니다. |
| 도구 실행 실패·작업 결과 | 명령 출력, 파일 변경, 도구 결과, 계획, 공개 추론 요약 및 기타 작업 항목을 접을 수 있는 상세 보기로 표시합니다. |
| 구형 승인 요청 | `execCommandApproval`, `applyPatchApproval`의 기존 응답 형식을 구분해 처리합니다. |

**지원 범위의 한계:** 미래의 모든 Codex 기능까지 완전한 CLI 대체를 보장하지는 않습니다. 일반 텍스트의 번호·목록을 실제 권한 승인으로 추측해서 변환하지 않습니다. 구조화된 질문을 보내지 않는 구형 CLI나 일반 질문에는 채팅 입력창으로 답하세요.

다음 경우에는 실패 이유와 CLI/연결 도구에서 처리할 안내를 보여 주며 자동 승인하지 않습니다.

- 등록하지 않은 동적 도구 실행 (`item/tool/call`): 실패 결과를 반환해 대기가 계속되지 않게 합니다.
- 외부 클라이언트 관리 인증 토큰 갱신, 장치 attestation: 이 앱은 토큰 발급자·장치 인증기가 아닙니다. CLI 로그인 복구 또는 공식 클라이언트가 필요합니다.
- 확장 MCP `openai/form`, 중첩 객체 등 표준 범위 밖의 양식: 동의 버튼을 비활성화하고 거절·취소를 제공합니다. 확장 양식 수신 기능은 광고하지 않습니다.
- 대화형 터미널 프로그램의 직접 키 입력, 음성·실시간 세션, 원격 데스크톱 등: 전용 UI는 제공하지 않습니다. CLI나 해당 기능을 지원하는 클라이언트를 사용하세요.
- 알려지지 않은 서버 요청: 프로토콜 오류를 반환하고 화면에 요청 이름과 대안을 표시합니다.

승인 기록에는 요청 종류와 사용자의 결정만 저장하며, 비밀 입력 답변이나 MCP 폼 값을 별도 승인 기록으로 저장하지 않습니다. Codex 및 연결 서비스 자체의 기록 정책은 별도입니다. 승인 대기는 서버 메모리에 있으며, **웹 서버 재시작 후에는 재발행된 요청만 처리**할 수 있습니다.

구현 기준: [공식 App Server 문서](https://developers.openai.com/codex/app-server), 설치된 CLI에서 생성한 `ServerRequest` / `ThreadItem` 스키마. `test/interaction-scenarios.mjs`와 테스트의 모의 Codex는 실제 명령·권한 변경 없이 상호작용을 검증합니다.

## 이미지와 파일 첨부

입력창 왼쪽 클립 버튼으로 파일을 선택하거나, 화면에 파일을 끌어 놓으세요. 클립보드의 이미지는 입력창에 붙여넣을 수 있습니다. 전송 전 미리보기에서 ×를 누르면 첨부를 취소합니다. 파일만 첨부해서 보내는 것도 가능합니다.

- **용량:** 파일당 20 MB, 메시지당 합계 30 MB, 최대 10개.
- **이미지:** PNG, JPEG, WebP, GIF. 이미지 입력을 지원하는 선택 모델에 `localImage`로 전달합니다. 애니메이션 전체 프레임 분석은 보장하지 않습니다.
- **텍스트·코드:** TXT, Markdown, CSV/TSV, JSON/JSONL, YAML, XML, HTML/CSS, JS/TS, Python, Java, C/C++, C#, Go, Rust, SQL, 로그.
- **문서:** PDF, DOCX, XLSX, PPTX. 업로드한 로컬 경로를 Codex에 전달하고 Codex의 파일 읽기 도구로 분석합니다. ChatGPT 웹의 문서 처리 기능과 같지는 않습니다. 문서 형식·스캔 여부에 따라 Python, PDF/Office 파서나 OCR 도구가 추가로 필요할 수 있으며, 이 앱은 해당 도구를 설치하지 않습니다.

파일은 `.data/uploads/`에 저장되며 Git에서 제외됩니다. 초안에서 첨부를 취소해도 업로드된 파일은 디스크에 남습니다. 자동 정리는 없으므로 공간이 필요하면 서버 종료 후 보관할 파일을 백업하고 해당 업로드 폴더를 정리하세요. 삭제하면 이전 대화의 파일 링크도 사용할 수 없습니다. 모델에 보낸 이미지와 파일에서 읽은 내용은 Codex 서비스로 전송될 수 있습니다.

## 필요한 것

| 항목 | 요구사항 |
| --- | --- |
| 운영체제 | Windows. 바로가기·실행 스크립트는 Windows 전용입니다. macOS/Linux 설치는 검증하지 않았습니다. |
| Node.js + npm | Node.js **20.14 이상**. 새로 설치할 때는 [공식 사이트의 LTS](https://nodejs.org/en/download)를 사용하세요. npm도 함께 설치됩니다. |
| Codex CLI | **npm으로 설치한 `@openai/codex`**. `codex app-server`를 지원해야 합니다. 실제 연결 검증 버전은 **0.155.0**입니다. 독립 실행형 Codex만 설치했다면 아래 npm 설치도 필요합니다. |
| Codex 로그인 | 이 PC의 CLI에서 로그인해야 합니다. 권장 절차는 ChatGPT 로그인입니다. ChatGPT 웹사이트 로그인만으로는 CLI가 로그인되지 않습니다. |
| 계정 이용 권한 | Codex를 이용할 수 있는 계정과 남은 이용 한도가 필요합니다. 사용 가능한 모델과 한도는 계정에 따라 달라집니다. |
| Git | Git 설치에 필요합니다. [Git for Windows](https://git-scm.com/downloads/win). Git 없이 설치하려면 [최신 Releases](https://github.com/dev-2nan/codex-web-chat/releases/latest)의 **codex-web-chat-vX.Y.Z.zip**을 받으세요. Source code ZIP에는 자동 설치용 정보가 없습니다. |
| PowerShell | 바로가기 생성에 Windows PowerShell을 사용합니다. |
| 브라우저·인터넷 | 현대적인 브라우저와 Codex 서비스에 연결할 인터넷이 필요합니다. |

**ChatGPT 로그인 방식에서는 별도 OpenAI API 키가 필요하지 않습니다.** 이 앱이 무료 이용량을 추가로 제공하지는 않습니다. GitHub 계정과 `gh`는 앱 설치·실행에 필요하지 않습니다.

설치·인증 방식은 [공식 Codex CLI 문서](https://developers.openai.com/codex/cli)와 [인증 문서](https://developers.openai.com/codex/auth)를 참고하세요.

## AI에게 설치 맡기기

파일과 터미널을 다룰 수 있는 로컬 AI 코딩 도구에 아래 내용을 그대로 전달하세요. 일반 웹 채팅만으로는 PC에 직접 설치할 수 없습니다.

```text
내 Windows PC에 https://github.com/dev-2nan/codex-web-chat 을 설치해 줘.

저장소의 최신 README와 launch.ps1, install-shortcut.ps1을 먼저 읽고 진행해.
1. 운영체제, node --version, npm.cmd --version, git --version,
   codex.cmd --version, codex.cmd login status를 확인해.
2. Node.js 20.14 이상과 npm, Git이 없으면 공식 배포처에서 설치하고
   새 프로세스에서도 PATH가 적용되는지 확인해. 기존 설치는 불필요하게 바꾸지 마.
3. npm으로 설치한 @openai/codex가 없으면 npm.cmd install -g @openai/codex로 설치해.
   npm.cmd root -g 아래 @openai/codex/bin/codex.js가 존재하는지 확인해.
4. GitHub Releases의 최신 정식 버전을 확인하고, 내 사용자 폴더의 쓰기 가능한 위치에
   해당 vX.Y.Z 태그를 --branch vX.Y.Z 옵션으로 clone해. 임의의 개발 브랜치 대신 정식 버전을 사용해.
   Git 없이 설치한다면 Releases의 codex-web-chat-vX.Y.Z.zip과 SHA256SUMS.txt를 받고
   SHA-256을 대조한 뒤 새 폴더에 압축을 풀어. Source code ZIP은 사용하지 마.
   같은 폴더가 이미 있으면 기존 파일·대화 데이터를 덮어쓰지 말고 상태를 확인해.
5. CLI 로그인이 안 되어 있으면 codex.cmd login을 실행해.
   브라우저 로그인은 내가 직접 완료하도록 알려줘. 내 비밀번호나 인증 토큰을
   읽거나 복사하거나 Git에 저장하지 마.
6. 비표준 npm 설치 경로라면 README의 CODEX_WEB_CLI 설정을 적용해.
7. npm.cmd test를 실행해. 테스트에는 실제 계정이나 AI 호출이 필요하지 않아.
8. install-shortcut.ps1로 바탕화면 바로가기를 만들고 launch.ps1로 실행해.
   실행 정책 우회가 필요하면 README처럼 해당 프로세스에만 적용해.
9. http://127.0.0.1:43127/health의 app이 codex-web-chat인지 확인하고,
   브라우저에서 Codex 연결 상태와 모델 목록을 확인해.
   짧은 연결 테스트 메시지 한 번으로 실제 답변까지 확인해. 계정 한도를 소량 사용해도 돼.
10. 완료 후 설치 경로, 바로가기 이름, 실행 방법을 간단히 알려줘.

공개 서버로 배포하지 말고 이 PC에서만 실행해.
로그인·권한·네트워크 오류가 있으면 성공했다고 하지 말고 필요한 조치를 알려줘.
```

## 직접 설치하기 — Windows PowerShell

아래 명령은 PowerShell에서 실행합니다. `.cmd`를 사용하면 npm/Codex의 PowerShell 래퍼 실행 정책 문제를 피할 수 있습니다.

### 1. Node.js와 Git 준비

위의 공식 링크에서 설치한 뒤 **새 PowerShell 창**을 열어 확인합니다.

```powershell
node --version
npm.cmd --version
git --version
```

### 2. Codex 설치 및 로그인

```powershell
npm.cmd install -g @openai/codex
codex.cmd --version
codex.cmd login
codex.cmd login status
```

안내하는 브라우저에서 본인이 로그인합니다. 이미 로그인된 CLI가 있다면 다시 로그인할 필요가 없습니다. **Codex 데스크톱 앱은 필수 설치 항목이 아닙니다.**

### 3. 소스 내려받기

```powershell
$installParent = Join-Path $env:USERPROFILE 'source'
New-Item -ItemType Directory -Path $installParent -Force | Out-Null
Set-Location $installParent
git clone https://github.com/dev-2nan/codex-web-chat.git
Set-Location codex-web-chat
```

ZIP으로 받았다면 압축을 풀고 `package.json`이 있는 폴더에서 이후 명령을 실행하세요. ZIP 다운로드에는 Git이 필요 없지만 `git pull`로 업데이트할 수는 없습니다.

### 4. 검사하고 바로가기 만들기

```powershell
npm.cmd test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-shortcut.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launch.ps1
```

`ExecutionPolicy Bypass`는 위 프로세스에만 적용하며 컴퓨터의 영구 실행 정책을 변경하지 않습니다. 현재 앱에는 npm 의존성이 없어 **프로젝트에서 `npm install`을 할 필요가 없습니다.**

이후에는 바탕화면 **Codex 웹 대화**를 더블클릭하면 됩니다. 재부팅 후에도 같은 바로가기로 서버를 시작할 수 있습니다. 서버가 이미 실행 중이면 재사용합니다.

### 5. 연결 확인

```powershell
Invoke-RestMethod http://127.0.0.1:43127/health
```

`app: codex-web-chat`은 웹서버가 켜졌다는 뜻입니다. **실제 AI 연결 확인은 별도**로, 브라우저에서 `Codex 연결됨`과 모델 목록을 확인하고 짧은 메시지를 보내 보세요. 실제 메시지는 계정 이용 한도를 사용합니다. `npm test`는 모의 Codex를 사용하므로 한도를 소비하지 않습니다.

터미널에서 직접 실행하고 싶다면:

```powershell
npm.cmd start
```

터미널을 유지한 채 `http://127.0.0.1:43127`에 접속합니다. 종료는 **Ctrl+C**입니다. 바로가기로 실행한 서버는 브라우저 창을 닫아도 계속 실행됩니다.

## 사용 방법

- **Enter**: 전송 / **Shift+Enter**: 줄바꿈
- **새 대화 / 왼쪽 목록**: 새 대화 시작 / 기존 대화 이어가기
- **MODEL / EFFORT**: 대화별 설정. 변경은 다음 메시지부터 적용되며, 응답 중에는 잠깁니다.
- **컨텍스트**: 최근 모델 요청의 사용률. 클릭하면 토큰 수와 한도를 확인합니다. 누적 사용량과 다르며, 자동 압축 후 줄어들 수 있습니다.
- **주간 한도**: 계정 또는 모델 전용 잔여율. 클릭하면 초기화 시각과 `↻` 버튼을 확인합니다. 활성 화면에서 1분마다 갱신합니다.
- **중지**: 현재 응답·작업 중지 요청

서버에서 제공되지 않은 사용량은 `—`로 표시합니다. API 키 인증 등 일부 계정에서는 주간 한도가 없을 수 있습니다. 초기화 예정 시각이 지났다고 임의로 잔여량을 100%로 바꾸지는 않습니다.

## 설정과 비표준 설치 경로

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CODEX_WEB_CLI` | `%APPDATA%\npm\node_modules\@openai\codex\bin\codex.js` | npm Codex의 **`codex.js` 파일 경로**. `.exe`, `.cmd` 경로가 아닙니다. |
| `CODEX_WEB_DATA_DIR` | 프로젝트의 `.data` | 웹 대화 저장 폴더. 변경할 경우 절대 경로를 사용하세요. |
| `CODEX_WEB_PORT` | `43127` | `npm start` 직접 실행 시 사용할 포트. 현재 바탕화면 실행 스크립트는 기본 포트 전용입니다. |

Node 버전 관리자나 사용자 지정 npm prefix를 사용한다면 실제 설치 경로를 지정합니다.

```powershell
$npmGlobalRoot = (npm.cmd root -g).Trim()
$codexEntry = Join-Path $npmGlobalRoot '@openai\codex\bin\codex.js'
Test-Path -LiteralPath $codexEntry
$env:CODEX_WEB_CLI = $codexEntry
npm.cmd start
```

`Test-Path` 결과가 `True`여야 합니다. 바탕화면 바로가기에서도 같은 경로를 쓰려면 사용자 환경변수로 저장합니다.

```powershell
[Environment]::SetEnvironmentVariable('CODEX_WEB_CLI', $codexEntry, 'User')
```

Windows에서 새 환경변수가 탐색기에 반영되도록 로그아웃 후 다시 로그인하거나 PC를 재시작한 뒤 바로가기를 여세요. 이미 켜져 있는 서버에는 환경변수 변경이 적용되지 않습니다.

## 데이터와 작업 범위

```text
브라우저 → 내 PC의 Node.js 서버 → Codex CLI app-server → OpenAI 서비스
```

- **`127.0.0.1`에만 바인딩**합니다. 공개 인터넷 서버나 여러 사용자용 서비스로 설계하지 않았습니다.
- 웹서버가 로컬에서 실행되더라도 **AI 응답을 위한 대화와 작업 내용은 Codex 서비스를 통해 처리**됩니다. 오프라인 AI가 아닙니다.
- 작업 폴더는 이 저장소 폴더입니다. 현재 폴더 선택 UI는 없습니다. Codex가 요청에 따라 파일을 수정하거나 명령을 실행할 수 있습니다.
- 앱은 `workspace-write` / `on-request` 정책을 지정합니다. 기존 Codex 로그인·설정·지원되는 도구 설정을 사용합니다.
- 웹 대화 목록·내용·모델 선택·사용량: **`.data/chats.json`**
- 바로가기 실행 로그: **`.data/server.log`**, **`.data/server-error.log`**
- Codex 세션: Codex 자체 저장소, 기본 **`%USERPROFILE%\.codex\sessions`**. 사용자 설정에 따라 달라질 수 있습니다.
- 브라우저 저장소: 마지막 선택 대화 ID와 새 대화의 모델 설정
- ChatGPT 웹사이트의 대화와는 별개이며 자동 동기화되지 않습니다.

`.data`, `.protocol`, 인증 파일, 로그는 Git에 포함하지 않습니다. 다른 PC에 프로젝트만 clone하면 **새 대화로 시작**합니다. `.data`만 옮겨도 목록은 보일 수 있지만, 기존 대화를 이어가려면 해당 Codex 세션도 필요합니다. 자동 세션 이전 기능은 없습니다. 로그인 정보는 공유하지 말고 각 PC에서 본인 계정으로 로그인하세요.

## 문제 해결

| 증상 | 확인할 사항 |
| --- | --- |
| `node` / `npm.cmd` / `git`을 찾지 못함 | 설치 후 새 PowerShell 창을 열고 PATH를 확인하세요. |
| `codex.cmd`를 찾지 못함 | npm 전역 Codex 설치와 `npm.cmd prefix -g`의 PATH 등록 여부를 확인하세요. |
| Codex 설치 파일을 찾지 못함 | 위의 `npm.cmd root -g`와 `CODEX_WEB_CLI` 설정을 확인하세요. |
| Codex 로그인 필요 | `codex.cmd login` 후 `codex.cmd login status`를 확인하세요. |
| UI는 열리지만 응답 실패 | 로그인, 계정 한도, 인터넷, CLI 버전, 기존 Codex 설정의 필수 MCP 서버를 확인하세요. |
| `EADDRINUSE` / 실행 실패 | 43127 포트를 다른 프로그램이 쓰는지 확인하세요. 모르는 프로세스를 종료하지 마세요. 기본 바로가기는 다른 포트를 자동 선택하지 않습니다. |
| 주간 한도에 `—` 표시 | 계정에서 값이 제공되지 않거나 조회 실패한 경우입니다. 로그인과 상세 보기의 새로고침 버튼을 확인하세요. |
| 명령 실행·파일 수정 승인 대기 | 채팅의 승인 요청을 확인하세요. Windows sandbox 관련 오류는 Codex CLI에서 먼저 해결하세요. |
| 스크립트가 차단됨 | 위의 프로세스 한정 실행 명령을 사용하세요. 조직에서 강제한 정책은 관리자에게 문의하세요. |
| PC 이동 후 이전 대화 재개 실패 | 웹 기록과 Codex 세션은 별도입니다. 우선 새 대화로 연결을 확인하세요. |

빠른 진단:

```powershell
node --version
npm.cmd --version
codex.cmd --version
codex.cmd login status
Test-NetConnection 127.0.0.1 -Port 43127
Get-Content .\.data\server-error.log -Tail 30
```

오류 제보에는 OS·Node·CLI 버전과 재현 절차를 적어 주세요. 대화 내용, 토큰, 인증 파일은 공개 이슈에 붙이지 마세요.

## 업데이트

**v1.4.0부터 별도의 서버·도메인·GitHub 로그인 없이 업데이트할 수 있습니다.** 바탕화면 바로가기는 앱을 바로 열고, 로컬 웹 서버가 GitHub의 최신 정식 릴리스를 백그라운드에서 확인합니다. 서버가 켜져 있으면 하루 한 번 확인하며, 결과는 PC에 캐시합니다. 오프라인·GitHub 장애에도 기존 버전은 실행됩니다.

1. 새 버전이 있으면 입력창 위에 작은 안내가 표시됩니다. **나중에**를 누르면 해당 버전 안내만 숨깁니다.
2. 사이드바 **↻ v버전**을 누르면 현재/최신 버전과 변경 사항을 볼 수 있습니다. **업데이트 확인**으로 수동 조회할 수 있습니다. GitHub 호출은 최소 1분 간격으로 제한합니다.
3. 진행 중인 대화·승인·로그인을 마치고, 입력 중인 메시지와 첨부를 보내거나 비운 다음 **설치하고 다시 시작**을 누르세요.
4. 다운로드와 SHA-256 검증 → 로컬 수정 확인 → 설치 → 서버 시작 확인 순서로 진행합니다. 정상 연결되면 설치를 시작한 화면이 새로고침됩니다. 설치 중에는 새 작업을 받지 않습니다.

**설치 방식별 처리:**

- **Git clone:** 로컬 수정·추가 파일이 없고 현재 커밋이 릴리스의 조상인 경우에만, 공식 저장소의 릴리스 태그 커밋으로 `fast-forward`합니다. 수정 파일, 개발 커밋의 분기, 덮어쓰기 충돌은 자동으로 해결하지 않습니다. 기존 브랜치를 변경하지 않습니다.
- **Releases의 설치 ZIP:** `.release-manifest.json`과 현재 파일의 해시를 비교하여 직접 수정한 파일을 보호합니다. 기존 앱 파일을 `.data/updater/`에 백업한 뒤 교체합니다. ZIP 안의 이 숨김 이름 파일도 함께 유지하세요.
- **Source code ZIP / 임의 복사:** 자동 설치용 기준 정보가 없으므로 새 버전 안내만 표시합니다. 공식 설치 ZIP 또는 Git 설치로 이전해 주세요.

새 서버가 정상적으로 시작하지 못하면 이전 앱 버전으로 복구하여 다시 실행합니다. ZIP 백업과 설치 상태는 `.data/updater/`에 남으며 자동 삭제하지 않습니다. 디스크 고장·전원 강제 종료·외부에서 동시에 파일을 수정하는 경우까지 자동 복구를 보장하지 않습니다. 복구 확인이 필요하다는 안내가 나오면 해당 폴더의 `job.json` / `backup.json` / `status.json`과 서버 로그를 확인하세요. 향후 릴리스의 데이터 형식 변경은 이전 버전이 읽을 수 있도록 설계해야 합니다.

업데이트는 `.data`의 대화·첨부와 사용자 Codex 인증·설정을 교체하지 않습니다. **Codex CLI 업데이트는 아래의 별도 메뉴로 관리합니다.** 자동 확인을 끄려면 서버 실행 환경에 `CODEX_WEB_UPDATE_CHECK=0`을 설정하세요. GitHub에 보내는 정보는 공개 릴리스 조회·파일 다운로드 요청이며 대화 내용은 포함하지 않습니다.

### Codex CLI 자체 업데이트와 새 모델

v1.5부터 사이드바의 **Codex 버전** 메뉴에서 웹챗과 별도로 CLI를 관리합니다. 웹챗은 터미널 화면 대신 `codex app-server`에 연결하므로, 터미널에서 보던 업데이트 선택 화면을 그대로 표시하지 않습니다.

- **지금 업데이트:** 웹챗이 사용하는 npm 설치 경로를 확인하고 조회한 정식 버전을 설치합니다. 대화·승인·로그인·다른 업데이트가 진행 중이면 설치를 차단합니다. 설치 후 Codex에 다시 연결하고 모델 목록을 갱신합니다.
- **이번 실행 건너뛰기:** 웹 서버를 다시 시작할 때까지 해당 버전 알림을 숨깁니다. 브라우저 새로고침이나 다른 탭에도 유지됩니다.
- **이 버전 건너뛰기:** 같은 버전 알림을 계속 숨기고 다음 정식 버전부터 다시 표시합니다. 사이드바 메뉴에서는 숨긴 버전도 직접 설치할 수 있습니다.

최신 버전은 npm 공식 레지스트리에서 하루 한 번 확인하며, 수동 확인은 최소 1분 간격입니다. 조회 실패 시 기존 Codex로 계속 사용합니다. 버전 건너뛰기 선택은 `.data/codex-updater.json`에 저장되며 터미널의 건너뛰기 설정과 별개입니다. CLI 자동 확인만 끄려면 `CODEX_WEB_CODEX_UPDATE_CHECK=0`, 웹챗과 CLI 확인을 모두 끄려면 `CODEX_WEB_UPDATE_CHECK=0`을 설정합니다.

CLI 설치는 같은 npm 경로를 쓰는 터미널에도 적용됩니다. 다른 Codex 프로세스가 실행 파일을 사용 중이면 설치가 실패할 수 있습니다. 다른 터미널을 닫고 재시도하거나 `npm.cmd install -g @openai/codex`로 업데이트한 뒤 웹 서버를 재시작하세요. npm 경로를 확인할 수 없는 설치도 수동 업데이트를 안내합니다. **CLI 패키지 자동 롤백은 제공하지 않습니다.**

GPT-6.1-Sol 같은 새 모델은 계정의 `model/list` 결과에서 자동으로 나타납니다. 활성 화면에서는 1분마다 갱신하며 **연결 관리 → 연결 다시 확인** 또는 사용량의 **↻**로 즉시 재조회할 수 있습니다. 기존 대화의 모델 선택은 유지하므로 MODEL 메뉴에서 새 모델을 선택하세요. CLI 설정의 모델·추론 강도가 현재 목록에서 지원되지 않으면 사용 가능한 기본값으로 돌아갑니다.

### 기존 v1.3 이하에서 처음 전환

기존 버전에는 원격 업데이트 기능이 없으므로 **이번 한 번은 수동 업데이트**가 필요합니다.

- Git 설치는 기존 폴더에서 변경 사항을 보존하고 `git pull --ff-only`를 실행하세요.
- ZIP 설치는 새 설치 ZIP을 **새 폴더**에 풀고 서버를 종료한 상태에서 기존 `.data`를 복사한 다음, 새 경로의 `install-shortcut.ps1`을 실행하세요. 기존 폴더와 백업은 정상 연결 확인 전까지 보관하세요.
- 코드를 받은 뒤 **바탕화면 바로가기를 다시 열어 재시작 안내에 “예”**를 누르세요. 작업 중인 대화가 있으면 먼저 완료하거나 중지해야 합니다. 직접 실행한 서버는 Ctrl+C 후 다시 실행합니다. 웹 화면만 새로고침해서는 구형 서버에 업데이트 기능이 생기지 않습니다.

### 운영자가 새 버전 배포하기

일반 `main` 푸시만으로 사용자에게 배포하지 않습니다. 검증한 정식 버전을 태그로 발행합니다.

1. `package.json`의 버전을 올리고 `RELEASE_NOTES.md`를 해당 버전의 변경 사항으로 작성합니다.
2. `npm.cmd test`를 통과시킨 뒤 변경 사항을 커밋하고 `main`에 푸시합니다.
3. 아래처럼 **package.json과 같은 버전**의 태그를 푸시합니다.

```powershell
git tag v1.5.0
git push origin v1.5.0
```

`.github/workflows/release.yml`이 테스트 → 추적 중인 앱 파일만 패키징 → ZIP·업데이트 JSON·SHA256SUMS 업로드 → 정식 Release 공개를 수행합니다. 실패하면 공개하지 않으며, 업로드 실패로 남은 초안은 수정 후 처리해야 합니다. 릴리스마다 버전과 태그를 새로 만들고 이미 배포한 파일은 덮어쓰지 마세요. GitHub Actions의 Release 작업이 성공했는지 확인하세요. 사용자에게는 다음 자동 확인 또는 수동 확인 때 표시됩니다. 도메인·자체 서버는 소개/설치 안내 페이지가 필요할 때 선택적으로 사용하면 됩니다.

## 개발

개발 폴더에서는 기존처럼 `git pull --ff-only`, `npm.cmd test`, 서버 재시작을 사용할 수 있습니다. 개발 중 변경 사항이 있으면 웹 자동 설치가 중단되며, 자동으로 stash/reset하지 않습니다.

```text
server.mjs              HTTP 서버, Codex JSON-RPC 연결, 대화 저장
public/                 HTML / CSS / JavaScript / 아이콘
lib/telemetry.mjs       컨텍스트·한도 계산과 모델 선택 검증
lib/attachments.mjs     첨부 검증·저장·Codex 입력 변환
lib/interactions.mjs    승인·질문 응답 검증과 요청 수명 관리
lib/updater.mjs         릴리스 조회·검증·설치 준비
lib/codex-updater.mjs   Codex CLI 버전 조회·건너뛰기·npm 업데이트
lib/update-worker.mjs   서버 재시작·설치·복구
scripts/build-release.mjs  공개 배포 패키지 생성
launch.ps1              Windows 백그라운드 실행 및 브라우저 열기
install-shortcut.ps1    바탕화면 바로가기 생성
test/                   모의 Codex 기반 테스트 (실제 API 호출 없음)
```

```powershell
npm.cmd test
npm.cmd start
```

GitHub Actions에서 Windows / Node.js 20·22 테스트를 실행합니다. Codex app-server 프로토콜 변경에 따라 호환성 수정이 필요할 수 있습니다. 고급 기능의 지원 범위는 위 승인·질문 대응 표를 참고하세요. 다중 사용자 로그인과 ChatGPT 대화 가져오기는 현재 지원하지 않습니다.

## English quick start

Windows-first; Korean UI. Install Node.js >=20.14, Git, and the **npm distribution** of Codex CLI. Sign in with your own Codex-enabled account. No separate API key is required for ChatGPT sign-in; your account's usage limits apply.

```powershell
npm.cmd install -g @openai/codex
codex.cmd login
git clone https://github.com/dev-2nan/codex-web-chat.git
Set-Location codex-web-chat
npm.cmd test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-shortcut.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launch.ps1
```

For Git-free installation, download the versioned **codex-web-chat-vX.Y.Z.zip** asset from Releases (not Source code ZIP), verify SHA256SUMS, and keep `.release-manifest.json`. Starting with v1.4, updates are checked daily and installed from the sidebar version button. Active work and local modifications block installation; failed startup rolls back. Earlier versions need a one-time manual update and server restart.

Open `http://127.0.0.1:43127`. No application dependency installation or build step is needed. For custom npm locations, set `CODEX_WEB_CLI` to the full path to `@openai/codex/bin/codex.js`. macOS/Linux setup is unverified; the desktop launcher is Windows-only. Do not expose this personal local server to the Internet. Conversation history stays out of Git; inference still uses the Codex service.

## 라이선스

[MIT](LICENSE) — 자유롭게 사용·수정·재배포할 수 있습니다. Codex와 연결된 서비스 이용에는 해당 서비스의 조건이 별도로 적용됩니다.

연동 참고: [공식 Codex App Server 문서](https://developers.openai.com/codex/app-server).
