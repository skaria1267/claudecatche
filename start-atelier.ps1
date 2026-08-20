$env:FRONTEND_VARIANT = "atelier"
$env:FRONTEND_ALLOW_SWITCH = "0"
Set-Location $PSScriptRoot

if (Get-Command python -ErrorAction SilentlyContinue) {
    python main.py
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    py -3 main.py
} else {
    Write-Error "Python was not found. Install Python or activate the project virtual environment."
}
