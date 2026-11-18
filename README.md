# Claude 메일 · Claude Mail

[한국어](#한국어) · [English](#english)

> 개인 프로젝트이며 Anthropic의 공식 제품이 아닙니다.
> This is a personal project, not an official Anthropic product.

---

## 한국어

Claude 데스크톱 앱 안에서 **Gmail과 IMAP 메일을 한 화면에서** 읽고 답장하는 웹메일 페이지입니다.
Claude 아티팩트(페이지)와 내 PC에서 돌아가는 작은 도우미 서버로 이루어져 있습니다.

### 어떤 메일을 연결할 수 있나요?

- **Gmail**: Claude의 Gmail 커넥터로 연결합니다.
- **IMAP을 지원하는 메일이면 무엇이든**: 네이버, 카카오(다음), 아웃룩·핫메일, 네이트, iCloud, Yahoo, 네이버웍스·하이웍스 같은 회사 메일, 자체 메일 서버까지 연결할 수 있습니다.
  - 등록한 계정은 왼쪽 메뉴에 **자동으로** 생깁니다. 계정 수 제한은 없습니다.
  - 잘 알려진 곳은 고유 색과 웹메일 바로가기가 붙고, 처음 보는 곳은 등록한 이름과 기본 색으로 보입니다.
  - 메일 쪽 설정에서 **IMAP/SMTP 사용**을 켜고, 보통은 **앱 비밀번호**를 만들어 넣어야 합니다.

### 할 수 있는 것

- 통합 받은편지함, 계정별 메일함, 보낸편지함, 임시보관함, 휴지통
- 원본 모양 그대로 본문 보기, 외부 이미지 표시
- 첨부파일 미리보기: PDF, 이미지, 한글(hwpx), 워드·엑셀·파워포인트, zip
- 답장 / 전체답장 / 전달 / 새 메일, 끌어다 놓기 첨부, Gmail 주소록, 명함 서명
- 16MB가 넘는 첨부파일은 Google Drive에 올려 링크로 보내기
- 읽음·안읽음, 별표, 이동, 스팸, 여러 통 한꺼번에 처리
- 검색, 기간 지정, 더 불러오기, 새 메일 알림
- Claude로 요약 · 할 일 뽑기 · 답장 초안 · 번역
- 모바일에서 왼쪽으로 밀어 삭제

### 구성

| 폴더 | 내용 |
|---|---|
| `page/claude-mail.html` | 메일 페이지 (Claude 아티팩트로 게시) |
| `page/capabilities.json` | 페이지가 쓰는 권한 목록 |
| `helper/server.js` | 첨부파일 도우미 (의존성 없는 Node.js MCP 서버) |
| `extension/` | Claude 데스크톱 확장 프로그램(.mcpb) 소스 |
| `install/install.ps1` | Windows 수동 설치 스크립트 |
| `install/rclone-setup.ps1` | 큰 첨부파일용 Google Drive 연결 (선택) |

IMAP 연결은 오픈소스 [imap-mcp-server](https://www.npmjs.com/package/imap-mcp-server)를 씁니다. 계정 정보는 내 PC(`~/.imap-mcp/accounts.json`)에 암호화되어 저장됩니다.

### 설치 (Windows)

**가장 쉬운 방법: 확장 프로그램 (Node.js 설치 필요 없음)**

1. [Releases](https://github.com/nokanghun-byte/claude-mail/releases/latest)에서 `claude-mail.mcpb`를 받습니다.
2. Claude 데스크톱 앱 **설정 → 확장 프로그램(Extensions)** 화면에 파일을 끌어다 놓거나, **고급 설정 → 확장 프로그램 설치**로 고른 뒤 **설치**를 누릅니다.
3. Claude에게 메일 계정을 등록해 달라고 말합니다. 예) "네이버 메일 계정 추가해줘. 주소는 ○○@naver.com이고 앱 비밀번호는 내가 직접 넣을게."
   - 메일 쪽 설정에서 **IMAP/SMTP 사용**을 켜고 **앱 비밀번호**를 만들어 두세요.
   - 계정 정보는 내 PC에만 암호화되어 저장됩니다.
4. Claude 설정 → 커넥터에서 **Gmail**, **Google Drive**를 연결합니다.
5. Claude에게 이렇게 부탁합니다.
   > `page/claude-mail.html`을 아티팩트로 게시해줘. 권한은 `page/capabilities.json`대로 선언해줘.

**직접 설정하는 방법 (개발자용)**

```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```
Node.js가 필요하며, Claude 앱 설정 파일에 `imap`·`attachments` 서버를 추가합니다. 확장 프로그램을 직접 만들려면 `extension\build.ps1`을 실행하세요.
### Google Drive 연결 (선택, 16MB 넘는 첨부파일용)

1. [Google Cloud 콘솔](https://console.cloud.google.com/projectcreate)에서 새 프로젝트를 만듭니다. (무료, 결제 정보 불필요)
2. **Google Drive API**를 사용 설정합니다.
3. **Google 인증 플랫폼 → 개요 → 시작하기**: 앱 이름, 지원 이메일, 대상 **외부**, 연락처 이메일을 넣고 만듭니다.
4. **대상 → 앱 게시**로 프로덕션에 게시합니다. (테스트 상태로 두면 7일마다 다시 로그인해야 합니다)
5. **클라이언트 → 클라이언트 만들기 → 데스크톱 앱**을 만들고 ID와 보안 비밀번호를 복사합니다.
6. 실행합니다.
   ```powershell
   powershell -ExecutionPolicy Bypass -File install\rclone-setup.ps1
   ```

이 앱은 `drive.file` 권한만 씁니다. **이 앱이 직접 올린 파일만** 볼 수 있고, 내 Drive의 다른 파일에는 접근하지 못합니다.

### 개인정보

모든 처리는 내 PC와 내 Claude 계정 안에서 일어나며, 이 프로젝트가 따로 수집하는 정보는 없습니다. 자세한 내용은 [개인정보처리방침](docs/privacy.md)을 보세요.

---

## English

A webmail page that runs inside the Claude desktop app and lets you read and reply to **Gmail and any IMAP mailbox in one place**.
It consists of a Claude artifact (the page) and a small helper server running on your PC.

### Which mail accounts can I connect?

- **Gmail**, through Claude's Gmail connector.
- **Any mailbox that supports IMAP**: Naver, Kakao/Daum, Outlook/Hotmail, Nate, iCloud, Yahoo, company mail (Naver Works, Hiworks, etc.), or your own mail server.
  - Every account you register appears in the left menu **automatically**. There is no limit on the number of accounts.
  - Well-known providers get their own color and a webmail shortcut; others are shown with the name you gave them.
  - Turn on **IMAP/SMTP access** in your mail settings; most providers also require an **app password**.

### Features

- Unified inbox, per-account inbox, Sent, Drafts, Trash
- Original HTML rendering, remote images
- Attachment preview: PDF, images, Hangul (hwpx), Word/Excel/PowerPoint, zip
- Reply / Reply all / Forward / New mail, drag-and-drop attachments, Gmail contacts, business-card signature
- Attachments over 16 MB are uploaded to Google Drive and sent as a link
- Read/unread, star, move, spam, bulk actions
- Search, date ranges, load more, new-mail notifications
- Claude-powered summary, to-do extraction, reply drafts, translation
- Swipe left to delete on mobile

### Layout

| Path | Contents |
|---|---|
| `page/claude-mail.html` | The mail page (publish as a Claude artifact) |
| `page/capabilities.json` | Permissions the page declares |
| `helper/server.js` | Attachment helper (dependency-free Node.js MCP server) |
| `extension/` | Claude desktop extension (.mcpb) source |
| `install/install.ps1` | Windows manual installer |
| `install/rclone-setup.ps1` | Google Drive link for large attachments (optional) |

IMAP access uses the open-source [imap-mcp-server](https://www.npmjs.com/package/imap-mcp-server). Account credentials are stored encrypted on your PC (`~/.imap-mcp/accounts.json`).

### Install (Windows)

**Easiest: the extension (no Node.js needed)**

1. Download `claude-mail.mcpb` from [Releases](https://github.com/nokanghun-byte/claude-mail/releases/latest).
2. In the Claude desktop app, open **Settings → Extensions**, drag the file in (or use **Advanced settings → Install Extension…**) and click **Install**.
3. Ask Claude to add your mail account, e.g. "Add my Naver mail account."
   - Turn on **IMAP/SMTP access** in your mail settings and create an **app password**.
   - Credentials are stored encrypted on your PC only.
4. In Claude settings → Connectors, connect **Gmail** and **Google Drive**.
5. Ask Claude:
   > Publish `page/claude-mail.html` as an artifact, declaring the capabilities in `page/capabilities.json`.

**Manual setup (for developers)**

```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```
Requires Node.js; adds `imap` and `attachments` servers to the Claude app config. To build the extension yourself, run `extension\build.ps1`.
### Google Drive link (optional, for attachments over 16 MB)

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/projectcreate) (free, no billing needed).
2. Enable the **Google Drive API**.
3. **Google Auth Platform → Overview → Get started**: app name, support email, audience **External**, contact email.
4. **Audience → Publish app** to production (in testing mode you must sign in again every 7 days).
5. **Clients → Create client → Desktop app**, then copy the client ID and secret.
6. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File install\rclone-setup.ps1
   ```

The app only uses the `drive.file` scope: it can see **only the files it uploaded itself**, never the rest of your Drive.

### Privacy

Everything happens on your PC and in your own Claude account; this project collects no data. See the [privacy policy](docs/privacy.md).

---

## 라이선스 · License

MIT
