$ErrorActionPreference = 'Stop'
$taskName = 'BentanInterviewInfoSummary'
$workspace = Split-Path $PSScriptRoot -Parent
$startScript = Join-Path $PSScriptRoot 'start-interview-info-summary.ps1'
if (-not (Test-Path -LiteralPath $startScript)) { throw 'Summary worker start script is missing.' }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notlike '*start-interview-info-summary.ps1*') { throw 'A different task already uses this name.' }
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '"'
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Bentan interview information summary with ChatGPT account. No listening ports.' -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName $taskName
