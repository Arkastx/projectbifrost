$ErrorActionPreference = 'Stop'

$base = 'https://alpha123.github.io/uma-tools/umalator-global'
$target = Join-Path $PSScriptRoot '..\\static\\umalator'

New-Item -ItemType Directory -Path $target -Force | Out-Null

Invoke-WebRequest -Uri "$base/bundle.js" -OutFile (Join-Path $target 'bundle.js') -UseBasicParsing
Invoke-WebRequest -Uri "$base/simulator.worker.js" -OutFile (Join-Path $target 'simulator.worker.js') -UseBasicParsing
Invoke-WebRequest -Uri "$base/course_data.json" -OutFile (Join-Path $target 'course_data.json') -UseBasicParsing

Write-Host "Umalator assets updated in $target"
