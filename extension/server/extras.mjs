// 확장 프로그램에만 있는 도구들
//  - open_account_setup : 메일 계정 등록 화면을 브라우저로 연다 (imap-mcp-server의 등록 화면)
//  - convert_document   : 워드·엑셀·파워포인트 첨부를 표·문단 글로 바꾼다 (파이썬 없이)
//  - get_mail_page      : Claude 메일 페이지 HTML과 권한 목록을 돌려준다 (페이지 만들기 명령용)
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
import { join, dirname, basename, extname } from "path";
import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from "fs";
import { homedir } from "os";
import net from "net";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.IMAP_DOWNLOAD_DIR || join(homedir(), "Downloads", "imap-attachments");
const DOC_MAX = 30 * 1024 * 1024;

export const TOOLS = [{
  name: "open_account_setup",
  description: "Open the mail account setup page (IMAP/SMTP: Naver, Kakao, Daum, Outlook, company mail, etc.) in the user's browser. Accounts added there appear in imap_list_accounts.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
}, {
  name: "convert_document",
  description: "Convert a Word (.docx), Excel (.xlsx/.xls/.csv) or PowerPoint (.pptx) attachment saved by imap_download_attachment into Markdown (headings, paragraphs, tables). Pass the saved path or just the file name inside the imap-attachments folder.",
  inputSchema: { type: "object", properties: { path: { type: "string" }, filename: { type: "string" } }, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, {
  name: "get_mail_page",
  description: "Return the Claude Mail page HTML and the capabilities JSON it needs, so Claude can publish it as an artifact for the user.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}];

export const PROMPTS = [{
  name: "make_mail_page",
  description: "Claude 메일 페이지 만들기 (Gmail + IMAP 메일을 한 화면에서)",
  text: "Claude Mail 확장 프로그램의 get_mail_page 도구로 메일 페이지 HTML과 권한 목록(capabilities)을 받아, 그 HTML을 그대로 아티팩트로 게시해 줘. 게시할 때 capabilities는 받은 JSON 그대로 선언하고, 제목은 'Email', 아이콘은 'mail'로 해 줘. 게시한 뒤 Gmail·Google Drive 커넥터가 연결되어 있는지 확인하고, 메일 계정을 추가하려면 페이지의 '메일 계정 추가' 버튼을 누르면 된다고 알려 줘."
}];

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

// ---------- 계정 등록 화면 ----------
let wizard = null;
function freePort(){
  return new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function openAccountSetup(){
  if (wizard){
    const { default: open } = await import("open");
    await open(wizard.url);
    return text({ ok: true, url: wizard.url, reopened: true });
  }
  const mod = await import(pathToFileURL(join(here, "..", "node_modules", "imap-mcp-server", "dist", "setup-core.mjs")).href);
  const port = await freePort();
  const srv = new mod.WebUIServer(port, { bindHost: "127.0.0.1" });
  const origLog = console.log; console.log = (...a) => process.stderr.write(a.join(" ") + "\n");   // 표준출력을 더럽히지 않게
  try { await srv.start(true); } finally { console.log = origLog; }
  wizard = { url: srv.getAccessUrl(true) };
  return text({ ok: true, url: wizard.url });
}

// ---------- 문서 변환 ----------
function resolveDoc(args){
  const raw = String(args.path || args.filename || "").normalize("NFC");
  if (!raw) throw new Error("path or filename is required");
  let full = /[\\/]/.test(raw) ? raw : join(DIR, raw);
  if (!existsSync(full)){
    const want = basename(full).normalize("NFC");
    const hit = existsSync(DIR) ? readdirSync(DIR).find(f => f.normalize("NFC") === want) : null;
    if (!hit) throw new Error("file not found: " + basename(full));
    full = join(DIR, hit);
  }
  const real = realpathSync(full);
  if (dirname(real).toLowerCase() !== realpathSync(DIR).toLowerCase()) throw new Error("only files in the imap-attachments folder can be converted");
  if (statSync(real).size > DOC_MAX) throw new Error("file too large");
  return real;
}
const cell = (v) => String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
function mdTable(rows){
  rows = rows.filter(r => r && r.some(c => cell(c) !== ""));
  if (!rows.length) return "_(빈 시트)_";
  const width = Math.min(30, Math.max(...rows.map(r => r.length)));
  const fit = (r) => Array.from({ length: width }, (_, i) => cell(r[i]));
  const out = ["| " + fit(rows[0]).join(" | ") + " |", "| " + Array(width).fill("---").join(" | ") + " |"];
  rows.slice(1, 301).forEach(r => out.push("| " + fit(r).join(" | ") + " |"));
  if (rows.length > 301) out.push("", "_(" + (rows.length - 301) + "행 더 있음)_");
  return out.join("\n");
}
async function convertDocument(args){
  const file = resolveDoc(args || {});
  const ext = extname(file).toLowerCase();
  if (ext === ".docx"){
    const mammoth = require("mammoth");
    const r = await mammoth.convertToMarkdown({ path: file });
    const md = r.value.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "_(그림)_").replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, "$1");
    return text({ result: md, kind: "docx" });
  }
  if ([".xlsx", ".xlsm", ".xls", ".csv", ".ods"].includes(ext)){
    const XLSX = require("xlsx");
    const wb = XLSX.read(readFileSync(file), { type: "buffer", cellDates: true, dense: true });
    const parts = wb.SheetNames.slice(0, 20).map(n => "## " + n + "\n\n" + mdTable(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" })));
    return text({ result: parts.join("\n\n"), kind: "xlsx" });
  }
  if (ext === ".pptx"){
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(readFileSync(file));
    const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const dec = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    const out = [];
    for (let i = 0; i < slides.length; i++){
      const xml = await zip.file(slides[i]).async("string");
      const paras = xml.split(/<\/a:p>/).map(p => (p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(t => dec(t.replace(/<\/?a:t>/g, ""))).join("")).filter(p => p.trim());
      out.push("## 슬라이드 " + (i + 1) + "\n\n" + (paras.length ? paras.join("\n\n") : "_(글자 없음)_"));
    }
    return text({ result: out.join("\n\n"), kind: "pptx" });
  }
  return fail("지원하지 않는 형식이에요: " + ext + " (docx, xlsx, xls, csv, pptx)");
}

// ---------- 페이지 ----------
function getMailPage(){
  const html = readFileSync(join(here, "..", "page", "claude-mail.html"), "utf8");
  const caps = JSON.parse(readFileSync(join(here, "..", "page", "capabilities.json"), "utf8"));
  return text({ title: "Email", icon: "mail", capabilities: caps, html });
}

export async function call(name, args){
  try {
    if (name === "open_account_setup") return await openAccountSetup();
    if (name === "convert_document") return await convertDocument(args || {});
    if (name === "get_mail_page") return getMailPage();
  } catch (e){ return fail(String(e && e.message || e)); }
  return null;
}
