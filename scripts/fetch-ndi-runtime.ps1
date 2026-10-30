# Stage Vizrt's NDI 6 Runtime for the Windows installer.
#
# The app loads NDI at runtime (src-tauri/src/bridge/ndi.rs) and looks in its
# own install folder first, so shipping the runtime's DLL inside the installer
# makes NDI work with nothing else installed. The DLL is Vizrt's, redistributed
# under the NDI SDK licence; it is not committed — CI fetches it for each
# release build:
#
#   1. download the official NDI 6 Runtime installer,
#   2. install it silently on the (throwaway) build machine,
#   3. copy Processing.NDI.Lib.x64.dll and the licence texts beside it into
#      src-tauri/ndi/, which tauri.ndi.conf.json bundles as resources.
#
# Usage (Windows, elevated, as CI runs it):  pwsh scripts/fetch-ndi-runtime.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is far slower with a progress bar

$RuntimeUrl = 'https://ndi.link/NDIRedistV6'
$Library = 'Processing.NDI.Lib.x64.dll'
$Destination = Join-Path $PSScriptRoot '..\src-tauri\ndi'
$Temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$Installer = Join-Path $Temp 'NDI-6-Runtime.exe'

function Find-Runtime {
  $roots = @("$env:ProgramFiles\NDI", "${env:ProgramFiles(x86)}\NDI") | Where-Object { Test-Path $_ }
  foreach ($root in $roots) {
    $found = Get-ChildItem -Path $root -Recurse -Filter $Library -ErrorAction SilentlyContinue |
      Where-Object { $_.DirectoryName -notmatch 'SDK' } |
      Select-Object -First 1
    if ($found) { return $found }
  }
  return $null
}

$dll = Find-Runtime
if (-not $dll) {
  Write-Host "Downloading the NDI 6 Runtime from $RuntimeUrl"
  Invoke-WebRequest -Uri $RuntimeUrl -OutFile $Installer -UseBasicParsing -MaximumRedirection 10

  Write-Host 'Installing it silently'
  $process = Start-Process -FilePath $Installer -PassThru `
    -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'
  if (-not $process.WaitForExit(10 * 60 * 1000)) {
    $process.Kill()
    throw 'The NDI Runtime installer did not finish within 10 minutes.'
  }
  if ($process.ExitCode -ne 0) {
    throw "The NDI Runtime installer exited with code $($process.ExitCode)."
  }
  $dll = Find-Runtime
}
if (-not $dll) {
  throw "The NDI Runtime installed, but $Library was not found under Program Files\NDI."
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -Path $dll.FullName -Destination $Destination -Force
# Vizrt's licence texts for the runtime ship beside the DLL; the NDI SDK
# licence requires them to travel with it.
Get-ChildItem -Path $dll.DirectoryName -File |
  Where-Object { $_.Extension -in '.txt', '.rtf', '.pdf' } |
  Copy-Item -Destination $Destination -Force

Write-Host "Staged for the installer from $($dll.DirectoryName):"
Get-ChildItem -Path $Destination | ForEach-Object { Write-Host "  $($_.Name) ($($_.Length) bytes)" }
