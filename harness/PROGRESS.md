# 하네스 진행 상태 (PROGRESS)

> **재개 프로토콜** — 모든 세션은 굵직한 단계를 시작/완료할 때마다 아래 "현재 상태"를 갱신합니다 (마지막 갱신 시각 필수).
> 자동 재개 루프(10분 주기)는 이 파일을 읽고 다음 두 조건이 **모두** 참일 때만 작업을 이어받습니다:
> 1. 상태가 `🔵 진행 중`인 항목이 있다
> 2. 그 항목의 "마지막 갱신"이 **30분 이상** 경과했다 (활성 세션과의 충돌 방지)

## 현재 상태

### 🟢 완료 — Notion 책임 재배치 + start 0번(--fresh) 제거
- **start `--fresh` 제거**: 무조건 `/copy-project` 로 복사해 오는 전제 → `/start-project` 의 제자리 정리 단계 삭제. start = 1) 연동 확인+Notion 초기화 → 2) Q&A → 3) 계획 → 4) main 시드.
- **copy = 빈 껍데기**: `copy-project.mjs` 가 reset 을 항상 `--no-notion` 으로 호출. 현재 프로젝트(harness-setup)에 종속된 테스트 산출물·토큰·정체성만 비우고 **Notion 은 건드리지 않음**.
- **Notion 초기화는 start 로 이동**: `init-project.mjs` 가 notion-url 접근 확인 성공 시 `resetDashboard()` 로 대시보드 초기화 페이로드(pageId 포함) 적재. 실제 flush 는 오케스트레이터/MCP. `notion.mjs resetDashboard` 에 pageId 필드 추가.
- **검증**: lint green, selftest(copy/reset/init/eval) PASS, init-project 스모크에서 Notion 접근 OK(200)+페이로드 적재 실측(임시 cwd, 실제 repo 무오염).
- **마지막 갱신**: 2026-06-15 (기록자: Notion 책임 재배치 세션)

### 🟢 완료 — 부트스트랩 커맨드 통합 (4개 → 2개)
- **통합**: `/clear-project`·`/init-project` 커맨드를 `/start-project` 로 흡수. `/start-project` 가 0)`--fresh` 제자리 정리 → 1) git/Notion 연동 확인 → 2) Q&A → 3) 계획 시드 → 4) main 시드를 순서대로 오케스트레이션. `copy-project` 는 유지.
- **결과**: `.claude/commands/` = copy-project / start-project / run-cycle / status / git-flow / evaluate (6개). 부트스트랩 커맨드는 copy-project·start-project 2개.
- **스크립트 보존**: `reset-project.mjs`·`init-project.mjs` 는 삭제하지 않고 start-project 가 호출(yarn reset/copy 로도 직접 실행 가능).
- **문서 동기**: start-project.md 재작성, copy-project.md 참조, docs/commands.md 표·흐름, README 커맨드 흐름·인덱스, AGENTS 커맨드 목록, usage 명령어 표·§6.
- **마지막 갱신**: 2026-06-15 (기록자: 커맨드 통합 세션)

### 🟢 완료 — preflight → init-project rename + commands 인덱스
- **rename**: `scripts/preflight.mjs`→`init-project.mjs`, `*.selftest.mjs` 동일, `.claude/commands/preflight.md`→`init-project.md`. 커맨드는 `/init-project`(`/init` 은 빌트인 예약). 스크립트 경로·커맨드명 참조 전부 갱신. **단 `config.json` 의 `preflight` 키는 데이터 호환 위해 유지**(demo·init-project.mjs 가 읽고 씀).
- **commands 정리**: `docs/commands.md` 인덱스 신설 — 8개 커맨드를 부트스트랩/사이클로 묶고 실행 흐름·파괴성 표기. (commands/ 안에 두면 `.md` 가 슬래시 커맨드로 등록돼 버려 docs/ 에 배치)
- **검증**: INIT-PROJECT SELFTEST PASS, lint green, init-project 스모크(`--no-git`) 동작, demo PASS(config.preflight 키 정상).
- **마지막 갱신**: 2026-06-15 (기록자: init-project rename 세션)

### 🟢 완료 — preflight 에 git 원격·Notion 접근 확인 추가
- **추가**: `preflight.mjs` 가 `--git-remote=<url>` → `git ls-remote` 로 접근·인증 확인 후 origin 연결, `--notion-url=<url>` → page id 추출 + `NOTION_TOKEN` 으로 페이지 조회(integration 연결 확인). 결과를 `config.json`(`gitRemote`·`notionDashboardPageId`·`preflight.checks`)에 기록. 실패는 경고만(자율 유지).
- **목적**: 인터뷰/개발 **전에** 연동 끊김을 잡아 "한참 작업 후 push·미러 실패" 사고 방지.
- **부수 수정**: `--no-git`/`--no-mcp` 별칭이 실제로 동작하도록 parseFlag 별칭 지원(문서엔 있었으나 코드 미인식이던 버그).
- **검증**: `preflight.selftest.mjs`(page id 추출 10 체크) + 임시 cwd 스모크(새 config 스키마 확인) + `--no-git` 동작 확인. CI self-test 10종 편입.
- **문서 동기**: `preflight.md`(동작·인자·대화형 절차), README 빠른시작·자가검증 목록.
- **다음(미완)**: `/start-project` 에서 저장된 `notionDashboardPageId` 로 대시보드 실제 생성·초기화(B-②) 연결.
- **마지막 갱신**: 2026-06-15 (기록자: preflight 연동확인 세션)

