# /start-project — 프로젝트 시작 (연동확인·Notion 초기화 → Q&A·계획·시드)

> ⛔ **이 문서의 지침은 반드시 그대로 지킨다(꼭 지킬 것).** 특히 **신규·`--fresh` 시작에서 deep-interview(2단계)는 무조건 수행**하며, **지 마음대로 간단한 Q&A로 축소하거나 생략하지 않는다.** 전역 just-execute(되묻지 말고 즉시 실행) 규칙보다 **이 문서의 절차가 우선**한다.

`/copy-project` 로 복사해 온 새 프로젝트 폴더에서, 자율 개발 루프(`/run-cycle`)를 돌리기 **직전에 한 번** 실행하는 부트스트랩 커맨드입니다. 이전의 `/init-project`(연동 확인)를 **단계로 흡수**했습니다.

> 정리(이전 산출물·토큰·정체성 비우기)는 **`/copy-project` 가 복사 시 이미 수행**합니다(빈 껍데기로 가져옴). 그래서 이 커맨드에는 별도 정리 단계가 없습니다.
> 스크립트는 그대로 재사용합니다: `init-project.mjs`(연동 확인·Notion 초기화) · `loop.mjs --init`(계획) · `git-flow.mjs seed-main`(시드).

## 동작 순서

### 0) 기존 상태 처리 — 기본은 "이어서(resume)", `--fresh` 일 때만 초기화

`harness/state.json` 을 먼저 확인한다. **"이전 것을 지울지"는 `--fresh` 옵션으로만 선택**하며, 기본은 묻지 않고 이어서 진행한다(재실행 때 매번 선택을 강요하지 않아 편함).

- **state 없음 / status=`init`** → 신규. 그대로 1단계로 진행(갓 복사한 새 프로젝트의 정상 경로 — 지울 것도 없음).
- **state 있고 진행 이력 있음**(status `running`/`done` 등):
  - **기본(옵션 없음) = 이어서**: 초기화·인터뷰·시드를 건너뛰고 현재 state 로 `/run-cycle` 을 이어서 진행.
  - **`--fresh` 지정 = 새로 시작**: 런 상태만 초기화(`state.json` 삭제 + `evaluations`·`decisions`·`errors` 비움 + `cycle-log` 비움; **`.env`·정체성·`config` 연동설정 보존**) → 그다음 1·2(deep-interview)·3단계 정상 진행.

> 이전에 제거했던 `start 0번(--fresh)` 을 **fresh/resume 분기**로 되살린 형태다. 단 **기본은 resume**(안 지움)이고, 지우는 건 **`--fresh` 로 명시할 때만**. deep-interview(2단계)는 **신규/`--fresh` 경로에서만 무조건** 수행하고, **이어서(resume)는 이미 계획이 확정돼 인터뷰 없이** 계속한다.

### 1) 연동 주소 받기 → 접속 확인 + Notion 대시보드 초기화

사용자에게 **git 원격 주소**와 (사용 시) **Notion 대시보드 페이지 URL** 을 받아 실제 접근을 확인하고, Notion 은 새 프로젝트용으로 초기화합니다:

```bash
node scripts/init-project.mjs --use-mcp=true \
  --git-remote=git@github.com:me/my-app.git \
  --notion-url=https://www.notion.so/.../Dashboard-<32hex>
```

- **git**: `git ls-remote` 로 접근·인증 확인 → 성공 시 `origin` 연결.
- **Notion**: URL 에서 page id 추출 → `NOTION_TOKEN` 으로 페이지 조회로 **접근(integration 연결)만 확인**합니다. ⚠️ `init-project.mjs` 는 **대시보드를 비우지 않습니다** — `dashboard-reset` 페이로드를 적재하고 flush 하지만 `notion-api.mjs` 에서 `dashboard.reset`/`dashboard.upsert` 는 **비파괴 no-op**(실제 삭제·쓰기 안 함, `sent=1` 은 no-op 을 센 값)입니다. **실제 허브 초기화는 아래 1b 단계(오케스트레이터)가 직접 수행**합니다.
- 결과를 ✅/❌ 로 보여주고, 실패는 차단하지 않고 경고만(자율 유지). 대화형에서는 `AskUserQuestion` 으로 주소를 받습니다.

