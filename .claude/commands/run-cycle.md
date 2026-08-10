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
| `design`    | 에이전트     | 설계·구조 결정 (architect 중심) + ADR. **⛔ 수용기준(AC)과 그것을 검증하는 상호작용 스펙을 여기서 확정한다** — `harness/plan.json` 의 `acceptance[]` + `harness/eval-scenario.json` 의 단언(`"ac": "AC-1"` 태그). verify 의 스펙·AC 문제는 이 페이즈로 되돌아온다 |
| `implement` | 에이전트     | 코드 구현 (ui/entity-modeler 등).                                                     |
| `verify`    | **드라이버** | ①프리플라이트(스펙·AC 커버리지, 0초) → ②`done-gate --deterministic-only` → ③`eval-scenario`(실제 조작). |
| `evaluate`  | 에이전트     | **드라이버가 `eval-playwright` 를 먼저 실행**(캡처물+베이스라인 생성, 이번 사이클 산출물 없으면 차단) → customer/quality/ux 가 캡처물을 보고 `harness/evaluations/<id>.json` 의 score·complaints 를 조정. |
| `debate`    | 에이전트     | 평가 결과 토론·반박 → 재작업 결정. **드라이버**가 결과(pass/rework)로 전이 분기.       |
| `vote`      | 에이전트     | (분기) 재작업 5회 초과 시에만 진입. 다수결+CEO 캐스팅보트 → `harness/decisions/<id>.md`. |
| `merge`     | **드라이버** | done-gate 통과 시 `git-flow merge-step` → step 브랜치 push → main 병합 → main push(원격 시)                        |

> `vote` 는 선형 시퀀스가 아니라 **분기 페이즈**입니다. `debate` 가 `rework` 판정을 냈는데
> `reworkCount` 가 이미 5(=MAX_REWORK)에 도달했을 때만 `loop.mjs` 가 `merge` 대신 `vote` 로 보냅니다.

## evaluate — 캡처물(스크린샷+DOM) 소비 평가 ⛔ (무조건)

> ✅ **실행은 코드가 강제한다** — `loop.mjs` 의 evaluate 페이즈가 `eval-playwright.mjs` 를 **직접 실행**하고,
> 이번 사이클(`cycleId`)의 평가 산출물이 생기지 않으면 **전진을 차단**한다(검증결함 → evaluate 재시도).
> 즉 아래 1번은 이미 수행된 상태로 페이즈가 시작된다. **당신이 할 일은 2~3번(캡처물을 보고 판정 반영)이다.**
> (예전에는 1번도 md 지시뿐이어서 `eval-playwright.mjs` 의 호출자가 0건이었다 — 2차 자기진단 F17.)

> ⛔ **UI/UX 평가를 루브릭 숫자만으로 끝내지 않는다.** `eval-playwright.mjs` 는 `harness/evaluations/<id>/` 에 **`screenshot.png`(데스크톱)·`screenshot-mobile.png`(375px)·`dom.html`** 를 남긴다. 오케스트레이터는 evaluate 에서:
>
> 1. (코드가 수행) `eval-playwright.mjs` 로 루브릭 베이스라인 + 캡처물을 생성한다.
> 2. **customer·ui·ux 에이전트가 그 `screenshot.png`(+모바일) 이미지를 `Read` 로 직접 "보고"(이미지가 렌더됨), `dom.html` 을 읽고** 레이아웃·여백(padding)·정렬·간격·시각 위계·반응형·사용 흐름·a11y 를 평가한다.
> 3. 그 시각/UX 판정을 `evaluations/<id>.json` 의 `score`·`complaints` 로 **반영**한다(시각/UX 결함 = minor~major). 루브릭("앱이 떴는가")은 **하한**일 뿐, "잘 보이는가·쓸 만한가"는 **캡처물을 본 에이전트**가 정한다.
> 4. UI/UX 결함이 나오면 🚨 이슈 트래커 행 + 회의(§6)로 처리 → rework.
>
> ⚠️ 캡처물을 보지 않고 루브릭 점수만으로 통과시키면 **평가 무효**(실제 사고: 사이드 padding 없는 UI 가 96점 통과). `config.useMcp=false`/Playwright 미설치일 때만 정적 폴백.

