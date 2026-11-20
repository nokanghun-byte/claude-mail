// Claude 메일 확장 프로그램의 MCP 서버 (한 프로세스).
//   - imap-core.mjs   : imap-mcp-server를 모듈로 불러와 메모리 안에서 연결
//   - attachments.js  : 첨부파일 읽기, 외부 이미지, 큰 파일 조각 받기, Google Drive 업로드(drive.js / rclone)
//   - extras.mjs      : 계정 등록 화면, 문서 변환, 메일 페이지
//   - notify.mjs      : 메일 페이지를 닫아 두어도 새 메일을 운영체제 알림으로 알려 줌
// Claude 앱의 내장 Node.js는 하위 Node 프로세스를 띄울 수 없으므로 모두 이 프로세스 안에서 돈다.

import { createRequire } from "module";
import { appendFileSync, rmdirSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

const VERSION = "1.4.5";
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
  "imap_forward_email", "imap_move_email", "imap_save_draft"
].join(",");

// 첨부 미리보기용 임시 폴더: '다운로드' 폴더 대신 사용자 폴더의 숨은 폴더(~/.claude-mail/attachments)를 쓴다.
// (예전 버전이 만든 빈 '다운로드\imap-attachments' 폴더는 비어 있을 때만 지운다)
if (!process.env.IMAP_DOWNLOAD_DIR) process.env.IMAP_DOWNLOAD_DIR = join(homedir(), ".claude-mail", "attachments");
try { rmdirSync(join(homedir(), "Downloads", "imap-attachments")); } catch (e) { /* 없거나 파일이 남아 있으면 그대로 둔다 */ }

// 앱이 읽기만 하는 도구는 묻지 않고, 지우거나 보내는 도구만 확인하도록 도구마다 성격을 붙인다
const READ_ONLY = new Set(["imap_list_accounts", "imap_test_account", "imap_list_folders", "imap_folder_status",
  "imap_get_unread_count", "imap_search_emails", "imap_get_latest_emails", "imap_get_email", "imap_find_email_by_message_id",
  "imap_find_thread_messages", "imap_download_attachment", "imap_connect", "imap_disconnect"]);
const DESTRUCTIVE = new Set(["imap_delete_email", "imap_remove_account"]);
const SENDS = new Set(["imap_send_email", "imap_reply_to_email", "imap_forward_email"]);
function annotate(t){
  if (t.annotations && Object.keys(t.annotations).length) return t;
  const ro = READ_ONLY.has(t.name);
  return Object.assign({}, t, { annotations: {
    readOnlyHint: ro, destructiveHint: DESTRUCTIVE.has(t.name), idempotentHint: ro, openWorldHint: SENDS.has(t.name)
  } });
}

// ---------- 하위 기능 준비 ----------
let attMod = null;
function att(){ return attMod || (attMod = require("./attachments.js")); }
let attSeq = 1;
function attRequest(method, params){ return att().request({ jsonrpc: "2.0", id: "a" + (attSeq++), method, params: params || {} }); }
let extras = null;
async function ex(){ return extras || (extras = await import("./extras.mjs")); }

let imapReady = null;   // 첫 initialize 응답을 보낸 뒤에 불러온다 (앱이 몇 초 안에 응답을 기다림)
function startImap(){ if (imapReady) return imapReady; imapReady = (async () => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { server } = await import("./imap-core.mjs");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "claude-mail", version: VERSION });
  await client.connect(b);
  log("imap ready");
  return client;
})(); imapReady.catch(e => log("imap failed:", e && e.stack || e)); return imapReady; }

const LONG = { timeout: 10 * 60 * 1000 };
let notifierStarted = false;
let attNames = null, extraNames = null;
async function listAll(){
  const E = await ex();
  const parts = await Promise.all([
    startImap().then(c => c.listTools(undefined, LONG)).then(r => r.tools || []).catch(e => { log("imap list error:", e && e.message); return []; }),
    attRequest("tools/list").then(m => (m.result && m.result.tools) || [])
  ]);
  attNames = new Set(parts[1].map(t => t.name));
  extraNames = new Set(E.TOOLS.map(t => t.name));
  return parts[0].map(annotate).concat(parts[1], E.TOOLS);
}

// ---------- 클라이언트(Claude 앱) 쪽 ----------
function send(obj){ process.stdout.write(JSON.stringify(obj) + "\n"); }
function errOut(id, e){ send({ jsonrpc: "2.0", id, error: { code: (e && typeof e.code === "number") ? e.code : -32603, message: String(e && e.message || e) } }); }

async function handle(msg){
  const { id, method } = msg;
  if (method === "initialize"){
    send({ jsonrpc: "2.0", id, result: {
      protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {}, prompts: {} },
      serverInfo: { name: "claude-mail", version: VERSION }
    } });
    setTimeout(startImap, 0);
    if (!notifierStarted){
      notifierStarted = true;
      import("./notify.mjs").then(N => N.startNotifier(startImap, log)).catch(e => log("notify load failed:", e && e.message));
    }
    return;
  }
  if (id == null) return;   // 알림은 무시
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: await listAll() } });
  if (method === "tools/call"){
    const p = msg.params || {};
    if (!attNames) await listAll();
    if (extraNames.has(p.name)){
      const r = await (await ex()).call(p.name, p.arguments || {});
      return send({ jsonrpc: "2.0", id, result: r });
    }
    if (attNames.has(p.name)){
      const m = await attRequest("tools/call", p);
      return send(Object.assign({ jsonrpc: "2.0", id }, m.error ? { error: m.error } : { result: m.result }));
    }
    const client = await startImap();
    const result = await client.callTool({ name: p.name, arguments: p.arguments || {} }, undefined, LONG);
    return send({ jsonrpc: "2.0", id, result });
  }
  if (method === "prompts/list"){
    const E = await ex();
    return send({ jsonrpc: "2.0", id, result: { prompts: E.PROMPTS.map(p => ({ name: p.name, description: p.description })) } });
  }
  if (method === "prompts/get"){
    const E = await ex(), pr = E.PROMPTS.find(p => p.name === (msg.params && msg.params.name));
    if (!pr) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown prompt" } });
    return send({ jsonrpc: "2.0", id, result: { description: pr.description, messages: [{ role: "user", content: { type: "text", text: pr.text } }] } });
  }
  if (method === "resources/list") return send({ jsonrpc: "2.0", id, result: { resources: [] } });
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
