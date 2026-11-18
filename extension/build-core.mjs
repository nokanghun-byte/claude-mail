// imap-mcp-server의 실행 파일을 '모듈'로 바꿔 server/imap-core.mjs로 만든다.
// (Claude 앱의 내장 Node.js는 하위 Node 프로세스를 띄울 수 없어서, 한 프로세스 안에서 불러 써야 한다)
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "node_modules", "imap-mcp-server", "dist", "index.js");
let s = readFileSync(src, "utf8");
const start = s.indexOf("async function main() {");
const end = s.indexOf("});", s.indexOf("main().catch(", start)) + 3;
if (start < 0 || end < 3) throw new Error("imap-mcp-server 구조가 바뀌었어요: main()을 찾지 못했습니다");
s = s.slice(0, start) + "export { server };\n" + s.slice(end);
s = s.replace(/^#!.*\n/, "");
writeFileSync(join(here, "server", "imap-core.mjs"), s);
console.log("server/imap-core.mjs 생성 완료");
