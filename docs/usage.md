# 상세 사용법 — harness-setup

이 문서는 [README.md](../README.md) 의 빠른 시작을 넘어선 **상세 사용법·명령어 레퍼런스·협의체 동작·문서 읽는 법**을 다룹니다.

---

## 1. 실행 모델: "한 번 호출 = 한 페이즈"

서브에이전트는 서로 직접 대화하지 못하고, 오케스트레이션을 하나의 거대한 턴에 몰아넣어서도 안 됩니다. 그래서 드라이버 `scripts/loop.mjs` 는 **결정적 상태 기계**입니다.

- **1회 호출 = 현재 페이즈 1개 실행 후 다음 페이즈로 전진.** 각 호출 후 상태가 `harness/state.json` 에 원자적으로(temp→rename) 기록됩니다.
- 페이즈 순서: `decompose → design → implement → verify → evaluate → debate → merge`. `merge` 후 다음 step 이 있으면 그 step 의 `decompose` 로 래핑, 없으면 `status=done`.
- **결정적 페이즈**(`verify`, `merge`)는 드라이버가 직접 실행합니다.
  - `verify` → `node scripts/done-gate.mjs --deterministic-only` (typecheck/lint/check-arch/test).
  - `merge` → `node scripts/git-flow.mjs merge-step <nn> <slug>` (done-gate 통과 시에만 병합).
- **에이전트 주도 페이즈**(`decompose`, `design`, `implement`, `evaluate`, `debate`)는 드라이버가 `PHASE <name> requires agent work via /run-cycle` 로그 + `harness/cycles/` 에 1줄 append 하고 전진합니다. 실제 추론은 `/run-cycle` 커맨드(서브에이전트 스폰)가 담당합니다.

### 멱등 재개 (크래시/턴 경계 생존)

핵심 규칙: **"state 가 진실, 미커밋이면 재실행."** `committed=false` 인데 페이즈가 done 으로 간주되면(`needsRerun`), 드라이버는 건너뛰지 않고 현재 페이즈를 **다시 실행**합니다. `phaseSeq` 는 단조 증가하고 `checkpointToken`(`<phaseSeq>-<phase>-<counter>`)은 매 전진마다 재생성됩니다. 자세한 규칙은 [state-manifest.md](state-manifest.md), 검증은 `scripts/resume.selftest.mjs` 참고.

---

## 2. 명령어 레퍼런스

### 스크립트 (Node `.mjs`, 직접 실행)

| 스크립트              | 역할                                                                          | 주요 인자                                                                                     |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `init-project.mjs`       | git 존재 확인 + (필요 시) `git init -b main` + `harness/config.json` 기록     | `--use-git[=bool]`, `--use-mcp[=bool]` / 환경변수 `HARNESS_USE_GIT`, `HARNESS_USE_MCP`        |
| `loop.mjs`            | 재호출 드라이버 (1 호출 = 1 페이즈)                                           | `--init "<s1>,<s2>"` (planSteps 시드, init 상태에서만)                                        |
| `git-flow.mjs`        | `seed-main` / `start-step <nn> <slug>` / `merge-step <nn> <slug> [--gate-ok]` | `skipGitFlow=true` 면 전 명령 no-op                                                           |
| `done-gate.mjs`       | 완료 게이트 (결정적 4종 + 평가 임계치)                                        | `--deterministic-only`, `--json`, `--score=N`, `--major-complaints=N`, `--skip-deterministic` |
| `eval-playwright.mjs` | 고객 평가 + 루브릭 채점 + teardown                                            | `--port=N`(기본 8000), `--id=ID`, `--score=N`, `--major-complaints=N`, `--no-server`          |
| `check-arch.js`       | FSD 레이어 경계 검사                                                          | `--json`, `--files <dir>`                                                                     |
| `demo.mjs`            | 통합 스모크 데모 (실제 repo 무오염)                                           | —                                                                                             |

### 슬래시 커맨드 (`.claude/commands/`)

