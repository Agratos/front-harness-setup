# Notion 대시보드 재설계 스펙 (계획 기반) (US-009)

이 문서는 harness-setup 자율 개발 루프의 진행 상황을 Notion 에 **계획 기반(plan-driven)** 으로
표현하는 대시보드 스펙입니다. 구현 어댑터는 `scripts/lib/notion.mjs` 이며,
`harness/config.json` 의 `useMcp` 플래그로 게이트됩니다.

> ⚠️ **레거시 / 비파괴 주의.** 이 "대시보드(타임라인)" 모델은 현재 **새 허브 모델(`docs/notion-hub-layout.md`)로 대체**되었습니다. `notion-api.mjs` 의 `dashboard.reset`/`dashboard.upsert` 는 더 이상 페이지 블록을 삭제·append 하지 않고 **비파괴 no-op** 입니다(과거 `clearPageChildren` 가 허브 구조를 통째로 날리던 버그 제거). 라이브 허브 갱신은 `/run-cycle` 오케스트레이터가 **커넥터로** 수행합니다(`run-cycle.md` §Notion 허브 갱신).

---

## 1. 동작 모델 — outbox(아웃박스) 패턴

- 어댑터(`notion.mjs`)는 **라이브 Notion API 를 직접 호출하지 않습니다.**
- 대신 페이로드를 빌드해 **`harness/notion-outbox/<id>.json`** 에 적재합니다(결정론적·오프라인 안전).
- 실제 전송(생성/갱신)은 **`scripts/lib/notion-api.mjs`(Notion REST)가 flush** 합니다 — `loop`·`init-project` 가 적재 직후 `scripts/notion-flush.mjs` 를 best-effort 로 자동 실행(useMcp+`NOTION_TOKEN` 게이트). MCP 세션에서 수동 flush 도 가능합니다.

이유:

1. 런타임에 Notion MCP 가 연결돼 있지 않을 수 있습니다(또는 `useMcp=false`).
2. 평가/게이트 로직이 외부 네트워크에 의존하면 결정적 테스트가 깨집니다.
3. outbox 는 repo 안에 남으므로 **repo 만으로 전 기능이 재현·검증** 됩니다.

### useMcp 게이트

| `useMcp`       | 동작                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| `false` (기본) | 모든 어댑터 함수가 **no-op** → `{ skipped: true }`. outbox 미기록.            |
| `true`         | 페이로드를 빌드해 outbox 에 기록 → `{ skipped: false, outboxPath, payload }`. |

---

## 2. 대시보드 구조 (상단 콜아웃 + 요약 카드 + 계획단계 DB + 상세/도움말 분리)

`upsertDashboard(planSteps, scores, opts)` 가 빌드하는 페이로드 구조입니다.
멱등 키(`idempotencyKey`, 기본 `dashboard-main`)로 **매번 새로 만들지 않고 갱신(upsert)** 합니다.

### 2.1 상단 콜아웃 (topCallout)

페이지 최상단 콜아웃 블록. 한눈에 보는 요약:

- **프로젝트명** (`projectName`, 기본 `harness-setup`)
- **목표** (`goal`)
- **종합 평점** (`overallScore`) — done-gate/eval 종합 점수
- **도움말 링크** (`helpUrl`) — 별도 도움말 페이지로 연결

### 2.2 요약 카드 (summaryCards)

숫자 카드 묶음:

| 카드             | 의미                  |
| ---------------- | --------------------- |
| `totalSteps`     | 전체 계획 단계 수     |
| `doneSteps`      | 완료 단계 수          |
| `blockedSteps`   | 막힌(blocked) 단계 수 |
| `totalDecisions` | 누적 결정 수          |
| `totalErrors`    | 누적 오류 수          |

### 2.3 계획 단계 DB (planStepsDb)

**행 = 계획 단계**, **컬럼 = 상태/평점/결정수/오류/브랜치/산출물**.

| 컬럼        | 설명                                       |
| ----------- | ------------------------------------------ |
| `step`      | 단계 번호 (1-based)                        |
| `label`     | 단계 라벨                                  |
| `status`    | `pending` / `running` / `done` / `blocked` |
| `score`     | 단계 평점(있으면)                          |
| `decisions` | 그 단계에서 내린 결정 수                   |
| `errors`    | 그 단계 오류 수                            |
| `branch`    | 관련 git 브랜치                            |
| `artifacts` | 산출물 경로 목록                           |

### 2.4 상세 페이지 / 도움말 페이지 분리

본문 과밀을 막기 위해 상세·도움말은 **별도 페이지** 로 분리하고 본문에는 링크만 둡니다.

- `detailPageRef`: `dashboard/detail` — 단계별 상세, 평가 로그, 스크린샷.
- `helpPageRef`: `dashboard/help` — 루브릭/게이트/teardown 설명 등 사용 가이드.

---

## 3. 토론 댓글 미러 (mirrorDecisionComment)

결정(decision) 스레드의 토론을 Notion 으로 미러링합니다.

### capability 확인 → 폴백

1. **Notion comments API 지원 여부를 먼저 확인** 합니다(`opts.commentsApiSupported`).
2. 지원되면 `fallbackMode: 'comments-api'` — 페이지/블록 댓글로 미러.
3. **미지원이면 `fallbackMode: 'toggle-thread'`** — 페이지 본문에 **토글 스레드** 블록으로
   턴별 발언을 중첩 기록하는 폴백으로 전환합니다.

페이로드 필드: `{ decisionId, turn, author, text, fallbackMode }`.
멱등 키는 `decision-<decisionId>-turn-<turn>` 으로, 같은 턴을 중복 미러하지 않습니다.

---

## 4. flush 계약 (오케스트레이터/MCP 레이어)

outbox flush 구현은 이 문서 범위 밖이지만, 어댑터가 보장하는 계약은 다음과 같습니다.

- 각 outbox 파일은 `kind`(`dashboard.upsert` | `decision.comment.mirror`)와
  `idempotencyKey` 를 가집니다 → flush 는 **멱등 upsert** 로 처리해야 합니다.
- flush 성공 시 해당 outbox 파일을 제거(또는 `sent/` 로 이동)하는 책임은 flush 레이어에 있습니다.
- `useMcp=false` 면 outbox 자체가 생성되지 않으므로 flush 도 no-op 입니다.

---

## 5. 요약

- `useMcp=false`: outbox 미기록, 모든 함수 `{skipped:true}` → repo 만으로 동작/검증.
- `useMcp=true`: `harness/notion-outbox/<id>.json` 에 페이로드 적재 → MCP 레이어가 flush.
- 대시보드 = 상단 콜아웃 + 요약 카드 + 계획단계 DB + 상세/도움말 분리.
- 댓글 미러 = comments API 우선, 미지원 시 토글 스레드 폴백.
