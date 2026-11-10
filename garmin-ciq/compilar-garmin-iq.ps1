$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot ".env.local"
$CliBin = Join-Path $PSScriptRoot "tools\connect-iq-sdk-manager.exe"
$KeyFile = Join-Path $PSScriptRoot "developer_key.der"
$JungleFile = Join-Path $PSScriptRoot "monkey.jungle"
$ManifestFile = Join-Path $PSScriptRoot "manifest.xml"
$OutIqPublic = Join-Path $ProjectRoot "public\Archery101010.iq"
$OutIqStatic = Join-Path $ProjectRoot "out\Archery101010.iq"

# Load GARMIN_USERNAME and GARMIN_PASSWORD from .env.local without printing values
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match "^\s*GARMIN_USERNAME\s*=\s*(.+)\s*$") {
            $env:GARMIN_USERNAME = $Matches[1].Trim('"').Trim("'")
        }
        if ($_ -match "^\s*GARMIN_PASSWORD\s*=\s*(.+)\s*$") {
            $env:GARMIN_PASSWORD = $Matches[1].Trim('"').Trim("'")
        }
    }
}

if (-not $env:GARMIN_USERNAME) {
    $env:GARMIN_USERNAME = Read-Host "Ingresa tu correo de cuenta Garmin"
}
if (-not $env:GARMIN_PASSWORD) {
    $sec = Read-Host "Ingresa tu contraseña de cuenta Garmin (oculta)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $env:GARMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}

Write-Host "1/4 Aceptando acuerdo oficial Connect IQ SDK..."
& $CliBin agreement view | Out-Null
& $CliBin agreement accept

Write-Host "2/4 Iniciando sesion en servidor oficial de desarrolladores..."
& $CliBin login

Write-Host "3/4 Descargando Connect IQ SDK 9.3.0 y los 35 modelos de reloj..."
& $CliBin sdk set "^9.0.0"
& $CliBin device download --include-fonts --manifest="$ManifestFile"

$SdkBinDir = (& $CliBin sdk current-path --bin).Trim()
$MonkeyCBat = Join-Path $SdkBinDir "monkeyc.bat"

Write-Host "4/4 Compilando y firmando paquete oficial Archery101010.iq..."
& $MonkeyCBat -e -w -r -f "$JungleFile" -y "$KeyFile" -o "$OutIqPublic"

if (Test-Path (Split-Path -Parent $OutIqStatic)) {
    Copy-Item -Force "$OutIqPublic" "$OutIqStatic"
}

Write-Host "LISTO: Paquete generado exitosamente en $OutIqPublic"
