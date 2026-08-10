# /status — 하네스 진행 상태 한눈에 보기

```bash
node scripts/status.mjs          # 사람용 대시보드
node scripts/status.mjs --json   # 머신리더블 (스크립트/오케스트레이터용)
yarn status                      # 동일
```

**읽기 전용입니다.** 어떤 파일도 쓰지 않고 페이즈를 전진시키지 않습니다.
(`loop.mjs` 는 호출하면 **한 페이즈 전진**하므로 단순 조회에 쓰면 안 됩니다.)

## 무엇을 보여주나

사용자가 실제로 알고 싶은 네 가지를 한 화면에 모읍니다. 이 정보는 원래
`state.json` · `gate-status.json` · `evaluations/eval-*.json` · `evaluations/scen-*/scenario.json` · `plan.json`
**다섯 파일**에 흩어져 있었습니다.

| 알고 싶은 것 | 화면의 어디 |
| --- | --- |
| ① 지금 어디까지 왔나 | 상단 `step 1/2` + 페이즈 진행 막대 |
| ② 지금 무엇이 막고 있나 | `최신 검사 결과` 4줄 (게이트 / E2E / 평가 / AC) + `막힌 이유` |
| ③ **다음에 뭘 해야 하나** | 맨 아래 `▶ 다음 1개 행동` |
| ④ 만들려던 것이 만들어지고 있나 | `수용기준 AC` — AC 별 ✓/· 표시 |

## 예시 출력

```
┌─ 하네스 상태 ─────────────────────────────────────────────
│ 🔵 running   step 1/2  01-task-board
│ 사이클 step-0#0   재작업 0/5
├─ 페이즈 ──────────────────────────────────────────────────
│ decompose → design → implement → [verify] → evaluate → debate → merge
│ 지금: verify — 게이트 4종 + 실제 조작(E2E) 검증 — 코드가 자동 실행
├─ 최신 검사 결과 (이번 사이클) ────────────────────────────
└───────────────────────────────────────────────────────────
  게이트 4종       ✅ green
  상호작용 E2E     — 미실행
  평가             — 미실행
  수용기준 AC      ❌ 2/3 단언으로 덮임 · 미검증: AC-3
                   목표: 작업을 등록하고 상태를 바꾼다
                   ✓ AC-1 제목·담당자를 입력해 작업을 추가하면 목록에 보인다
                   ✓ AC-2 추가 후 입력 폼이 비워진다
                   · AC-3 상태를 완료로 바꾸면 통계가 갱신된다
  실패 카운터      verify=2/3  에스컬레이션 0/3

▶ 다음 1개 행동: 단언에 ac 태그 추가(AC-3) → node scripts/loop.mjs
  이유: 수용기준 1개가 어떤 단언으로도 검증되지 않습니다 — verify 가 게이트 실행 전에 차단합니다
```

이 예시의 핵심은 **AC-3 이 아직 어떤 단언으로도 검증되지 않았다는 사실을 verify 를 돌리기 전에 알려준다**는 점입니다.
15초짜리 게이트를 돌려보고 실패로 알게 되는 것보다 값싼 순서입니다.

## 읽는 법

### 신선도 — "이번 사이클" 이 기준

게이트·평가·E2E 결과는 모두 **이번 사이클(`step-<idx>#<rework>`)** 의 것만 유효합니다.
다른 사이클 결과는 `⚠ 다른 사이클(...)` 로 표시되며 통과 근거가 되지 않습니다
(이전 재작업 회차의 100점이 이번 merge 를 통과시키던 구멍을 막은 규칙).

### 수용기준(AC) — 비활성이면 경고

`harness/plan.json` 이 없으면 이 줄은 이렇게 뜹니다.

```
  수용기준 AC      — plan.json 없음 (AC 추적 비활성 — 만든 것이 의도와 맞는지 코드가 모릅니다)
```

AC 추적을 켜려면 `harness/plan.example.json` 을 `harness/plan.json` 으로 복사해 작성합니다.
켜는 순간부터 verify 가 AC 커버리지를 강제합니다(빠진 AC → 설계결함 → `design` 되돌림).

### 상태 아이콘

| 아이콘 | 의미 |
| --- | --- |
| 🔵 `running` | 진행 중 |
| 🛑 `blocked` | 자동 복구 포기 — 조치 후 `loop.mjs --resume` (저장소가 바뀌어야 재개 허용) |
| 🏁 `done` | 모든 step 완료 |

## 원본 파일을 직접 봐야 할 때

| 항목 | 경로 |
| --- | --- |
| 상태 매니페스트 | `harness/state.json` ([스키마](../../docs/state-manifest.md)) |
| 계획·수용기준 | `harness/plan.json` (예시: `harness/plan.example.json`) |
| 게이트 실측 | `harness/gate-status.json` |
| 상호작용 결과 | `harness/evaluations/scen-<cycle>/scenario.json` · `preflight.json` |
| 평가 결과 | `harness/evaluations/eval-*.json` / `.md` (+ 스크린샷·dom.html) |
| 사이클 로그 | `harness/cycles/cycle-log.ndjson` (페이즈별 1줄) |
| 협의 기록 | `harness/decisions/<id>.md` |
| 에러 로그 | `harness/errors/` |
| 리포트 | `harness/report.md` |

## 평점 해석 — done-gate 히스테리시스

- `score ≥ 90` & `major = 0` → 최초 통과 + 래치(`latched=true`)
- 래치 후 `score ≥ 88` → 계속 통과 (88~90 미세변동은 플래핑 없음)
- 래치 후 `score < 88` 또는 `major > 0` → 탈락(`latched=false`)
