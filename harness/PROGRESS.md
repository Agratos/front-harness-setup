# 하네스 진행 상태 (PROGRESS)

> **재개 프로토콜** — 모든 세션은 굵직한 단계를 시작/완료할 때마다 아래 "현재 상태"를 갱신합니다 (마지막 갱신 시각 필수).
> 자동 재개 루프(10분 주기)는 이 파일을 읽고 다음 두 조건이 **모두** 참일 때만 작업을 이어받습니다:
> 1. 상태가 `🔵 진행 중`인 항목이 있다
> 2. 그 항목의 "마지막 갱신"이 **30분 이상** 경과했다 (활성 세션과의 충돌 방지)

## 현재 상태

### 🟢 완료 — demo.mjs 결정 격리 + .gitignore 보강
- **변경**: `demo.mjs` 가 실제 `harness/decisions/` 에 결정을 쓰고 멱등성 위해 `decision-*.md` 를 일괄 삭제하던 로직이 **실제 결정 기록(decision-0002 등)까지 지우는 데이터 손실 버그**였음 → `logDecision` 을 **임시 격리 디렉터리**에서 시연하도록 변경(git/loop 와 동일 격리 원칙). 실제 `harness/decisions/` 는 일절 건드리지 않음.
- **추가**: `.gitignore` 에 `*.tsbuildinfo` 추가(빌드 캐시 산출물). 헤더 주석·report 섹션4·README 데모 설명 동기 갱신.
- **검증**: 데모 재실행 후 `harness/decisions/`(0001·0002) 무손상 확인, `tsconfig.tsbuildinfo` ignored 확인, lint green, DEMO: PASS.
- **마지막 갱신**: 2026-06-15 (기록자: 데모 격리 수정 세션)

### 🟢 완료 — 재작업 5회→투표 코드 강제 (확정 2·3)
- **변경**: `loop.mjs` 에 `MAX_REWORK=5` + `computeTransition` 도입 — `debate` 의 `rework` 판정마다 `reworkCount++` 후 `implement` 되돌이, 5회 초과 시 `vote` 페이즈 분기, `vote→merge` 는 `state.gateOverride` + `done-gate --vote-override` 로 **주관 임계만 우회(결정적 게이트 유지)**. `state.mjs` 에 `gateOverride` 필드 추가. `git-flow.mjs` 가 `--vote-override` 전달.
- **배경**: 평가에서 "`reworkCount` 가 스키마에만 있고 증가 코드 없음 → 문서와 코드 불일치" 발견 → 사용자가 코드 강제안(a) 선택. 투표 *내용*(다수결·캐스팅보트)은 종전대로 에이전트 수동 준수.
- **문서 동기 갱신**: `run-cycle.md`·`usage.md`·`AGENTS.md`(강제 모델 표)·`state-manifest.md`·`status.md`·`pm.md`·README·사양서 변경 이력.
- **검증**: `loop.selftest`(시나리오 B: rework→vote 추가) PASS + self-test 6종 PASS + 게이트 4종 green + `done-gate --vote-override` 동작 확인.
- **마지막 갱신**: 2026-06-15 (기록자: 재작업/투표 코드화 세션)

### 🟢 완료 — 엔티티 구조 scms-ems 방식 전환 (step/07)
- **변경**: `src/entities/example` 을 `model/`(dto·types·mapper·store) 세그먼트 + API 동작 단위 파일 분리로 재배치 (scms-ems 계승). mutation mapper 경유·`selectResult` 어댑터는 v2 규약 유지
- **문서 동기 갱신**: `docs/fsd/entities.md`·`naming.md`, README, AGENTS.md, `.claude/agents/entity-modeler.md`, 사양서 변경 이력
- **검증**: 게이트 4종 green (typecheck 0 / lint 0 / test 5 passed / check-arch 0위반)
- **마지막 갱신**: 2026-06-12 (기록자: 컨벤션 전환 세션)

### 🟢 완료 — v2 재구축 (Step 1~6 전체)
- **사양서**: `docs/spec/interview-2026-06-11.md` (사용자 직접 인터뷰 3라운드, 승인 기록 보유)
- **단계별 main 머지**:
  - Step 1 툴체인 시드 (스모크 테스트, passWithNoTests 제거) — `965fdfd`
  - Step 2 FSD 규약 + 실재 예시 슬라이스 (entities/example·features/example-list·pages/home) — `5d48235`
  - Step 3 협의체 9역할 + v2 정책 (5회+투표·캐스팅보트·가변 페르소나) — `efe40e8`
  - Step 4 드라이버·done-gate·git-flow + self-test 6종 — `f7ca24c`
  - Step 5 고객 평가(Playwright)·루브릭(가변 페르소나 §0)·Notion 미러 — `7bdb250`
  - Step 6 통합 데모 PASS + README/AGENTS/usage v2 정합 + CI 워크플로 — (이 커밋)
- **최종 검증**: 게이트 4종 green (typecheck 0 / lint 0 / test 5 passed / check-arch 0위반)
  + self-test 7종 PASS (state/git-flow/done-gate/loop/log/resume/eval) + demo PASS
  + 실 평가 eval-0001 종합 100 / major 0 / teardown 검증
- **남은 후속(선택)**: ① 노션 대시보드 예시 데이터 → 실데이터 교체(노션 세션 항목 참조)
  ② 제품 빌드 시 mantine·react-router provider 추가 ③ main 브랜치 보호 설정(GitHub)
- **마지막 갱신**: 2026-06-11T02:40Z (기록자: 메인 재구축 세션)

### 🟢 완료 — 노션 대시보드 개편
- **페이지**: https://app.notion.com/p/Harness-Inc-37305d7cde4780ecabfeda0bddebf85b
- **구조**: 콜아웃 요약 → 계획/진행 상황/이슈/배포 (섹션별 상단 2~3건 요약 줄 + 접힌 DB 링크) → 에이전트 설명/회의록/참고
- **남은 일**: ① 예시 데이터를 실제 데이터로 교체 ② `/evaluate` Notion 동기화 시 대시보드 요약 줄도 함께 갱신하는 규칙 반영
- **마지막 갱신**: 2026-06-11T02:30Z (이 세션)

## 갱신 규칙
1. 단계 시작/완료 시 해당 항목의 "다음 할 일"·"마지막 갱신"을 즉시 갱신한다.
2. 사용량 한도로 중단이 예상되면: 지금까지 한 일 + **바로 다음 1개 행동**을 적고 멈춘다.
3. 새 세션이 이어받을 때: 이 파일 → `git log` → `harness/` 산출물 순으로 확인한 뒤 작업한다.
4. 이어받은 세션은 작업 직전에 "마지막 갱신"을 자기 시각으로 먼저 갱신한다 (이중 인수 방지).
