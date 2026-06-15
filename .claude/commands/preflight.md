# /preflight — 프로젝트 시작 전 게이트

harness-setup 의 자율 개발 루프를 시작하기 **전에** git/MCP 연동을 점검·결정하는 게이트입니다.
(인터뷰/계획보다 먼저 실행)

## 동작

1. `.git` 존재 여부를 출력합니다.
2. `useGit=true` 인데 저장소가 없으면 **`git init -b main`** 을 수행합니다 (이 명령이 저장소 생성을 소유).
3. **(선택) git 원격 접근 확인** — `--git-remote=<url>` 이 주어지면 `git ls-remote` 로 **접근·인증을 실제로 확인**하고, 성공하면 `origin` 을 연결합니다. 실패하면 경고만 남기고 진행은 막지 않습니다.
4. **(선택) Notion 페이지 접근 확인** — `--notion-url=<url>` 이 주어지면(그리고 `useMcp=true`) URL 에서 page id 를 추출해 `NOTION_TOKEN` 으로 **페이지 조회**합니다(integration 연결 여부 확인). page id 는 config 에 저장됩니다(이후 대시보드 미러/초기화 대상).
5. `harness/config.json` 에 결정·확인 결과를 기록합니다:
   ```json
   {
   	"useGit": true,
   	"useMcp": false,
   	"mcpServers": [],
   	"skipGitFlow": false,
   	"gitRemote": "git@github.com:me/my-app.git",
   	"notionDashboardPageId": "37305d7c-de47-80ec-abfe-da0bddebf85b",
   	"preflight": {
   		"ranAt": "...", "gitInitDone": true, "gitPresentBefore": false,
   		"checks": {
   			"gitRemote": { "url": "...", "reachable": true },
   			"notion": { "url": "...", "pageId": "...", "reachable": true }
   		}
   	}
   }
   ```
6. `useGit=false` 면 `skipGitFlow=true` 가 기록되어 이후 git-flow(브랜치/병합)가 우회됩니다.

> 접근 확인은 **인터뷰/개발 전에 연동 끊김을 잡기 위한 것**입니다(한참 작업 후 push·미러 실패 방지). 확인 실패는 차단하지 않고 경고로 남깁니다 — 자율 흐름 유지.

## 실행

```bash
# 기본값 (useGit=true, useMcp=false)
node scripts/preflight.mjs

# git 원격 주소 + Notion 대시보드 URL 접근 확인까지
node scripts/preflight.mjs --use-mcp=true \
  --git-remote=git@github.com:me/my-app.git \
  --notion-url=https://www.notion.so/me/Dashboard-37305d7cde4780ecabfeda0bddebf85b

# 비대화형 주입
node scripts/preflight.mjs --use-git=true --use-mcp=true
node scripts/preflight.mjs --no-git            # git 우회
HARNESS_USE_GIT=false HARNESS_USE_MCP=true node scripts/preflight.mjs
```

## 인자 / 환경변수

| 설정          | 인자                            | 환경변수             | 기본값  |
| ------------- | ------------------------------- | -------------------- | ------- |
| git 사용      | `--use-git[=bool]` / `--no-git` | `HARNESS_USE_GIT`    | `true`  |
| MCP 연동      | `--use-mcp[=bool]` / `--no-mcp` | `HARNESS_USE_MCP`    | `false` |
| git 원격 주소 | `--git-remote=<url>`            | `HARNESS_GIT_REMOTE` | (없음)  |
| Notion URL    | `--notion-url=<url>`            | `HARNESS_NOTION_URL` | (없음)  |

> `--notion-url` 접근 확인에는 `NOTION_TOKEN` 이 필요합니다(`process.env` 또는 `.env`). 페이지에 integration 을 연결해 두어야 조회가 성공합니다.

## 대화형 절차 (오케스트레이터)

대화형 환경에서는 `AskUserQuestion` 으로 다음을 물어 인자로 전달합니다:

1. **git 사용 여부**, 사용 시 **원격 저장소 주소(URL)** — 비어 있는 새 원격을 미리 만들어 두고 그 URL 을 받습니다.
2. **MCP(Notion) 사용 여부**, 사용 시 **대시보드로 쓸 Notion 페이지 URL** — 그 페이지에 integration 을 연결해 두어야 합니다.

받은 주소로 preflight 를 실행해 **접근 확인 결과(✅/❌)를 사용자에게 보여줍니다.** ❌ 면 원인(권한·인증·integration 미연결)을 안내하고 고친 뒤 다시 실행하도록 권합니다. 비대화형(CI/자율 루프)에서는 인자·환경변수로 주입합니다.

## 다음 단계

preflight 통과 후 → `/start-project` (Q&A → 계획 → 조건부 main 시드) → `/run-cycle` 루프.
