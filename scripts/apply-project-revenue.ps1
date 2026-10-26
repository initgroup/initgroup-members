param()
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot
try {
    @'
import json
from backend.project_revenue import apply_schema
print(json.dumps(apply_schema()))
'@ | & (Join-Path $repoRoot "venv\Scripts\python.exe") -
    if ($LASTEXITCODE -ne 0) { throw "Project revenue migration failed." }
} finally {
    Pop-Location
}
