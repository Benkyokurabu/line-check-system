param(
  [switch] $Uninstall
)

$ErrorActionPreference = "Stop"
$taskName = "BenTan LINE Registration Sync Helper"
$projectRoot = Split-Path -Parent $PSScriptRoot
$helperScript = Join-Path $PSScriptRoot "line-manager-sync-helper.mjs"
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "同期ヘルパーの自動起動を解除しました。"
  exit 0
}

if (-not (Test-Path -LiteralPath $helperScript)) {
  throw "同期ヘルパーが見つかりません: $helperScript"
}

$action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"{0}"' -f $helperScript) -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "LINE公式アカウントの登録名を勉たんへ安全に同期するローカルヘルパー" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "同期ヘルパーを自動起動に登録し、起動しました。"
