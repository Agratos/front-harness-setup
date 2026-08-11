# 세션 분리 사양 — 계획·개발·채점의 컨텍스트 격리 (2026-08-11)

> **요구의 출처**: 사용자 지시 — "계획, 개발, 채점은 같은 세션이 아니라 다른 세션에서 돌린다."
> 이 요구는 v2 인터뷰 사양(`interview-2026-06-11.md`)에 반영되지 않은 채 누락되어 있었다.
> 본 문서가 그 누락을 닫는 사양 정본이다.

## 1. 문제 — 지금 무엇이 분리되어 있지 않은가

현재 구조의 실태 (2026-08-11, main 기준 실측):

| 층 | 분리 여부 | 근거 |
| --- | --- | --- |
| 결정적 채점(루브릭 베이스라인·E2E·done-gate) | ✅ 코드 — 세션 무관 | `rubric.mjs`(순수 함수) · `eval-scenario.mjs` · `done-gate.mjs` |
| 역할 관점(customer/quality/ux 등) | 🟡 서브에이전트 컨텍스트만 분리 | `.claude/agents/*.md` |
| **주관 채점 반영(score·complaints 편집)** | ❌ **미분리** | `run-cycle.md` §협의 위임 "⛔ 호출 주체는 항상 오케스트레이터(메인 세션)다" + `customer.md` "기존 eval-NNNN.json 을 편집해 점수를 조정한다" |
| 세션 수준(계획/개발/채점 독립 프로세스) | ❌ **없음** | 사양·코드 어디에도 요구 없음 |

**왜 문제인가**: done-gate 의 통과 임계(90/88)와 major 판정에 들어가는 주관 점수를,
구현을 지휘한 바로 그 메인 세션이 수집·합성·기록한다. 서브에이전트의 컨텍스트가 분리되어
있어도 **최종 반영의 손이 같은 세션**이므로, 점수의 독립성이 구조적으로 보장되지 않는다.
(이 하네스가 반복해서 확인한 실패 유형 — "md 에 ⛔ 라고 적혀 있고 검사자가 없으면 지켜지지 않는다" —
이 그대로 적용되는 자리다.)

## 2. 격리의 정의 (이 사양에서 "다른 세션"의 의미)

채점 세션은 아래 7개 조건을 **전부** 만족해야 격리로 인정한다.

1. **새 프로세스**: 오케스트레이터와 대화 이력·컨텍스트를 공유하지 않는 fresh 세션(`claude -p` 헤드리스).
2. **입력은 파일 산출물만**: 캡처물(`screenshot.png`·`screenshot-mobile.png`·`dom.html`),
   `harness/plan.json`(AC), 평가 베이스라인 JSON, `docs/eval-rubric.md`. 구현 의도·과정 서술은 입력이 아니다.
3. **읽기 전용**: 리뷰어 세션의 도구는 `Read` 만 허용. 코드·평가 파일을 직접 수정할 수 없다.
4. **판정 반영은 코드만**: 리뷰어는 verdict JSON 을 출력할 뿐, 평가 파일에 쓰는 것은
   래퍼(`scripts/eval-review.mjs`)다. 스탬프의 유일한 발급자도 래퍼다.
5. **하향 단조(lower-only)**: 격리 리뷰는 점수를 **낮추거나 불만을 추가만** 할 수 있다.
   상향은 결함을 실제로 고친 뒤 코드 재계측(`eval-playwright` 재실행)으로만 가능하다.
6. **변조 탐지**: 래퍼가 반영 직후의 score/complaints 정규화 해시를 스탬프에 남기고,
   done-gate 가 병합 전에 재검증한다. 리뷰 이후 누가 점수를 만지면 게이트가 FAIL 한다.
7. **환경 부재만 기록된 skip**: claude CLI 가 없는 환경은 `skipped-no-tool` 스탬프로
   기록하고 통과시킨다(침묵의 통과 없음). 산출물 부재·리뷰 실패는 전부 차단이다.

