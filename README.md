# Claude 메일

Claude 데스크톱 앱 안에서 **Gmail · 네이버 · 카카오 메일을 한 화면에서** 읽고 답장하는 웹메일 페이지입니다.
Claude 아티팩트(페이지)와 내 PC에서 돌아가는 작은 도우미 서버로 이루어져 있습니다.

> 개인 프로젝트이며 Anthropic의 공식 제품이 아닙니다.

## 할 수 있는 것

- 통합 받은편지함, 계정별 메일함, 보낸편지함, 임시보관함, 휴지통
- 원본 모양 그대로 본문 보기, 외부 이미지 표시
- 첨부파일 미리보기: PDF, 이미지, 한글(hwpx), 워드·엑셀·파워포인트, zip
- 답장 / 전체답장 / 전달 / 새 메일, 끌어다 놓기 첨부, Gmail 주소록, 명함 서명
- 16MB가 넘는 첨부파일은 Google Drive에 올려 링크로 보내기
- 읽음·안읽음, 별표, 이동, 스팸, 여러 통 한꺼번에 처리
- 검색, 기간 지정, 더 불러오기, 새 메일 알림
- Claude로 요약 · 할 일 뽑기 · 답장 초안 · 번역
- 모바일에서 왼쪽으로 밀어 삭제

## 구성

| 폴더 | 내용 |
|---|---|
| `page/claude-mail.html` | 메일 페이지 (Claude 아티팩트로 게시) |
| `page/capabilities.json` | 페이지가 쓰는 권한 목록 |
| `helper/server.js` | 첨부파일 도우미 (의존성 없는 Node.js MCP 서버) |
| `install/install.ps1` | Windows 설치 스크립트 |
| `install/rclone-setup.ps1` | 큰 첨부파일용 Google Drive 연결 (선택) |

## 설치 (Windows)

1. [Node.js](https://nodejs.org) LTS를 설치합니다.
2. PowerShell에서 설치 스크립트를 실행합니다.
   ```powershell
   powershell -ExecutionPolicy Bypass -File install\install.ps1
   ```
   - 네이버·카카오를 쓰려면 중간에 `y`를 눌러 계정을 등록합니다. 각 메일 설정에서 **IMAP/SMTP 사용**을 켜고 **앱 비밀번호**를 만들어 넣으세요.
3. Claude 데스크톱 앱을 완전히 종료했다가 다시 켭니다.
4. Claude 설정 → 커넥터에서 **Gmail**, **Google Drive**를 연결합니다.
5. Claude에게 이렇게 부탁합니다.
   > `page/claude-mail.html`을 아티팩트로 게시해줘. 권한은 `page/capabilities.json`대로 선언해줘.

## Google Drive 연결 (선택, 16MB 넘는 첨부파일용)

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

## 개인정보

모든 처리는 내 PC와 내 Claude 계정 안에서 일어나며, 이 프로젝트가 따로 수집하는 정보는 없습니다. 자세한 내용은 [개인정보처리방침](docs/privacy.md)을 보세요.

## 라이선스

MIT