### 🟢 완료 — 복사+초기화 커맨드 `/copy-project`
- **추가**: `scripts/copy-project.mjs` + `.claude/commands/copy-project.md`. 이 하네스를 `<경로>/<이름>` 으로 복사하고 복사본에서 `reset-project --apply` 자동 실행(복사→초기화 한 번에).
  - 제외 복사: node_modules·.git·dist·.yarn 캐시·**.env(토큰)**·*.tsbuildinfo·.omc.
  - **미리보기/승인 없음**(사용자 요청): 복사는 새 위치 생성이라 비파괴적. 안전장치는 "대상 기존 비어있지않음/소스 내부경로 거부"로 충분.
  - 커맨드는 대상 경로·이름만 묻고 바로 실행 → Notion flush 마무리.
- **검증**: `scripts/copy-project.selftest.mjs`(26 체크, filter·planCopy·doCopy) + 실제 C:\tmp 복사 smoke PASS. CI self-test 9종 편입.
- **문서 동기**: README(빠른시작 0-1 A/B·구조·자가검증·커맨드 흐름), AGENTS(커맨드·scripts), usage §6-1, package.json(`yarn copy`).
- **마지막 갱신**: 2026-06-15 (기록자: copy-project 세션)

### 🟢 완료 — 초기화 슬래시 커맨드 `/clear-project`
- **추가**: `.claude/commands/clear-project.md` — `reset-project.mjs` 를 **미리보기→사용자 승인→적용→Notion 실제 flush** 안전 절차로 감싸는 슬래시 커맨드. 직접 `node` 실행의 파괴 위험·번거로움 해소.
- 이름: `/clear` 는 Claude Code 빌트인(대화 비우기) 예약어라 `/clear-project` 사용(스크립트명은 reset-project 유지).
- **문서 동기**: README·AGENTS 커맨드 목록, usage §6 에 커맨드 안내 추가.
- **마지막 갱신**: 2026-06-15 (기록자: clear-project 커맨드 세션)

### 🟢 완료 — 새 프로젝트 초기화 스크립트(reset-project) + Notion 리셋
- **추가**: `scripts/reset-project.mjs` — 복사 후 새 프로젝트로 쓸 때 잔존물 일괄 정리. 기본 dry-run, `--apply` 로 적용.
  - 정리: `harness/` 런타임 산출물(state·config·report·cycles·decisions·evaluations·errors), `.env` 토큰(→.env.example), 정체성(package.json·index.html·App.tsx 의 harness-setup→새 이름). **이전 평가 제거로 첫 merge 가짜 통과 방지.**
  - **Notion 리셋**: `config.useMcp` 면 `notion.mjs` 의 신규 `resetDashboard()` 로 `harness/notion-outbox/dashboard-reset.json` 적재 → 다음 flush 때 대시보드 초기화. `--notion`/`--no-notion` 오버라이드.
  - 멱등(2차 실행 0건), example-/.gitkeep·하네스 엔진 보존, git 이력은 안내만.
- **추가 검증**: `scripts/reset-project.selftest.mjs`(25 체크) — CI self-test 8종으로 편입.
- **문서 동기**: README(빠른시작 0-1·구조·자가검증), AGENTS(scripts 맵), usage(§6 신설 + 데모 설명 정정), package.json(`yarn reset`).
- **마지막 갱신**: 2026-06-15 (기록자: reset-project 세션)

### 🟢 완료 — demo.mjs 결정 격리 + .gitignore 보강
- **변경**: `demo.mjs` 가 실제 `harness/decisions/` 에 결정을 쓰고 멱등성 위해 `decision-*.md` 를 일괄 삭제하던 로직이 **실제 결정 기록(decision-0002 등)까지 지우는 데이터 손실 버그**였음 → `logDecision` 을 **임시 격리 디렉터리**에서 시연하도록 변경(git/loop 와 동일 격리 원칙). 실제 `harness/decisions/` 는 일절 건드리지 않음.
- **추가**: `.gitignore` 에 `*.tsbuildinfo` 추가(빌드 캐시 산출물). 헤더 주석·report 섹션4·README 데모 설명 동기 갱신.
- **검증**: 데모 재실행 후 `harness/decisions/`(0001·0002) 무손상 확인, `tsconfig.tsbuildinfo` ignored 확인, lint green, DEMO: PASS.
- **마지막 갱신**: 2026-06-15 (기록자: 데모 격리 수정 세션)