> ⛔ **1b) Notion 허브 초기화 — 오케스트레이터가 무조건 수행(생략 금지).** init 의 flush 가 no-op 이므로, 접근 확인 뒤 **오케스트레이터가 커넥터(MCP)/REST 로 직접** 허브를 새 프로젝트용으로 초기화한다(`docs/notion-hub-layout.md` §7·§8). 코드·게이트만 돌리고 Notion 을 빈손으로 두지 않는다(실제 사고 사례). `useMcp=false` 또는 토큰/네트워크 부재일 때만 생략(자율 유지).
>
> - **비운다**: 제목 `🏢 Harness <…> Inc.` 의 `<>` 안 이름(→ 새 프로젝트명) / 상단 콜아웃(프로젝트 설명·상태줄) / 각 섹션 top-3 불릿 / 모든 DB 행(📋 계획·🔄 Cycles·🚨 이슈·🚀 배포·🧪 테스트 관리·📝 회의록).
> - **유지**: 섹션 헤더·구분선 / 인라인 DB 블록(스키마·뷰·컬럼) / 섹션 안내문 / 👥 Team Roster(레퍼런스).
> - **도구**: 제목·콜아웃·불릿 = `notion-update-page`(또는 REST `PATCH /pages`·`PATCH /blocks/{id}`). DB 행은 **삭제 대신 archive** — 커넥터로는 행 삭제 불가하므로 REST `PATCH /pages/{rowId}` `{ "archived": true }`(행 조회는 `POST /databases/{id}/query`, `Notion-Version: 2022-06-28`) 또는 Notion UI 수동. **인라인 DB 블록 자체는 절대 삭제하지 않는다**(구조 파괴 금지 — 과거 `clearPageChildren` 버그).
> - 페이지/DB/ds ID 는 박힌 값을 믿지 말고 **허브를 fetch 해 현재 ID** 를 얻어 쓴다.

### 2) deep-interview 식 Q&A (요구사항 결정화) — **무조건 진행(필수)**

연동 확인이 끝나면 **반드시** 아래 핵심 질문으로 모호성을 제거합니다. **deep-interview 는 무조건 수행하며, 자동 기본 계획으로 건너뛰지 않는다**(전역 just-execute 규칙으로도 생략 금지). **임의로 간단한 Q&A로 축소하지 말고, 아래 항목을 충분히 깊게(모호하면 후속 질문까지) 묻는다:**

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
- ⚠️ `--init` 은 시드와 동시에 **첫 페이즈(decompose)를 자동 전진**시킨다(`step/01-…` 브랜치 생성 + `design` 진입). 그래서 `/run-cycle` 첫 진입 시 step 1 은 이미 `design` 이다 — **decompose 산출물(step 분해 기록 `decisions/<id>.md`)은 첫 `/run-cycle` 에서 보강**하라.

### 4) 조건부 main 시드 (git 사용 시에만)

```bash
node scripts/git-flow.mjs seed-main   # 멱등 — main 에 커밋 있으면 no-op. useGit=false 면 자동 우회.
```

> 🔧 **default 브랜치 보장**: `seed-main` 은 원격이 연결돼 있으면 **`main` 을 먼저 push** 한다 — 빈 레포에 **step 브랜치가 main 보다 먼저 push 되면 GitHub 이 그 step 을 default 브랜치로 잡는** 문제(실제 테스트에서 `step/01-…` 가 default 가 됨)를 막기 위함. 이미 default 가 잘못 잡혔으면 `gh repo edit <owner>/<repo> --default-branch main`(또는 `gh api -X PATCH repos/<owner>/<repo> -f default_branch=main`)로 교정한다.

## 실행 요약

```bash
# 0) 기존 상태: 기본=이어서(resume). --fresh 면 런상태 초기화(state/eval/decision/cycle-log) 후 새로 — .env·정체성 보존
# 1) 연동 확인 + Notion 초기화 (git/Notion 주소 입력)
node scripts/init-project.mjs --use-mcp=true --git-remote=<url> --notion-url=<url>
#    → init 은 git/Notion 접근 확인만. (Notion 대시보드 비우기는 no-op)
# 1b) ⛔ Notion 허브 초기화 — 오케스트레이터가 커넥터/REST 로 직접 수행(무조건, §1b)
# 2) deep-interview Q&A (필수·무조건) → planSteps 확정
# 3) 계획 시드
node scripts/loop.mjs --init "01-login,02-dashboard"
# 4) git 사용 시 main 시드
node scripts/git-flow.mjs seed-main
```

## 다음 단계

`/run-cycle` — 드라이버(`loop.mjs`)를 페이즈마다 재호출하며 각 step 을 완주합니다.

## 비고

- 정리가 필요한 특수 상황(복사 없이 제자리에서 다시 시작)에는 `yarn reset --apply` 를 직접 쓸 수 있습니다. 일반 흐름은 `/copy-project` 로 복사해 오는 것을 전제합니다.
- **deep-interview 는 무조건 수행한다.** 전역 just-execute(되묻지 말고 즉시 실행) 규칙으로도 이 인터뷰는 **건너뛰지 않으며**, planSteps 는 인터뷰 결과로 확정한다(자동 기본 계획 시드 금지).
- 유일한 예외는 **완전 비대화형(CI/headless, TTY 없음)** — 질문이 물리적으로 불가능한 환경에서만 planSteps 를 `--init` 인자로, 연동값을 인자/환경변수로 주입한다.
