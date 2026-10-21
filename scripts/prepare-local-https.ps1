#Requires -Version 7.2
using namespace System.Security.Cryptography
using namespace System.Security.Cryptography.X509Certificates
param(
  [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) '.local/tls'),
  [string[]]$AdditionalIP = @()
)
$ErrorActionPreference = 'Stop'

function Write-PublicCertificate($Certificate, [string]$File) {
  [IO.File]::WriteAllText($File, $Certificate.ExportCertificatePem(), [Text.UTF8Encoding]::new($false))
}
function Write-PrivateKey($Key, [string]$File) {
  # Establish restrictive permissions before writing any new secret bytes.
  [IO.File]::Open($File, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::Write).Dispose()
  if ($IsWindows) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl = [Security.AccessControl.FileSecurity]::new()
    # Modify the DACL only. Set-Acl can also request audit privileges that an
    # ordinary non-elevated process intentionally does not possess.
    $acl.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;$sid)", [Security.AccessControl.AccessControlSections]::Access)
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($File), $acl)
  } else { [IO.File]::SetUnixFileMode($File, [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite) }
  [IO.File]::WriteAllText($File, $Key.ExportPkcs8PrivateKeyPem(), [Text.UTF8Encoding]::new($false))
}

$directory = [IO.Path]::GetFullPath($OutputDirectory)
if ($directory -eq [IO.Path]::GetPathRoot($directory)) { throw 'La carpeta TLS debe ser una carpeta dedicada, no una raíz de disco.' }
$publicDirectory = [IO.Path]::GetFullPath((Join-Path (Split-Path $PSScriptRoot -Parent) 'public'))
if ($directory.Equals($publicDirectory, [StringComparison]::OrdinalIgnoreCase) -or $directory.StartsWith($publicDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Las claves TLS no se escriben dentro del directorio público del servidor.' }
[IO.Directory]::CreateDirectory($directory) | Out-Null
$caFile = Join-Path $directory 'ca.crt'
$caKeyFile = Join-Path $directory 'ca.key'
$serverFile = Join-Path $directory 'server.crt'
$serverKeyFile = Join-Path $directory 'server.key'
$now = [DateTimeOffset]::UtcNow
$addresses = [Collections.Generic.HashSet[string]]::new()
$addresses.Add('127.0.0.1') | Out-Null
$addresses.Add('::1') | Out-Null
foreach ($adapter in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
  foreach ($entry in $adapter.GetIPProperties().UnicastAddresses) {
    if ($entry.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { $addresses.Add($entry.Address.ToString()) | Out-Null }
  }
}
foreach ($address in $AdditionalIP) {
  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($address, [ref]$parsed)) { throw 'AdditionalIP debe contener direcciones IP válidas.' }
  $addresses.Add($parsed.ToString()) | Out-Null
}

$ca = $null; $caKey = $null; $serverKey = $null; $issued = $null
try {
  if ((Test-Path -LiteralPath $caFile) -xor (Test-Path -LiteralPath $caKeyFile)) { throw 'La autoridad local está incompleta; no se sobrescribe una identidad existente.' }
  if (Test-Path -LiteralPath $caFile) {
    $ca = [X509Certificate2]::CreateFromPemFile($caFile, $caKeyFile)
    if ($ca.NotAfter.ToUniversalTime() -le $now.UtcDateTime.AddDays(370)) { throw 'La autoridad local requiere renovación manual; no se reemplaza silenciosamente una CA ya confiada.' }
  } else {
    $caKey = [RSA]::Create(3072)
    $name = 'CN=WaterDuel Local CA ' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
    $request = [CertificateRequest]::new($name, $caKey, [HashAlgorithmName]::SHA256, [RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([X509BasicConstraintsExtension]::new($true, $true, 0, $true))
    $request.CertificateExtensions.Add([X509KeyUsageExtension]::new([X509KeyUsageFlags]::KeyCertSign -bor [X509KeyUsageFlags]::CrlSign, $true))
    $request.CertificateExtensions.Add([X509SubjectKeyIdentifierExtension]::new($request.PublicKey, $false))
    $ca = $request.CreateSelfSigned($now.AddMinutes(-5), $now.AddYears(10))
    Write-PrivateKey $caKey $caKeyFile
    Write-PublicCertificate $ca $caFile
  }
  $serverKey = [RSA]::Create(3072)
  $request = [CertificateRequest]::new('CN=WaterDuel LAN', $serverKey, [HashAlgorithmName]::SHA256, [RSASignaturePadding]::Pkcs1)
  $request.CertificateExtensions.Add([X509BasicConstraintsExtension]::new($false, $false, 0, $true))
  $request.CertificateExtensions.Add([X509KeyUsageExtension]::new([X509KeyUsageFlags]::DigitalSignature -bor [X509KeyUsageFlags]::KeyEncipherment, $true))
  $oids = [OidCollection]::new(); $oids.Add([Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
  $request.CertificateExtensions.Add([X509EnhancedKeyUsageExtension]::new($oids, $false))
  $san = [SubjectAlternativeNameBuilder]::new(); $san.AddDnsName('localhost')
  foreach ($address in $addresses) { $san.AddIpAddress([Net.IPAddress]::Parse($address)) }
  $request.CertificateExtensions.Add($san.Build())
  $request.CertificateExtensions.Add([X509SubjectKeyIdentifierExtension]::new($request.PublicKey, $false))
  $serial = [byte[]]::new(16); [RandomNumberGenerator]::Fill($serial); $serial[0] = $serial[0] -band 0x7f
  $issued = $request.Create($ca, $now.AddMinutes(-5), $now.AddDays(365), $serial)
  Write-PrivateKey $serverKey $serverKeyFile
  Write-PublicCertificate $issued $serverFile
  Write-Output 'Certificados TLS locales preparados. No se instaló confianza en ningún dispositivo.'
  Write-Output ('CA pública para confianza manual: ' + $caFile)
} finally {
  if ($issued) { $issued.Dispose() }; if ($serverKey) { $serverKey.Dispose() }; if ($ca) { $ca.Dispose() }; if ($caKey) { $caKey.Dispose() }
}