## 3. 단계 로드맵

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| **1단계 — 채점 격리** | `eval-review.mjs`(격리 리뷰 스포너·스탬프 발급자) + `loop.mjs` evaluate 강제 배선 + `done-gate` 변조 탐지 | **이번 반영** |
| 2단계 — debate 입력 제한 | debate 의 pass/rework 근거를 격리 산출물(평가 JSON + `review.json`)로 제한, 오케스트레이터 임의 판정 제거. 시행 7 로 격리 채점 효과 계측(격리 전후 점수 분포 대조) | 대기 |
| 3단계 — 계획/개발 세션 분리 | `loop.mjs` 가 이미 "한 호출 = 한 페이즈" 상태 기계이므로, 페이즈 그룹별 헤드리스 세션 러너(`run-phase-session.mjs`)가 decompose·design / implement / evaluate·debate 를 각각 fresh 세션으로 실행. 세션 지문(spawn id)을 record-decision 스탬프에 포함, phase-gate 가 "구현 세션 ≠ 채점 세션" 교차 검증 | 대기 |

> 1단계를 채점부터 시작하는 이유: 품질 보증의 병목이 주관 점수의 독립성이고(시행 6의 96→100 이
> 독립성 없는 숫자였다), `loop.mjs` 의 evaluate 강제 배선(runEvaluatePhase)이라는 **기존 코드 게이트에
> 그대로 얹을 수 있어** 가장 적은 변경으로 가장 큰 독립성을 산다. 계획/개발 분리(3단계)는 러너 신설이
> 필요해 변경 폭이 크므로, 1·2단계의 실측(시행 7)을 본 뒤 착수한다.

## 4. 1단계 상세 계약

### 4.1 컴포넌트

| 파일 | 역할 |
| --- | --- |
| `scripts/eval-review.mjs` | 격리 리뷰 스포너 CLI + verdict 반영 + 스탬프 발급(유일). `--id=eval-NNNN` |
| `scripts/loop.mjs` `runEvaluatePhase` | 베이스라인 생성 후 `eval-review` 실행 → 이번 사이클 평가에 `review` 스탬프 없으면 **전진 차단**(검증결함 → evaluate 재시도). `eval-review.mjs` 부재(스켈레톤·셀프테스트 임시 cwd)는 환경 부재로 skip |
| `scripts/done-gate.mjs` | 병합 판정 시 `verifyEvalReview` 호출 — 스탬프 존재 + 해시 일치 검증. 불일치 = **변조로 간주, FAIL** |

### 4.2 리뷰어 세션 계약

- **기동**: `claude -p --allowedTools Read` (프롬프트는 stdin). 모델은 `HARNESS_REVIEW_MODEL`
  또는 `harness/config.json` 의 `review.model` (기본: CLI 기본값).
- **프롬프트**: 래퍼가 `harness/evaluations/<id>/review-prompt.md` 로 생성 — 페르소나 채점 지침
  (customer.md §캡처물 소비와 동일 루브릭)+ 읽을 파일 목록 + verdict 스키마. 감사 추적을 위해 파일로 보존.
- **출력(verdict JSON)**:

```json
{
  "dimensionScores": { "ui": 90, "ux": 100, "fn": 100, "quality": 80 },
  "complaints": [
    { "dimension": "ui", "item": "review.side-padding", "severity": "minor", "reason": "본문이 뷰포트 가장자리에 밀착" }
  ],
  "summary": "한 줄 총평"
}
```

- **반영 규칙(래퍼)**: `dimensionScores` 는 베이스라인보다 **낮을 때만** 반영(상향 무시),
  `complaints` 는 추가만(중복 item 무시). 종합 score 는 `rubric.mjs` 의 `DIMENSIONS` 가중치로 재계산,
  `majorComplaints` 는 병합 후 재계산. 리뷰어 원문은 `harness/evaluations/<id>/review.json` 에 보존.
- **스탬프(평가 JSON 의 `review` 필드)**:

```json
{
  "mode": "isolated | skipped-no-tool",
  "cmd": "claude | custom(HARNESS_REVIEW_CMD)",
  "at": "ISO8601",
  "added": { "complaints": 1, "loweredDimensions": ["ui"] },
  "integrity": "<score·majorComplaints·dimensions·complaints 정규화 sha256>"
}
```

