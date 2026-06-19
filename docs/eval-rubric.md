# 평가 루브릭 (eval-rubric) — 고정 채점 기준 (US-009)

이 문서는 `scripts/eval-playwright.mjs` 가 사용하는 **고정(fixed) 채점 기준** 입니다.
평가는 4개 차원(UI / UX / 기능 / 품질)으로 나뉘며, 각 차원은 **구체적 체크리스트 항목** 의
통과/실패로 0~100 점에 매핑됩니다. 평가자가 매 회 기준을 바꾸지 않도록 **결정적(deterministic)** 으로
규정합니다.

> 한 줄 요약: **불만(complaint) = 실패한 체크리스트 항목**. 불만은 심각도(severity)에 따라
> `major` / `minor` 로 나뉘고, **major 불만이 1건이라도 있으면** done-gate(완료 게이트)는
> 통과하지 못합니다.

---

## 0. 페르소나 운영 (v2 — 사양서 확정 6)

- **기본 1 페르소나**로 평가합니다 (프로젝트별 핵심 페르소나 + 주요 시나리오).
- CEO 가 decompose 단계에서 복잡도 체크리스트(폼 필드 ≥5 / 상태 분기 ≥3 / 관여 슬라이스 ≥4 중
  2개 이상)로 **"복잡 화면"** 판정 시, customer 에이전트가 **2~3 페르소나 관점**으로 각각 평가하고
  종합합니다 (`.claude/agents/ceo.md` · `customer.md` 참조).
- 다중 페르소나 평가 시 **체크리스트와 배점은 동일**하게 적용하고, 페르소나별 점수를 평균해
  차원 점수를 냅니다. 불만 목록은 페르소나별로 합집합(중복 제거)합니다.

---

## 1. 용어 정의

| 용어                 | 정의                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| **체크리스트 항목**  | 차원별로 미리 정해진 검증 질문. 각 항목은 통과(pass) 또는 실패(fail).              |
| **불만(complaint)**  | **실패한 체크리스트 항목 1건**. `{ dimension, item, severity, detail }` 로 표현.   |
| **심각도(severity)** | `major` 또는 `minor`. 항목별로 루브릭에 **고정** 되어 있습니다(평가자 재량 아님).  |
| **major 불만**       | 출시/완료를 막아야 하는 결함. 예: 앱이 렌더되지 않음, 핵심 기능 동작 불가, 크래시. |
| **minor 불만**       | 사용성/완성도 흠. 점수는 깎지만 단독으로 출시를 막지는 않음.                       |
| **차원 점수**        | 한 차원(UI 등)의 0~100 점. 해당 차원 체크리스트의 가중 통과율로 산출.              |
| **종합 점수**        | 4개 차원 점수의 가중 평균(0~100). done-gate 의 `score` 입력값.                     |

---

## 2. 채점 차원과 체크리스트

각 차원은 100점 만점이며, 항목마다 **배점(weight)** 과 **고정 심각도** 를 가집니다.
차원 점수 = `Σ(통과한 항목의 배점)` (배점 합은 차원당 100).

### 2.1 UI (차원 가중치 0.25)

| 항목 ID               | 체크리스트 질문                                                | 배점 | 실패 시 심각도 |
| --------------------- | -------------------------------------------------------------- | ---- | -------------- |
| `ui.renders`          | 페이지가 흰 화면/에러 없이 렌더되는가 (DOM body 비어있지 않음) | 40   | **major**      |
| `ui.title`            | 문서 `<title>` 이 기대값(`package.json` 의 `name`)과 일치하는가         | 20   | minor          |
| `ui.heading`          | 핵심 heading(`package.json` 의 `name`)이 화면에 보이는가                | 30   | **major**      |
| `ui.no-console-error` | 로드 중 콘솔 error 가 0건인가                                  | 10   | minor          |

### 2.2 UX (차원 가중치 0.20)

| 항목 ID                | 체크리스트 질문                                                 | 배점 | 실패 시 심각도 |
| ---------------------- | --------------------------------------------------------------- | ---- | -------------- |
| `ux.load-fast`         | 첫 화면이 타임아웃(기본 30s) 안에 준비되는가                    | 40   | **major**      |
| `ux.layout-stable`     | 스크린샷에서 레이아웃 깨짐/겹침이 없는가(관찰 기반)             | 20   | minor          |
| `ux.responsive-meta`   | viewport 메타 등 기본 반응형 설정이 있는가                      | 15   | minor          |
| `ux.responsive-layout` | 모바일 폭(375px)에서 가로 overflow(스크롤)가 없는가(관찰 기반)  | 15   | minor          |
| `ux.a11y-landmarks`    | 페이지에 landmark(nav/main 등)가 1개 이상 존재하는가(관찰 기반) | 10   | minor          |

### 2.3 기능 (차원 가중치 0.35)

| 항목 ID               | 체크리스트 질문                                                                          | 배점 | 실패 시 심각도 |
| --------------------- | ---------------------------------------------------------------------------------------- | ---- | -------------- |
| `fn.app-mounts`       | React 앱이 `#root` 에 마운트되는가                                                       | 40   | **major**      |
| `fn.no-runtime-error` | 페이지 로드 중 처리되지 않은 런타임 예외가 없는가                                        | 40   | **major**      |
| `fn.navigable`        | 첫 내부 링크 클릭(내비게이션) 후에도 앱이 살아있는가(관찰 기반, 단일 페이지면 기본 통과) | 20   | minor          |

### 2.4 품질 (차원 가중치 0.20)

