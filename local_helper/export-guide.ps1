param(
  [Parameter(Mandatory=$true)][string]$StudentNumber,
  [Parameter(Mandatory=$true)][string]$StudentName,
  [Parameter(Mandatory=$true)][string]$MasterPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
if ($StudentNumber -notmatch '^\d{5,12}$') { throw 'Invalid student number.' }
if ($MasterPath -notmatch '^\\\\TS3210\\benko\\' -or [System.IO.Path]::GetExtension($MasterPath) -ne '.xlsm') { throw 'Invalid guide path.' }
$copy = Join-Path ([System.IO.Path]::GetDirectoryName($OutputPath)) 'guide-source.xlsm'
Copy-Item -LiteralPath $MasterPath -Destination $copy -ErrorAction Stop
$excel = $null
$book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AutomationSecurity = 3
  $book = $excel.Workbooks.Open($copy, 0, $true)
  $sheet = $book.Worksheets.Item('出力_指導簿')
  $sheet.Range('A3').Value2 = '学籍番号検索'
  $sheet.Range('A10').Value2 = $StudentNumber
  $excel.CalculateFull()
  $selected = [string]$sheet.Range('C3').Value2
  $db = $book.Worksheets.Item('DB_氏名学籍番号')
  $found = $db.Columns.Item(1).Find($StudentNumber)
  if (-not $found -or [string]$found.Value2 -ne $StudentNumber) { throw 'Student number not found in the guide workbook.' }
  $name = [string]$db.Cells.Item($found.Row, 2).Value2
  $actual = ($name.Normalize([Text.NormalizationForm]::FormKC) -replace '[\s　]', '')
  $expected = ($StudentName.Normalize([Text.NormalizationForm]::FormKC) -replace '[\s　]', '')
  if ($selected -ne $StudentNumber -or $actual -ne $expected -or -not $sheet.Range('F2').Value2) {
    throw 'Guide student number and name do not match.'
  }
  $sheet.ExportAsFixedFormat(0, $OutputPath)
  if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Guide PDF was not created.' }
} finally {
  if ($book) { $book.Close($false) }
  if ($excel) { $excel.Quit() }
  Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue
}