## verify/QA — 상호작용(E2E) 검증 ✅ (이제 코드 강제)

> ✅ **드라이버가 자동으로 실행한다.** `verify` 페이즈의 순서는 다음과 같다.
>
> 1. **프리플라이트**(0초, `eval-scenario --preflight`) — 스펙 존재·파싱 + **AC 커버리지**.
>    실패하면 **게이트를 돌리지 않고** 즉시 차단한다(결정적 게이트 4종은 실측 15초, 실제 프로젝트면 1~2분).
> 2. `done-gate --deterministic-only` (typecheck/lint/check-arch/test)
> 3. `node scripts/eval-scenario.mjs --id=scen-<cycleId>` — 실제 조작 + 단언
>
> 단언이 하나라도 실패하면 전진을 차단한다(게이트 green + E2E 실패 = **구현결함** → `implement` 되돌림).
> 스펙·AC 문제는 **설계결함** → `design` 되돌림. 오케스트레이터가 잊어버릴 수 있는 지점이 아니다.
> **skip 은 Playwright 미설치(환경 부재)에만 허용**된다 — 스펙·서버 부재는 실패다(exit 2).
>
> 📌 **왜 코드로 옮겼나 (테스트벤치 실측)**: `e.currentTarget` 을 setState 업데이터 안에서 읽어
> **두 번째 입력에 앱이 통째로 죽는** 버그가 typecheck·lint·check-arch·**단위테스트 10개**를 전부 통과하고
> 루브릭 평가마저 **100점/major 0** 을 받았다(`eval-playwright` 는 조작을 안 하므로 초기 렌더만 본다).
> 오직 `eval-scenario` 만 잡았다. 배선이 없으면 **죽은 앱이 만점으로 병합된다.**
> 상세: `docs/testbench/results.md` 시행 1.

아래는 **시나리오 스펙을 무엇으로 채울지**에 대한 지침이다(스펙 작성은 여전히 에이전트 몫).

> ⛔ **단위 테스트·정적 렌더만으로 "동작"을 통과시키지 않는다.** QA(`.claude/agents/qa.md`)/오케스트레이터는 핵심 유스케이스를 **실제로 조작**해 단언한다: `node scripts/eval-scenario.mjs`(dev 서버 + Playwright). 스펙 `harness/eval-scenario.json` = 액션(`fill`/`select`/`click`) + 단언(`textVisible`/**`inputEmpty`**/`inputValue`/`minCount`/`textGone`).
>
> - 반드시 단언: **제출 후 폼 초기화**(inputEmpty), 추가/토글/필터 후 목록·통계 반영, 상태 변경이 실제 적용되는지, 입력 검증(잘못된 값 거부).
> - 실패 단언 → **기능 결함(major)** → `harness/errors/`·평가 반영 → done-gate FAIL → rework.
> - ⚠️ 실제 사고: "추가 후 폼 미초기화·재추가 미적용"이 단위테스트·스크린샷을 **통과**했고, 상호작용 단언으로만 잡혔다(uncontrolled 폼 `form.key` 누락).
>
> **스펙 파일이 없으면 verify 가 실패한다** (exit 2 = 검증 불가 → 설계결함 → `design` 되돌림).
> 예전에는 스펙이 없으면 exit 0 으로 **조용히 통과**해서, 이 ⛔ 지시를 무시해도 아무 일도 일어나지 않았다(F15).
> exit code 계약: **0** 통과 / 명시적 면제 / 환경 부재(Playwright 미설치) · **1** 단언 실패(구현결함 → `implement`)
> · **2** 검증 불가(스펙 없음·깨짐·빈 스펙 → `design` / dev 서버 미기동 → `implement`).
>
> 상호작용이 없는 step(예: 순수 타입 리팩터)은 **면제를 명시**한다 — 침묵의 통과는 허용되지 않는다:
>
> ```json
> { "scenarios": [], "skipReason": "이 step 은 DTO 타입 정리만 — 화면 변경 없음" }
> ```
>
> 또한 평가 루브릭의 `fn.e2e-verified`(major, 배점 30)가 이 실행 결과를 읽는다. verify 를 통과하지 않으면
> **평가 단계에서 major 불만이 생겨 merge 가 막힌다** — E2E 를 건너뛰고 점수만 받는 경로가 없다.

