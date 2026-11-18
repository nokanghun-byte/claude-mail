# Claude 메일 설치 스크립트 (Windows)
# - 첨부파일 도우미(helper)를 내 PC에 복사하고
# - Claude 데스크톱 앱 설정에 imap / attachments / markitdown 서버를 추가한다.
# 기존 설정 파일은 실행 전에 같은 폴더에 .bak_claude-mail 로 백업한다.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

function Say($t, $c = "Cyan") { Write-Host $t -ForegroundColor $c }

# 1) Node.js 확인
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$npx  = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $node -or -not $npx) {
  Say "Node.js가 없어요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요." "Red"; exit 1
}

# 2) 도우미 복사
$dest = Join-Path $env:LOCALAPPDATA "claude-mail"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $root "helper\server.js") (Join-Path $dest "server.js") -Force
Say "첨부파일 도우미를 $dest 에 복사했어요."

# 3) Claude 데스크톱 설정 파일 찾기 (스토어 앱 → 일반 설치 순)
$cands = @()
$cands += Get-ChildItem (Join-Path $env:LOCALAPPDATA "Claude-Data") -Filter claude_desktop_config.json -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$cands += Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Filter claude_desktop_config.json -Recurse -Depth 6 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$cands += (Join-Path $env:APPDATA "Claude\claude_desktop_config.json")
$cfg = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cfg) { $cfg = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"; New-Item -ItemType Directory -Force (Split-Path $cfg) | Out-Null; Set-Content $cfg "{}" -Encoding utf8 }
Say "Claude 설정 파일: $cfg"
Copy-Item $cfg "$cfg.bak_claude-mail" -Force

$j = Get-Content $cfg -Raw -Encoding utf8 | ConvertFrom-Json
if (-not $j.mcpServers) { $j | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }

$tools = "imap_list_accounts,imap_test_account,imap_connect,imap_disconnect,imap_list_folders,imap_folder_status,imap_get_unread_count,imap_search_emails,imap_get_latest_emails,imap_get_email,imap_find_email_by_message_id,imap_find_thread_messages,imap_download_attachment,imap_mark_as_read,imap_mark_as_unread,imap_delete_email,imap_reply_to_email,imap_send_email,imap_flag_email,imap_unflag_email,imap_forward_email,imap_move_email"
$servers = [ordered]@{
  imap        = [pscustomobject]@{ command = $npx; args = @("-y", "imap-mcp-server@2.2.0"); env = [pscustomobject]@{ IMAP_MCP_ENABLED_TOOLS = $tools } }
  attachments = [pscustomobject]@{ command = $node; args = @((Join-Path $dest "server.js")) }
}
$uvx = (Get-Command uvx -ErrorAction SilentlyContinue).Source
if ($uvx) { $servers.markitdown = [pscustomobject]@{ command = $uvx; args = @("markitdown-mcp") } }
else { Say "uv가 없어서 문서 미리보기(markitdown)는 건너뛰어요. 필요하면 https://docs.astral.sh/uv/ 설치 후 다시 실행하세요." "Yellow" }

foreach ($k in $servers.Keys) {
  if ($j.mcpServers.PSObject.Properties[$k]) { $j.mcpServers.PSObject.Properties.Remove($k) }
  $j.mcpServers | Add-Member -NotePropertyName $k -NotePropertyValue $servers[$k]
}
[IO.File]::WriteAllText($cfg, ($j | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
Say "설정에 서버를 추가했어요. (백업: $cfg.bak_claude-mail)" "Green"

# 4) 네이버·카카오 계정 (선택)
$a = Read-Host "Gmail 말고 다른 메일(네이버·카카오·다음·아웃룩·회사 메일 등) 계정을 지금 등록할까요? (y/n)"
if ($a -eq "y") {
  Say "브라우저에 계정 등록 화면이 열려요. 메일 주소와 앱 비밀번호를 넣고 저장하세요. 다 하면 이 창에서 Ctrl+C."
  & $npx -y -p imap-mcp-server@2.2.0 imap-setup
}

Say ""
Say "끝났어요. Claude 데스크톱 앱을 완전히 종료했다가 다시 켜 주세요." "Green"
Say "(앱이 켜진 채로 설정이 덮어써질 수 있어요. 다시 켠 뒤에도 서버가 안 보이면 이 스크립트를 한 번 더 실행하세요.)" "Yellow"
