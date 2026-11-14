# Starts Mosaik's hub when you log in to Windows, hidden, as a scheduled task of your own user.
#
#   npm run autostart:install     build, then create (or update) the task
#   npm run autostart:status      show the task and whether the hub answers
#   npm run autostart:uninstall   stop and delete the task
#
# The task runs the built hub (packages/hub/dist) with no window ("conhost --headless"), in this folder
# (so it reads .env), writing its logs to %LOCALAPPDATA%\Mosaik\hub.log. It needs no administrator
# rights. After updating Mosaik, run "npm run autostart:install" again to rebuild.
# Kept ASCII-only: Windows PowerShell 5.1 reads scripts without a BOM in the system code page.

param(
  [ValidateSet("install", "uninstall", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$TaskName = "Mosaik"
$Root = Split-Path -Parent $PSScriptRoot
$Entry = Join-Path $Root "packages\hub\dist\main.js"
$LogFile = Join-Path $env:LOCALAPPDATA "Mosaik\hub.log"
$User = "$env:USERDOMAIN\$env:USERNAME"

function Get-HubPort {
  $port = 7300
  $envFile = Join-Path $Root ".env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*HUB_PORT\s*=\s*(\d+)\s*$' } | Select-Object -Last 1
    if ($line -and $line -match '(\d+)\s*$') { $port = [int]$Matches[1] }
  }
  return $port
}

function Test-Hub {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-HubPort)/api/health" -TimeoutSec 2
    return $health.name -eq "mosaik"
  } catch {
    return $false
  }
}

switch ($Action) {
  "install" {
    if (-not (Test-Path $Entry)) { throw "The hub is not built: run 'npm run build' first ($Entry is missing)." }
    $node = (Get-Command node -ErrorAction Stop).Source
    $arguments = "--headless `"$node`" --env-file-if-exists=.env `"$Entry`" `"--log-file=$LogFile`""
    $taskAction = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" -Argument $arguments -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
    # No time limit, also on battery; if the hub stops with an error it is started again, up to 3 times
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
      -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings `
      -Principal $principal -Force `
      -Description "Mosaik: local hub of language-learning stats (http://127.0.0.1:$(Get-HubPort)). Logs: $LogFile" | Out-Null
    Write-Output "Task '$TaskName' installed: the hub will start when you log in."
    Write-Output "Start it now with:  Start-ScheduledTask -TaskName $TaskName"
    if (Test-Hub) { Write-Output "Note: a hub already answers on port $(Get-HubPort) (npm run dev?). Stop it before starting the task." }
  }
  "uninstall" {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { Write-Output "There is no task '$TaskName'."; break }
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Task '$TaskName' removed. A hub it had started is stopped."
  }
  "status" {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
      Write-Output "There is no task '$TaskName'. Install it with: npm run autostart:install"
    } else {
      $info = Get-ScheduledTaskInfo -TaskName $TaskName
      Write-Output "Task '$TaskName': $($task.State). Last run: $($info.LastRunTime), result $($info.LastTaskResult)."
      Write-Output "Runs: $($task.Actions[0].Execute) $($task.Actions[0].Arguments)"
    }
    if (Test-Hub) { Write-Output "The hub answers on http://127.0.0.1:$(Get-HubPort)." } else { Write-Output "No hub answers on port $(Get-HubPort)." }
    Write-Output "Logs: $LogFile"
  }
}
