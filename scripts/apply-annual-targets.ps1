param()
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $repoRoot "venv\Scripts\python.exe"
Push-Location $repoRoot
try {
    @'
import json
from backend.annual_targets_migration import apply_migration
print(json.dumps(apply_migration()))
'@ | & $python -
    if ($LASTEXITCODE -ne 0) { throw "Annual target migration failed. Existing data was not deleted; rerun after resolving the cause." }
} finally {
    Pop-Location
}
