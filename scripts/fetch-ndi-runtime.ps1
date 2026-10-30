# Stage Vizrt's NDI 6 Runtime for the Windows installer.
#
# The app loads NDI at runtime (src-tauri/src/bridge/ndi.rs) and looks in its
# own install folder first, so shipping the runtime's DLL inside the installer
# makes NDI work with nothing else installed. The DLL is Vizrt's, redistributed
# under the NDI SDK licence; it is not committed — CI stages it for each build
# into src-tauri/ndi/, which tauri.ndi.conf.json bundles as resources.
#
# Where it comes from: Vizrt's own download links refuse GitHub's build
# machines (ndi.link answers 502, downloads.ndi.tv 403), so the same
# redistributable is taken from the cyndilib package on PyPI, which ships it
# unmodified with its licence text. Three checks make that safe and the build
# reproducible:
#   - the package file is pinned by URL and SHA-256,
#   - the DLL inside it is pinned by SHA-256 (NDI 6.3.2),
#   - the DLL must carry a valid Authenticode signature from Vizrt.
# To move to a newer NDI, update all three pins together.
#
# Usage (Windows):  pwsh scripts/fetch-ndi-runtime.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is far slower with a progress bar

$PackageUrl = 'https://files.pythonhosted.org/packages/d7/d1/7d17aa78773035a25adcebf6d163709ecf29ba2bba60fe453d14c687fcd6/cyndilib-0.1.3-cp313-cp313-win_amd64.whl'
$PackageSha256 = '9af1477fd4099dbfbb5a0609a5e53981a8e538018d35e53a4c1731a220899e71'
$LibrarySha256 = '2b6602075868ba4401f82f417d72424805d69b11ca86078023d0d489ff45dd84'
$Library = 'Processing.NDI.Lib.x64.dll'
$Licences = 'Processing.NDI.Lib.Licenses.txt'

$Destination = Join-Path $PSScriptRoot '..\src-tauri\ndi'
$Temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$Package = Join-Path $Temp 'ndi-runtime-package.zip'
$Unpacked = Join-Path $Temp 'ndi-runtime-package'

function Assert-Sha256($path, $expected, $what) {
  $actual = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "$what has SHA-256 $actual, expected $expected. Refusing to bundle it."
  }
}

foreach ($attempt in 1..4) {
  try {
    Write-Host "Downloading the NDI 6 Runtime package (attempt $attempt)"
    Invoke-WebRequest -Uri $PackageUrl -OutFile $Package -UseBasicParsing
    break
  } catch {
    if ($attempt -eq 4) { throw }
    Write-Warning "Download failed: $($_.Exception.Message)"
    Start-Sleep -Seconds ([math]::Pow(2, $attempt))
  }
}
Assert-Sha256 $Package $PackageSha256 'The downloaded package'

if (Test-Path $Unpacked) { Remove-Item -Recurse -Force $Unpacked }
Expand-Archive -Path $Package -DestinationPath $Unpacked
$bin = Join-Path $Unpacked 'cyndilib\wrapper\bin'
$dll = Join-Path $bin $Library

Assert-Sha256 $dll $LibrarySha256 $Library
$signature = Get-AuthenticodeSignature -FilePath $dll
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Vizrt') {
  throw "$Library is not validly signed by Vizrt (status: $($signature.Status), signer: $($signature.SignerCertificate.Subject))."
}
Write-Host "Signed by: $($signature.SignerCertificate.Subject)"

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -Path $dll -Destination $Destination -Force
# The NDI SDK licence requires Vizrt's licence texts to travel with the DLL.
Copy-Item -Path (Join-Path $bin $Licences) -Destination $Destination -Force

Write-Host 'Staged for the installer:'
Get-ChildItem -Path $Destination | ForEach-Object { Write-Host "  $($_.Name) ($($_.Length) bytes)" }
