$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  & node scripts/bootstrap-publish.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap failed; fix the reported step and rerun.' }
} finally {
  Pop-Location
}
