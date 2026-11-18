// Claude 메일 확장 프로그램의 MCP 서버 (한 프로세스).
//   - imap-core.mjs   : imap-mcp-server를 모듈로 불러와 메모리 안에서 연결
//   - attachments.js  : 첨부파일 읽기, 외부 이미지, 큰 파일 조각 받기, rclone 업로드
// Claude 앱의 내장 Node.js는 하위 Node 프로세스를 띄울 수 없으므로 모두 이 프로세스 안에서 돈다.

import { createRequire } from "module";
import { appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const require = createRequire(import.meta.url);
const DEBUG_FILE = join(tmpdir(), "claude-mail-debug.log");
function log(...a){
  const line = "[claude-mail] " + a.join(" ") + "\n";
  process.stderr.write(line);
  if (process.env.CLAUDE_MAIL_DEBUG) { try { appendFileSync(DEBUG_FILE, new Date().toISOString() + " " + line); } catch (e) {} }
}

process.env.IMAP_MCP_ENABLED_TOOLS = [
  "imap_list_accounts", "imap_add_account", "imap_update_account", "imap_remove_account", "imap_test_account",
  "imap_connect", "imap_disconnect", "imap_list_folders", "imap_folder_status", "imap_get_unread_count",
  "imap_search_emails", "imap_get_latest_emails", "imap_get_email", "imap_find_email_by_message_id",
  "imap_find_thread_messages", "imap_download_attachment", "imap_mark_as_read", "imap_mark_as_unread",
  "imap_delete_email", "imap_reply_to_email", "imap_send_email", "imap_flag_email", "imap_unflag_email",
  "imap_forward_email", "imap_move_email"
].join(",");

// ---------- 하위 기능 준비 ----------
let attMod = null;
function att(){ return attMod || (attMod = require("./attachments.js")); }
let attSeq = 1;
function attRequest(method, params){ return att().request({ jsonrpc: "2.0", id: "a" + (attSeq++), method, params: params || {} }); }

let imapReady = null;   // 첫 initialize 응답을 보낸 뒤에 불러온다 (앱이 몇 초 안에 응답을 기다림)
function startImap(){ if (imapReady) return imapReady; imapReady = (async () => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { server } = await import("./imap-core.mjs");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "claude-mail", version: "1.0.2" });
  await client.connect(b);
  log("imap ready");
  return client;
})(); imapReady.catch(e => log("imap failed:", e && e.stack || e)); return imapReady; }

const LONG = { timeout: 10 * 60 * 1000 };
let attNames = null;
async function listAll(){
  const parts = await Promise.all([
    startImap().then(c => c.listTools(undefined, LONG)).then(r => r.tools || []).catch(e => { log("imap list error:", e && e.message); return []; }),
    attRequest("tools/list").then(m => (m.result && m.result.tools) || [])
  ]);
  attNames = new Set(parts[1].map(t => t.name));
  return parts[0].concat(parts[1]);
}

// ---------- 클라이언트(Claude 앱) 쪽 ----------
function send(obj){ process.stdout.write(JSON.stringify(obj) + "\n"); }
function errOut(id, e){ send({ jsonrpc: "2.0", id, error: { code: (e && typeof e.code === "number") ? e.code : -32603, message: String(e && e.message || e) } }); }

async function handle(msg){
  const { id, method } = msg;
  if (method === "initialize"){
    send({ jsonrpc: "2.0", id, result: {
      protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "claude-mail", version: "1.0.2" }
    } });
    setTimeout(startImap, 0);
    return;
  }
  if (id == null) return;   // 알림은 무시
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: await listAll() } });
  if (method === "tools/call"){
    const p = msg.params || {};
    if (!attNames) await listAll();
    if (attNames.has(p.name)){
      const m = await attRequest("tools/call", p);
      return send(Object.assign({ jsonrpc: "2.0", id }, m.error ? { error: m.error } : { result: m.result }));
    }
    const client = await startImap();
    const result = await client.callTool({ name: p.name, arguments: p.arguments || {} }, undefined, LONG);
    return send({ jsonrpc: "2.0", id, result });
  }
  if (method === "resources/list") return send({ jsonrpc: "2.0", id, result: { resources: [] } });
  if (method === "prompts/list") return send({ jsonrpc: "2.0", id, result: { prompts: [] } });
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
}

let inBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", d => {
  inBuf += d; let i;
  while ((i = inBuf.indexOf("\n")) >= 0){
    const line = inBuf.slice(0, i).trim(); inBuf = inBuf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
    handle(msg).catch(e => { log("error:", e && e.stack || e); if (msg.id != null) errOut(msg.id, e); });
  }
});
process.stdin.on("end", () => process.exit(0));
log("start", "node=" + process.version);
