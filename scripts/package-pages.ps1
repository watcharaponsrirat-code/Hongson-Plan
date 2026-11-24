param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot '.runtime\node.exe'
if (-not (Test-Path -LiteralPath $runtimePath)) {
    $runtimePath = (Get-Command node -ErrorAction Stop).Source
}
& $runtimePath (Join-Path $projectRoot 'scripts\build-pages.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Building the standalone Pages file failed.' }
$outputDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$archivePath = Join-Path $outputDir 'Hongson-Plan-GitHub-Pages.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
try {
    $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relativePath in @('index.html', '.nojekyll', 'GITHUB_PAGES.md')) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, (Join-Path $projectRoot $relativePath), $relativePath,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
Write-Output "Created: $archivePath"
