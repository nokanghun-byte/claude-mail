// Google Drive에 큰 첨부파일을 직접 올린다 (rclone 없이).
// - 로그인: 내 PC의 임시 주소(127.0.0.1)로 Google 로그인 결과를 받는 방식 (PKCE)
// - 권한: drive.file (이 프로그램이 올린 파일만 볼 수 있음)
// - 토큰: ~/.claude-mail/google-token.json (내 PC에만 저장)
// - 클라이언트 ID/비밀: 환경변수 CLAUDE_MAIL_GOOGLE_CLIENT_ID / _SECRET (확장 프로그램 설정),
//   없으면 rclone 설정의 [gdrive] client_id / client_secret 을 쓴다.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_FILE = path.join(os.homedir(), ".claude-mail", "google-token.json");
const FOLDER_NAME = "메일 첨부";

function readRcloneClient(){
  const cands = [
    process.env.RCLONE_CONFIG,
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "rclone", "rclone.conf"),
    path.join(os.homedir(), ".config", "rclone", "rclone.conf")
  ].filter(Boolean);
  for (const f of cands){
    try {
      const txt = fs.readFileSync(f, "utf8");
      const sec = txt.split(/^\[/m).find(s => /^gdrive\]/.test(s));
      if (!sec) continue;
      const get = k => { const m = sec.match(new RegExp("^" + k + "\\s*=\\s*(.+)$", "m")); return m ? m[1].trim() : ""; };
      if (get("client_id") && get("client_secret")) return { id: get("client_id"), secret: get("client_secret"), from: "rclone" };
    } catch (e){}
  }
  return null;
}
function client(){
  const id = (process.env.CLAUDE_MAIL_GOOGLE_CLIENT_ID || "").trim(), secret = (process.env.CLAUDE_MAIL_GOOGLE_CLIENT_SECRET || "").trim();
  if (id && secret && !/^\$\{/.test(id)) return { id, secret, from: "settings" };
  // 한 번 로그인하면 클라이언트 정보도 토큰 파일에 같이 저장해 두므로, 이후에는 rclone 설정이 없어도 된다
  const t = loadToken();
  if (t && t.client_id && t.client_secret) return { id: t.client_id, secret: t.client_secret, from: "saved" };
  return readRcloneClient();
}
function loadToken(){ try { return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch (e){ return null; } }
function saveToken(t){ fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 }); }

function openBrowser(url){
  try {
    if (process.platform === "win32") spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch (e){ return false; }
}

let login = null;   // 진행 중인 로그인 {url, state, done, error}
function status(){
  const c = client(), t = loadToken();
  return {
    connected: !!(c && t && t.refresh_token && t.client_id === c.id),
    hasClient: !!c,
    clientFrom: c ? c.from : "",
    login: login ? { pending: !login.done, error: login.error || "" } : null
  };
}

function startLogin(){
  const c = client();
  if (!c) return Promise.resolve({ ok: false, reason: "Google 클라이언트 ID가 없어요. 확장 프로그램 설정에 넣어 주세요." });
  if (login && !login.done) { openBrowser(login.url); return Promise.resolve({ ok: true, url: login.url, reopened: true }); }
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/callback"){ res.writeHead(404); return res.end(); }
      const page = (msg) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end("<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;padding:40px'><h2>" + msg + "</h2><p>이 창은 닫아도 돼요.</p>"); };
      try {
        if (u.searchParams.get("state") !== state) throw new Error("state mismatch");
        if (u.searchParams.get("error")) throw new Error(u.searchParams.get("error"));
        const code = u.searchParams.get("code");
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier })
        });
        const j = await r.json();
        if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "no refresh token");
        saveToken({ client_id: c.id, client_secret: c.secret, refresh_token: j.refresh_token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 - 60000 });
        login.done = true;
        page("Google Drive 연결 완료");
      } catch (e){
        login.done = true; login.error = String(e && e.message || e);
        page("연결하지 못했어요: " + login.error.replace(/[<>&]/g, ""));
      } finally {
        setTimeout(() => srv.close(), 500);
      }
    });
    let redirect = "";
    srv.listen(0, "127.0.0.1", () => {
      redirect = "http://127.0.0.1:" + srv.address().port + "/callback";
      const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
        client_id: c.id, redirect_uri: redirect, response_type: "code", scope: SCOPE,
        access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256"
      });
      login = { url, done: false, error: "" };
      setTimeout(() => { if (login && !login.done){ login.done = true; login.error = "시간이 지나 로그인이 취소됐어요"; try { srv.close(); } catch (e){} } }, 10 * 60 * 1000);
      openBrowser(url);
      resolve({ ok: true, url });
    });
  });
}

async function accessToken(){
  const c = client(), t = loadToken();
  if (!c || !t || !t.refresh_token) throw new Error("Google Drive가 연결되어 있지 않아요");
  if (t.access_token && t.expires_at > Date.now()) return t.access_token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: t.refresh_token, grant_type: "refresh_token" })
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google 로그인 갱신 실패: " + (j.error_description || j.error || r.status));
  t.access_token = j.access_token; t.expires_at = Date.now() + (j.expires_in || 3600) * 1000 - 60000;
  saveToken(t);
  return t.access_token;
}

async function api(method, url, body, headers){
  const tok = await accessToken();
  const r = await fetch(url, { method, headers: Object.assign({ Authorization: "Bearer " + tok }, headers || {}), body });
  return r;
}

async function folderId(){
  const q = "name = '" + FOLDER_NAME + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const r = await api("GET", "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id)", spaces: "drive" }));
  const j = await r.json();
  if (j.files && j.files[0]) return j.files[0].id;
  const c = await api("POST", "https://www.googleapis.com/drive/v3/files?fields=id", JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }), { "Content-Type": "application/json" });
  const cj = await c.json();
  if (!cj.id) throw new Error("Drive에 '메일 첨부' 폴더를 만들지 못했어요");
  return cj.id;
}

// 파일 하나를 이어 올리기 방식으로 올린다. job: {percent, title, id}
async function upload(file, name, job){
  const size = fs.statSync(file).size;
  const parent = await folderId();
  const init = await api("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name",
    JSON.stringify({ name, parents: [parent] }),
    { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size) });
  if (!init.ok) throw new Error("업로드 시작 실패 (" + init.status + ")");
  const loc = init.headers.get("location");
  const CH = 8 * 1024 * 1024;
  const fd = fs.openSync(file, "r");
  try {
    let off = 0;
    while (off < size){
      const len = Math.min(CH, size - off), buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, off);
      const tok = await accessToken();
      const r = await fetch(loc, { method: "PUT", headers: { Authorization: "Bearer " + tok, "Content-Length": String(len), "Content-Range": "bytes " + off + "-" + (off + len - 1) + "/" + size }, body: buf });
      if (r.status === 308){ const rg = r.headers.get("range"); off = rg ? Number(rg.split("-")[1]) + 1 : off + len; }
      else if (r.ok){ const j = await r.json(); job.percent = 100; job.title = j.name || name; return j.id; }
      else throw new Error("업로드 실패 (" + r.status + ")");
      job.percent = Math.floor(off / size * 100);
    }
  } finally { fs.closeSync(fd); }
  throw new Error("업로드가 끝나지 않았어요");
}

module.exports = { status, startLogin, upload };
