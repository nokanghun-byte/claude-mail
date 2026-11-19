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
