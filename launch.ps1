$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$address = 'http://127.0.0.1:43127'
try {
    $mutex = New-Object System.Threading.Mutex($false, 'Local\CodexWebChatLauncher43127')
    $locked = $mutex.WaitOne(30000)
    if (-not $locked) { throw 'Another launcher is still starting. Please try again.' }
    try {
        $running = $false
        try { $health = Invoke-RestMethod "$address/health" -TimeoutSec 2; $running = $health.app -eq 'codex-web-chat' } catch { }
        if ($running) {
            $expectedVersion = (Get-Content -LiteralPath (Join-Path $projectPath 'package.json') -Raw | ConvertFrom-Json).version
            if ($health.version -ne $expectedVersion) {
                Add-Type -AssemblyName PresentationFramework
                $state = Invoke-RestMethod "$address/api/state" -TimeoutSec 3
                if ($state.chats | Where-Object { $_.active }) {
                    [System.Windows.MessageBox]::Show('새 버전이 준비되었습니다. 진행 중인 작업을 마치거나 웹 화면에서 중지한 뒤 바로가기를 다시 열어 주세요.', 'Codex 업데이트') | Out-Null
                } else {
                    $serverPath = Join-Path $projectPath 'server.mjs'
                    if ([IO.Path]::GetFullPath($state.cwd) -ne [IO.Path]::GetFullPath($projectPath)) { throw 'This port belongs to another project. Close that server before opening this project.' }
                    $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 43127 -State Listen -ErrorAction Stop)
                    if ($listeners.Count -ne 1) { throw 'Could not identify the running web server safely.' }
                    $serverProcessId = $listeners[0].OwningProcess
                    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
                    $serverPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($serverPath) + '"?(?:\s|$)'
                    if ($serverProcess.Name -ne 'node.exe' -or $serverProcess.CommandLine -notmatch $serverPattern) { throw 'The listening process is not this project web server.' }
                    $answer = [System.Windows.MessageBox]::Show('새 버전을 적용하려면 Codex 웹 서버를 다시 시작해야 합니다. 저장된 대화는 유지됩니다. 지금 적용할까요?', 'Codex 업데이트', 'YesNo', 'Question', 'No')
                    if ($answer -eq 'Yes') {
                        $state = Invoke-RestMethod "$address/api/state" -TimeoutSec 3
                        if ($state.chats | Where-Object { $_.active }) { throw 'A conversation has started. Stop it in the web UI and reopen the shortcut to update.' }
                        Stop-Process -Id $serverProcessId -ErrorAction Stop
                        Wait-Process -Id $serverProcessId -Timeout 10 -ErrorAction SilentlyContinue
                        $running = $false
                    }
                }
            }
        }
        if (-not $running) {
            $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
            $logPath = Join-Path $projectPath '.data'
            New-Item -ItemType Directory -Path $logPath -Force | Out-Null
            $serverPath = Join-Path $projectPath 'server.mjs'
            $process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'server.log') -RedirectStandardError (Join-Path $logPath 'server-error.log') -PassThru
            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                Start-Sleep -Milliseconds 250
                try { $health = Invoke-RestMethod "$address/health" -TimeoutSec 1; if ($health.app -eq 'codex-web-chat') { $running = $true; break } } catch { }
                if ($process.HasExited) { break }
            }
            if (-not $running) { throw 'Codex Web could not start. See .data/server-error.log in the project folder.' }
        }
    } finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
    Start-Process $address
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Codex Web') | Out-Null
}