| 커맨드           | 감싸는 스크립트                              | 설명                                  |
| ---------------- | -------------------------------------------- | ------------------------------------- |
| `/start-project` | `init-project`·`loop --init`·`git-flow seed-main` | 연동 확인 + Notion 대시보드 초기화 → Q&A·계획·main 시드 |
| `/run-cycle`     | `loop.mjs` 재호출 + 협의 위임                | 사이클 완주의 심장                    |
| `/status`        | `harness/state.json` 조회                    | 진행 상황 표시                        |
| `/git-flow`      | `git-flow.mjs`                               | 브랜치 라이프사이클                   |
| `/evaluate`      | `eval-playwright.mjs`                        | 고객 평가 + Notion 미러               |

### done-gate 통과 규칙 (히스테리시스 + 래치)

`merge` 페이즈의 `git-flow merge-step` 이 내부적으로 `done-gate.mjs` 를 호출합니다. **결정적 게이트 AND 평가 임계치** 를 모두 만족해야 exit 0 → 병합:

- **진입(ENTER)**: 종합 score ≥ 90 AND major 불만 0 → 통과 + 래치(`state.scores[stepId].latched=true`).
- **유지(HOLD)**: 래치 후 score ≥ 88 이면 계속 통과 (88~90 미세 변동은 플래핑 없음).
- **탈락**: 래치 후 score < 88, 또는 major 불만 발생.

---

## 3. 협의체 동작 (consensus)

오케스트레이터 중재 모델·9역할 요약은 [AGENTS.md](../AGENTS.md) 와 [.claude/agents/README.md](../.claude/agents/README.md) 에 있습니다. 운용 핵심:

1. **CEO 가 subset 선정**: 페이즈에 투입할 에이전트 subset 을 `harness/decisions/<id>-roster.md` 에 근거와 함께 기록.
2. **PM 이 호출(최대 동시 K=3)**: CEO 선정 subset 만, 한 번에 최대 3개 에이전트 동시 호출.
3. **`주장:이유` 증분 append**: 각 기여를 받는 즉시 `harness/decisions/<id>.md` 에 추가(배치 금지).
4. **충돌만 반박(≤3 라운드)**: 입장이 충돌하는 지점에만 반박 라운드. 최대 3 라운드.
   토론 페이즈는 **매 단계 항상** 실행하되, 이견이 없으면 1라운드(주장:이유 1회 + 합성)로 종결합니다(확정 1).
5. **합성**: 합의 시 최종 결론(타협 + `why`) 기록, 미합의 시 CEO 에스컬레이션.

> 서브에이전트는 서로 직접 대화하지 않습니다. 모든 통신은 PM 코디네이터를 통하며, 공유 문서 `harness/decisions/<id>.md` 가 단일 진실 공급원입니다.

### 토론 로그 스키마 (`harness/decisions/<id>.md`)

`scripts/lib/log.mjs` 의 `logDecision()` 이 다음 스키마로 생성합니다:

```
안건 / 제기자 / 주장:이유[] / 관점·반박 / 타협 / 결론 + 근거(why) / 영향 / 연결단계
```

```js
import { logDecision } from './scripts/lib/log.mjs';
logDecision(repoRoot, {
	topic: '안건 한 줄',
	raisedBy: 'architect',
	claims: [{ agent: 'ui', claim: '주장', reason: '이유' }],
	rebuttals: ['ux → ui: 반박/관점'], // 문자열 또는 배열
	compromise: '타협안',
	conclusion: '결론',
	why: '왜 이 결론인지',
	impact: '영향 범위',
	linkedStep: '01-login',
});
// → harness/decisions/decision-NNNN.md (결정적 id)
```

예시 산출물: `harness/decisions/example-0001.md` (스키마 데모).

### 재작업 한도 (코드 강제)

`evaluate`/`debate` 에서 임계치 미달이면 재작업합니다. **카운트와 분기는 `loop.mjs` 가 코드로 강제**합니다:

- `debate` 가 `rework` 판정이면 드라이버가 `state.reworkCount`++ 후 `implement` 로 되돌립니다 (step 바뀌면 0 초기화).
- `reworkCount` 가 `MAX_REWORK(=5)` 에 도달한 뒤에도 `rework` 면 → `merge` 대신 **`vote` 페이즈**로 분기(확정 2).
- 투표의 *내용*(다수결, 동률 시 CEO 캐스팅보트, 확정 3)은 에이전트가 수행하고 표 분포·결과를 decisions 에 기록합니다.
- `vote` → `merge` 로 진행하며 `state.gateOverride=true` 가 done-gate 를 `--vote-override` 로 호출 → **주관 임계만 우회, 결정적 게이트는 유지**. 따라서 점수 정체로는 멈추지 않되 깨진 코드는 병합되지 않습니다.

