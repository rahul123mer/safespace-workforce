# Used by stop.cmd: stops the API, worker and frontend together with every process
# they spawned. Uvicorn's reload mode serves from a "multiprocessing.spawn" child whose
# command line does not name the app, so children are found through their parents.
$all = Get-CimInstance Win32_Process
$roots = $all | Where-Object { $_.Name -in 'python.exe', 'node.exe' -and $_.CommandLine -match 'employee_api|vite.*--port 5180' }
$ids = New-Object System.Collections.Generic.HashSet[int]
$queue = New-Object System.Collections.Generic.Queue[int]
foreach ($r in $roots) { if ($ids.Add([int]$r.ProcessId)) { $queue.Enqueue([int]$r.ProcessId) } }
while ($queue.Count) {
  $id = $queue.Dequeue()
  foreach ($c in $all | Where-Object { $_.ParentProcessId -eq $id }) {
    if ($ids.Add([int]$c.ProcessId)) { $queue.Enqueue([int]$c.ProcessId) }
  }
}
foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800
$busy = Get-NetTCPConnection -LocalPort 8030, 5180 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host "App stopped, but port $(($busy.LocalPort | Sort-Object -Unique) -join ', ') is still in use by another process."
} else {
  Write-Host "App stopped."
}
