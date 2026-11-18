# 16MB가 넘는 첨부파일을 Google Drive 링크로 보내기 위한 rclone 연결 (선택)
# 준비물: Google Cloud에서 만든 '데스크톱 앱' OAuth 클라이언트 ID / 보안 비밀번호
# (만드는 방법은 README의 'Google Drive 연결' 참고)

$ErrorActionPreference = "Stop"
function Say($t, $c = "Cyan") { Write-Host $t -ForegroundColor $c }

$r = (Get-Command rclone -ErrorAction SilentlyContinue).Source
if (-not $r) {
  $r = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Filter rclone.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $r) {
  Say "rclone을 설치할게요..."
  winget install --id Rclone.Rclone -e --accept-source-agreements
  $r = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Filter rclone.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $r) { Say "rclone을 찾지 못했어요. 창을 닫고 다시 실행해 주세요." "Red"; exit 1 }

Say "Google Cloud의 '클라이언트 ID'와 '클라이언트 보안 비밀번호'를 붙여 넣으세요. (창에서 마우스 오른쪽 클릭 = 붙여 넣기)"
$id = (Read-Host "클라이언트 ID").Trim()
$secret = (Read-Host "클라이언트 보안 비밀번호").Trim()
if (-not $id -or -not $secret) { Say "값이 비어 있어요." "Red"; exit 1 }

$remotes = & $r listremotes 2>$null
if ($remotes -contains "gdrive:") {
  & $r config update gdrive client_id $id client_secret $secret --non-interactive | Out-Null
} else {
  & $r config create gdrive drive scope drive.file client_id $id client_secret $secret --non-interactive | Out-Null
}
Say "브라우저가 열리면 Google 계정으로 로그인하고 '계속'/'허용'을 누르세요."
& $r config reconnect gdrive: --auto-confirm
Say "끝났어요." "Green"
