$ErrorActionPreference = 'Stop'
$taskName = 'BentanCodexPanel'
$workspace = Split-Path $PSScriptRoot -Parent
$startScript = Join-Path $PSScriptRoot 'start-codex-panel.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $workspace '.worktrees/codex-panel/.git'))) { throw 'Codex dedicated worktree is not ready.' }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Arguments -notlike '*start-codex-panel.ps1*')) { throw 'A different task already uses this name.' }
$shellExecutable = (Get-Process -Id $PID).Path
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -WindowStyle Hidden -File "' + $startScript + '"'
$action = New-ScheduledTaskAction -Execute $shellExecutable -Argument $arguments -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '勉たん内の工藤専用Codexチャット接続。外部待受ポートなし。' -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName $taskName
