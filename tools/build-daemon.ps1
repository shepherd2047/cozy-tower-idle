# Shared build loop: the ONLY thing that runs Cocos builds. Sessions just edit files and wait for BUILD_STATUS.json.
# Rebuilds web-mobile whenever anything under assets/ or settings/ changed since the last build started.
# Status: tower-wizard-cocos/BUILD_STATUS.json  {state, startedAt, finishedAt, ok, errors[], log, snapshot, url, lastGood*}
# Every successful build is copied to tools/snapshots/<HHmmss>/ (served at http://127.0.0.1:8150/<HHmmss>/) and never
# changes afterwards: TEST AGAINST `url` / `lastGoodUrl`, never against build/web-mobile, which is rewritten mid-build.
# Request a TikTok build too: create tools/want-tiktok (the daemon deletes it after building).
$proj = 'C:\Users\mu\Desktop\New folder\tower-wizard-cocos'
$exe = 'C:\CocosCreator\3.8.8\CocosCreator.exe'
$logs = "$proj\tools\build-logs"; New-Item -ItemType Directory -Force $logs | Out-Null
$statusFile = "$proj\BUILD_STATUS.json"
function Editors { Get-CimInstance Win32_Process -Filter "Name='CocosCreator.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'sub-process' } }
function Newest { (Get-ChildItem "$proj\assets" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -ne '.meta' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime }
# many sessions poll the status file, so write a temp file and swap it in (retrying while a reader holds it open)
function Status($o) {
  $tmp = "$statusFile.tmp"; $o | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $tmp
  for ($i = 0; $i -lt 50; $i++) { try { Move-Item -Force $tmp $statusFile -ErrorAction Stop; return } catch { Start-Sleep -Milliseconds 100 } }
  "status write failed after retries"
}
function Build($cfg) {
  $stamp = Get-Date -Format HHmmss; $log = "$logs\$cfg-$stamp.log"
  $p = Start-Process -FilePath $exe -ArgumentList '--project', "`"$proj`"", '--build', "`"configPath=$proj\$cfg`"" -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -NoNewWindow
  $s = Get-Date
  while (((Get-Date) - $s).TotalSeconds -lt 900) {
    if ($p.HasExited) { break }
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'build Task .* Finished in' -Quiet)) { Start-Sleep 3; break }
    Start-Sleep 2
  }
  if (-not $p.HasExited) { & taskkill /PID $p.Id /T /F 2>$null | Out-Null }
  $errs = @(Select-String -Path $log, "$log.err" -Pattern 'error TS|SyntaxError|build failed|Error:' -ErrorAction SilentlyContinue | Where-Object { $_.Line -notmatch ' - debug: ' } | Select-Object -First 12 | ForEach-Object { $_.Line.Trim() })
  $ok = [bool](Select-String -Path $log -Pattern 'build Task .* Finished in' -Quiet) -and $errs.Count -eq 0
  return @{ ok = $ok; errors = $errs; log = $log }
}
$snaps = "$proj\tools\snapshots"; New-Item -ItemType Directory -Force $snaps, "$proj\tools\live" | Out-Null
$last = @{}
try {   # keep advertising the previous good snapshot across daemon restarts (the warm pool and tests depend on it)
  $prev = Get-Content -Raw $statusFile | ConvertFrom-Json
  if ($prev.lastGoodUrl) { $last = @{ lastGoodSnapshot = $prev.lastGoodSnapshot; lastGoodUrl = $prev.lastGoodUrl; lastGoodStartedAt = $prev.lastGoodStartedAt } }
} catch {}
$lastStart = [datetime]::MinValue
while ($true) {
  $want = Test-Path "$proj\tools\want-tiktok"
  $n = Newest
  if (($n -gt $lastStart -or $want) -and -not (Editors)) {
    if (((Get-Date) - (Newest)).TotalSeconds -lt 15) { Start-Sleep 5; continue }   # wait until edits have been quiet 15 s
    $lastStart = Get-Date
    Status (@{ state = 'building'; startedAt = $lastStart.ToString('o'); target = 'web-mobile' } + $last)
    $r = Build 'build-web.json'
    $st = @{ state = 'idle'; startedAt = $lastStart.ToString('o'); finishedAt = (Get-Date).ToString('o'); ok = $r.ok; errors = $r.errors; log = $r.log; target = 'web-mobile' }
    if ($r.ok) {
      # no "Made with Cocos" splash in test/phone builds: the engine skips it when totalTime <= 0 (saves 2 s per load)
      & node -e "const f=process.argv[1],fs=require('fs');const s=JSON.parse(fs.readFileSync(f,'utf8'));if(s.splashScreen){s.splashScreen.totalTime=0;fs.writeFileSync(f,JSON.stringify(s));}" "$proj\build\web-mobile\src\settings.json"
      # immutable snapshot: tests use its URL, so later rebuilds can never change files under a running test
      $stamp = $lastStart.ToString('HHmmss')
      & robocopy "$proj\build\web-mobile" "$snaps\$stamp" /E /NFL /NDL /NJH /NJS /NP | Out-Null
      Get-ChildItem $snaps -Directory | Sort-Object CreationTime -Descending | Select-Object -Skip 8 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue   # by time: HHmmss names wrap at midnight
      & robocopy "$snaps\$stamp" "$proj\tools\live" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null   # what the phone plays (port 8140)
      $st.snapshot = $stamp; $st.url = "http://127.0.0.1:8150/$stamp/"
      $last = @{ lastGoodSnapshot = $stamp; lastGoodUrl = $st.url; lastGoodStartedAt = $st.startedAt }
    }
    $st += $last
    if ($want -and $r.ok) {
      Remove-Item "$proj\tools\want-tiktok" -ErrorAction SilentlyContinue
      $t = Build 'build-tiktok.json'; $st.tiktok = @{ ok = $t.ok; errors = $t.errors; finishedAt = (Get-Date).ToString('o') }
    }
    Status $st
    "$((Get-Date).ToString('HH:mm:ss')) built ok=$($r.ok) errors=$($r.errors.Count)"
  }
  Start-Sleep 10
}
