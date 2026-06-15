# /start-project — 프로젝트 시작 (연동확인·Notion 초기화 → Q&A·계획·시드)

`/copy-project` 로 복사해 온 새 프로젝트 폴더에서, 자율 개발 루프(`/run-cycle`)를 돌리기 **직전에 한 번** 실행하는 부트스트랩 커맨드입니다. 이전의 `/init-project`(연동 확인)를 **단계로 흡수**했습니다.

> 정리(이전 산출물·토큰·정체성 비우기)는 **`/copy-project` 가 복사 시 이미 수행**합니다(빈 껍데기로 가져옴). 그래서 이 커맨드에는 별도 정리 단계가 없습니다.
> 스크립트는 그대로 재사용합니다: `init-project.mjs`(연동 확인·Notion 초기화) · `loop.mjs --init`(계획) · `git-flow.mjs seed-main`(시드).

## 동작 순서

### 1) 연동 주소 받기 → 접속 확인 + Notion 대시보드 초기화

사용자에게 **git 원격 주소**와 (사용 시) **Notion 대시보드 페이지 URL** 을 받아 실제 접근을 확인하고, Notion 은 새 프로젝트용으로 초기화합니다:

```bash
node scripts/init-project.mjs --use-mcp=true \
  --git-remote=git@github.com:me/my-app.git \
  --notion-url=https://www.notion.so/.../Dashboard-<32hex>
```

- **git**: `git ls-remote` 로 접근·인증 확인 → 성공 시 `origin` 연결.
- **Notion**: URL 에서 page id 추출 → `NOTION_TOKEN` 으로 페이지 조회(integration 연결 확인) → **대시보드 초기화 페이로드(`dashboard-reset`)를 적재**합니다. 새 프로젝트이므로 이전 내용을 비웁니다.
- 결과를 ✅/❌ 로 보여주고, 실패는 차단하지 않고 경고만(자율 유지). 대화형에서는 `AskUserQuestion` 으로 주소를 받습니다.

> **Notion 실제 비우기(flush)**: 적재된 `harness/notion-outbox/dashboard-reset.json` 을 오케스트레이터가 MCP 로 flush 해 대시보드(계획 DB·요약·결정 미러)를 비웁니다. MCP 미연동/비대화형이면 outbox 페이로드만 남기고 다음 flush 로 미룹니다.

### 2) deep-interview 식 Q&A (요구사항 결정화)

연동 확인이 끝나면 핵심 질문으로 모호성을 제거합니다(충분히 명확하면 건너뜀):

- **목표/범위**: 무엇을 만드는가? 완료의 정의는?
- **페르소나**: 누가 쓰는가? 핵심 시나리오 1~2개.
- **제약**: 기술 스택 고정 여부, 일정, 비기능 요구(성능/접근성).
- **평가 기준**: done-gate 임계(기본 종합 90점, major 불만 0)를 따를지.

### 3) 계획 시드 (planSteps 도출)

Q&A 결과를 step 목록으로 분해해 시드합니다. 각 step 은 `"<nn>-<slug>"` 형식(예: `01-login`) — 이 라벨이 `git-flow` 의 `step/<nn>-<slug>` 브랜치명으로 직결됩니다.

```bash
node scripts/loop.mjs --init "01-login,02-dashboard,03-settings"
```

- `--init` 은 상태가 `init`/없을 때만 시드(기존 진행 상태는 덮어쓰지 않음).

### 4) 조건부 main 시드 (git 사용 시에만)

```bash
node scripts/git-flow.mjs seed-main   # 멱등 — main 에 커밋 있으면 no-op. useGit=false 면 자동 우회.
```

## 실행 요약

```bash
# 1) 연동 확인 + Notion 초기화 (git/Notion 주소 입력)
node scripts/init-project.mjs --use-mcp=true --git-remote=<url> --notion-url=<url>
#    → Notion dashboard-reset 적재 → 오케스트레이터가 MCP flush 로 대시보드 비움
# 2) (대화형) Q&A → planSteps 확정
# 3) 계획 시드
node scripts/loop.mjs --init "01-login,02-dashboard"
# 4) git 사용 시 main 시드
node scripts/git-flow.mjs seed-main
```

## 다음 단계

`/run-cycle` — 드라이버(`loop.mjs`)를 페이즈마다 재호출하며 각 step 을 완주합니다.

## 비고

- 정리가 필요한 특수 상황(복사 없이 제자리에서 다시 시작)에는 `yarn reset --apply` 를 직접 쓸 수 있습니다. 일반 흐름은 `/copy-project` 로 복사해 오는 것을 전제합니다.
- 비대화형(CI/자율 루프)에서는 Q&A 를 건너뛰고 `--init` 으로 planSteps 를, 연동값은 인자/환경변수로 주입합니다.
- 사용자 전역 규칙상 범위/옵션을 되묻지 않고 즉시 실행해야 하는 맥락에서는, 합리적 기본 planSteps 를 도출해 바로 시드하고 진행합니다.
