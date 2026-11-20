#!/usr/bin/env node
// 첨부 도우미 (MCP stdio 서버)
// imap 연결이 PC에 저장한 첨부파일(다운로드\imap-attachments)을 읽어서 원본 그대로(base64) 돌려준다.
// - 그 폴더 안의 파일만 읽는다. 다른 경로·하위 폴더·상위 폴더(..)는 거부한다.
// - 읽기만 한다. 파일을 쓰거나 지우지 않는다.
// 외부 라이브러리 없이 Node만으로 동작한다 (줄 단위 JSON-RPC).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const DIR = path.resolve(process.env.IMAP_DOWNLOAD_DIR || path.join(os.homedir(), "Downloads", "imap-attachments"));
const MAX_BYTES = 15 * 1024 * 1024;
const MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  hwp: "application/x-hwp", hwpx: "application/hwp+zip", zip: "application/zip",
  txt: "text/plain", csv: "text/csv", json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", eml: "message/rfc822"
};

const TOOLS = [{
  name: "read_saved_attachment",
  description: "Read one attachment file that the imap server saved to the imap-attachments download folder, and return its raw bytes (base64) so a page can display it. The saved copy is then removed from that folder unless keep is true. Only plain file names inside that folder are accepted; paths are refused.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "File name only (no folders), as returned in the imap_download_attachment result's path." },
      keep: { type: "boolean", description: "Keep the saved copy in the folder after reading (default false: it is removed)." }
    },
    required: ["filename"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
}, {
  name: "fetch_image",
  description: "Download one image from a public http(s) address (for example a picture inside an email) and return it as an image so a page can show it. Only image responses up to 8 MB are returned; local and private network addresses are refused.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The http(s) address of the image." },
      as: { type: "string", enum: ["image", "resource"], description: "Optional. \"resource\" returns the bytes as an embedded resource blob instead of an image block (large images can be dropped from image blocks on the way to a page)." }
    },
    required: ["url"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
}, {
  name: "stage_file",
  description: "Save one file that a page wants to attach to an outgoing email into a private temporary folder, and return its local path (for imap_send_email / imap_reply_to_email attachments with `path`). Files older than one day in that folder are cleaned up automatically.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "File name (no folders)." },
      base64Content: { type: "string", description: "The file content, base64." }
    },
    required: ["name", "base64Content"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
}, {
  name: "drive_folder_status",
  description: "Tell whether the Google Drive for desktop folder (My Drive) is available on this PC, so large email attachments can be handed to it.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, {
  name: "stage_chunk",
  description: "Receive one piece of a large file (in order). When the last piece arrives, the joined file is moved into the '메일 첨부' folder inside the PC's Google Drive folder, where Google Drive for desktop uploads it. Returns the final file name.",
  inputSchema: {
    type: "object",
    properties: {
      uploadId: { type: "string", description: "Same id for all pieces of one file." },
      index: { type: "number", description: "Piece number, starting at 0." },
      total: { type: "number", description: "Number of pieces." },
      name: { type: "string", description: "File name (no folders)." },
      base64Content: { type: "string", description: "This piece's bytes, base64." },
      dest: { type: "string", description: "\"rclone\" to upload the joined file to Google Drive with rclone (then poll upload_status with the returned jobId)." }
    },
    required: ["uploadId", "index", "total", "name", "base64Content"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
}, {
  name: "rclone_status",
  description: "Tell whether large email attachments can be uploaded to Google Drive (built-in Google sign-in, or rclone remote 'gdrive'). Returns ok, via, and canLogin when drive_login can connect it.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, {
  name: "drive_login",
  description: "Start Google sign-in in the browser so large email attachments can be uploaded straight to the user's Google Drive (drive.file scope: only files this app uploads). Poll rclone_status to see when it is connected.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
}, {
  name: "upload_status",
  description: "Progress of a large-file upload started by stage_chunk with dest \"rclone\". Returns state (uploading/done/failed), percent, the Drive file id when done, and the final title.",
  inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}];

// ---- 큰 파일을 PC의 Google Drive 폴더로 (Google Drive 데스크톱 앱이 올려 준다) ----
function findDriveFolder(){
  const cands = [];
  for (const L of "GHIJKLMNOPQRSTUVWXYZDEF"){
    cands.push(L + ":\\내 드라이브", L + ":\\My Drive");
  }
  const home = os.homedir();
  cands.push(path.join(home, "내 드라이브"), path.join(home, "My Drive"), path.join(home, "Google Drive", "내 드라이브"), path.join(home, "Google Drive", "My Drive"), path.join(home, "Google Drive"));
  for (const c of cands){ try { if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c; } catch (e){} }
  return "";
}
function driveStatus(id){
  const dir = findDriveFolder();
  reply(id, { content: [{ type: "text", text: JSON.stringify(dir ? {ok: true, folder: dir} : {ok: false, reason: "Google Drive 데스크톱 앱이 실행 중이 아니거나 로그인되어 있지 않아요"}) }] });
}
// 조각을 이어 붙이고, 마지막 조각이 오면 Drive 폴더의 '메일 첨부'로 옮긴다
const CHUNK_DIR = path.join(os.tmpdir(), "mail-bigfile");
const BIG_MAX = 2 * 1024 * 1024 * 1024;
function stageChunk(id, args){
  const uploadId = String(args && args.uploadId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const index = Number(args && args.index), total = Number(args && args.total);
  const name = path.basename(String(args && args.name || "").normalize("NFC")).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "file";
  const b64 = String(args && args.base64Content || "");
  if (!uploadId || !(index >= 0) || !(total >= 1) || index >= total) return toolError(id, "bad chunk arguments");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return toolError(id, "empty chunk");
  fs.mkdirSync(CHUNK_DIR, {recursive: true});
  const part = path.join(CHUNK_DIR, uploadId + ".part");
  if (index === 0){ try { fs.unlinkSync(part); } catch (e){} }
  else if (!fs.existsSync(part)) return toolError(id, "earlier pieces are missing; start again");
  fs.appendFileSync(part, buf);
  const size = fs.statSync(part).size;
  if (size > BIG_MAX){ try { fs.unlinkSync(part); } catch (e){} return toolError(id, "file too large"); }
  if (index < total - 1) return reply(id, { content: [{ type: "text", text: JSON.stringify({done: false, received: size}) }] });
  // 마지막 조각 + rclone: 원래 이름으로 바꿔 두고 rclone 업로드를 시작한다 (끝날 때까지 기다리지 않는다)
  if (args && args.dest === "rclone"){
    if (!nativeOk() && !findRclone()){ try { fs.unlinkSync(part); } catch (e){} return toolError(id, "Google Drive is not connected (run drive_login)"); }
    const dir = path.join(CHUNK_DIR, uploadId);
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, name);
    try { fs.renameSync(part, file); } catch (e){ fs.copyFileSync(part, file); try { fs.unlinkSync(part); } catch (e2){} }
    if (nativeOk()) startNativeJob(uploadId, file, name); else startRcloneJob(uploadId, file, name);
    return reply(id, { content: [{ type: "text", text: JSON.stringify({done: true, jobId: uploadId, size}) }] });
  }
  // 마지막 조각: Drive 폴더로 옮긴다 (같은 이름이 있으면 번호를 붙인다)
  const drive = findDriveFolder();
  if (!drive){ return toolError(id, "Google Drive folder not found (is Google Drive for desktop running and signed in?)"); }
  const target = path.join(drive, "메일 첨부");
  fs.mkdirSync(target, {recursive: true});
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let finalName = name, k = 2;
  while (fs.existsSync(path.join(target, finalName))) finalName = stem + " (" + (k++) + ")" + ext;
  try { fs.renameSync(part, path.join(target, finalName)); }
  catch (e){ fs.copyFileSync(part, path.join(target, finalName)); try { fs.unlinkSync(part); } catch (e2){} }
  reply(id, { content: [{ type: "text", text: JSON.stringify({done: true, title: finalName, folder: "메일 첨부", size}) }] });
}

// ---- rclone으로 Google Drive에 직접 올리기 (16MB 넘는 첨부) ----
// 페이지는 큰 파일을 조각으로 넘기고(stage_chunk, dest: "rclone"), 다 모이면 rclone이 Drive의 '메일 첨부' 폴더로 올린다.
// 올리는 데 오래 걸리므로 바로 작업 번호를 돌려주고, 페이지가 upload_status로 진행을 묻는다.
const { spawn } = require("child_process");
let gdrive = null; try { gdrive = require("./drive.js"); } catch (e){}   // 내장 Google 로그인 (없으면 rclone만)
function nativeOk(){ try { return !!(gdrive && gdrive.status().connected); } catch (e){ return false; } }
const REMOTE = "gdrive";
const REMOTE_DIR = "메일 첨부";
function findRclone(){
  if (process.env.RCLONE_PATH && fs.existsSync(process.env.RCLONE_PATH)) return process.env.RCLONE_PATH;
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "WinGet", "Packages");
  try {
    for (const d of fs.readdirSync(base).filter(n => /^Rclone\.Rclone/i.test(n))){
      const inner = path.join(base, d);
      for (const s of fs.readdirSync(inner)){
        const exe = path.join(inner, s, "rclone.exe");
        if (fs.existsSync(exe)) return exe;
      }
      if (fs.existsSync(path.join(inner, "rclone.exe"))) return path.join(inner, "rclone.exe");
    }
  } catch (e){}
  const links = path.join(base, "..", "Links", "rclone.exe");
  if (fs.existsSync(links)) return links;
  return "";
}
function runRclone(args){
  return new Promise((resolve) => {
    const exe = findRclone();
    if (!exe) return resolve({code: -1, out: "", err: "rclone not installed"});
    const p = spawn(exe, args, {windowsHide: true});
    let out = "", err = "";
    p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d);
    p.on("close", code => resolve({code, out, err}));
    p.on("error", e => resolve({code: -1, out, err: String(e && e.message)}));
  });
}
async function rcloneStatus(id){
  if (nativeOk()) return reply(id, { content: [{ type: "text", text: JSON.stringify({ok: true, via: "google"}) }] });
  const st = gdrive ? gdrive.status() : null;
  const canLogin = !!(st && st.hasClient), pending = !!(st && st.login && st.login.pending);
  const exe = findRclone();
  if (!exe) return reply(id, { content: [{ type: "text", text: JSON.stringify({ok: false, canLogin, pending, reason: canLogin ? "Google Drive에 아직 로그인하지 않았어요" : "Google Drive 연결 정보가 없어요"}) }] });
  const r = await runRclone(["listremotes"]);
  const ok = r.code === 0 && r.out.split(/\r?\n/).some(l => l.trim() === REMOTE + ":");
  reply(id, { content: [{ type: "text", text: JSON.stringify(ok ? {ok: true, via: "rclone"} : {ok: false, canLogin, pending, reason: "Google Drive가 연결되어 있지 않아요"}) }] });
}
const jobs = new Map();
async function startRcloneJob(jobId, file, name){
  const job = {state: "uploading", percent: 0, title: name, error: "", id: ""};
  jobs.set(jobId, job);
  try {
    // 같은 이름이 있으면 번호를 붙인다
    const ls = await runRclone(["lsjson", REMOTE + ":" + REMOTE_DIR, "--files-only", "--no-modtime"]);
    const names = new Set(); try { JSON.parse(ls.out || "[]").forEach(e => names.add(e.Name)); } catch (e){}
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    let finalName = name, k = 2;
    while (names.has(finalName)) finalName = stem + " (" + (k++) + ")" + ext;
    job.title = finalName;
    const dest = REMOTE + ":" + REMOTE_DIR + "/" + finalName;
    await new Promise((resolve) => {
      const p = spawn(findRclone(), ["copyto", file, dest, "--stats", "2s", "--stats-one-line", "-v", "--drive-chunk-size", "16M"], {windowsHide: true});
      let tail = "";
      p.stderr.on("data", d => {
        tail = (tail + d).slice(-4000);
        const m = String(d).match(/(\d{1,3})%/g);
        if (m) job.percent = Math.min(100, Number(m[m.length - 1].replace("%", "")));
      });
      p.on("close", code => { if (code !== 0) job.error = (tail.split(/\r?\n/).filter(l => /ERROR|Failed|error/i.test(l)).pop() || "rclone exit " + code).slice(0, 300); resolve(); });
      p.on("error", e => { job.error = String(e && e.message); resolve(); });
    });
    if (job.error){ job.state = "failed"; return; }
    const st = await runRclone(["lsjson", "--stat", dest]);
    let info = {}; try { info = JSON.parse(st.out || "{}"); } catch (e){}
    if (!info.ID){ job.state = "failed"; job.error = "업로드한 파일을 Drive에서 찾지 못했어요"; return; }
    job.id = info.ID; job.percent = 100; job.state = "done";
  } catch (e){
    job.state = "failed"; job.error = String(e && e.message || e);
  } finally {
    try { fs.rmSync(path.dirname(file), {recursive: true, force: true}); } catch (e){}
  }
}
async function startNativeJob(jobId, file, name){
  const job = {state: "uploading", percent: 0, title: name, error: "", id: ""};
  jobs.set(jobId, job);
  try { job.id = await gdrive.upload(file, name, job); job.state = "done"; job.percent = 100; }
  catch (e){ job.state = "failed"; job.error = String(e && e.message || e).slice(0, 300); }
  finally { try { fs.rmSync(path.dirname(file), {recursive: true, force: true}); } catch (e){} }
}
async function driveLogin(id){
  if (!gdrive) return toolError(id, "built-in Google sign-in is not available");
  try { const r = await gdrive.startLogin(); reply(id, { content: [{ type: "text", text: JSON.stringify(r) }] }); }
  catch (e){ toolError(id, "login failed: " + (e && e.message)); }
}
function uploadStatus(id, args){
  const job = jobs.get(String(args && args.jobId || ""));
  if (!job) return toolError(id, "unknown upload job");
  reply(id, { content: [{ type: "text", text: JSON.stringify(job) }] });
}

