export const targetReadme=`TauriTavern 目標交付包

目標：TauriTavern 2.3.0（實機顯示 dev 3fe9e055b512）、酒館助手 4.11.3、提示詞模板 1.17.9。
這是標準角色卡、角色助手腳本、regex 與 EJS 世界書；不需 CardStudio 私有 runtime。
JSON/PNG 單檔不包含外置立繪。先關閉目標酒館，使用 PowerShell：
  ./Import-Images.ps1 -DataRoot "你的 TauriTavern data 目錄"
腳本驗證摘要，只新增 default-user/user/images/<namespace>/<sha256>.<ext>。
不覆寫不同內容，不讀帳戶、聊天或 API key；重複執行會核對並略過相同檔案。
若執行政策阻擋，請直接依 assets-manifest.json 用檔案管理員複製並核對 SHA256；勿繞過安全政策。
再在酒館角色管理匯入 card.json 或 card.png，啟用這張角色卡的 regex、世界書、酒館助手角色腳本和提示詞模板。
助手角色腳本的全域授權必須由使用者在目標 UI 開啟；卡片 enabled 不等於主機已授權。
首次使用請開新聊天。初始值明確寫在角色腳本，不使用編輯器預覽 fixture。
助手是唯一狀態寫入者，按樓層存入 message variables；EJS 與 HTML 均讀相同命名空間。
原生助手允許角色 JS；匯入前請查看腳本。編輯器隔離預覽不執行這些腳本，也不證明目標 runtime 已通過。
提示詞模板在此只於送出 prompt 時讀取狀態，避免依賴其 DOM hook 的重掛載行为。
狀態錯誤會保留前一份有效值；修改/滑動時最多重建 251 樓，前一樓不可讀就停止，不杜撰初值。
更改目標設定後請重建並開新聊天。歷史聊天的 schema/digest 不會靜默遷移。
回退：-Rollback 僅移除本包 journal 記錄新增且摘要仍相同的圖片；卡片請使用酒館 UI 刪除該匯入副本。
請保留本包及匯入後的 journal；勿把同一份 journal 拿到另一個 data 目錄。
沒有 API 請求、模型品質證明、遠端下載或自動安裝擴充。
`;

// The user supplies the known data root. Every file and directory is checked;
// no wildcard removal, symlink traversal, overwrite or executable download.
export const imageInstaller=String.raw`param([Parameter(Mandatory=$true)][string]$DataRoot,[switch]$Rollback)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($DataRoot)
function RegularDirectory([string]$p) {
  $item=Get-Item -LiteralPath $p -Force
  if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Expected an ordinary directory.'}
}
RegularDirectory $root
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'assets-manifest.json') -Raw | ConvertFrom-Json
if($manifest.namespace -cnotmatch '^[a-z][a-z0-9_]{0,47}$'){throw 'Invalid namespace.'}
$dest=$root
foreach($part in @('default-user','user','images',$manifest.namespace)){
  $dest=Join-Path $dest $part
  if(!(Test-Path -LiteralPath $dest)){[IO.Directory]::CreateDirectory($dest)|Out-Null}
  RegularDirectory $dest
}
$journalPath=Join-Path $PSScriptRoot 'image-import-journal.json'
function VerifiedFile([string]$p,[string]$digest){
  $item=Get-Item -LiteralPath $p -Force
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Expected an ordinary file.'}
  if((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest){throw 'Digest mismatch.'}
}
if($Rollback){
  $journal=Get-Content -LiteralPath $journalPath -Raw|ConvertFrom-Json
  if($journal.root -cne $root -or $journal.namespace -cne $manifest.namespace){throw 'Journal belongs to another target.'}
  foreach($name in $journal.created){
    $entry=@($manifest.assets|Where-Object {$_.filename -ceq $name})
    if($entry.Count -ne 1 -or $name -cnotmatch '^[a-f0-9]{64}\.(png|jpg|webp)$'){throw 'Invalid journal item.'}
    $file=Join-Path $dest $name
    if(Test-Path -LiteralPath $file){VerifiedFile $file $entry[0].sha256;Remove-Item -LiteralPath $file}
  }
  Write-Output 'Rollback complete.'
  exit
}
$created=@()
if(Test-Path -LiteralPath $journalPath){
  $old=Get-Content -LiteralPath $journalPath -Raw|ConvertFrom-Json
  if($old.root -cne $root -or $old.namespace -cne $manifest.namespace){throw 'Existing journal belongs to another target.'}
  $created=@($old.created)
}
foreach($entry in $manifest.assets){
  if($entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $entry.filename -cnotmatch '^[a-f0-9]{64}\.(png|jpg|webp)$' -or !$entry.filename.StartsWith($entry.sha256+'.')){throw 'Invalid asset manifest.'}
  $source=Join-Path (Join-Path $PSScriptRoot 'assets') $entry.filename
  VerifiedFile $source $entry.sha256
  $file=Join-Path $dest $entry.filename
  if(Test-Path -LiteralPath $file){VerifiedFile $file $entry.sha256;continue}
  # Journal intent first: interrupted copies are never falsely reported complete.
  $created=@($created+$entry.filename|Select-Object -Unique)
  @{root=$root;namespace=$manifest.namespace;created=$created}|ConvertTo-Json|Set-Content -LiteralPath $journalPath -Encoding UTF8
  [IO.File]::Copy($source,$file,$false)
  VerifiedFile $file $entry.sha256
}
Write-Output 'Images verified. Import the character card through TauriTavern.'
`;
