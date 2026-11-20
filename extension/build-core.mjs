// 확장 프로그램을 만들기 전에 필요한 파일을 준비한다.
//  1) imap-mcp-server 실행 파일을 '모듈'로 바꿔 server/imap-core.mjs로 만든다
//     (Claude 앱의 내장 Node.js는 하위 Node 프로세스를 띄울 수 없어서, 한 프로세스 안에서 불러 써야 한다)
//     + 보낸편지함을 찾을 때 한국어 이름도 찾게 한다
//  2) 계정 등록 화면(setup.js)을 모듈로 바꿔 dist/setup-core.mjs로 만든다 (public 폴더를 그대로 쓰려고 같은 폴더에 둔다)
//  3) 첨부 도우미·Drive 업로드·메일 페이지를 복사한다
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "node_modules", "imap-mcp-server", "dist");

// 1) imap-core
let s = readFileSync(join(dist, "index.js"), "utf8");
const start = s.indexOf("async function main() {");
const end = s.indexOf("});", s.indexOf("main().catch(", start)) + 3;
if (start < 0 || end < 3) throw new Error("imap-mcp-server 구조가 바뀌었어요: main()을 찾지 못했습니다");
s = s.slice(0, start) + "export { server };\n" + s.slice(end);
s = s.replace(/^#!.*\n/, "");
const sentList = '      "Sent Messages",\n      "Sent",';
if (!s.includes(sentList)) throw new Error("보낸편지함 이름 목록을 찾지 못했습니다");
s = s.replace(sentList, '      "Sent Messages",\n      "보낸메일함",\n      "보낸편지함",\n      "보낸 편지함",\n      "Sent",');
// 계정 등록 화면에서 새로 추가한 계정이 목록에 바로 보이도록, 목록을 줄 때마다 파일을 다시 읽게 한다
const listFn = "  getAllAccounts() {\n    return Array.from(this.accounts";
if (!s.includes(listFn)) throw new Error("getAllAccounts를 찾지 못했습니다");
s = s.replace(listFn, "  getAllAccounts() {\n    this.loadAccountsSync();\n    return Array.from(this.accounts");
// 인코딩 표시 없이 EUC-KR 글자로 온 제목(오래된 국내 광고 메일 등)이 '�'로 깨지지 않게.
// 카카오 등은 ENVELOPE·헤더 요청에는 이미 깨진 글자를 주지만 원문(BODY[])에는 원래 바이트가 남아 있다.
// 그래서 목록을 다 만든 뒤, 제목·보낸 사람이 깨진 메일만 원문 앞부분(16KB)을 받아 EUC-KR로 다시 읽는다.
const retPoints = [
  "      return messages;\n",
  "      return messages.sort((a, b) => b.date.getTime() - a.date.getTime());\n"
];
for (const rp of retPoints) {
  if (s.split(rp).length - 1 !== 1) throw new Error("메일 목록 반환 위치를 못 찾았어요: " + rp.trim());
  s = s.replace(rp, "      await fixBrokenSubjects(client, messages);\n" + rp);
}
s = s.replace("// src/utils/client-side-search.ts", `// 깨진 제목 고치기 (Claude Mail 확장 프로그램이 덧붙임)
function rawHeaderBytes(head, name) {
  const want = name.toLowerCase() + ":";
  const lines = head.toString("latin1").split(/\\r?\\n(?![ \\t])/);
  for (const l of lines) if (l.slice(0, want.length).toLowerCase() === want) return Buffer.from(l.slice(want.length).replace(/\\r?\\n[ \\t]+/g, " "), "latin1");
  return null;
}
function decodeRaw(bytes) {
  if (!bytes) return "";
  if (!bytes.some((b) => b > 127)) return "";
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); } catch {}
  try { const t = new TextDecoder("euc-kr").decode(bytes).trim(); return t.includes("\\ufffd") ? "" : t; } catch { return ""; }
}
async function fixBrokenSubjects(client, list) {
  try {
    const bad = (list || []).filter((m) => m && m.uid && (/\\ufffd/.test(m.subject || "") || /\\ufffd/.test(m.from || "")));
    if (!bad.length) return;
    const byUid = new Map(bad.map((m) => [m.uid, m]));
    for await (const r of client.fetch(bad.map((m) => m.uid).join(","), { uid: true, source: { start: 0, maxLength: 16384 } }, { uid: true })) {
      const m = byUid.get(r.uid);
      if (!m || !r.source) continue;
      const src = Buffer.from(r.source);
      let end = src.indexOf("\\r\\n\\r\\n");
      if (end < 0) end = src.indexOf("\\n\\n");
      const head = end < 0 ? src : src.subarray(0, end);
      if (/\\ufffd/.test(m.subject || "")) { const t = decodeRaw(rawHeaderBytes(head, "subject")); if (t) m.subject = t; }
      if (/\\ufffd/.test(m.from || "")) { const f = decodeRaw(rawHeaderBytes(head, "from")); if (f) m.from = f; }
    }
  } catch {}
}

// src/utils/client-side-search.ts`);
if (!s.includes("async function fixBrokenSubjects")) throw new Error("제목 고치기 함수를 넣지 못했어요");
// 첨부를 저장 위치(savePath)에 저장할 때 같은 이름의 파일이 있으면 덮어쓰지 않고 '이름 (1).확장자'로 저장한다
for (const [fsv, pv, tv] of [["fs3", "path3", "targetPath2"], ["fs2", "path2", "targetPath"]]) {
  const from = `    const ${tv} = savePath || ${pv}.join(DOWNLOAD_DIR, ${pv}.basename(resolvedFilename));`;
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error("첨부 저장 위치 코드를 못 찾았어요: " + tv + " (" + n + ")");
  s = s.replace(from, `    let ${tv} = savePath || ${pv}.join(DOWNLOAD_DIR, ${pv}.basename(resolvedFilename));
    if (savePath && ${fsv}.existsSync(${tv})) {
      const ext0 = ${pv}.extname(${tv}), stem0 = ext0 ? ${tv}.slice(0, -ext0.length) : ${tv};
      for (let k = 1; k < 1000; k++) { const c = stem0 + " (" + k + ")" + ext0; if (!${fsv}.existsSync(c)) { ${tv} = c; break; } }
    }`);
}
// 확장 프로그램의 임시보관 정리 도구(extras.mjs)가 쓰도록 내부 객체도 내보낸다
if (!s.includes("\nexport { server };")) throw new Error("imap-core export 구조가 바뀌었어요");
s = s.replace("\nexport { server };", "\nexport { server, imapService, accountManager };");
writeFileSync(join(here, "server", "imap-core.mjs"), s);

// 2) setup-core (명령줄 처리 부분을 빼고 WebUIServer만 내보낸다)
let w = readFileSync(join(dist, "setup.js"), "utf8").replace(/^#!.*\n/, "");
const cli = w.indexOf('program.name("imap-setup")');
if (cli < 0) throw new Error("setup.js 구조가 바뀌었어요");
w = w.slice(0, cli) + "export { WebUIServer };\n";
// 2-1) 등록 화면 손보기: 'Command failed' 대신 이유를 한국어로, Gmail 앱 비밀번호의 띄어쓰기 제거
function must(from, to){ if (w.indexOf(from) < 0) throw new Error("setup.js 패치 위치를 못 찾았어요: " + from.slice(0, 60)); w = w.split(from).join(to); }
w += `
function cleanPw(pw, host) {
  const s = String(pw == null ? "" : pw);
  return /gmail|google/i.test(String(host || "")) ? s.replace(/\\s+/g, "") : s.trim();
}
function friendlyImapError(error, host) {
  const msg = error instanceof Error ? error.message : String(error || "");
  const resp = (error && (error.responseText || error.response)) || "";
  const g = /gmail|google/i.test(String(host || ""));
  // 접속 단계에서 원래 오류가 'Command failed' 한 줄로 바뀌어 오는데, 이건 거의 항상 로그인 거부다
  if (error && error.authenticationFailed || /^Command failed\\.?$/i.test(msg.trim()) || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(msg + " " + resp)) {
    return g
      ? "Gmail이 로그인을 거부했어요 (아이디 또는 비밀번호 오류). 평소 Google 비밀번호가 아니라 16자리 '앱 비밀번호'를 넣어야 해요. 2단계 인증을 켠 뒤 https://myaccount.google.com/apppasswords 에서 만들 수 있어요."
      : "메일 서버가 로그인을 거부했어요 (아이디 또는 비밀번호 오류). 메일 설정에서 IMAP/SMTP 사용을 켰는지, 앱 비밀번호(또는 외부 메일 프로그램용 비밀번호)를 넣었는지 확인해 주세요." + (resp ? " (서버 응답: " + resp + ")" : "");
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return "서버 주소를 찾지 못했어요. IMAP 서버 주소를 확인해 주세요.";
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(msg)) return "서버에 연결하지 못했어요. 서버 주소·포트(보통 993)와 인터넷 연결을 확인해 주세요.";
  return (msg || "연결 시험 실패") + (resp ? " (" + resp + ")" : "");
}
`;
must('const { email, password, host, port, tls, imapUsername } = req.body;',
     'const { email, password: rawPassword, host, port, tls, imapUsername } = req.body;\n        const password = cleanPw(rawPassword, host || "imap.gmail.com");');
must('error: error instanceof Error ? error.message : "Connection test failed"',
     'error: friendlyImapError(error, req.body && req.body.host)');
must('password: imapPasswordFromEnv ? "" : password,',
     'password: imapPasswordFromEnv ? "" : cleanPw(password, imapHost),');
must('            ...smtp,\n',
     '            ...smtp,\n            ...smtp.password ? { password: cleanPw(smtp.password, smtp.host || imapHost) } : {},\n');
writeFileSync(join(dist, "setup-core.mjs"), w);

// 3) 복사
copyFileSync(join(here, "..", "helper", "server.js"), join(here, "server", "attachments.js"));
copyFileSync(join(here, "..", "helper", "drive.js"), join(here, "server", "drive.js"));
mkdirSync(join(here, "page"), { recursive: true });
copyFileSync(join(here, "..", "page", "claude-mail.html"), join(here, "page", "claude-mail.html"));
copyFileSync(join(here, "..", "page", "capabilities.json"), join(here, "page", "capabilities.json"));
console.log("준비 완료: imap-core.mjs, setup-core.mjs, attachments.js, drive.js, page/");
