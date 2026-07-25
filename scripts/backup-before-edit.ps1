param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string[]] $Path,

  [Parameter(Mandatory = $false)]
  [string] $Tag = "edit"
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$safeTag = ($Tag -replace "[^A-Za-z0-9_-]", "_").Trim("_")
if (-not $safeTag) {
  $safeTag = "edit"
}

foreach ($inputPath in $Path) {
  $item = Get-Item -LiteralPath $inputPath -ErrorAction Stop
  if ($item.PSIsContainer) {
    throw "Backup target must be a file: $inputPath"
  }

  $directory = $item.DirectoryName
  $name = $item.Name
  $extension = $item.Extension
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($name)

  if ($name.StartsWith(".") -and [string]::IsNullOrEmpty($baseName)) {
    $backupName = "$name.before_${safeTag}_$stamp"
  } elseif ($name.StartsWith(".") -and $baseName -eq "") {
    $backupName = "$name.before_${safeTag}_$stamp"
  } else {
    $backupName = "$baseName.before_${safeTag}_$stamp$extension"
  }

  $backupPath = Join-Path $directory $backupName
  Copy-Item -LiteralPath $item.FullName -Destination $backupPath -ErrorAction Stop
  Get-Item -LiteralPath $backupPath | Select-Object FullName, Length, LastWriteTime
}
