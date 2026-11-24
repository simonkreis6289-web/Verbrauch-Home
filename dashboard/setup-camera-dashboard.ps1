param(
    [string]$Go2rtcFolder = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $Go2rtcFolder 'go2rtc.exe') -PathType Leaf)) {
    throw 'Bitte das Skript im entpackten go2rtc-Ordner starten.'
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$target = Join-Path $Go2rtcFolder 'dashboard-www'
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $downloads = @{
        go2rtc = 'https://github.com/AlexxIT/go2rtc/archive/refs/tags/v1.9.15.zip'
        verbrauch = 'https://github.com/simonkreis6289-web/Verbrauch-Home/archive/refs/heads/main.zip'
    }
    foreach ($name in $downloads.Keys) {
        $archive = Join-Path $temporary "$name.zip"
        Invoke-WebRequest -UseBasicParsing -Uri $downloads[$name] -OutFile $archive
        Expand-Archive -LiteralPath $archive -DestinationPath $temporary
    }

    $app = Join-Path $temporary 'Verbrauch-Home-main'
    $player = Join-Path $temporary 'go2rtc-1.9.15/www'
    if (-not (Test-Path (Join-Path $app 'dashboard/cameras.js') -PathType Leaf)) {
        throw 'Die Live-Kameras wurden im heruntergeladenen Dashboard nicht gefunden.'
    }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -Path (Join-Path $player '*') -Destination $target -Recurse -Force
    foreach ($file in @('dashboard.html', 'dashboard-settings.html', 'icon-192.png', 'fuel-prices.json', 'market-prices.json')) {
        Copy-Item -LiteralPath (Join-Path $app $file) -Destination $target -Force
    }
    $assets = Join-Path $target 'dashboard'
    New-Item -ItemType Directory -Path $assets -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $app 'dashboard') -File |
        Where-Object { $_.Extension -ne '.ps1' } |
        Copy-Item -Destination $assets -Force

    Write-Host 'Dashboard-Dateien bereit. In go2rtc.yaml unter api den Eintrag static_dir: "dashboard-www" setzen.'
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}
