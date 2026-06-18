# /run-cycle — 사이클 완주 (드라이버 재호출 + 협의 위임)

> 사양서 참조: `docs/spec/interview-2026-06-11.md`

> ⛔ **이 문서와 참조 사양 md 를 반드시 읽고 그대로 수행한다.** 매 사이클 오케스트레이터는 `run-cycle.md`(이 문서)·`.claude/agents/*.md`(역할)·`docs/eval-rubric.md`(채점)·`docs/notion-hub-layout.md`(허브)를 **읽고 실행**한다. **에이전트 페이즈를 no-op 로 건너뛰거나, 실제 평가 없이 점수로 통과시키지 않는다.** 매 사이클: **실제 구현 → 실제 평가(Playwright 화면 + 루브릭) → 토론 → 이번 사이클의 신선한 증거(`evaluations/<id>.json`(`stepId` 포함)·스크린샷·`decisions/<id>.md`)로만 통과**. done-gate 가 stale·다른-step 평가를 **거부**하므로 가짜 100점 통과는 불가능하다(아래 §done-gate).

자율 개발 루프의 심장입니다. 드라이버 `scripts/loop.mjs` 를 **페이즈마다 재호출**하며 현재 step 을
`decompose → design → implement → verify → evaluate → debate → merge` 순으로 완주시킵니다.

## 왜 페이즈마다 재호출하는가

서브에이전트는 서로 직접 대화하지 못하고, 오케스트레이션을 하나의 거대한 턴에 몰아넣어서도 안 됩니다.
그래서 `loop.mjs` 는 **"한 번 호출 = 한 페이즈 진행"** 의 결정적 상태 기계입니다.
각 호출 후 상태가 `harness/state.json` 에 원자적으로 기록되므로, 턴 경계/크래시를 넘어 재개됩니다.

- **결정적 페이즈** (`verify`, `merge`): `loop.mjs` 가 직접 실행합니다.
  - `verify` → `node scripts/done-gate.mjs --deterministic-only` (typecheck/lint/check-arch/test).
  - `merge` → `node scripts/git-flow.mjs merge-step <nn> <slug>` (done-gate 통과 시에만 병합).
- **에이전트 주도 페이즈** (`decompose`, `design`, `implement`, `evaluate`, `debate`):
  `loop.mjs` 는 `PHASE <name> requires agent work via /run-cycle` 로그 + `harness/cycles/` 에
  사이클 로그를 남기고 전진합니다. **실제 에이전트 추론은 이 커맨드가 담당**합니다.

## 페이즈별 오케스트레이터 동작

각 페이즈에서 `loop.mjs` 를 호출하기 **전에**, 에이전트 주도 페이즈라면 아래 협의를 수행해 산출물을
만들고, 그 다음 `node scripts/loop.mjs` 로 페이즈를 마감(전진)합니다.

### 협의 위임 모델 (PM 코디네이터 — `.claude/agents/pm.md`)

1. **CEO 가 subset 선정**: 이번 페이즈에 투입할 에이전트 subset 을 `harness/decisions/<id>-roster.md` 에 근거와 함께 기록합니다 (`.claude/agents/ceo.md`).
2. **PM 이 호출 (최대 동시 K=3)**: CEO 선정 subset 만, 한 번에 최대 3개 에이전트를 동시 호출합니다.
3. **주장:이유 증분 append**: 각 에이전트의 `주장:이유` 기여를 받는 즉시 `harness/decisions/<id>.md` 에 추가합니다 (배치 금지).
4. **토론 페이즈는 매 단계 항상 실행합니다.** 이견이 없으면 1라운드(각 에이전트 `주장:이유` 1회 제출 + PM 합성)로 짧게 종결합니다. 이견이 있을 때만 반박 라운드를 추가로 진행합니다(최대 3 라운드).
5. **합성**: 3 라운드 내 합의 시 최종 결론(타협안 + `why`)을 기록, 미합의 시 `[미합의 → CEO 에스컬레이션]`.

> 에이전트 간 통신은 항상 PM 을 거칩니다. 공유 문서 `harness/decisions/<id>.md` 가 단일 진실 공급원입니다.

### 페이즈 의미

