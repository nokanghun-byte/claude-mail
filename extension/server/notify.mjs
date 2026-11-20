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
// 윈도우: 메일 페이지 안 알림과 같은 모양의 작은 창을 화면 오른쪽 아래에 직접 띄운다 (알림 센터를 쓰지 않음).
// 포커스를 빼앗지 않고, 8초 뒤 사라진다(마우스를 올리면 기다림). 누르면 Claude 창을 앞으로 가져온다.
// 여러 통이면 위로 쌓는다(slot).
const POPUP_SECONDS = 8;
const AV_COLORS = ["#3182F6", "#00A661", "#7B61FF", "#F04452", "#FF8A00", "#00A3C4", "#E2489C", "#5B6B7F"];
function avColor(name){ let h = 0; const n = String(name || "?"); for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
const POPUP_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, Microsoft.VisualBasic
$d = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__DATA__')) | ConvertFrom-Json
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
  WindowStyle="None" AllowsTransparency="True" Background="Transparent" Topmost="True" ShowInTaskbar="False" ShowActivated="False"
  ResizeMode="NoResize" Width="400" Height="98" Opacity="0" FontFamily="Pretendard, Malgun Gothic, Segoe UI">
  <Border x:Name="Card" CornerRadius="14" Background="#F51E1F23" BorderBrush="#2EFFFFFF" BorderThickness="1" Padding="16,0,14,0" Margin="12,5,12,5" Height="88" Cursor="Hand">
    <Border.Effect><DropShadowEffect BlurRadius="26" ShadowDepth="5" Direction="270" Opacity="0.45"/></Border.Effect>
    <Grid VerticalAlignment="Center">
      <Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <Border x:Name="AvBg" Width="40" Height="40" CornerRadius="20" VerticalAlignment="Top">
        <TextBlock x:Name="Av" FontSize="16" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center"/>
      </Border>
      <StackPanel Grid.Column="1" Margin="12,0,6,0">
        <TextBlock x:Name="Head" FontSize="12" FontWeight="SemiBold" Foreground="#6AA6FF"/>
        <TextBlock x:Name="Subj" FontSize="15" FontWeight="Bold" Foreground="#F4F5F7" TextTrimming="CharacterEllipsis" Margin="0,3,0,0"/>
        <TextBlock x:Name="From" FontSize="13" Foreground="#A3A8B0" TextTrimming="CharacterEllipsis" Margin="0,2,0,0"/>
      </StackPanel>
      <TextBlock x:Name="Close" Grid.Column="2" Text="&#x2715;" FontSize="12" Foreground="#80FFFFFF" VerticalAlignment="Top" Padding="4,0,2,4"/>
    </Grid>
  </Border>
</Window>
'@
$w = [Windows.Markup.XamlReader]::Parse($xaml)
$conv = New-Object Windows.Media.BrushConverter
$w.FindName('Head').Text = $d.head
$w.FindName('Subj').Text = $d.subject
$w.FindName('From').Text = $d.from
$w.FindName('Av').Text = $d.letter
$w.FindName('Av').Foreground = $conv.ConvertFromString($d.color)
$bg = $conv.ConvertFromString($d.color); $bg.Opacity = 0.22; $w.FindName('AvBg').Background = $bg
$fade = { param($to, $done) $a = New-Object Windows.Media.Animation.DoubleAnimation($to, [TimeSpan]::FromMilliseconds(220)); if ($done) { $a.add_Completed($done) }; $w.BeginAnimation([Windows.Window]::OpacityProperty, $a) }
$close = { & $fade 0 ([EventHandler]{ $w.Close() }) }
$w.add_Loaded({
  $wa = [Windows.SystemParameters]::WorkArea
  # 창 높이 98 = 카드 88 + 위아래 여백 5씩 → 카드 사이 10px, 화면 아래·오른쪽과는 12px
  $w.Left = $wa.Right - $w.Width
  $w.Top = $wa.Bottom - 7 - $w.Height * ([int]$d.slot + 1)
  & $fade 1 $null
})
$t = New-Object Windows.Threading.DispatcherTimer
$t.Interval = [TimeSpan]::FromSeconds([int]$d.seconds)
$t.add_Tick({ $t.Stop(); & $close })
$w.add_MouseEnter({ $t.Stop() })
$w.add_MouseLeave({ $t.Start() })
$w.FindName('Close').add_MouseLeftButtonUp({ param($s, $e) $e.Handled = $true; $t.Stop(); & $close })
$w.FindName('Card').add_MouseLeftButtonUp({
  $t.Stop()
  try { $p = Get-Process -Name 'Claude' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) } } catch {}
  & $close
})
try { $snd = Join-Path $env:WINDIR 'Media\Windows Notify Email.wav'; if (Test-Path $snd) { (New-Object Media.SoundPlayer $snd).Play() } } catch {}
$t.Start()
[void]$w.ShowDialog()
`;
const slots = [];   // 지금 떠 있는 알림 창 자리
function popupWindows(info){
  let slot = 0; while (slots[slot]) slot++;
  slots[slot] = true;
  const data = Buffer.from(JSON.stringify({ seconds: POPUP_SECONDS, slot, ...info }), "utf8").toString("base64");
  const ps = POPUP_PS.replace("__DATA__", data);
  const enc = Buffer.from(ps, "utf16le").toString("base64");
  setTimeout(() => { slots[slot] = false; }, (POPUP_SECONDS + 2) * 1000);
  // 창이 떠 있는 동안 기다리지 않는다 (다음 알림이 위로 쌓이게)
  return new Promise((resolve) => {
    try {
      const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", enc], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let err = "";
      p.stderr.on("data", d => { err += d; });
      p.on("error", e => resolve({ ok: false, error: String(e && e.message || e) }));
      p.on("close", code => { if (code !== 0) resolve({ ok: false, error: err.trim().slice(0, 500) || ("exit " + code) }); });
      setTimeout(() => resolve({ ok: true }), 4000);   // 4초 안에 실패하지 않았으면 떴다고 본다
    } catch (e){ resolve({ ok: false, error: String(e && e.message || e) }); }
  });
}
export async function showMailPopup(info){
  if (process.platform !== "win32") return showNotification(info.head, [info.from, info.subject]);
  // 동그라미 글자: '(주)', '㈜', 따옴표 같은 걸 건너뛰고 첫 글자
  const nm = String(info.from || "").replace(/^\s*(\(주\)|㈜|\(유\)|\(사\))\s*/, "");
  const ch = (nm.match(/[0-9A-Za-zㄱ-ㆎ가-힣぀-ヿ一-鿿]/) || ["?"])[0];
  const r = await popupWindows({ letter: ch.toUpperCase(), color: avColor(info.from), ...info });
  // 직접 그린 창이 안 뜨면 윈도우 알림으로라도 알린다
  return r.ok ? r : toastWindows(info.head, [info.from, info.subject]);
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

// 메일 페이지와 같은 계정 이름 (서버 주소로 정한다)
const ACC_NAMES = [[/naver\.com$/, "네이버"], [/worksmobile\.com$/, "네이버웍스"], [/kakao\.com$/, "카카오"], [/daum\.net$/, "다음"],
  [/(outlook|office365|hotmail|live)\.com$/, "아웃룩"], [/nate\.com$/, "네이트"], [/hiworks\.com$/, "하이웍스"], [/(gmail|googlemail)\.com$/, "Gmail"],
  [/(icloud|me)\.com$/, "iCloud"], [/yahoo\.com$/, "Yahoo"]];
function accountLabel(acc){
  const host = String(acc && acc.host || "").toLowerCase();
  for (const [re, name] of ACC_NAMES) if (re.test(host)) return name;
  return (acc && (acc.name || acc.user)) || "메일";
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
    const label = accountLabel(acc);
    if (fresh.length > SHOW_EACH){
      const who = Array.from(new Set(fresh.map(m => senderName(m.from)))).slice(0, 3).join(", ");
      await notify({ head: "새 메일 " + fresh.length + "통 · " + label, subject: short(fresh[0].subject || "(제목 없음)", 120), from: short(who + " 외", 80) });
    } else {
      for (const m of fresh.reverse()){
        await notify({ head: "새 메일 · " + label, subject: short(m.subject || "(제목 없음)", 120), from: short(senderName(m.from), 60) });
      }
    }
  }
  async function notify(info){
    const r = await showMailPopup(info);
    if (!r.ok) log("notify: 알림 표시 실패: " + r.error);
  }

  log("notify: on, every " + every + " min");
  setTimeout(checkAll, 20 * 1000);
  setInterval(checkAll, every * 60 * 1000);
}
