param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

# Met à jour la version dans tauri.conf.json
$conf = Get-Content "src-tauri/tauri.conf.json" -Raw
$conf = $conf -replace '"version": "\d+\.\d+\.\d+"', "`"version`": `"$Version`""
Set-Content "src-tauri/tauri.conf.json" $conf

# Commit + tag + push
git add .
git commit -m "Release v$Version"
git tag "v$Version"
git push
git push origin "v$Version"

Write-Host "✅ Release v$Version en cours de build sur GitHub Actions !" -ForegroundColor Green
Write-Host "👉 https://github.com/BIBIdu39/calendar/actions" -ForegroundColor Cyan
