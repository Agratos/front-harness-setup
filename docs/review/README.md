# 하네스 진단 · 목표 설계 (2026-08-10)

v2 하네스 전량 리뷰와 v3 목표 설계. HTML 은 브라우저로 열어 보세요.

| 문서 | 내용 |
| --- | --- |
| [harness-review-2026-08-10.html](harness-review-2026-08-10.html) | **진단** — 발견 14건(F1~F14), 근거(file:line), 우선순위 로드맵 |
| [harness-target-design.html](harness-target-design.html) | **목표 설계** — 작업 지시서 · 세 축(강제/목적/조작성) · 5단계 전환 경로 |

## 한 줄 요약

> 드라이버가 "다음에 뭘 해야 하는지" 를 말해주고, "그걸 했는지" 를 검사해야 한다.

지금까지의 실패(빈 병합, 스크린샷 미확인, Notion 미갱신, 폼 버그 통과)는 전부
**"에이전트가 md 지시를 안 지킴"** 이었다. 지키게 만드는 게 아니라 **안 지키면 진행이 안 되게** 만든다.

## 진행 상황

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| 1 | **안전망** — gatesGreen 실측 · cycleId 신선도 · 빈 병합 차단 · 실패 라우팅/blocked | ✅ 완료 |
| 2 | 계약 — `phases.mjs` 페이즈 계약 + 산출물 게이트 | 대기 |
| 3 | 목적 — `plan.json` 수용기준 + AC↔E2E 매핑 + 체크리스트 판정 | 대기 |
| 4 | 조작성 — 작업 지시서(`harness next/done`) + hooks + 커맨드 3개 | 대기 |
| 5 | 정리 — Notion 코드화 · check-arch 확장 · 골든 픽스처 CI | 대기 |

검증은 [`docs/testbench/`](../testbench/) 의 고정 사양(프로젝트 관리 프로그램)으로 4회 반복 시행해 비교한다.

## 외부 참고 — 사내 멀티에이전트 조직 가이드

`AI_클로드_에이전트_조직_가이드.pptx` (Trac·Redmine 협업 원리를 Claude 멀티에이전트에 이식) 에서 채택한 것:

| 채택 | 어디에 반영했나 |
| --- | --- |
| **결함 3분류**(설계결함/구현결함/검증결함) + 되돌림 규칙 | ✅ 1단계 — `loop.mjs classifyFailure` 가 게이트 실측으로 자동 분류해 `design`/`implement`/`evaluate` 로 되돌림 |
| **HANDOFF 문서** (역할·분류·근본원인·구현지침·회귀·다음) | 2단계 예정 — 페이즈 산출물 스키마로 채택 |
| **횡단변경 이력**(티켓 번호 · 영향모듈 PENDING→DONE→CLOSED) | 3단계 예정 — FSD 슬라이스 간 계약 변경 추적 |
| 서브에이전트는 기억이 없다 → **팀 기억은 파일로 외부화** | 이미 하네스의 기본 원칙(공유 문서 = SoT). 재확인 |

채택하지 않은 것 — **도메인별 3역 반복 조직도**와 platform/common/database/ops 특수 에이전트.
harness-setup 은 단일 제품 FSD 앱이고 이미 9역 협의체가 그 역할을 덮는다(architect≈platform,
entity-modeler≈common+database, quality≈ops). 조직도를 복제하면 에이전트만 늘고 얻는 것이 없다.
**조직 형태가 아니라 인계·분류 규약을 가져왔다.**
