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
