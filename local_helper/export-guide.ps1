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
  # Read values directly: Excel Find may miss rows hidden by a saved filter.
  # End(xlUp) also skips filtered rows; UsedRange includes every populated row.
  $used = $db.UsedRange
  $lastRow = [int]($used.Row + $used.Rows.Count - 1)
  if ($lastRow -lt 2) { throw 'Student number not found in the guide workbook.' }
  $numbers = $db.Range('A1:A' + $lastRow).Value2
  $matchingRows = @()
  for ($row = 2; $row -le $lastRow; $row++) {
    if (([string]$numbers.GetValue($row, 1)).Trim() -eq $StudentNumber) { $matchingRows += $row }
  }
  if ($matchingRows.Count -ne 1) { throw 'Student number must match exactly one guide row.' }
  $name = [string]$db.Cells.Item([int]$matchingRows[0], 2).Value2
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
