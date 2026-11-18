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
writeFileSync(join(dist, "setup-core.mjs"), w);

// 3) 복사
copyFileSync(join(here, "..", "helper", "server.js"), join(here, "server", "attachments.js"));
copyFileSync(join(here, "..", "helper", "drive.js"), join(here, "server", "drive.js"));
mkdirSync(join(here, "page"), { recursive: true });
copyFileSync(join(here, "..", "page", "claude-mail.html"), join(here, "page", "claude-mail.html"));
copyFileSync(join(here, "..", "page", "capabilities.json"), join(here, "page", "capabilities.json"));
console.log("준비 완료: imap-core.mjs, setup-core.mjs, attachments.js, drive.js, page/");