- **exit code**: `0` 반영 완료·기록된 환경 부재 / `1` 리뷰어 실행·파싱 실패(재시도 대상) /
  `2` 대상 평가 없음.

### 4.3 우회 경로의 노출 (F24 원칙 유지)

- `HARNESS_REVIEW_CMD`(리뷰어 커맨드 오버라이드)는 셀프테스트의 환경 조건이자 우회 경로다 —
  스탬프 `cmd` 에 그대로 기록되어 사후 감사에서 보인다. 자율 루프에서 사용 금지.
- `--score` 주입 평가(`injected: true`)는 기존 bypass 표기를 따르며, done-gate 의 리뷰 요구에서
  제외된다(이미 노출된 CI 전용 경로에 이중 요구를 얹지 않는다).
  - **단, 리뷰 스탬프가 이미 있는 평가의 `injected` 플래그는 bypass 로 인정하지 않는다** — 정상 주입
    평가는 리뷰가 no-op 이라 스탬프가 생기지 않으므로, 둘의 공존은 후행 편집(변조 시도)이다.
    그 경우 해시 검증을 그대로 받는다(2026-08-12 봉합 — 감사 발견: `injected` 한 줄로 해시 게이트 우회).
- **env 주입(`HARNESS_EVAL_SCORE/MAJOR`)은 `HARNESS_SELFTEST=1` 또는 CI 환경에서만 유효**하다.
  그 외 환경에서는 무시하고 경고를 남긴다(2026-08-12 봉합 — env 한 줄로 루브릭·신선도·격리 리뷰가
  전부 면제되는 F24 해치를 테스트 환경으로 격리). `--score=` CLI 플래그는 호출 커맨드라인에 드러나는
  가시적 우회이므로 유지된다.
- **skip 스탬프(`skipped-no-tool`)는 검증 시점의 도구 가용성과 대조**된다 — done-gate/loop 의
  `verifyEvalReview` 가 리뷰 도구(claude CLI 또는 `HARNESS_REVIEW_CMD`)의 가용을 확인하면 skip 을
  무효화하고 리뷰 실행을 요구한다(2026-08-12 봉합 — 감사 발견: 수기 skip 스탬프가 무검증 통과).

### 4.4 실패 라우팅 (기존 3분류에 편입)

| 상황 | 분류 | 라우팅 |
| --- | --- | --- |
| 리뷰어 실행 실패·verdict 파싱 실패 | 검증결함 | evaluate 재시도 (3회 → 되돌림 → blocked) |
| 이번 사이클 평가에 스탬프 없음 | 검증결함 | evaluate 재시도 |
| done-gate 해시 불일치(리뷰 후 변조) | 검증결함 | merge FAIL → evaluate 되돌림 |
| claude CLI 부재 + 오버라이드 없음 | 환경 부재 | `skipped-no-tool` 스탬프 기록 후 통과 |

## 5. 검증 계획

- `scripts/eval-review.selftest.mjs` (신설, CI 17종째): 가짜 리뷰어(`HARNESS_REVIEW_CMD`)로 결정적 검증 —
  verdict 반영(하향·추가) / 상향 시도 무시 / 스탬프·해시 발급 / 변조 탐지 / 파싱 실패 exit 1 / 대상 없음 exit 2.
- `loop.selftest.mjs` — 기존 시나리오 회귀(임시 cwd 는 환경 부재 경로로 green 유지).
- 실측: 다음 시행(시행 7)에서 격리 리뷰가 실제 발화하는지 + 점수 분포가 달라지는지 계측.

## 변경 이력

- 2026-08-11: 최초 작성 — 사용자 지시(세션 분리)의 사양 누락을 확인하고 정본화. 1단계 반영과 동시 작성.
- 2026-08-12: 1단계 우회 구멍 3건 봉합(§4.3) — ① 리뷰 스탬프 있는 평가의 후행 `injected` 부착을 변조로 취급,
  ② `HARNESS_EVAL_SCORE/MAJOR` env 주입을 `HARNESS_SELFTEST=1`/CI 로 격리, ③ skip 스탬프를 검증 시점
  도구 가용성과 대조(수기 skip 위조 차단). 셀프테스트: eval-review [B8+/B9+], done-gate [8].