| 페이즈      | 주도         | 산출/행위                                                                             |
| ----------- | ------------ | ------------------------------------------------------------------------------------- |
| `decompose` | 에이전트     | step 분해(`harness/decisions/<id>.md`). **진입 시 드라이버가 `git-flow start-step` 으로 step 브랜치 생성**                              |
| `design`    | 에이전트     | 설계·구조 결정 (architect 중심). ADR.                                                 |
| `implement` | 에이전트     | 코드 구현 (ui/entity-modeler 등).                                                     |
| `verify`    | **드라이버** | `done-gate --deterministic-only` (typecheck/lint/check-arch/test).                    |
| `evaluate`  | 에이전트     | customer/quality/ux 채점 → `harness/evaluations/<id>.json` (종합 score + major 불만). |
| `debate`    | 에이전트     | 평가 결과 토론·반박 → 재작업 결정. **드라이버**가 결과(pass/rework)로 전이 분기.       |
| `vote`      | 에이전트     | (분기) 재작업 5회 초과 시에만 진입. 다수결+CEO 캐스팅보트 → `harness/decisions/<id>.md`. |
| `merge`     | **드라이버** | done-gate 통과 시 `git-flow merge-step` → step 브랜치 push → main 병합 → main push(원격 시)                        |

> `vote` 는 선형 시퀀스가 아니라 **분기 페이즈**입니다. `debate` 가 `rework` 판정을 냈는데
> `reworkCount` 가 이미 5(=MAX_REWORK)에 도달했을 때만 `loop.mjs` 가 `merge` 대신 `vote` 로 보냅니다.

## done-gate 통과 시 merge

`merge` 페이즈에서 `git-flow merge-step` 이 내부적으로 `done-gate.mjs` 를 호출합니다.
done-gate 는 **결정적 게이트 AND 평가 임계치(히스테리시스+래치)** 를 모두 만족해야 exit 0 → 병합:

- 진입: 종합 score ≥ 90 AND major 불만 0 → 통과 + 래치(`state.scores[stepId].latched=true`).
- 유지: 래치 후 score ≥ 88 이면 계속 통과 (88~90 미세변동은 플래핑 없음).
- 탈락: 래치 후 score < 88, 또는 major 불만 발생.

## 재작업 한도 (≤5회) — 코드 강제 (확정 2·3)

`evaluate`/`debate` 에서 임계치 미달이면 재작업합니다. **카운트·분기·진행은 `loop.mjs` 가 코드로 강제하고, 투표의 "내용"(누가 무엇에 표를 던지는가)만 에이전트가 수행**합니다.

- **카운트 (코드)**: `debate` 가 `rework` 판정일 때마다 드라이버가 `state.reworkCount` 를 1 증가시키고 `implement` 로 되돌립니다. step 이 바뀌면 0 으로 초기화합니다.
- **5회 초과 → 투표 (코드 분기)**: `reworkCount` 가 `MAX_REWORK(=5)` 에 도달한 뒤에도 `rework` 면, 드라이버가 `merge` 대신 **`vote` 페이즈**로 보냅니다.
- **투표 내용 (에이전트)**: PM 이 투표를 소집(`.claude/agents/pm.md`)하고, 참여 에이전트가 1표씩 `주장:이유` 로 행사합니다. 다수결, 동률 시 **CEO 캐스팅보트**(`.claude/agents/ceo.md`, 확정 3). 표 분포·결과를 `harness/decisions/<id>.md` 에 기록합니다.
- **투표 후 진행 (코드)**: `vote` 다음은 항상 `merge` 입니다. 이때 드라이버가 `state.gateOverride=true` 로 두어 `git-flow merge-step` 이 done-gate 를 `--vote-override` 로 호출합니다 → **주관 임계(90/88)만 우회**하고 **결정적 게이트(typecheck/lint/check-arch/test)는 그대로 강제**합니다.

> 즉 **주관 점수 정체(90 미만)로는 루프가 멈추지 않지만(완전 자율 — blocked 없음), 깨진 코드는 투표로도 병합되지 않습니다.** 결정적 게이트가 계속 실패하면 `merge` 가 전진하지 못하고 같은 페이즈를 재실행합니다(고쳐야 할 실제 버그).
> 검증: `node scripts/loop.selftest.mjs` 의 "시나리오 B: rework→vote 분기".

## 실행 루프 (의사 절차)