// ---- 보낼 첨부를 잠시 저장 ----
const OUTBOX = path.join(os.tmpdir(), "mail-outbox");
const STAGE_MAX = 30 * 1024 * 1024;
function cleanOutbox(){
  try {
    if (!fs.existsSync(OUTBOX)) return;
    const now = Date.now();
    for (const n of fs.readdirSync(OUTBOX)){
      const p = path.join(OUTBOX, n);
      try { if (now - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, {recursive: true, force: true}); } catch (e){}
    }
  } catch (e){}
}
function stageFile(id, args){
  const raw = String(args && args.name || "").normalize("NFC");
  const name = path.basename(raw).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "file";
  const b64 = String(args && args.base64Content || "");
  if (!b64) return toolError(id, "no file content");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return toolError(id, "empty or invalid file content");
  if (buf.length > STAGE_MAX) return toolError(id, "file too large");
  cleanOutbox();
  // 파일마다 따로 폴더를 만들어 원래 이름을 그대로 쓴다 (받는 쪽에 보이는 첨부 이름)
  const dir = path.join(OUTBOX, Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, {recursive: true});
  const full = path.join(dir, name);
  fs.writeFileSync(full, buf);
  reply(id, { content: [{ type: "text", text: JSON.stringify({ path: full, size: buf.length }) }] });
}

