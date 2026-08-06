param([int]$Port = 8765)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = $ScriptDir
if (-not (Test-Path -LiteralPath (Join-Path $Root '2026_08_jitsuryoku_analysis.html'))) {
  $Root = Join-Path $ScriptDir '..\analysis_outputs\2026_08_jitsuryoku_analysis_portable'
}
$Root = [System.IO.Path]::GetFullPath($Root)
$HtmlName = '2026_08_jitsuryoku_analysis.html'
$StatePath = Join-Path $Root 'analysis_state.json'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")

function Send-Response($context, [int]$status, [string]$contentType, [byte[]]$bytes) {
  $context.Response.StatusCode = $status
  $context.Response.ContentType = $contentType
  $context.Response.ContentEncoding = [System.Text.Encoding]::UTF8
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}
function Send-Text($context, [int]$status, [string]$contentType, [string]$text) {
  Send-Response $context $status $contentType ([System.Text.Encoding]::UTF8.GetBytes($text))
}

try {
  $listener.Start()
  Write-Host "保存サーバーを起動しました: http://localhost:$Port/$HtmlName"
  Start-Process "http://localhost:$Port/$HtmlName"
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
      if ($path -eq '/api/state') {
        if ($context.Request.HttpMethod -eq 'GET') {
          if (Test-Path -LiteralPath $StatePath) {
            Send-Response $context 200 'application/json; charset=utf-8' ([System.IO.File]::ReadAllBytes($StatePath))
          } else {
            Send-Text $context 200 'application/json; charset=utf-8' '{"notes":{},"classes":{}}'
          }
        } elseif ($context.Request.HttpMethod -eq 'POST') {
          $reader = [System.IO.StreamReader]::new($context.Request.InputStream, [System.Text.Encoding]::UTF8)
          $body = $reader.ReadToEnd()
          $reader.Close()
          $parsed = $body | ConvertFrom-Json
          $json = $parsed | ConvertTo-Json -Depth 10
          $tempPath = "$StatePath.tmp"
          [System.IO.File]::WriteAllText($tempPath, $json, [System.Text.UTF8Encoding]::new($false))
          Move-Item -LiteralPath $tempPath -Destination $StatePath -Force
          Send-Text $context 200 'application/json; charset=utf-8' '{"ok":true}'
        } else {
          Send-Text $context 405 'text/plain; charset=utf-8' 'Method Not Allowed'
        }
      } elseif ($path -eq '/' -or $path -eq "/$HtmlName") {
        Send-Response $context 200 'text/html; charset=utf-8' ([System.IO.File]::ReadAllBytes((Join-Path $Root $HtmlName)))
      } elseif ($path -eq '/README.txt') {
        Send-Response $context 200 'text/plain; charset=utf-8' ([System.IO.File]::ReadAllBytes((Join-Path $Root 'README.txt')))
      } else {
        Send-Text $context 404 'text/plain; charset=utf-8' 'Not Found'
      }
    } catch {
      if ($context.Response.OutputStream.CanWrite) { Send-Text $context 500 'text/plain; charset=utf-8' $_.Exception.Message }
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}