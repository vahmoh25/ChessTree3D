# Tiny static file server for local development: powershell -File serve.ps1 [port]
param([int]$Port = 8765)
$root = $PSScriptRoot
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8';
            '.json' = 'application/json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq '') { $path = 'index.html' }
  $file = Join-Path $root $path
  try {
    if ($ctx.Request.HttpMethod -eq 'POST' -and $path -like 'docs/*.png') {
      # dev helper used to save screenshots captured from the canvases
      $ms = New-Object IO.MemoryStream
      $ctx.Request.InputStream.CopyTo($ms)
      $b64 = [Text.Encoding]::ASCII.GetString($ms.ToArray()) -replace '^data:image/png;base64,', ''
      $target = Join-Path $root ($path -replace '[^\w\./-]', '')
      New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
      [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($b64))
      $ctx.Response.StatusCode = 200
    } elseif ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($root))) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
  } catch { $ctx.Response.StatusCode = 500 }
  $ctx.Response.Close()
}