// ---- 외부 그림 받아 오기 ----
// 메일 속 그림 주소만 받는다: http(s)만, 내 PC·사설망 주소는 거부, 그림이 아니거나 8MB를 넘으면 거부.
const dns = require("dns").promises;
const net = require("net");
const IMG_MAX = 8 * 1024 * 1024;
function isPrivateIp(ip){
  if (net.isIPv4(ip)){
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}
async function checkPublic(u){
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http(s) addresses are allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$/i.test(host) || /\.local$/i.test(host)) throw new Error("local addresses are refused");
  const addrs = net.isIP(host) ? [{address: host}] : await dns.lookup(host, {all: true});
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error("private network addresses are refused");
}
async function fetchImage(id, args){
  let u;
  try { u = new URL(String(args && args.url || "")); } catch (e){ return toolError(id, "not a valid address"); }
  try {
    // 넘겨주기(redirect)도 한 단계씩 확인한다
    let res, hops = 0;
    for (;;){
      await checkPublic(u);
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
      res = await fetch(u, {redirect: "manual", signal: ctl.signal, headers: {"User-Agent": "Mozilla/5.0 (mail image viewer)", "Accept": "image/*"}});
      clearTimeout(timer);
      if (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops++ < 5){ u = new URL(res.headers.get("location"), u); continue; }
      break;
    }
    if (!res.ok) return toolError(id, "server answered " + res.status);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\//.test(type)) return toolError(id, "not an image (" + (type || "unknown type") + ")");
    const len = Number(res.headers.get("content-length") || 0);
    if (len > IMG_MAX) return toolError(id, "image too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > IMG_MAX) return toolError(id, "image too large");
    const b64 = buf.toString("base64");
    if (args && args.as === "resource") return reply(id, { content: [{ type: "resource", resource: { uri: "mail-image:" + u.hostname + "/" + buf.length, mimeType: type, blob: b64 } }] });
    reply(id, { content: [{ type: "image", data: b64, mimeType: type }] });
  } catch (e){
    toolError(id, "could not fetch image: " + (e && e.name === "AbortError" ? "timed out" : (e && e.message) || "error"));
  }
}

// 다른 프로그램 안에서 모듈로 불릴 때는 응답을 그 프로그램에 돌려준다 (Claude 메일 확장 프로그램)
const resolvers = new Map();
function send(msg){
  if (msg && msg.id != null && resolvers.has(msg.id)){ const r = resolvers.get(msg.id); resolvers.delete(msg.id); return r(msg); }
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result){ send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message){ send({ jsonrpc: "2.0", id, error: { code, message } }); }
function toolError(id, text){ reply(id, { content: [{ type: "text", text }], isError: true }); }

function readAttachment(id, args){
  const raw = args && typeof args.filename === "string" ? args.filename : "";
  const name = raw.normalize("NFC");
  // 이름만 받는다: 폴더 구분자·상위 폴더·드라이브 표시가 있으면 거부
  if (!name || name !== path.basename(name) || /[\\/:]/.test(name) || name === "." || name === "..")
    return toolError(id, "filename must be a plain file name inside the imap-attachments folder");
  let full = path.join(DIR, name);
  if (!fs.existsSync(full)){
    // 저장된 이름의 유니코드 형태가 다를 수 있어 폴더에서 같은 이름을 찾는다
    const hit = fs.existsSync(DIR) ? fs.readdirSync(DIR).find(f => f.normalize("NFC") === name) : null;
    if (!hit) return toolError(id, "file not found in imap-attachments: " + name);
    full = path.join(DIR, hit);
  }
  const real = fs.realpathSync(full);
  if (path.dirname(real).toLowerCase() !== fs.realpathSync(DIR).toLowerCase())
    return toolError(id, "file is outside the imap-attachments folder");
  const st = fs.statSync(real);
  if (!st.isFile()) return toolError(id, "not a file");
  if (st.size > MAX_BYTES) return toolError(id, "file too large (" + st.size + " bytes, limit " + MAX_BYTES + ")");
  const ext = path.extname(real).slice(1).toLowerCase();
  const mimeType = MIME[ext] || "application/octet-stream";
  const data = fs.readFileSync(real).toString("base64");
  // 읽은 뒤에는 PC에 남은 사본을 지운다 (첨부를 볼 때마다 다운로드 폴더에 파일이 쌓이지 않게).
  // keep: true 로 부르면 남겨 둔다.
  let removed = false;
  if (!(args && args.keep === true)){
    try { fs.unlinkSync(real); removed = true; } catch (e){ /* 지우지 못해도 읽은 내용은 돌려준다 */ }
  }
  reply(id, {
    content: [
      { type: "text", text: JSON.stringify({ filename: path.basename(real), size: st.size, mimeType, removedFromDisk: removed }) },
      { type: "resource", resource: { uri: "file:///" + real.replace(/\\/g, "/"), mimeType, blob: data } }
    ]
  });
}

function handle(msg){
  const { id, method, params } = msg;
  if (method === "initialize"){
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "attachments", version: "1.0.0" }
    });
  }
  if (method === "notifications/initialized" || (method && method.startsWith("notifications/"))) return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call"){
    const name = params && params.name;
    try {
      if (name === "read_saved_attachment") return readAttachment(id, params.arguments || {});
      if (name === "stage_file") return stageFile(id, params.arguments || {});
      if (name === "drive_folder_status") return driveStatus(id);
      if (name === "stage_chunk") return stageChunk(id, params.arguments || {});
      if (name === "rclone_status"){ pending++; return rcloneStatus(id).finally(() => { pending--; if (ended && !pending) process.exit(0); }); }
      if (name === "upload_status") return uploadStatus(id, params.arguments || {});
      if (name === "drive_login") return driveLogin(id);
      if (name === "fetch_image"){ pending++; return fetchImage(id, params.arguments || {}).finally(() => { pending--; if (ended && !pending) process.exit(0); }); }
      return fail(id, -32602, "unknown tool: " + name);
    } catch (e){ return toolError(id, "read failed: " + (e && e.message)); }
  }
  if (id !== undefined) fail(id, -32601, "method not found: " + method);
}

let pending = 0, ended = false;   // 그림 받기가 끝나기 전에 닫히지 않게
if (require.main !== module){
  module.exports = { request(msg){ return new Promise(r => { resolvers.set(msg.id, r); handle(msg); }); } };
} else {
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0){
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (e){ fail(null, -32700, "parse error"); continue; }
    handle(msg);
  }
});
process.stdin.on("end", () => { ended = true; if (!pending) process.exit(0); });
console.error("[attachments] serving " + DIR);
}
