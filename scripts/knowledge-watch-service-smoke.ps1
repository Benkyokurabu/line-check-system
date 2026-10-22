[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$hostExe = (Get-Process -Id $PID).Path
$service = Join-Path $PSScriptRoot 'knowledge-watch-service.ps1'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('bentan-watch-smoke-' + [Guid]::NewGuid().ToString('N'))
$runtime = Join-Path $scratch '資料集約\知識基盤\runtime'
$inbox = Join-Path $scratch '資料集約\知識受信'
$runner = $null
$state = $null
try {
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  New-Item -ItemType Directory -Path $inbox -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $scratch '.smoke-marker'), 'isolated knowledge watcher integration test')
  [IO.File]::WriteAllText((Join-Path $runtime 'watch.log'), ('x' * 1100))
  $sentinel = 'SMOKE_ORIGINAL_MUST_NOT_BE_LOGGED_' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText((Join-Path $inbox 'smoke.txt'), $sentinel, (New-Object Text.UTF8Encoding($false)))
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $service + '" -Action Run -Root "' + $scratch + '" -MaxLogBytes 1024 -LogCopies 2'
  $runner = Start-Process -FilePath $hostExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
  $records = Join-Path $scratch '資料集約\知識基盤\records.json'
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ((Test-Path -LiteralPath $records) -and (Test-Path -LiteralPath (Join-Path $runtime 'watch-state.json'))) { break }
  }
  if (-not (Test-Path -LiteralPath $records)) { throw 'Smoke watcher failed to save the isolated input.' }
  $state = Get-Content -LiteralPath (Join-Path $runtime 'watch-state.json') -Raw | ConvertFrom-Json
  $store = Get-Content -LiteralPath $records -Raw | ConvertFrom-Json
  if ($store.entries.Count -ne 1 -or $store.entries[0].revisions[0].body -ne $sentinel) { throw 'Smoke original did not match saved knowledge.' }
  Start-Sleep -Seconds 3
  $logs = Get-ChildItem -LiteralPath $runtime -Filter 'watch.log*'
  if (-not (Test-Path -LiteralPath (Join-Path $runtime 'watch.log.1'))) { throw 'Smoke rotation did not create a prior log.' }
  foreach ($log in $logs) { if ((Get-Content -LiteralPath $log.FullName -Raw).Contains($sentinel)) { throw 'Original appeared in smoke log.' } }
  $statusText = & $hostExe -NoProfile -File $service -Action Start -Root $scratch
  $status = $statusText | ConvertFrom-Json
  if (-not $status.running -or -not $status.childRunning -or $status.runnerPid -ne $runner.Id) { throw 'Smoke duplicate start or status check failed.' }
  [pscustomobject]@{ passed = $true; tests = @('hidden start', 'real intake', 'same runner on second start', 'body excluded from log', 'log rotation'); count = 5 } | ConvertTo-Json -Compress
} finally {
  if (-not $state -and (Test-Path -LiteralPath (Join-Path $runtime 'watch-state.json'))) { $state = Get-Content -LiteralPath (Join-Path $runtime 'watch-state.json') -Raw | ConvertFrom-Json }
  if ($state -and $state.childPid) {
    $ownedChild = Get-Process -Id $state.childPid -ErrorAction SilentlyContinue
    if ($ownedChild -and $ownedChild.ProcessName -eq 'node' -and $ownedChild.StartTime.ToUniversalTime().Ticks -eq ([DateTime] $state.childStartedAt).ToUniversalTime().Ticks) { Stop-Process -Id $ownedChild.Id -ErrorAction SilentlyContinue }
  }
  if ($runner -and -not $runner.HasExited) { Stop-Process -Id $runner.Id -ErrorAction SilentlyContinue; $runner.WaitForExit() }
  $resolvedScratch = [IO.Path]::GetFullPath($scratch)
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if ($resolvedScratch.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath (Join-Path $resolvedScratch '.smoke-marker'))) {
    Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
  }
}
