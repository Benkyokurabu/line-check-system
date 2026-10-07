$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  & python -m PyInstaller --onefile --noconsole --name BentanInterviewMaterials --distpath dist_daily --workpath build_daily --specpath build_daily helper.py
  if ($LASTEXITCODE -ne 0) { throw '面談資料アプリの作成に失敗しました。' }
  $target = Join-Path $PSScriptRoot 'dist_daily\BentanInterviewMaterials.exe'
  if (-not (Test-Path -LiteralPath $target)) { throw '配布用の実行ファイルが見つかりません。' }
  & python (Join-Path $PSScriptRoot 'verify-built-exe.py') $target
  if ($LASTEXITCODE -ne 0) { throw 'Release source verification failed.' }
  Get-FileHash -LiteralPath $target -Algorithm SHA256
} finally { Pop-Location }
