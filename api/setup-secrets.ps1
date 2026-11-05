# One-time setup of the Portal API's secrets in the "Website APIs" Google Cloud project.
# Run it yourself in a terminal (it never prints a secret):
#   powershell -ExecutionPolicy Bypass -File api\setup-secrets.ps1
#
# 1. Turns on the Geocoding API and makes a geocoding-only key -> secret portal-maps-api-key
# 2. Makes a random Documenso webhook secret                    -> secret portal-documenso-webhook-secret
# 3. Asks for the Documenso API token (hidden while you type)   -> secret portal-documenso-api-token
# 4. Lets only the portal-api service account read the three secrets
# Already-made secrets are left as they are, so it's safe to run again.
$ErrorActionPreference = 'Stop'
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$project = 'bamboo-research-511821-j2'
$serviceAccount = "portal-api@$project.iam.gserviceaccount.com"

function Test-Secret($name) {
    & $gcloud secrets describe $name --project $project --format="value(name)" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}
# Saves a value as a new secret, passing it through a temporary file that is deleted right after
function New-Secret($name, $value) {
    $file = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($file, $value)
        & $gcloud secrets create $name --project $project --replication-policy=automatic --data-file=$file | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not create $name" }
    } finally { Remove-Item $file -Force }
    Write-Host "  Saved $name" -ForegroundColor Green
}

Write-Host "`n1 of 4: Geocoding key" -ForegroundColor Cyan
if (Test-Secret 'portal-maps-api-key') { Write-Host '  Already set up' } else {
    & $gcloud services enable geocoding-backend.googleapis.com --project $project
    $key = & $gcloud services api-keys create --project $project --display-name 'Portal API - Geocoding' `
        --api-target=service=geocoding-backend.googleapis.com --format='value(response.keyString)'
    if (-not $key) { throw 'Could not create the geocoding key' }
    New-Secret 'portal-maps-api-key' ($key.Trim())
}

Write-Host "`n2 of 4: Documenso webhook secret" -ForegroundColor Cyan
if (Test-Secret 'portal-documenso-webhook-secret') { Write-Host '  Already set up' } else {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    New-Secret 'portal-documenso-webhook-secret' (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

Write-Host "`n3 of 4: Documenso API token" -ForegroundColor Cyan
if (Test-Secret 'portal-documenso-api-token') { Write-Host '  Already set up' } else {
    Write-Host '  Paste the Documenso API token (the DOCUMENSO_API_TOKEN script property in the Apps Script project''s' -ForegroundColor Yellow
    Write-Host '  settings, or a new token from sign.andrewmarth.com > Settings > API Tokens). Nothing shows while you paste.' -ForegroundColor Yellow
    $secure = Read-Host -AsSecureString '  Token'
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if (-not $plain.Trim()) { throw 'No token was pasted' }
    New-Secret 'portal-documenso-api-token' ($plain.Trim())
}

Write-Host "`n4 of 4: Letting portal-api read them" -ForegroundColor Cyan
foreach ($name in 'portal-maps-api-key', 'portal-documenso-webhook-secret', 'portal-documenso-api-token') {
    & $gcloud secrets add-iam-policy-binding $name --project $project --member "serviceAccount:$serviceAccount" `
        --role roles/secretmanager.secretAccessor --format='value(etag)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not give portal-api access to $name" }
}
Write-Host "`nAll done. Tell Claude the secrets are set up." -ForegroundColor Green
