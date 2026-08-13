# Generate a self-signed CodeSigning certificate and export .pfx / .cer
# Usage: powershell -File create-signing-cert.ps1
# Output: emo/certs/emoji-assistant.pfx (password below) and .cer
$ErrorActionPreference = 'Stop'

$certDir = Join-Path $PSScriptRoot '..\certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$pfxPath = Join-Path $certDir 'emoji-assistant.pfx'
$pfxPassword = 'EmojiAssistant2026!Sign'

# 1. Create self-signed code-signing cert (20 years)
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject 'CN=EmojiAssistant, O=EmojiAssistant, C=CN' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears(20) `
    -HashAlgorithm SHA256

Write-Output ("cert thumbprint: " + $cert.Thumbprint)

# 2. Export .pfx with private key
$cert | Export-PfxCertificate -FilePath $pfxPath -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) | Out-Null
Write-Output ("pfx exported: " + $pfxPath)
Write-Output ("pfx password: " + $pfxPassword)

# 3. Export .cer (for manual install on other machines)
$cerPath = Join-Path $certDir 'emoji-assistant.cer'
Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
Write-Output ("cer exported: " + $cerPath)

# 4. Install root cert to CurrentUser Root + TrustedPublisher (trust on this machine)
#    certutil works in non-interactive sessions (Import-Certificate may fail without UI)
certutil -user -addstore Root $cerPath | Out-Null
certutil -user -addstore TrustedPublisher $cerPath | Out-Null
Write-Output 'cert installed to CurrentUser Root + TrustedPublisher'

Write-Output 'DONE'
