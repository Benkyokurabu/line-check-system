[CmdletBinding()]
param(
  [ValidateSet('Start', 'Run', 'Status', 'Install')]
  [string] $Action = 'Status',
  [Parameter(Mandatory = $true)]
  [string] $Root,
  [string] $CliPath = (Join-Path $PSScriptRoot 'knowledge-intake.mjs'),
  [int] $MaxLogBytes = 1048576,
  [int] $LogCopies = 5
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required for the knowledge watcher service.' }
$workspace = (Get-Item -LiteralPath $Root).FullName.TrimEnd('\', '/')
$cli = (Get-Item -LiteralPath $CliPath).FullName
$scriptFile = $PSCommandPath
$node = (Get-Command node.exe -ErrorAction Stop).Source
$hostExecutable = (Get-Process -Id $PID).Path
if ($MaxLogBytes -lt 1024 -or $LogCopies -lt 1 -or $LogCopies -gt 20) { throw 'Invalid log rotation settings.' }
foreach ($value in @($workspace, $cli, $scriptFile, $hostExecutable, $node)) {
  if ($value -match '["\r\n]') { throw 'Paths must not contain quotes or control characters.' }
}
$runtime = Join-Path $workspace '資料集約\知識基盤\runtime'
$stateFile = Join-Path $runtime 'watch-state.json'
$logFile = Join-Path $runtime 'watch.log'
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($workspace.ToLowerInvariant())))).Replace('-', '').Substring(0, 16) }
finally { $sha.Dispose() }
$taskName = "BentanKnowledgeWatch-$identity"
$runArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptFile + '" -Action Run -Root "' + $workspace + '" -CliPath "' + $cli + '"'

function Get-WatchStatus {
  if (-not (Test-Path -LiteralPath $stateFile)) { return @{ running = $false; taskName = $taskName } }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $runner = Get-Process -Id $state.runnerPid -ErrorAction SilentlyContinue
  $running = $runner -and $runner.StartTime.ToUniversalTime().Ticks -eq ([DateTime] $state.runnerStartedAt).ToUniversalTime().Ticks
  $child = if ($state.childPid) { Get-Process -Id $state.childPid -ErrorAction SilentlyContinue } else { $null }
  return @{ running = [bool] $running; childRunning = [bool] ($running -and $child -and $child.StartTime.ToUniversalTime().Ticks -eq ([DateTime] $state.childStartedAt).ToUniversalTime().Ticks);
    runnerPid = $state.runnerPid; childPid = $state.childPid; heartbeat = $state.heartbeat; taskName = $taskName; log = $logFile }
}

if ($Action -eq 'Status') { Get-WatchStatus | ConvertTo-Json -Compress; exit 0 }
if ($Action -eq 'Start') {
  $status = Get-WatchStatus
  if (-not $status.running) {
    Start-Process -FilePath $hostExecutable -ArgumentList $runArguments -WindowStyle Hidden -WorkingDirectory $workspace | Out-Null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      Start-Sleep -Milliseconds 250
      $status = Get-WatchStatus
      if ($status.running -and $status.childRunning) { break }
    }
  }
  $status | ConvertTo-Json -Compress
  if (-not $status.running) { exit 1 }
  exit 0
}
if ($Action -eq 'Install') {
  # This action registers one dedicated task and never overwrites any existing task.
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.Actions.Count -ne 1 -or $existing.Actions[0].Execute -ne $hostExecutable -or $existing.Actions[0].Arguments -ne $runArguments) {
      throw 'A task with this name already exists with different settings; it was not changed.'
    }
    @{ installed = $true; changed = $false; taskName = $taskName } | ConvertTo-Json -Compress
    exit 0
  }
  $userName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $taskAction = New-ScheduledTaskAction -Execute $hostExecutable -Argument $runArguments -WorkingDirectory $workspace
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
  $principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description '勉たんの知識受信フォルダを監視。本文はログへ出さず、原文と未確認知識をローカルへ保存。' | Out-Null
  @{ installed = $true; changed = $true; taskName = $taskName } | ConvertTo-Json -Compress
  exit 0
}

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
# The stream lock works across sessions and remains held for the entire runner lifetime.
$lockStream = $null
try { $lockStream = [IO.File]::Open((Join-Path $runtime '.watch-process.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch [IO.IOException] { exit 0 }
$mutex = New-Object Threading.Mutex($false, "Local\BentanKnowledgeWatch-$identity")
$ownsMutex = $false
$childProcess = $null
$utf8 = New-Object Text.UTF8Encoding($false)

function Write-WatchLog([string] $Message) {
  if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -ge $MaxLogBytes) {
    $oldest = "$logFile.$LogCopies"
    if (Test-Path -LiteralPath $oldest) { Remove-Item -LiteralPath $oldest }
    for ($copy = $LogCopies - 1; $copy -ge 1; $copy--) {
      $from = "$logFile.$copy"
      if (Test-Path -LiteralPath $from) { Move-Item -LiteralPath $from -Destination "$logFile.$($copy + 1)" }
    }
    Move-Item -LiteralPath $logFile -Destination "$logFile.1"
  }
  [IO.File]::AppendAllText($logFile, ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine), $utf8)
}
function Write-State {
  $state = @{ runnerPid = $PID; runnerStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');
    childPid = if ($childProcess -and -not $childProcess.HasExited) { $childProcess.Id } else { $null };
    childStartedAt = if ($childProcess -and -not $childProcess.HasExited) { $childProcess.StartTime.ToUniversalTime().ToString('o') } else { $null };
    heartbeat = [DateTime]::UtcNow.ToString('o') }
  $temporary = "$stateFile.$PID.tmp"
  [IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Compress), $utf8)
  [IO.File]::Move($temporary, $stateFile, $true)
}