`debate` 결과는 평가 파일(`harness/evaluations/<id>.json`)의 히스테리시스 판정으로 자동 결정되며, 비대화형에서는 `--debate=pass|rework`(또는 env `HARNESS_DEBATE_OUTCOME`)로 주입할 수 있습니다.

---

## 4. 평가 (고객 에이전트)

`scripts/eval-playwright.mjs` 가 dev 서버를 고정 포트(기본 8000)에 detached 로 띄우고, Playwright(chromium headless)로 접속해 스크린샷·관찰값을 수집한 뒤 고정 루브릭으로 채점합니다.

- **루브릭 4차원**: UI(0.25) / UX(0.20) / 기능(0.35) / 품질(0.20). 가중 평균 = 종합 점수. 상세: [eval-rubric.md](eval-rubric.md).
- **불만 = 실패한 체크리스트 항목**. major 불만이 1건이라도 있으면 done-gate FAIL.
- **TEARDOWN(Windows critical)**: 항상 `finally` 에서 `taskkill /F /T /PID` 로 dev 서버 프로세스 트리를 종료하고 포트 해제를 검증 → orphan 미잔존.
- **폴백**: Playwright 미설치/브라우저 실패 시 정적 폴백(static-fallback)으로 전환하되 teardown 은 동일 수행, exit 0.
- **Notion 미러(자동)**: `config.useMcp=true` 면 개발 중 자동 적재됩니다 — `loop.mjs` 가 페이즈마다 대시보드 진행상황(`upsertDashboard`)을, `logDecision` 이 결정 결론(`mirrorDecisionComment`)을 `harness/notion-outbox/` 에 쌓습니다. `false` 면 모두 no-op. `useMcp=true` 면 `loop`·`init-project` 가 적재 직후 **`scripts/notion-flush.mjs`(Notion REST)로 실제 Notion 에 자동 반영**합니다(`NOTION_TOKEN` 필요, best-effort — 실패 시 outbox 에 남아 재시도). 상세: [notion-dashboard.md](notion-dashboard.md).

---

## 5. 통합 데모 (`scripts/demo.mjs`)

전체 골격을 **실제 저장소를 오염시키지 않고** 한 번에 시연합니다.

- git-flow(`seed-main → start-step → merge-step`)는 `os.tmpdir` 의 throwaway 임시 git repo 에서 실행 → 실제 repo 무커밋.
- loop 1-step 완주는 임시 cwd(demo state)에서 실행 → 실제 `harness/state.json` 무손상.
- `logDecision` 협의 결정 시연도 **임시 격리 디렉터리**에서 실행 → 실제 `harness/decisions/` 무오염(이전엔 실제 decisions 를 일괄 삭제하다 진짜 기록까지 지우던 버그를 제거).
- 실제 repo 에 남기는 산출물: (1) `harness/report.md` 최종 보고(eval-0001 의 차원별/종합 평점 + 단계 요약 + 미해결 불만 수), (2) `harness/cycles/` 요약 로그.
- 성공 시 마지막 줄에 `DEMO: PASS`.

---

## 6. 새 프로젝트 초기화 (`scripts/reset-project.mjs`)

이 저장소를 폴더째 복사해 새 프로젝트를 시작할 때, 이전 프로젝트의 잔존물을 한 번에 정리합니다. **파괴적이므로 기본은 dry-run(미리보기)이고 `--apply` 를 줘야 실제로 적용**됩니다.

```bash
node scripts/reset-project.mjs --name=my-app          # 미리보기
node scripts/reset-project.mjs --name=my-app --apply  # 실제 적용
```

> 이 스크립트는 **`/copy-project` 가 복사 시 `--no-notion` 으로 호출**(빈 껍데기화)하거나, 복사 없이 제자리에서 다시 시작할 때 `yarn reset --apply` 로 직접 실행합니다. **Notion 대시보드 초기화·접속 확인은 `/start-project`(연동 확인 단계)가 새 URL 로 수행**합니다(별도 `/clear-project`·`/init-project` 커맨드는 통합으로 제거됨).

