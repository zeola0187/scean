param([Parameter(Mandatory=$true)][ValidateSet('Before','After')][string]$Mode,[Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference='Stop'
$taskRequest=Get-Content -Raw -LiteralPath $Request | ConvertFrom-Json
$shellObject=New-Object -ComObject Shell.Application
if($Mode -eq 'Before') {
  $handles=@($shellObject.Windows() | ForEach-Object { [long]$_.HWND })
  [pscustomobject]@{handles=$handles} | ConvertTo-Json -Compress
  exit
}
$wanted=[IO.Path]::GetFullPath([string]$taskRequest.path)
$matched=@()
for($attempt=0;$attempt -lt 30 -and $matched.Count -eq 0;$attempt++) {
  $matched=@($shellObject.Windows() | Where-Object {
    try { [IO.Path]::GetFileName([string]$_.FullName) -ieq 'explorer.exe' -and [IO.Path]::GetFullPath([string]$_.Document.Folder.Self.Path) -ieq $wanted } catch { $false }
  })
  if($matched.Count -eq 0){Start-Sleep -Milliseconds 200}
}
$rows=@($matched | ForEach-Object {
  $handle=[long]$_.HWND
  $newWindow=$handle -notin @($taskRequest.beforeHandles)
  # Close only a newly created Explorer window still displaying this unique test folder.
  # Existing user windows/tabs are never closed.
  $closed=$false
  if($newWindow -and [IO.Path]::GetFullPath([string]$_.Document.Folder.Self.Path) -ieq $wanted){$_.Quit();$closed=$true}
  [pscustomobject]@{matchedExpectedFolder=$true;newWindow=$newWindow;closedOwnedWindow=$closed}
})
[pscustomobject]@{observed=($matched.Count -gt 0);matches=$rows;unrelatedWindowPathsRecorded=$false} | ConvertTo-Json -Depth 5 -Compress
if($matched.Count -eq 0){exit 2}
