$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'BentanInterviewMaterials.exe'
if (-not (Test-Path -LiteralPath $source)) { throw 'BentanInterviewMaterials.exe が見つかりません。配布フォルダから実行してください。' }
$target = Join-Path $env:LOCALAPPDATA 'BentanInterviewMaterials'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$destination = Join-Path $target 'BentanInterviewMaterials.exe'
Get-Process -Name 'BentanInterviewMaterials' -ErrorAction SilentlyContinue | Stop-Process -Force
Copy-Item -LiteralPath $source -Destination $destination -Force
foreach ($name in @('sources.txt', 'guide-path.txt', 'export-guide.ps1')) {
  $file = Join-Path $PSScriptRoot $name
  if (-not (Test-Path -LiteralPath $file)) { throw "$name が見つかりません。" }
  Copy-Item -LiteralPath $file -Destination (Join-Path $target $name) -Force
}
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Set-ItemProperty -Path $runKey -Name 'BentanInterviewMaterials' -Value ('"' + $destination + '"')
Start-Process -FilePath $destination -WindowStyle Hidden
for ($attempt = 0; $attempt -lt 6; $attempt++) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:38473/health' -TimeoutSec 3
    if ($health.ready) { Write-Output '面談資料アプリの設置・自動起動を確認しました。'; exit 0 }
  } catch { }
}
throw 'アプリを設置しましたが、起動を確認できませんでした。'
