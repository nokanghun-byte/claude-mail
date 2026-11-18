# 확장 프로그램 만들기 (Windows)
# 결과: dist\claude-mail.mcpb
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
Copy-Item ..\helper\server.js server\attachments.js -Force
npm install --omit=dev --no-audit --no-fund
node build-core.mjs
New-Item -ItemType Directory -Force ..\dist | Out-Null
npx -y @anthropic-ai/mcpb@latest pack . ..\dist\claude-mail.mcpb