### 🟢 완료 — 재작업 5회→투표 코드 강제 (확정 2·3)
- **변경**: `loop.mjs` 에 `MAX_REWORK=5` + `computeTransition` 도입 — `debate` 의 `rework` 판정마다 `reworkCount++` 후 `implement` 되돌이, 5회 초과 시 `vote` 페이즈 분기, `vote→merge` 는 `state.gateOverride` + `done-gate --vote-override` 로 **주관 임계만 우회(결정적 게이트 유지)**. `state.mjs` 에 `gateOverride` 필드 추가. `git-flow.mjs` 가 `--vote-override` 전달.
- **배경**: 평가에서 "`reworkCount` 가 스키마에만 있고 증가 코드 없음 → 문서와 코드 불일치" 발견 → 사용자가 코드 강제안(a) 선택. 투표 *내용*(다수결·캐스팅보트)은 종전대로 에이전트 수동 준수.
- **문서 동기 갱신**: `run-cycle.md`·`usage.md`·`AGENTS.md`(강제 모델 표)·`state-manifest.md`·`status.md`·`pm.md`·README·사양서 변경 이력.
- **검증**: `loop.selftest`(시나리오 B: rework→vote 추가) PASS + self-test 6종 PASS + 게이트 4종 green + `done-gate --vote-override` 동작 확인.
- **마지막 갱신**: 2026-06-15 (기록자: 재작업/투표 코드화 세션)

### 🟢 완료 — 엔티티 구조 scms-ems 방식 전환 (step/07)
- **변경**: `src/entities/example` 을 `model/`(dto·types·mapper·store) 세그먼트 + API 동작 단위 파일 분리로 재배치 (scms-ems 계승). mutation mapper 경유·`selectResult` 어댑터는 v2 규약 유지
- **문서 동기 갱신**: `docs/fsd/entities.md`·`naming.md`, README, AGENTS.md, `.claude/agents/entity-modeler.md`, 사양서 변경 이력
- **검증**: 게이트 4종 green (typecheck 0 / lint 0 / test 5 passed / check-arch 0위반)
- **마지막 갱신**: 2026-06-12 (기록자: 컨벤션 전환 세션)

### 🟢 완료 — v2 재구축 (Step 1~6 전체)
- **사양서**: `docs/spec/interview-2026-06-11.md` (사용자 직접 인터뷰 3라운드, 승인 기록 보유)
- **단계별 main 머지**:
  - Step 1 툴체인 시드 (스모크 테스트, passWithNoTests 제거) — `965fdfd`
  - Step 2 FSD 규약 + 실재 예시 슬라이스 (entities/example·features/example-list·pages/home) — `5d48235`
  - Step 3 협의체 9역할 + v2 정책 (5회+투표·캐스팅보트·가변 페르소나) — `efe40e8`
  - Step 4 드라이버·done-gate·git-flow + self-test 6종 — `f7ca24c`
  - Step 5 고객 평가(Playwright)·루브릭(가변 페르소나 §0)·Notion 미러 — `7bdb250`
  - Step 6 통합 데모 PASS + README/AGENTS/usage v2 정합 + CI 워크플로 — (이 커밋)
- **최종 검증**: 게이트 4종 green (typecheck 0 / lint 0 / test 5 passed / check-arch 0위반)
  + self-test 7종 PASS (state/git-flow/done-gate/loop/log/resume/eval) + demo PASS
  + 실 평가 eval-0001 종합 100 / major 0 / teardown 검증
- **남은 후속(선택)**: ① 노션 대시보드 예시 데이터 → 실데이터 교체(노션 세션 항목 참조)
  ② 제품 빌드 시 mantine·react-router provider 추가 ③ main 브랜치 보호 설정(GitHub)
- **마지막 갱신**: 2026-06-11T02:40Z (기록자: 메인 재구축 세션)

### 🟢 완료 — 노션 대시보드 개편
- **페이지**: https://app.notion.com/p/Harness-Inc-37305d7cde4780ecabfeda0bddebf85b
- **구조**: 콜아웃 요약 → 계획/진행 상황/이슈/배포 (섹션별 상단 2~3건 요약 줄 + 접힌 DB 링크) → 에이전트 설명/회의록/참고
- **남은 일**: ① 예시 데이터를 실제 데이터로 교체 ② `/evaluate` Notion 동기화 시 대시보드 요약 줄도 함께 갱신하는 규칙 반영
- **마지막 갱신**: 2026-06-11T02:30Z (이 세션)

## 갱신 규칙
1. 단계 시작/완료 시 해당 항목의 "다음 할 일"·"마지막 갱신"을 즉시 갱신한다.
2. 사용량 한도로 중단이 예상되면: 지금까지 한 일 + **바로 다음 1개 행동**을 적고 멈춘다.
3. 새 세션이 이어받을 때: 이 파일 → `git log` → `harness/` 산출물 순으로 확인한 뒤 작업한다.
4. 이어받은 세션은 작업 직전에 "마지막 갱신"을 자기 시각으로 먼저 갱신한다 (이중 인수 방지).
