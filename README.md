# harness-setup

Claude Code 서브에이전트 **협의체**가 `주장:이유` 형식으로 토론·합의하며 FSD 웹프론트(`src/`)를 단계별로 자율 개발하는 **단일 저장소형 개발 하니스**입니다. 모든 토론·오류·수정·평가를 저장소에 1차 기록하고, 고객 에이전트가 브라우저로 실사용·채점해 종료 조건(종합 ≥ 90, 불만 0)에 도달하면 멈춥니다.

## 빠른 시작

> 환경: Windows 11 / Node v22 / yarn 4 (Berry). 스크립트는 `.mjs`(Node, ESM)입니다.
>
> 툴체인은 참조 프로젝트 `default-setup` 을 계승합니다. 단 `vitest`(테스트)와 `scripts/check-arch.js`(FSD 레이어 경계 검사)는 `default-setup` 에 **없던 신규(net-new) 도입** 도구입니다. ESLint 는 import 정렬을 담당하고, 레이어 경계 강제는 `check-arch.js` 가 맡습니다.

```bash
# 0) 의존성 설치 (최초 1회)
yarn install

# 0-1) 새 프로젝트로 시작하기 — 둘 중 하나
#  (A) 다른 경로로 복사 + 초기화 (권장): .env 토큰·.git·node_modules 제외 복사 후 자동 초기화
node scripts/copy-project.mjs --dest=../ --name=my-app
#  (B) 제자리 초기화: 이미 복사해 둔 폴더에서 이전 산출물·토큰·정체성만 정리
node scripts/reset-project.mjs --name=my-app          # 미리보기(dry-run)
node scripts/reset-project.mjs --name=my-app --apply  # 실제 적용
#   초기화 = harness/ 런타임 로그·평가(가짜 통과 방지)·결정 정리, .env 토큰 제거, 이름 치환,
#   Notion 사용 시 dashboard-reset 페이로드 적재(다음 flush 때 대시보드 초기화).

# 1) 프리플라이트 — git/MCP 게이트 + (선택) 원격·Notion 접근 확인 + harness/config.json 기록
node scripts/init-project.mjs            # 기본 useGit=true, useMcp=false
#   원격·Notion 연동까지 미리 확인(권장): 끊김을 개발 전에 잡음
node scripts/init-project.mjs --use-mcp=true \
  --git-remote=git@github.com:me/my-app.git \
  --notion-url=https://www.notion.so/.../Dashboard-<32hex>
#   (git ls-remote 로 접근 확인 후 origin 연결, Notion page 조회로 integration 연결 확인)

# 2) 프로젝트 시작 — 계획(planSteps) 시드 + (git 사용 시) main 시드
node scripts/loop.mjs --init "01-login,02-dashboard"
node scripts/git-flow.mjs seed-main   # useGit=false 면 자동 no-op

# 3) 사이클 완주 — 페이즈마다 드라이버를 재호출 (한 번 호출 = 한 페이즈 진행)
node scripts/loop.mjs                 # decompose→design→implement→verify→evaluate→debate→merge
#   status=done 이 될 때까지 반복 호출 (턴 경계/크래시를 넘어 재개됨)
#   debate 가 rework 판정이면 implement 로 되돌아가며 reworkCount++; 5회 초과 시 vote 페이즈로 분기
#   (vote 후 merge 는 주관 임계만 우회하고 결정적 게이트는 유지 — 사양서 확정 2·3)

# 4) 평가 — dev 서버 기동 + Playwright 실사용 + 루브릭 채점 + teardown
node scripts/eval-playwright.mjs      # harness/evaluations/<id>.{md,json}
```

Claude Code 안에서는 위 스크립트를 감싼 슬래시 커맨드로도 실행합니다:
`/copy-project` → `cd` → `yarn install` → `/start-project` → `/run-cycle` → `/evaluate` → `/status`.

- **`/copy-project`** — 경로·이름만 받아 이 하네스를 `<경로>/<이름>` 으로 **빈 껍데기로 복사**합니다(`.env` 토큰·`.git`·node_modules 제외, 현재 프로젝트의 테스트 산출물 제거). **Notion 은 건드리지 않습니다.**
- **`/start-project`** — 복사해 온 폴더에서 git/Notion 주소를 넣어 **접속 확인 + Notion 대시보드 초기화** 후 Q&A·계획 시드·main 시드. (이전 `init-project` 를 흡수)

### 통합 데모로 한 번에 흐름 보기

전체 골격(init-project → git-flow → loop → 협의 로그 → 평가 → 최종 보고)을 **실제 저장소를 오염시키지 않고** 한 번에 시연합니다. git-flow·loop·협의 결정(logDecision) 시연은 모두 임시 격리 환경에서 돌고, 실제 repo 에는 보고서(`harness/report.md`)·요약 로그(`harness/cycles/`)만 남깁니다.

```bash
node scripts/demo.mjs                 # → 'DEMO: PASS', harness/report.md 채워짐
```

### 자가검증 (게이트)

