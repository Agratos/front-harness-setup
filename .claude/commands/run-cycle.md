# /run-cycle — 사이클 완주 (드라이버 재호출 + 협의 위임)

> 사양서 참조: `docs/spec/interview-2026-06-11.md`

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
| `decompose` | 에이전트     | step 을 세부 작업으로 분해. `harness/decisions/<id>.md`.                              |
| `design`    | 에이전트     | 설계·구조 결정 (architect 중심). ADR.                                                 |
| `implement` | 에이전트     | 코드 구현 (ui/entity-modeler 등).                                                     |
| `verify`    | **드라이버** | `done-gate --deterministic-only` (typecheck/lint/check-arch/test).                    |
| `evaluate`  | 에이전트     | customer/quality/ux 채점 → `harness/evaluations/<id>.json` (종합 score + major 불만). |
| `debate`    | 에이전트     | 평가 결과 토론·반박 → 재작업 결정.                                                    |
| `merge`     | **드라이버** | done-gate(결정적 + 평가 임계치) 통과 시 `git-flow merge-step`.                        |

## done-gate 통과 시 merge

`merge` 페이즈에서 `git-flow merge-step` 이 내부적으로 `done-gate.mjs` 를 호출합니다.
done-gate 는 **결정적 게이트 AND 평가 임계치(히스테리시스+래치)** 를 모두 만족해야 exit 0 → 병합:

- 진입: 종합 score ≥ 90 AND major 불만 0 → 통과 + 래치(`state.scores[stepId].latched=true`).
- 유지: 래치 후 score ≥ 88 이면 계속 통과 (88~90 미세변동은 플래핑 없음).
- 탈락: 래치 후 score < 88, 또는 major 불만 발생.

## 재작업 한도 (≤5회)

`evaluate`/`debate` 에서 임계치 미달이면 재작업합니다. 재작업 횟수는 `state.reworkCount` 로 추적하며
**최대 5회**입니다. 5회 결렬 시 에이전트 투표로 결정합니다(진짜 회의처럼). 다수결, 동률 시 CEO 캐스팅보트(확정 3). 투표 결과와 표 분포를 `harness/decisions/<id>.md` 에 기록한 뒤 다음 단계로 진행합니다(완전 자율 유지 — blocked 로 멈추지 않음).

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

## 상태 확인 / 정리

- 진행 상황: `/status` (아래 `status.md`).
- 사이클 로그: `harness/cycles/cycle-log.ndjson` (페이즈별 1줄 append).
- 협의 기록: `harness/decisions/<id>.md`, 평가: `harness/evaluations/<id>.json`.
