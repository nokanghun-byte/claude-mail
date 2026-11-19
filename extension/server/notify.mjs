// 새 메일 알림: Claude 앱이 켜져 있는 동안 IMAP 계정의 받은메일함을 몇 분마다 확인하고,
// 새로 온 안 읽은 메일이 있으면 운영체제 알림(윈도우 알림 센터 / macOS 알림)을 띄운다.
// - 메일 페이지 창을 닫아 두어도 동작한다.
// - 마지막으로 본 메일 번호(UID)만 ~/.claude-mail/notify-state.json 에 저장한다 (메일 내용은 저장하지 않음).
// - 끄기: 확장 프로그램 설정의 '새 메일 알림'을 끈다.

import { spawn } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

const STATE_FILE = join(homedir(), ".claude-mail", "notify-state.json");
const SHOW_EACH = 3;           // 이보다 많이 오면 한 번에 묶어서 알린다

function flag(v, def){
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s || /^\$\{/.test(s)) return def;
  return !(s === "false" || s === "0" || s === "off" || s === "no");
}
function minutes(v, def){
  const n = Number(String(v == null ? "" : v).trim());
  return isFinite(n) && n >= 1 ? Math.min(n, 60) : def;
}

function loadState(){ try { return JSON.parse(readFileSync(STATE_FILE, "utf8")) || {}; } catch (e){ return {}; } }
function saveState(s){ try { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e){} }

function xml(s){ return String(s || "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]); }
function short(s, n){ s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function senderName(from){
  const s = String(from || "");
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : s).trim() || "(보낸 사람 없음)";
}

// 윈도우: 알림 센터 토스트. 알림 주체는 Claude 앱(누르면 Claude가 앞으로 나온다), 못 찾으면 PowerShell.
function toastWindows(title, lines){
  const body = lines.map(l => "<text>" + xml(l) + "</text>").join("");
  const toastXml = "<toast><visual><binding template=\"ToastGeneric\"><text>" + xml(title) + "</text>" + body + "</binding></visual><audio src=\"ms-winsoundevent:Notification.Mail\"/></toast>";
  const ps = [
    "$ErrorActionPreference='Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "$id = $null",
    "try { $id = (Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1).AppID } catch {}",
    "if (-not $id) { $id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe' }",
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$x.LoadXml('" + toastXml.replace(/'/g, "''") + "')",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))"
  ].join("; ");
  const enc = Buffer.from(ps, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", enc]);
}
function toastMac(title, lines){
  const q = s => "\"" + String(s || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
  const script = "display notification " + q(lines.slice(1).join(" · ")) + " with title " + q(title) + " subtitle " + q(lines[0] || "") + " sound name \"default\"";
  return run("osascript", ["-e", script]);
}
function run(cmd, args){
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let err = "";
      p.stderr.on("data", d => { err += d; });
      p.on("error", e => resolve({ ok: false, error: String(e && e.message || e) }));
      p.on("close", code => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().slice(0, 500) || ("exit " + code) }));
    } catch (e){ resolve({ ok: false, error: String(e && e.message || e) }); }
  });
}
export function showNotification(title, lines){
  if (process.platform === "win32") return toastWindows(title, lines);
  if (process.platform === "darwin") return toastMac(title, lines);
  return Promise.resolve({ ok: false, error: "unsupported platform" });
}

function parse(r){
  try { return JSON.parse(((r && r.content) || []).map(c => c.text || "").join("")); } catch (e){ return null; }
}

// getClient: imap MCP 클라이언트를 돌려주는 함수, log: 로그 함수
export function startNotifier(getClient, log){
  const enabled = flag(process.env.CLAUDE_MAIL_NOTIFY, true);
  const every = minutes(process.env.CLAUDE_MAIL_NOTIFY_MINUTES, 3);
  if (!enabled){ log("notify: off"); return; }
  const state = loadState();
  let busy = false;

  async function checkAll(){
    if (busy) return; busy = true;
    try {
      const client = await getClient();
      const list = parse(await client.callTool({ name: "imap_list_accounts", arguments: {} }));
      const accounts = (list && list.accounts) || [];
      for (const acc of accounts){
        try { await checkOne(client, acc); }
        catch (e){ log("notify: " + acc.name + " 확인 실패: " + (e && e.message || e)); }
      }
      saveState(state);
    } catch (e){ log("notify error: " + (e && e.message || e)); }
    finally { busy = false; }
  }

  async function checkOne(client, acc){
    const r = await client.callTool({ name: "imap_get_latest_emails", arguments: { accountId: acc.id, folder: "INBOX", count: 15 } }, undefined, { timeout: 2 * 60 * 1000 });
    if (r && r.isError) throw new Error(((r.content || [])[0] || {}).text || "error");
    const ms = ((parse(r) || {}).messages || []).filter(m => typeof m.uid === "number");
    // 받은메일함이 비어 있으면 기준을 0으로 잡아 두어야 첫 메일이 와도 알릴 수 있다
    if (!ms.length){ if (typeof state[acc.id] !== "number") state[acc.id] = 0; return; }
    const maxUid = Math.max.apply(null, ms.map(m => m.uid));
    const last = state[acc.id];
    // 처음 보는 계정이거나 메일함 번호가 새로 매겨졌으면(이전보다 작음) 기준만 잡고 알리지 않는다
    if (typeof last !== "number" || maxUid < last){ state[acc.id] = maxUid; return; }
    const fresh = ms.filter(m => m.uid > last && !(m.flags || []).some(f => /\\seen/i.test(f)))
                    .sort((a, b) => b.uid - a.uid);
    state[acc.id] = Math.max(last, maxUid);
    if (!fresh.length) return;
    const label = acc.name || acc.user || "메일";
    if (fresh.length > SHOW_EACH){
      const who = Array.from(new Set(fresh.map(m => senderName(m.from)))).slice(0, 3).join(", ");
      await notify("새 메일 " + fresh.length + "통 · " + label, [short(who + " 외", 80)]);
    } else {
      for (const m of fresh.reverse()){
        await notify("새 메일 · " + label, [short(senderName(m.from), 60), short(m.subject || "(제목 없음)", 120)]);
      }
    }
  }
  async function notify(title, lines){
    const r = await showNotification(title, lines);
    if (!r.ok) log("notify: 알림 표시 실패: " + r.error);
  }

  log("notify: on, every " + every + " min");
  setTimeout(checkAll, 20 * 1000);
  setInterval(checkAll, every * 60 * 1000);
}
