$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $workspace
$logDirectory = Join-Path $workspace 'analysis_outputs/info-summary'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$workerScript = Join-Path $PSScriptRoot 'interview-info-summary-worker.mjs'
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
while ($true) {
  try {
    $ErrorActionPreference = 'Continue'
    & $nodeExecutable $workerScript 2>&1 | Out-File -LiteralPath (Join-Path $logDirectory 'worker.log') -Append -Encoding utf8
  } finally {
    $ErrorActionPreference = 'Stop'
  }
  Start-Sleep -Seconds 15
}