```bash
yarn typecheck && yarn lint && yarn test:run && node scripts/check-arch.js
node scripts/loop.selftest.mjs        # 드라이버 시퀀싱 + 재작업→투표 분기
node scripts/resume.selftest.mjs      # 멱등 재개(크래시 후 미커밋 페이즈 재실행)
node scripts/git-flow.selftest.mjs    # git-flow (임시 repo)
node scripts/eval.selftest.mjs        # 평가/teardown/루브릭
node scripts/log.selftest.mjs         # 로깅 헬퍼
node scripts/reset-project.selftest.mjs  # 제자리 초기화(멱등·Notion 리셋)
node scripts/copy-project.selftest.mjs   # 복사 제외 필터·대상 검증
node scripts/init-project.selftest.mjs      # Notion page id 추출
node scripts/notion-api.selftest.mjs        # Notion flush 빌더·게이트
```

## 구조 개요

```
harness-setup/
├─ scripts/            # 하니스 드라이버·게이트·평가·로깅 (Node .mjs)
│  ├─ init-project.mjs        # git/MCP 게이트 + config.json
│  ├─ loop.mjs             # 재호출 드라이버 (1 호출 = 1 페이즈, 크래시 재개)
│  ├─ git-flow.mjs         # seed-main / start-step / merge-step (직푸시 차단)
│  ├─ done-gate.mjs        # 결정적 게이트 + 평가 임계치(히스테리시스/래치)
│  ├─ eval-playwright.mjs  # 고객 평가(Playwright) + 루브릭 + teardown
│  ├─ check-arch.js        # FSD 레이어 경계 검사
│  ├─ demo.mjs             # 통합 스모크 데모
│  ├─ copy-project.mjs     # 다른 경로로 복사 + 초기화 (새 프로젝트 시작)
│  ├─ reset-project.mjs    # 제자리 초기화 (산출물·토큰·정체성·Notion)
│  ├─ notion-flush.mjs     # outbox → 실제 Notion 반영(flush, REST)
│  ├─ *.selftest.mjs       # 각 모듈 자가검증
│  └─ lib/                 # state / log / rubric / teardown / notion(적재) · notion-api(flush)
├─ .claude/
│  ├─ agents/          # 협의체 9역할 정의 (ceo, pm, architect, ui, ux, qa, quality, …)
│  └─ commands/        # 슬래시 커맨드 (init-project, start-project, run-cycle, …)
├─ harness/            # 런타임 1차 로그
│  ├─  config.json          # init-project 결과 (useGit/useMcp/skipGitFlow/gitRemote/notion)
│  ├─ state.json           # 진행 상태 매니페스트 (크래시-안전)
│  ├─ decisions/           # 협의·결론 (안건/주장:이유/타협/결론+근거/…)
│  ├─ cycles/              # 단계별 진행 로그 (cycle-log.ndjson)
│  ├─ errors/              # 오류·수정 (위치/메시지/원인/diff)
│  ├─ evaluations/         # 차원별 평점 + 스크린샷
│  └─ report.md            # 최종 보고서 (데모/실행 종료 시 채워짐)
├─ docs/               # FSD 규약·루브릭·상태 매니페스트·상세 사용법
├─ .github/workflows/  # CI (게이트 4종 + 자가검증 7종)
└─ src/                # FSD 웹프론트 (실재 예시 슬라이스 포함 — 사양서 확정 4)
   ├─ app/                 # providers(react-query; mantine·router 는 제품 단계 추가) + App
   ├─ pages/               # 실재 예시: home (feature 조립)
   ├─ widgets/             # (비어 있음) docs/fsd/widgets.md 규약대로 작성
   ├─ features/            # 실재 예시: example-list (엔티티 훅 소비)
   ├─ entities/            # 실재 예시: example (model/ 아래 DTO↔Mapper↔Types + mapper 단위테스트 — scms-ems 방식)
   └─ shared/              # lib(api·react-query·zustand 인프라 헬퍼)
```

> **스택**: React 19 · Vite 7 · TypeScript 5.9 · **react-router-dom 7** · **@tanstack/react-query 5** · **zustand 5** · **Mantine 8**(UI·테마, default-setup 계승) · **@mantine/form** + **zod**(폼·검증).
> 테스트는 **vitest + jsdom + @testing-library/react** (스모크 + mapper 단위 테스트, **테스트 0개 = 게이트 실패**). app 레이어 providers 는 현재 react-query 만 합성하며 mantine·react-router 는 제품 단계에서 추가합니다. dev·평가 포트는 모두 **8000** 으로 통일됩니다.

## 더 알아보기

- **슬래시 커맨드 인덱스·실행 흐름** → [docs/commands.md](docs/commands.md)
- **상세 사용법·명령어 레퍼런스·협의체 동작·문서 읽는 법** → [docs/usage.md](docs/usage.md)
- **협의체 9역할 + 오케스트레이터 중재 모델 + 디렉터리 맵** → [AGENTS.md](AGENTS.md)
- **FSD 규약** → [docs/fsd/](docs/fsd/) · **평가 루브릭** → [docs/eval-rubric.md](docs/eval-rubric.md)
- **상태 매니페스트(크래시-안전 재개)** → [docs/state-manifest.md](docs/state-manifest.md)