## done-gate 통과 시 merge

`merge` 페이즈에서 `git-flow merge-step` 이 내부적으로 `done-gate.mjs` 를 호출합니다.
done-gate 는 **결정적 게이트 AND 평가 임계치(히스테리시스+래치)** 를 모두 만족해야 exit 0 → 병합:

- 진입: 종합 score ≥ 90 AND major 불만 0 → 통과 + 래치(`state.scores[stepId].latched=true`).
- 유지: 래치 후 score ≥ 88 이면 계속 통과 (88~90 미세변동은 플래핑 없음).
- 탈락: 래치 후 score < 88, 또는 major 불만 발생.

## 결정적 페이즈 실패 처리 — 재시도 → 되돌림 → 항복 (코드 강제)

`verify`/`merge` 가 실패하면 **드라이버가 자동으로 처리**한다. 오케스트레이터가 판단할 일이 아니다.
(예전에는 전진하지 않고 같은 페이즈를 영원히 재실행해 라이브락이 났다 — 실측 결함.)

| 단계 | 조건 | 동작 |
| --- | --- | --- |
| 재시도 | 연속 실패 < 3 | 같은 페이즈 재실행 |
| 되돌림 | 연속 실패 3회 | **결함 분류**에 따라 `design`/`implement`/`evaluate` 로 되돌림 |
| 항복 | 되돌림 3회 초과 | `status='blocked'` + 사유 기록 + **exit code 3** |

**결함 분류**(`harness/gate-status.json` 실측 기반): `check-arch` 실패 = **설계결함** → `design` /
`typecheck`·`lint`·`test` 실패 = **구현결함** → `implement` / merge 실패인데 게이트 green = **검증결함** → `evaluate`.

- `blocked` 가 되면 루프는 더 진행하지 않는다. 사유를 확인하고 조치한 뒤 **`node scripts/loop.mjs --resume`** 로 재개한다.
- 검증: `node scripts/loop.selftest.mjs`(시나리오 D).

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
# ① 현재 위치·막힌 것·다음 행동 확인 (읽기 전용 — 전진하지 않음)
node scripts/status.mjs

# ② (에이전트 주도 페이즈면) 위 협의 위임을 수행해 decisions/evaluations 산출물 생성

# ③ 페이즈 마감(전진) — 한 번 호출 = 한 페이즈
node scripts/loop.mjs

