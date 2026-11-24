param(
    [string]$Go2rtcFolder = (Get-Location).Path,
    [switch]$AutoUpdate
)

$ErrorActionPreference = 'Stop'
$Go2rtcFolder = (Resolve-Path -LiteralPath $Go2rtcFolder).Path
if (-not (Test-Path (Join-Path $Go2rtcFolder 'go2rtc.exe') -PathType Leaf)) {
    throw 'Bitte den entpackten go2rtc-Ordner angeben.'
}

# The manual setup and scheduled task share this lock.
$lock = [IO.File]::Open((Join-Path $Go2rtcFolder '.dashboard-update.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$id = [guid]::NewGuid().ToString('N')
$temporary = Join-Path ([IO.Path]::GetTempPath()) $id
$target = Join-Path $Go2rtcFolder 'dashboard-www'
$stage = Join-Path $Go2rtcFolder "dashboard-stage-$id"
$backup = Join-Path $Go2rtcFolder "dashboard-backup-$id"
$revisionFile = Join-Path $Go2rtcFolder '.dashboard-revision'
$repo = 'simonkreis6289-web/Verbrauch-Home'
try {
    $revision = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/main" -TimeoutSec 30).sha
    if ($revision -notmatch '^[0-9a-f]{40}$') { throw 'GitHub-Stand konnte nicht ermittelt werden.' }

    $installed = if (Test-Path -LiteralPath $revisionFile) { (Get-Content -LiteralPath $revisionFile -Raw).Trim() }
    if ($installed -ne $revision -or -not (Test-Path (Join-Path $target 'dashboard.html'))) {
        New-Item -ItemType Directory -Path $temporary, $stage | Out-Null
        $archive = Join-Path $temporary 'verbrauch.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/archive/$revision.zip" -OutFile $archive -TimeoutSec 120
        Expand-Archive -LiteralPath $archive -DestinationPath $temporary
        $app = Join-Path $temporary "Verbrauch-Home-$revision"

        $playerFiles = @('index.html', 'stream.html', 'video-stream.js', 'video-rtc.js')
        $player = $target
        $missingPlayerFiles = @($playerFiles | Where-Object { -not (Test-Path (Join-Path $player $_) -PathType Leaf) })
        if ($missingPlayerFiles.Count) {
            $playerArchive = Join-Path $temporary 'go2rtc.zip'
            Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/AlexxIT/go2rtc/archive/refs/tags/v1.9.15.zip' -OutFile $playerArchive -TimeoutSec 120
            Expand-Archive -LiteralPath $playerArchive -DestinationPath $temporary
            $player = Join-Path $temporary 'go2rtc-1.9.15/www'
            Copy-Item -Path (Join-Path $player '*') -Destination $stage -Recurse
        } else {
            Get-ChildItem -LiteralPath $target -File |
                Where-Object { $_.Name -notin @('dashboard.html', 'dashboard-settings.html', 'icon-192.png', 'fuel-prices.json', 'market-prices.json') } |
                Copy-Item -Destination $stage
            Get-ChildItem -LiteralPath $target -Directory |
                Where-Object { $_.Name -ne 'dashboard' } |
                Copy-Item -Destination $stage -Recurse
        }

        foreach ($file in @('dashboard.html', 'dashboard-settings.html', 'icon-192.png', 'fuel-prices.json', 'market-prices.json')) {
            Copy-Item -LiteralPath (Join-Path $app $file) -Destination $stage
        }
        $assets = Join-Path $stage 'dashboard'
        New-Item -ItemType Directory -Path $assets | Out-Null
        Get-ChildItem -LiteralPath (Join-Path $app 'dashboard') -File |
            Where-Object { $_.Extension -ne '.ps1' } |
            Copy-Item -Destination $assets
        foreach ($file in $playerFiles + @('dashboard/cameras.js', 'dashboard/load-data.js', 'dashboard/tv-layout.css')) {
            if (-not (Test-Path (Join-Path $stage $file) -PathType Leaf)) {
                throw "Dashboard-Update unvollstaendig: $file"
            }
        }

        if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup }
        try {
            Move-Item -LiteralPath $stage -Destination $target
        } catch {
            if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $target }
            throw
        }
        Set-Content -LiteralPath $revisionFile -Value $revision -Encoding Ascii
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    }
    Write-Host "Dashboard-Stand: $revision"

    if ($AutoUpdate) {
        $updater = Join-Path $Go2rtcFolder 'setup-camera-dashboard.ps1'
        if ($PSCommandPath -ne $updater) { Copy-Item -LiteralPath $PSCommandPath -Destination $updater -Force }
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Go2rtcFolder "{1}"' -f $updater, $Go2rtcFolder
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $Go2rtcFolder
        $intervalMinutes = 5
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($intervalMinutes) -RepetitionInterval (New-TimeSpan -Minutes $intervalMinutes)
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
        Register-ScheduledTask -TaskName 'Verbrauch Zuhause Dashboard Update' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
        Write-Host "Automatische Dashboard-Updates alle $intervalMinutes Minuten eingerichtet."
    }
} finally {
    foreach ($path in @($stage, $temporary)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
    $lock.Dispose()
}
