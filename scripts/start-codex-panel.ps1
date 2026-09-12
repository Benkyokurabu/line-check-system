$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $workspace
$logDirectory = Join-Path $workspace 'analysis_outputs/codex-panel'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$workerScript = Join-Path $PSScriptRoot 'codex-panel-worker.mjs'
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
while ($true) {
  & $nodeExecutable $workerScript 2>&1 | Out-File -LiteralPath (Join-Path $logDirectory 'worker.log') -Append -Encoding utf8
  Start-Sleep -Seconds 15
}