### 6-1. 다른 경로로 복사하며 시작 (`scripts/copy-project.mjs` / `/copy-project`)

제자리 초기화 대신, **이 하네스를 새 위치로 복사하면서 곧바로 초기화**하려면 `copy-project` 를 씁니다.

```bash
node scripts/copy-project.mjs --dest=<부모경로> --name=<이름>     # <부모경로>/<이름> 으로 복사 + 초기화
node scripts/copy-project.mjs --dest=../ --name=my-app --no-clear # 복사만(초기화 생략)
```

- `.env`(토큰)·`.git`·`node_modules`·`dist`·`.yarn` 캐시·`*.tsbuildinfo`·`.omc` 는 복사에서 제외합니다.
- 복사 직후 복사본 안에서 `reset-project --apply` 를 실행해 초기화합니다(가짜 통과 방지·정체성 치환·Notion 리셋 포함).
- **복사는 새 위치 생성이라 비파괴적** → 미리보기/승인 없이 바로 진행합니다. 대상이 이미 있거나 소스 내부 경로면 거부합니다.
- 슬래시 커맨드 **`/copy-project`** 는 대상 경로·이름을 물어본 뒤 바로 복사+초기화하고, 필요 시 Notion 을 실제로 비웁니다. 정의: [.claude/commands/copy-project.md](../.claude/commands/copy-project.md).

- **정리 대상**: `harness/` 런타임 산출물(`state.json`·`config.json`·`report.md`·`cycles` 로그·`decisions`·`evaluations`·`errors`), `.env` 토큰(→ `.env.example` 내용으로), 제품 정체성(`package.json`·`index.html`·`src/app/App.tsx` 의 `harness-setup` → 새 이름).
- **가짜 통과 방지**: 이전 평가(`harness/evaluations/<id>.json`)를 제거합니다 — 안 그러면 새 프로젝트의 첫 merge 게이트가 옛 점수를 읽어 통과해 버립니다.
- **Notion 초기화**: 프로젝트가 Notion 을 썼다면(`config.useMcp`) `harness/notion-outbox/dashboard-reset.json` 페이로드를 적재합니다. 다음 flush 때 오케스트레이터가 대시보드(계획·요약·결정 미러)를 비웁니다. `--notion`/`--no-notion` 으로 강제·억제할 수 있습니다.
- **보존**: 하네스 엔진(`scripts/`·`.claude/`·`docs/`·`src/` 예시 슬라이스)과 `example-*`/`.gitkeep` 문서 예시는 건드리지 않습니다. git 이력(`.git`)·브랜치는 안내만 하고 자동 변경하지 않습니다.
- **멱등**: 이미 정리된 저장소에 다시 돌리면 변경 0건입니다.

---

## 7. 문서 읽는 법

| 무엇이 궁금한가                   | 어디를 보나                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 빠르게 돌려보기                   | [README.md](../README.md) 빠른 시작                                                                                             |
| 상세 사용법·명령어·협의 동작      | 이 문서                                                                                                                         |
| 협의체 역할·중재 모델·디렉터리 맵 | [AGENTS.md](../AGENTS.md), [.claude/agents/README.md](../.claude/agents/README.md)                                              |
| FSD 레이어/세그먼트/배럴/네이밍   | [fsd/](fsd/) (app/pages/widgets/features/entities/shared/naming) — 레이어 문서의 코드 스니펫이 작성 템플릿 (`example` 은 플레이스홀더) |
| 평가 기준(차원·체크리스트·점수)   | [eval-rubric.md](eval-rubric.md)                                                                                                |
| 상태 매니페스트·크래시 재개 규칙  | [state-manifest.md](state-manifest.md)                                                                                          |
| Notion 대시보드/댓글 미러 스펙    | [notion-dashboard.md](notion-dashboard.md)                                                                                      |
| 각 페이즈 오케스트레이터 행위     | [.claude/commands/run-cycle.md](../.claude/commands/run-cycle.md)                                                               |

> **1차 문서 소스 = 저장소 내 MD/코드.** Notion 없이도 전체 흐름을 파악할 수 있도록 설계되었으며, Notion 은 (MCP 연동 시) 미러입니다.
