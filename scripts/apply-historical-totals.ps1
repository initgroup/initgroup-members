param()
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot
try {
    @'
import json
from backend.historical_totals import apply_schema
print(json.dumps(apply_schema()))
'@ | & (Join-Path $repoRoot "venv\Scripts\python.exe") -
    if ($LASTEXITCODE -ne 0) { throw "Historical totals migration failed." }
} finally {
    Pop-Location
}