```bash
# 현재 페이즈 확인
node scripts/status.md 참조 → harness/state.json

# (에이전트 주도 페이즈면) 위 협의 위임을 수행해 decisions/evaluations 산출물 생성

# 페이즈 마감(전진) — 한 번 호출 = 한 페이즈
node scripts/loop.mjs

#  ... status=done 이 될 때까지 위 과정을 반복 ...
```

- 각 호출은 현재 페이즈 1개를 실행하고 다음 페이즈로 전진합니다.
- `merge` 후 다음 step 이 있으면 그 step 의 `decompose` 로 래핑, 없으면 `status=done`.
- **멱등 재개**: `committed=false` 인데 페이즈가 done 표시면, 건너뛰지 않고 현재 페이즈를 재실행합니다.

## git 브랜치 라이프사이클 (사이클마다 브랜치)

각 step(사이클)은 **독립 브랜치**에서 작업하고 통과 시에만 main 에 병합·push 한다 — **절대 main 에서 직접 작업하지 않는다**(`assertNotDirectMainWork` 가드).

1. **시작(seed)**: `git-flow seed-main` — main 에 초기 시드 커밋(없을 때만, 멱등). `/start-project` 가 1회 수행.
2. **스텝 시작(`decompose` 진입)**: `loop.mjs` 가 `git-flow start-step <nn> <slug>` 를 호출해 **`step/<nn>-<slug>` 브랜치를 생성·체크아웃**한다. 이후 design/implement/verify 는 모두 이 브랜치에서 일어난다.
3. **검증(`verify`)**: `done-gate --deterministic-only`(typecheck/lint/check-arch/test) — step 브랜치에서.
4. **병합(`merge`)**: `git-flow merge-step <nn> <slug>` — done-gate 통과 시에만:
   - 원격이 있으면 **step 브랜치를 push**(테스트 통과분 백업) →
   - `step/<nn>-<slug>` 를 `main` 에 `--no-ff` 병합 →
   - 원격이 있으면 **main 을 push**.
5. **다음 스텝**: merge 후 다음 step 의 `decompose` 로 전진 → 다시 `start-step` 으로 **새 브랜치**를 딴다.

> 원격(`origin`)이 없으면 push 는 **경고만 남기고 skip**(자율 유지). 원격은 `/start-project`(`init-project --git-remote=<url>`)로 붙인다. `skipGitFlow=true(useGit=false)` 면 위 git 동작 전체가 no-op.
> 검증: `node scripts/git-flow.selftest.mjs`(push 시나리오 [4]/[5]) · `node scripts/loop.selftest.mjs`(시나리오 C: 사이클마다 브랜치 생성).

## Notion 허브 갱신 (오케스트레이터·커넥터, 비파괴)

라이브 허브(사양: `docs/notion-hub-layout.md`)는 **`/run-cycle` 오케스트레이터가 매 사이클 커넥터(MCP)로 직접** 갱신한다 — 계획·🔄 Cycles·🚨 이슈·🚀 배포 DB에 행을 쓰고, 섹션 상단 **top-3 불릿**(§1.1)과 콜아웃 상태줄을 다시 쓴다. **구조(섹션·인라인 DB·뷰·Team Roster)는 절대 건드리지 않는다.**

- ⚠️ **옛 REST 미러는 제거됨**: `loop.mjs` 는 더 이상 `upsertDashboard`(타임라인 문단 append)·구조 삭제 reset 을 수행하지 않는다. `notion-api.mjs` 의 `dashboard.reset`/`dashboard.upsert` 는 **비파괴 no-op** 으로 바뀌었다(과거 `clearPageChildren` 가 섹션·DB를 통째로 날리던 버그 제거).
- **top-3 불릿**: 섹션 DB에 행을 쓸 때마다 그 섹션의 상위 3개를 다시 뽑아 헤더 아래 불릿 블록을 **통째로 재작성**(순수 텍스트만, `<database>` 태그 금지 — 중복 DB 방지). 행 목록은 `harness/notion-state.json` 로컬 레지스트리로 관리.
- `config.useMcp=false` 면 Notion 갱신은 전부 생략(자율 유지).

## 상태 확인 / 정리

- 진행 상황: `/status` (아래 `status.md`).
- 사이클 로그: `harness/cycles/cycle-log.ndjson` (페이즈별 1줄 append).
- 협의 기록: `harness/decisions/<id>.md`, 평가: `harness/evaluations/<id>.json`.