try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { exit 0 }
  Write-WatchLog 'runner started; original text is excluded from logs'
  while ($true) {
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $node
    $startInfo.Arguments = '"' + $cli + '" watch --root "' + $workspace + '"'
    $startInfo.WorkingDirectory = $workspace
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = $utf8
    $startInfo.StandardErrorEncoding = $utf8
    $childProcess = New-Object Diagnostics.Process
    $childProcess.StartInfo = $startInfo
    [void] $childProcess.Start()
    Write-WatchLog 'intake watcher started'
    Write-State
    $outputRead = $childProcess.StandardOutput.ReadLineAsync()
    $errorRead = $childProcess.StandardError.ReadLineAsync()
    $buffer = New-Object Text.StringBuilder
    $heartbeatAt = [DateTime]::UtcNow
    while (-not $childProcess.HasExited) {
      if ($outputRead -and $outputRead.IsCompleted) {
        $line = $outputRead.Result
        if ($null -ne $line) {
          [void] $buffer.AppendLine($line)
          if ($line -eq '}') {
            try {
              $report = $buffer.ToString() | ConvertFrom-Json
              Write-WatchLog ("scan imported={0} duplicate={1} errors={2}" -f [int] $report.imported, [int] $report.duplicates, [int] $report.errors)
            } catch { Write-WatchLog 'intake output format changed; content suppressed' }
            [void] $buffer.Clear()
          }
          if ($buffer.Length -gt 1048576) { [void] $buffer.Clear(); Write-WatchLog 'oversized intake output suppressed' }
          $outputRead = $childProcess.StandardOutput.ReadLineAsync()
        } else { $outputRead = $null }
      }
      if ($errorRead -and $errorRead.IsCompleted) {
        if ($null -ne $errorRead.Result) { Write-WatchLog 'intake reported an error; run once for local diagnosis'; $errorRead = $childProcess.StandardError.ReadLineAsync() }
        else { $errorRead = $null }
      }
      if (([DateTime]::UtcNow - $heartbeatAt).TotalSeconds -ge 30) { Write-State; $heartbeatAt = [DateTime]::UtcNow }
      Start-Sleep -Milliseconds 100
    }
    Write-WatchLog ("intake exited code={0}; restart in 15 seconds" -f $childProcess.ExitCode)
    $childProcess.Dispose(); $childProcess = $null; Write-State
    Start-Sleep -Seconds 15
  }
} catch {
  Write-WatchLog ('runner failed: ' + $_.Exception.GetType().Name + '; source content suppressed')
  throw 'Knowledge watcher stopped; check local status and locks.'
} finally {
  if ($childProcess -and -not $childProcess.HasExited) { $childProcess.Kill() }
  if ($childProcess) { $childProcess.Dispose() }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose(); $lockStream.Dispose()
}