| 항목 ID           | 체크리스트 질문                                                                 | 배점 | 실패 시 심각도 |
| ----------------- | ------------------------------------------------------------------------------- | ---- | -------------- |
| `q.gates-green`   | 결정적 게이트(typecheck/lint/arch/test)가 통과하는가                            | 40   | **major**      |
| `q.screenshot`    | 평가 산출물(스크린샷)이 정상 생성됐는가                                         | 20   | minor          |
| `q.observability` | 관찰값(title/heading/console) 수집이 가능했는가                                 | 20   | minor          |
| `q.a11y-clean`    | 경량 a11y 점검(html lang / img alt / 접근가능한 이름) 위반이 0건인가(관찰 기반) | 20   | minor          |

> 차원 가중치 합 = 0.25 + 0.20 + 0.35 + 0.20 = **1.00**.

---

## 3. 종합 점수 산출식

```
차원점수(d) = Σ_{i ∈ 통과한 항목}  weight(i)          # 0~100, 배점 합은 차원당 100
종합점수   = round( Σ_d  dimWeight(d) × 차원점수(d) )   # 0~100, 반올림 정수
```

- 모든 항목이 통과하면 각 차원 = 100, 종합 = 100.
- 한 항목 실패 = 그 항목 배점만큼 해당 차원 점수가 깎이고, 차원 가중치만큼 종합에 반영됩니다.

### major 불만의 별도 효과 (점수와 독립)

종합 점수가 높아도 **major 불만이 1건 이상이면 done-gate 는 무조건 FAIL** 입니다.
(`scripts/done-gate.mjs` 의 `evaluateHysteresis`: `major > 0 → 즉시 탈락`.)
즉 점수는 "얼마나 좋은가" 를, **major 불만 수는 "출시 가능한가" 를 따로** 결정합니다.

---

## 4. 평가 산출물 스키마

평가 1회는 다음 두 파일을 남깁니다(`<id>` = 평가 식별자, 사전순=시간순 정렬되도록 권장).

### `harness/evaluations/<id>.json` (머신리더블 — done-gate 입력)

```json
{
	"id": "eval-0001",
	"createdAt": "2026-06-09T00:00:00.000Z",
	"mode": "playwright",
	"score": 100,
	"majorComplaints": 0,
	"dimensions": {
		"ui": { "score": 100, "weight": 0.25 },
		"ux": { "score": 100, "weight": 0.2 },
		"fn": { "score": 100, "weight": 0.35 },
		"quality": { "score": 100, "weight": 0.2 }
	},
	"complaints": [{ "dimension": "ui", "item": "ui.heading", "severity": "major", "detail": "..." }],
	"observations": { "title": "harness-setup", "headingPresent": true, "consoleErrors": 0 },
	"screenshot": "harness/evaluations/eval-0001/screenshot.png"
}
```

- `score`, `majorComplaints` 는 done-gate 가 직접 읽는 **계약 필드** 입니다(이름 변경 금지).
- `mode` 는 `playwright`(실측) 또는 `static-fallback`(Playwright 미설치/실패 시 정적 폴백).

### `harness/evaluations/<id>.md` (사람용 요약)

차원 점수표, 종합 점수, **불만 목록(심각도 포함)**, 스크린샷 경로를 표 형태로 담습니다.

---

## 5. 결정적 채점 규칙 (구현 계약)

`scripts/eval-playwright.mjs` 는 다음 순서로 채점합니다.

1. **관찰(observations) 수집**: Playwright 가 있으면 실측(title/heading/console/마운트 + landmark/a11y 위반 수/모바일 폭 overflow/실제 링크 클릭 내비게이션),
   없으면 정적 폴백 관찰값(index.html 파싱 등; 미관찰 항목은 기본 통과 처리).
2. **체크리스트 평가**: 각 항목을 관찰값으로 pass/fail 판정 → 실패는 불만으로 수집.
3. **차원·종합 점수 산출**: 위 산출식 적용.
4. **주입 오버라이드(테스트용)**: `--score=N` 또는 `--major-complaints=N` 이 주어지면
   결정적 테스트를 위해 해당 값으로 종합/major 를 **덮어씁니다**(관찰 기반 산출 대신).
   이는 done-gate 의 주입 방식과 동일한 계약입니다.

> 동일 입력(관찰값/주입값) → 항상 동일 점수. Math.random / 현재시각은 점수 산출에 사용하지 않습니다
> (`createdAt` 타임스탬프는 점수와 무관한 메타데이터일 뿐입니다).

---

## 6. 캡처물 소비 평가 — 루브릭은 하한 (B3)

위 결정적 루브릭은 **"앱이 떴는가"의 하한**일 뿐이다. **"잘 보이는가·쓸 만한가"(시각 품질·레이아웃·여백·UX)는 캡처물을 본 에이전트가 판정**한다.

- `scripts/eval-playwright.mjs` 는 매 평가에서 `harness/evaluations/<id>/` 에 **`screenshot.png`(데스크톱)·`screenshot-mobile.png`(375px)·`dom.html`** 를 남긴다(eval JSON 의 `screenshot`/`screenshotMobile`/`dom` 필드).
- **customer·ui·ux 에이전트는 그 스크린샷 이미지를 `Read` 로 직접 보고(이미지 렌더), `dom.html` 을 읽어** 레이아웃·사이드 padding·정렬·간격·시각 위계·반응형·사용 흐름·a11y 를 평가하고, 그 결과를 `<id>.json` 의 `score`·`complaints`(시각/UX 결함 = minor~major)에 반영한다.
- ⚠️ 캡처물을 보지 않고 루브릭 점수만으로 통과시키는 평가는 **무효**(실제 사고: 사이드 padding 없는 UI 가 96점 통과). `run-cycle.md` "evaluate — 캡처물 소비 평가" 절 참조.
