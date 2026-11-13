param([Parameter(Mandatory = $true)][string]$Installer)

$ErrorActionPreference = "Stop"
$signature = Get-AuthenticodeSignature -LiteralPath $Installer
if (-not $env:WINDOWS_CERTIFICATE_THUMBPRINT -and $signature.Status -eq "NotSigned") {
    Write-Warning "Windows installer has no Authenticode signature: $Installer"
    return
}
if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Thumbprint -ne $env:WINDOWS_CERTIFICATE_THUMBPRINT) {
    throw "Invalid Authenticode signature for ${Installer}: $($signature.Status) ($($signature.StatusMessage))"
}
