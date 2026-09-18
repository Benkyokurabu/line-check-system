$ErrorActionPreference = 'Stop'
$taskName = 'BentanCodexPanel'
$workspace = Split-Path $PSScriptRoot -Parent
$startScript = Join-Path $PSScriptRoot 'start-codex-panel.ps1'
$hiddenLauncher = Join-Path $PSScriptRoot 'start-codex-panel-hidden.vbs'
if (-not (Test-Path -LiteralPath (Join-Path $workspace '.worktrees/codex-panel/.git'))) { throw 'Codex dedicated worktree is not ready.' }
if (-not (Test-Path -LiteralPath $hiddenLauncher)) { throw "Hidden launcher is missing: $hiddenLauncher" }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and (($existing.Actions.Arguments -notlike '*start-codex-panel.ps1*') -and ($existing.Actions.Arguments -notlike '*start-codex-panel-hidden.vbs*'))) { throw 'A different task already uses this name.' }
$wscriptExecutable = Join-Path $env:SystemRoot 'System32\wscript.exe'
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '//B //NoLogo "' + $hiddenLauncher + '"'
$action = New-ScheduledTaskAction -Execute $wscriptExecutable -Argument $arguments -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Bentan private Codex queue for Kudo. No listening ports.' -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName $taskName
