# 개인정보처리방침 (Claude 메일 / mail-rclone)

최종 수정: 2026-11-19

## 수집하는 정보

Claude 메일과 이 프로젝트의 Google OAuth 앱(mail-rclone)은 **어떤 개인정보도 개발자 서버로 보내거나 저장하지 않습니다.** 개발자가 운영하는 서버는 없습니다.

## Google 사용자 데이터 사용

- 요청 권한: `https://www.googleapis.com/auth/drive.file`
- 용도: 사용자가 메일에 첨부한 큰 파일을 **사용자 본인의 Google Drive**에 올리고, 공유 링크를 만들어 메일 본문에 넣기 위해서만 씁니다.
- 이 권한으로는 이 앱이 직접 만든 파일만 접근할 수 있으며, Drive의 다른 파일은 읽지 않습니다.
- 인증 토큰은 사용자 PC(`~/.claude-mail/google-token.json`)에만 저장되며 다른 곳으로 전송되지 않습니다.
- Google 사용자 데이터를 제3자에게 판매·공유하거나 광고에 쓰지 않습니다.
- 이 앱의 Google API 사용은 [Google API 서비스 사용자 데이터 정책](https://developers.google.com/terms/api-services-user-data-policy)(제한적 사용 요건 포함)을 따릅니다.

## 메일 데이터

메일 내용은 사용자의 Claude 계정에 연결된 커넥터(Gmail)와 사용자 PC의 IMAP 서버 프로그램을 통해 사용자 화면에만 표시됩니다.

새 메일 알림을 위해 계정별로 마지막으로 확인한 메일 번호만 사용자 PC(`~/.claude-mail/notify-state.json`)에 저장합니다. 메일 내용은 저장하지 않습니다.

## 권한 철회

[Google 계정 → 보안 → 타사 앱 및 서비스](https://myaccount.google.com/connections)에서 언제든 접근 권한을 해제할 수 있습니다.

## 문의

이 저장소의 Issues로 문의해 주세요.

---

# Privacy Policy (Claude Mail / mail-rclone)

Last updated: 2026-11-19

## Data we collect

Claude Mail and its Google OAuth app (mail-rclone) **do not send or store any personal data on a developer server.** There is no developer-operated server.

## Use of Google user data

- Scope requested: `https://www.googleapis.com/auth/drive.file`
- Purpose: only to upload large attachments the user chooses to **the user's own Google Drive** and create a share link to put in the email.
- This scope only allows access to files created by this app; no other Drive files are read.
- The OAuth token is stored only on the user's PC (`~/.claude-mail/google-token.json`) and is never transmitted elsewhere.
- Google user data is never sold, shared with third parties, or used for advertising.
- Use of Google APIs complies with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Mail data

Mail content is shown only on the user's screen, via the connectors linked to the user's Claude account (Gmail) and the IMAP server program on the user's PC.

For new-mail notifications, only the last-checked message number per account is stored on the user's PC (`~/.claude-mail/notify-state.json`). No mail content is stored.

## Revoking access

You can revoke access at any time in [Google Account → Security → Third-party apps & services](https://myaccount.google.com/connections).

## Contact

Please open an Issue in this repository.