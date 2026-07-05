param()
Set-Location (Join-Path $PSScriptRoot '..')
Get-Content 'secrets.txt' | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $kv = $_ -split '=', 2
  if ($kv.Length -eq 2) {
    Set-Item -Path ("Env:" + $kv[0]) -Value $kv[1]
  }
}
# Run OpenNext build via npm exec to pick up local devDependency
npm exec -- @opennextjs/cloudflare build