#  ... status=done 이 될 때까지 ①~③ 반복 ...
```

- 각 호출은 현재 페이즈 1개를 실행하고 다음 페이즈로 전진합니다.
- `merge` 후 다음 step 이 있으면 그 step 의 `decompose` 로 래핑, 없으면 `status=done`.
- **멱등 재개**: 페이즈 실행 중 크래시했으면(`lastExecutedPhaseSeq === phaseSeq` + 미커밋)
  건너뛰지 않고 현재 페이즈를 재실행합니다(`RERUN` 표시).
- ⚠️ `status.mjs` 는 **읽기 전용**입니다. `loop.mjs` 는 호출하면 전진하므로 조회용으로 쓰지 마세요.

## git 브랜치 라이프사이클 (사이클마다 브랜치)

각 step(사이클)은 **독립 브랜치**에서 작업하고 통과 시에만 main 에 병합·push 한다 — **절대 main 에서 직접 작업하지 않는다**(`assertNotDirectMainWork` 가드).

1. **시작(seed)**: `git-flow seed-main` — main 에 초기 시드 커밋(없을 때만, 멱등). `/start-project` 가 1회 수행.
2. **스텝 시작(`decompose` 진입)**: `loop.mjs` 가 `git-flow start-step <nn> <slug>` 를 호출해 **`step/<nn>-<slug>` 브랜치를 생성·체크아웃**한다. 이후 design/implement/verify 는 모두 이 브랜치에서 일어난다.
3. **구현 커밋 (오케스트레이터 — ⛔ 필수)**: `loop.mjs`·`git-flow merge-step` 은 작업트리를 **자동 커밋하지 않는다.** merge 는 **커밋된 이력만** `--no-ff` 병합하므로, implement 산출물(코드·테스트·decisions)을 **반드시 step 브랜치에 `git add`/`git commit`** 해야 한다 — 안 하면 merge 가 **빈 병합**이 되어 코드가 main 에 안 들어간다. merge 직전엔 작업트리를 깨끗이 커밋해 둔다(`merge-step` 의 `git checkout main` 이 미커밋 변경으로 막히지 않게). ⚠️ 런타임 `harness/state.json` 은 추적 제외(`.gitignore`)이며 **`git add -A` 로 끌어와 커밋하지 말 것** — done-gate 가 merge 중 latch 를 state.json 에 쓰는데 tracked 면 직후 `checkout main` 이 충돌한다(실제 테스트에서 merge 1회 실패).
4. **검증(`verify`)**: `done-gate --deterministic-only`(typecheck/lint/check-arch/test) — step 브랜치에서.
5. **병합(`merge`)**: `git-flow merge-step <nn> <slug>` — done-gate 통과 시에만:
   - 원격이 있으면 **step 브랜치를 push**(테스트 통과분 백업) →
   - `step/<nn>-<slug>` 를 `main` 에 `--no-ff` 병합 →
   - 원격이 있으면 **main 을 push**.
6. **다음 스텝**: merge 후 다음 step 의 `decompose` 로 전진 → 다시 `start-step` 으로 **새 브랜치**를 딴다.

> 원격(`origin`)이 없으면 push 는 **경고만 남기고 skip**(자율 유지). 원격은 `/start-project`(`init-project --git-remote=<url>`)로 붙인다. `skipGitFlow=true(useGit=false)` 면 위 git 동작 전체가 no-op.
> 검증: `node scripts/git-flow.selftest.mjs`(push 시나리오 [4]/[5]) · `node scripts/loop.selftest.mjs`(시나리오 C: 사이클마다 브랜치 생성).

## Notion 허브 갱신 (오케스트레이터·커넥터, 비파괴) — ⛔ 무조건 수행

> ⛔ **매 사이클 Notion 허브 갱신은 필수다. 서술로만 두고 건너뛰지 않는다.** (실제 사고: 코드·게이트·평가·머지만 끝내고 Notion 을 빈손으로 둬서, 라이브 허브가 옛 프로젝트 그대로 남음.) `config.useMcp=false` 또는 토큰/네트워크 부재일 때**만** 생략(자율 유지).
>
> ⚠️ **이 항목만은 코드 검사자가 없다** (2차 자기진단 F22). 구조를 통째로 지우던 REST 미러를 제거한 뒤
> 대체 배선을 넣지 않았기 때문에, 하네스의 다른 ⛔ 와 달리 **건너뛰어도 전진이 막히지 않는다.**
> 그래서 여기가 가장 잘 잊히는 자리다 — 사이클을 닫기 전에 이 절을 다시 읽고 실제로 갱신했는지 확인한다.
> (`AGENTS.md` 강제 모델 표에도 "수동 준수" 로 표기돼 있다. 코드 강제로 올리는 것은 로드맵 5단계.)

라이브 허브(사양: `docs/notion-hub-layout.md`)는 **`/run-cycle` 오케스트레이터가 매 사이클 커넥터(MCP)/REST 로 직접** 갱신한다. **구조(섹션·인라인 DB·뷰·Team Roster)는 절대 건드리지 않는다.** 사이클마다 아래를 수행한다(해당 없으면 그 항목만 생략):

- **첫 사이클(새 프로젝트)**: 📋 계획 DB 에 planSteps 행이 없으면 먼저 생성(한 행 = 한 step). `/start-project` §1b 의 허브 초기화가 안 됐으면 여기서 보강.
- **decompose 진입**: 🔄 Cycles DB 새 행(`사이클 N — <step>`, 상태 `진행 중`, `계획` relation, `에이전트` multi_select) 생성 → 🔄 진행 상황 **top-3 불릿 재작성** + 콜아웃 상태줄(`사이클 N/M`) 갱신.
- **evaluate/debate**: 사이클 행 `평가`(done-gate score)·`한 일` 갱신. 이슈가 있으면 🚨 이슈 트래커 행 생성 + 본문 회의(§6) 기록.
- **verify/evaluate**: 🧪 테스트 관리 DB 에 각 테스트(결정적 게이트·상호작용/E2E·평가·단위)의 **통과/실패 행**을 사이클 relation 으로 기록(eval-scenario 스토리보드 결과 포함) → 🧪 테스트 **top-3 불릿 재작성**(실패 🔴 → 미실행 ⚪ → 최신 실행일, §1.1). "모든 기능이 테스트됐고 통과했나"의 원장(§4). **상호작용 행은 만든 뒤 `node scripts/notion-storyboard.mjs --id=<scenId> --row=<행 page id>` 로 캡처 스토리보드를 행 본문에 이미지로 첨부**(File Upload API — MCP 가 못 하는 단계, §4·§8). 안 하면 행만 있고 사진이 안 보인다.
- **merge**: 사이클 행 상태 `완료`. 배포가 있으면 🚀 배포 DB 행 + 콜아웃 '최근 배포' 갱신.
- **값/도구 형식**: `docs/notion-hub-layout.md` §8 준수 — relation=`"[\"https://app.notion.com/p/<id>\"]"`, date=`is_datetime`=1, multi_select=JSON 문자열, 행 생성=`notion-create-pages`(parent=`data_source_id`). 허브/ds ID 는 박힌 값 신뢰 말고 **허브를 fetch 해 현재 ID** 사용.
- ⚠️ top-3 불릿 재작성의 텍스트에는 **순수 텍스트만**(`<database>` 태그 금지 — 중복 DB 양산 방지).

- ⚠️ **옛 REST 미러는 제거됨**: `loop.mjs` 는 더 이상 `upsertDashboard`(타임라인 문단 append)·구조 삭제 reset 을 수행하지 않는다. `notion-api.mjs` 의 `dashboard.reset`/`dashboard.upsert` 는 **비파괴 no-op** 으로 바뀌었다(과거 `clearPageChildren` 가 섹션·DB를 통째로 날리던 버그 제거).
- **top-3 불릿**: 섹션 DB에 행을 쓸 때마다 그 섹션의 상위 3개를 다시 뽑아 헤더 아래 불릿 블록을 **통째로 재작성**(순수 텍스트만, `<database>` 태그 금지 — 중복 DB 방지). 행 목록은 `harness/notion-state.json` 로컬 레지스트리로 관리.
- `config.useMcp=false` 면 Notion 갱신은 전부 생략(자율 유지).

## 상태 확인 / 정리

- 진행 상황: `/status` (아래 `status.md`).
- 사이클 로그: `harness/cycles/cycle-log.ndjson` (페이즈별 1줄 append).
- 협의 기록: `harness/decisions/<id>.md`, 평가: `harness/evaluations/<id>.json`.
