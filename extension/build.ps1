# 확장 프로그램 만들기 (Windows / macOS의 pwsh)
# 결과: dist/claude-mail.mcpb
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
npm install --omit=dev --no-audit --no-fund
node build-core.mjs
New-Item -ItemType Directory -Force ../dist | Out-Null
npx -y @anthropic-ai/mcpb@2.1.2 pack . ../dist/claude-mail.mcpb