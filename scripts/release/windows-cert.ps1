# Imports the Windows Authenticode certificate for the desktop signing job.
#
# Env contract (the release-desktop-signing environment):
#   WINDOWS_PFX            base64-encoded PKCS#12 certificate, optional
#   WINDOWS_PFX_PASSWORD   password for that certificate
# When WINDOWS_PFX is unset, skip certificate import.
# Otherwise exactly one certificate with a private key must be present, and
# its thumbprint is written to GITHUB_ENV as WINDOWS_CERTIFICATE_THUMBPRINT,
# which scripts/build-desktop-release.ts consumes for the Tauri config.

$ErrorActionPreference = "Stop"
if (-not $env:WINDOWS_PFX) { exit 0 }
$certificatePath = Join-Path $env:RUNNER_TEMP "xbond-signing.pfx"
try {
  [IO.File]::WriteAllBytes($certificatePath, [Convert]::FromBase64String($env:WINDOWS_PFX))
  $password = ConvertTo-SecureString -String $env:WINDOWS_PFX_PASSWORD -AsPlainText -Force
  $certificates = @(Import-PfxCertificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\My -Password $password)
  $certificate = @($certificates | Where-Object HasPrivateKey)
  if ($certificate.Count -ne 1) { throw "Expected one code signing certificate" }
  "WINDOWS_CERTIFICATE_THUMBPRINT=$($certificate[0].Thumbprint)" >> $env:GITHUB_ENV
} finally {
  Remove-Item -LiteralPath $certificatePath -ErrorAction SilentlyContinue
}
