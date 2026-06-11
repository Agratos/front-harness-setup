# MCP 서버 연동 (Figma + Notion)

harness-setup 은 `.mcp.json` 으로 MCP 서버를 연동합니다. **시크릿은 `.env`(git 미추적)에만** 두고, `.mcp.json` 은 `${VAR}` 확장으로만 참조합니다(커밋 안전).

## 연동된 서버

| 서버     | 패키지                        | 용도                                     | 시크릿(.env)    |
| -------- | ----------------------------- | ---------------------------------------- | --------------- |
| `figma`  | `figma-developer-mcp`         | 디자인 핸드오프(피그마 노드/스타일 조회) | `FIGMA_API_KEY` |
| `notion` | `@notionhq/notion-mcp-server` | 작업 로그·계획 대시보드·토론 댓글 미러   | `NOTION_TOKEN`  |

Notion MCP 는 `API-*` 툴(`API-post-page`, `API-patch-page`, `API-retrieve-a-page`, `API-query-data-source` 등)을 노출합니다. 하니스의 `scripts/lib/notion.mjs` 가 만든 `harness/notion-outbox/*.json` 페이로드를 이 툴로 반영합니다.

## 설정 절차

1. `.env` 에 실제 토큰 입력 (`.env.example` 참고). 이 파일은 커밋되지 않습니다.
2. `${VAR}` 확장을 위해 토큰을 **사용자 환경변수로도 등록** (Windows, 1회):
   ```powershell
   [Environment]::SetEnvironmentVariable('FIGMA_API_KEY', '<figd_...>', 'User')
   [Environment]::SetEnvironmentVariable('NOTION_TOKEN',  '<ntn_...>',  'User')
   ```
   (Claude Code 는 `.mcp.json` 의 `${VAR}` 를 **프로세스 환경**에서 확장합니다. `.env` 만으로는 자동 주입되지 않으므로 사용자 환경변수 등록을 권장합니다.)
3. **Claude Code 재시작** — `.mcp.json` 변경은 재시작 후 적용됩니다.
4. 연결 확인: 재시작 후 `mcp__figma__*` / `mcp__notion__API-*` 툴이 사용 가능해집니다.

## Notion 권한

- Notion integration(토큰)이 대상 페이지/DB 에 **연결(Connections)** 되어 있어야 합니다.
- 대시보드 재설계는 `docs/notion-dashboard.md` 의 계획-주도형 구조를 따릅니다.

## 우회 / 비연동

- `harness/config.json` 의 `useMcp=false` 면 `notion.mjs` 어댑터가 no-op(outbox만 기록)로 동작하고, 전체 하니스는 repo 만으로 정상 동작합니다.
- `useMcp=true` 면 outbox 페이로드를 생성하고, MCP 레이어(Claude Code)가 Notion 에 반영합니다.

> 보안: `.env` 와 실제 토큰을 **절대 커밋하지 마세요**. `.gitignore` 가 `.env`·`.env.*` 를 무시하고 `.env.example` 만 추적합니다.
