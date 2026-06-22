$Script = Join-Path $PSScriptRoot "mineru_precise_parse.py"

$Uv = Get-Command uv -ErrorAction SilentlyContinue
if ($Uv) {
    & $Uv.Source run --python 3.12 python $Script @args
    exit $LASTEXITCODE
}

$PyLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($PyLauncher) {
    & $PyLauncher.Source -3 $Script @args
    exit $LASTEXITCODE
}

$Python = Get-Command python -ErrorAction SilentlyContinue
if ($Python) {
    & $Python.Source $Script @args
    exit $LASTEXITCODE
}

Write-Error "No Python runtime was found. Install uv, Python Launcher for Windows, or Python 3, then run this wrapper again."
exit 2
