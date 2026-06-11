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
| `preflight.mjs`       | git 존재 확인 + (필요 시) `git init -b main` + `harness/config.json` 기록     | `--use-git[=bool]`, `--use-mcp[=bool]` / 환경변수 `HARNESS_USE_GIT`, `HARNESS_USE_MCP`        |
| `loop.mjs`            | 재호출 드라이버 (1 호출 = 1 페이즈)                                           | `--init "<s1>,<s2>"` (planSteps 시드, init 상태에서만)                                        |
| `git-flow.mjs`        | `seed-main` / `start-step <nn> <slug>` / `merge-step <nn> <slug> [--gate-ok]` | `skipGitFlow=true` 면 전 명령 no-op                                                           |
| `done-gate.mjs`       | 완료 게이트 (결정적 4종 + 평가 임계치)                                        | `--deterministic-only`, `--json`, `--score=N`, `--major-complaints=N`, `--skip-deterministic` |
| `eval-playwright.mjs` | 고객 평가 + 루브릭 채점 + teardown                                            | `--port=N`(기본 8000), `--id=ID`, `--score=N`, `--major-complaints=N`, `--no-server`          |
| `check-arch.js`       | FSD 레이어 경계 검사                                                          | `--json`, `--files <dir>`                                                                     |
| `demo.mjs`            | 통합 스모크 데모 (실제 repo 무오염)                                           | —                                                                                             |

### 슬래시 커맨드 (`.claude/commands/`)

| 커맨드           | 감싸는 스크립트                              | 설명                                  |
| ---------------- | -------------------------------------------- | ------------------------------------- |
| `/preflight`     | `preflight.mjs`                              | git/MCP 게이트 (인터뷰보다 먼저 실행) |
| `/start-project` | `loop.mjs --init` + `git-flow.mjs seed-main` | Q&A → 계획 → 조건부 main 시드         |
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

### 재작업 한도

`evaluate`/`debate` 에서 임계치 미달이면 재작업합니다. `state.reworkCount` 로 추적하며 **최대 5회**(확정 2).
5회 결렬 시 **에이전트 투표**로 결정합니다 — 다수결, 동률이면 CEO 캐스팅보트(확정 3). 투표 결과와
표 분포를 decisions 에 기록한 뒤 다음 step 으로 진행합니다(완전 자율 유지, blocked 없음).

---

## 4. 평가 (고객 에이전트)

`scripts/eval-playwright.mjs` 가 dev 서버를 고정 포트(기본 8000)에 detached 로 띄우고, Playwright(chromium headless)로 접속해 스크린샷·관찰값을 수집한 뒤 고정 루브릭으로 채점합니다.

- **루브릭 4차원**: UI(0.25) / UX(0.20) / 기능(0.35) / 품질(0.20). 가중 평균 = 종합 점수. 상세: [eval-rubric.md](eval-rubric.md).
- **불만 = 실패한 체크리스트 항목**. major 불만이 1건이라도 있으면 done-gate FAIL.
- **TEARDOWN(Windows critical)**: 항상 `finally` 에서 `taskkill /F /T /PID` 로 dev 서버 프로세스 트리를 종료하고 포트 해제를 검증 → orphan 미잔존.
- **폴백**: Playwright 미설치/브라우저 실패 시 정적 폴백(static-fallback)으로 전환하되 teardown 은 동일 수행, exit 0.
- **Notion 미러**: `harness/config.json` 의 `useMcp` 로 게이트. `false` 면 no-op, `true` 면 `harness/notion-outbox/` 에 페이로드 적재. 상세: [notion-dashboard.md](notion-dashboard.md).

---

## 5. 통합 데모 (`scripts/demo.mjs`)

전체 골격을 **실제 저장소를 오염시키지 않고** 한 번에 시연합니다.

- git-flow(`seed-main → start-step → merge-step`)는 `os.tmpdir` 의 throwaway 임시 git repo 에서 실행 → 실제 repo 무커밋.
- loop 1-step 완주는 임시 cwd(demo state)에서 실행 → 실제 `harness/state.json` 무손상.
- 실제 repo 에 남기는 산출물: (1) `harness/decisions/decision-NNNN.md` 1건(`logDecision`, 반복 실행해도 누적 안 함), (2) `harness/report.md` 최종 보고(eval-0001 의 차원별/종합 평점 + 단계 요약 + 미해결 불만 수), (3) `harness/cycles/` 요약 로그.
- 성공 시 마지막 줄에 `DEMO: PASS`.

---

## 6. 문서 읽는 법

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
