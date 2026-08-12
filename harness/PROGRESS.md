# 하네스 진행 상태 (PROGRESS)

> **재개 프로토콜** — 모든 세션은 굵직한 단계를 시작/완료할 때마다 아래 "현재 상태"를 갱신합니다 (마지막 갱신 시각 필수).
> 자동 재개 루프(10분 주기)는 이 파일을 읽고 다음 두 조건이 **모두** 참일 때만 작업을 이어받습니다:
> 1. 상태가 `🔵 진행 중`인 항목이 있다
> 2. 그 항목의 "마지막 갱신"이 **30분 이상** 경과했다 (활성 세션과의 충돌 방지)
>
> ⚙ **대상 프로젝트의 루프 재개는 코드가 담당한다** — `node scripts/resume-watch.mjs`(데몬) 또는
> `--once`(cron). state.json 이 30분 stale 일 때만 인수하고, 잠금·blocked·에이전트 페이즈(러너 미가용)에는
> 개입하지 않는다. 위 문단의 수동 프로토콜은 하네스 저장소 **자체 개발**(이 파일) 전용으로 남는다.

## 현재 상태

### 🟢 완료 — 성능분석 감사 반영: 게이트 봉합 + 계획 무결성 + 세션 분리 2단계 (step/36~38)

- **배경**: 4대 요구사항(문답형 계획 / 계획·개발·테스트 세션 분리 / 브랜치→통과→main / 완성까지 반복)
  대비 전수 감사에서 우회 구멍·미배선 지점을 발견 → 3개 step 브랜치로 반영, 각각 main 병합.
- **step/36 — 게이트 우회 구멍 5건 봉합** (`2695a00`)
  - eval-review: 리뷰 스탬프 있는 평가의 후행 `injected` 부착 = 변조 취급 / 수기 skip 스탬프를
    검증 시점 도구 가용성과 대조해 무효화 / `HARNESS_EVAL_SCORE` env 주입을 `HARNESS_SELFTEST=1`·CI 로 격리.
  - git-flow merge-step: state.json 의 **현재 step 만 병합**(예외는 `--any-step` 명시) /
    main 전진 시 병합 결과 트리 **재게이트 + 실패 시 ORIG_HEAD 롤백** / 기존 pre-commit 훅에
    main 가드 **체이닝**(경고만 남기고 포기하던 것을 강제로).
- **step/37 — 계획 무결성 게이트 4종** (`820ed4c`)
  - **스펙 동결(specFreeze)**: design 확정 시 AC+시나리오 정규화 지문을 동결 — implement 이후
    기준 완화를 verify(0초 대조)·done-gate(백스톱, vote-override 로도 우회 불가)가 차단.
  - **최종 수용 게이트**: 모든 step 병합 후에도 acceptance 미작성 step·미검증 AC 가 있으면
    `done` 으로 위장하지 않고 blocked + 사유 (감사 리스크 A-4·A-5 봉합).
  - **no-ac 차단**: 현재 step 의 acceptance 가 비면 preflight 검증 불가(→design).
  - **init 격리 + source 필수화**: 구식 `--init` 라벨 시드는 셀프테스트/CI 전용,
    plan.source(인터뷰 문서)는 필드+실존 검사 — 인터뷰 없이 지어낸 계획의 시드 차단.
- **step/38 — 세션 분리 2단계: debate 판정 독립**
  - `--debate`/`HARNESS_DEBATE_OUTCOME` 주입을 셀프테스트/CI 로 격리(그 외 무시+로그).
  - 파일 평가는 **격리 리뷰 스탬프가 유효할 때만** 판정 근거(`verifyEvalReview` 재사용) —
    사양 `session-isolation-2026-08-11.md` 로드맵 2단계 반영(잔여: 시행 7 계측, 3단계 러너).
- **step/39~41 + 원격 (같은 세션 후속)**
  - **세션 분리 3단계**: `run-phase-session.mjs`(격리 페이즈 세션 러너 — 페이즈별 도구 제한, 세션 지문
    발급) + `record-decision` 지문 스탬프 + `phase-gate` "판정 세션 ≠ 설계/구현 세션" 교차 검증
    (`sessionIsolation` 옵트인). 사양 로드맵 3/3 반영 완료.
  - **재개 루프 코드화**: `resume-watch.mjs` — state.json 30분 stale 때만 인수, 잠금·blocked·러너
    미가용에 불간섭, stuck 정지. `yarn resume:watch` / `--once`(cron).
  - **4순위 verdict**: 루브릭에 `fn.ac-verified`(단일 최대 가중 30, major) — "모든 AC 가 단언으로
    덮였고 E2E 로 증명됐는가" 를 채점. plan 없는 프로젝트는 명시 skip(acApplicable=false)만 허용.
  - **원격 main 보호**: `Agratos/harness-setup-test` 에 force-push·삭제 차단 적용(required check 는
    직접 push 플로우와 충돌해 보류 — git-flow.md §원격 main 보호에 트레이드오프 기록).
- **검증**: 셀프테스트 20종 전원 PASS (신규: eval-review B8+/B9+, done-gate [8][9], git-flow [9][10][11],
  loop [I][J][K], plan [B no-ac][D source][E], eval [B3], phase-gate [D], run-phase-session·resume-watch 신설).
- **다음 1개 행동**: 시행 7 — 격리 채점·스펙 동결·최종 수용·AC 가중·세션 러너가 실물 프로젝트에서
  발화하는지 계측(sessionIsolation=true 로) → 결과에 따라 세션 격리 기본 활성화 여부 결정.
- **마지막 갱신**: 2026-08-12 (기록자: 성능분석 감사 반영 세션)

### 🟢 완료 — 세션 분리 1단계: **격리 채점** (계획·개발·채점 세션 분리 — 채점부터)

- **브랜치**: `step/34-session-isolation` → main
- **요구의 출처**: 사용자 지시 "계획·개발·채점은 다른 세션에서" — v2 인터뷰 사양에 **누락**돼 있었음을
  확인(주관 점수 반영의 손이 구현을 지휘한 메인 세션과 동일 — 시행 6의 96→100 은 독립성 없는 숫자).
  사양 정본 신설: `docs/spec/session-isolation-2026-08-11.md` (격리 7조건 + 3단계 로드맵).
- **핵심 변화 (1단계 = 채점 격리)**

  | 항목 | 이전 | 이후 |
  | --- | --- | --- |
  | 주관 채점 반영 | 오케스트레이터/서브에이전트가 eval JSON 직접 편집 | **격리 세션만**(`eval-review.mjs` 가 fresh `claude -p` — 읽기 전용 Read, 파일 입력만) |
  | 점수 방향 | 제한 없음 | **하향 단조** — 낮추거나 불만 추가만. 상향은 재작업 후 코드 재계측으로만 |
  | evaluate 전진 | 베이스라인 산출물만 검사 | + **격리 리뷰 스탬프** 없으면 차단(검증결함 → 재시도) |
  | 리뷰 후 편집 | 감지 불가 | **정규화 해시 불일치 → done-gate FAIL**(변조 판정) |
  | claude CLI 부재 | — | `skipped-no-tool` **기록된 skip**(환경 부재만 — fail-open 원칙 유지) |

- **새 파일**: `scripts/eval-review.mjs`(스포너·반영·스탬프 유일 발급자) · `scripts/eval-review.selftest.mjs`
  (37 체크 — 하향 단조/스탬프·해시/변조 탐지/loop 배선 통합, CI **18종**째). 감사 추적:
  `harness/evaluations/<id>/review-prompt.md`·`review.json` 보존.
- **md 동기**: run-cycle(§evaluate 재작성)·evaluate·customer(⛔ 평가 JSON 편집 금지로 반전)·ux·AGENTS(강제 모델 표).
- **검증**: 신규 셀프테스트 37 체크 PASS · 기존 셀프테스트 17종 전원 PASS(회귀 0) · lint green.
- **다음 1개 행동**: 시행 7 — 격리 채점이 실물 프로젝트에서 발화하는지 + 점수 분포 변화 계측.
  그 후 2단계(debate 입력 제한)·4순위(verdict.json — AC 최대 가중)와 합류.
- **마지막 갱신**: 2026-08-11 (기록자: 세션 분리 1단계 세션)

### 🟢 완료 — md 동기화: 역할·커맨드 md 를 v3 실체와 일치 (md 감사 반영)

- **배경**: md 전수 감사에서 "코드는 v3 로 진화했는데 역할 md 계층이 v2 에 멈춰, 성실한 에이전트가
  md 를 따를수록 틀리는" 지점들을 발견 → `step/33-md-sync` 로 일괄 정정.
- **🔴 수정 3건**: ① `qa.md` 의 "(스펙/Playwright/서버 부재 시 skip — 차단 안 함)" — F15·F16 반전
  **이전** 규칙 잔존 → exit 0/1/2 계약으로 교체. ② `qa.md` 의 `yarn check-arch`(존재하지 않는 명령)
  → `yarn check:arch`. ③ `pm.md` 에 record-decision CLI·스탬프 절 신설 — 기존 손글씨 템플릿만 따르면
  스탬프가 없어 phase-gate 에 막히던 경로 차단(투표 절차 5단계에도 `--phase=vote` 마감 명시).
- **🟡 수정**: 역할 md 9종의 계획 참조 `.omc/plans/`(OMC 종속, 어떤 스크립트도 안 읽음 —
  2026-06-12 코드리뷰 기지적) → **`harness/plan.json`(계획 정본·AC)** 로 교체. `usage.md` §4 의
  "loop 가 Notion 자동 적재+flush" 잔존 서술(F22) → 수동 준수로 정정. `evaluate.md` 에
  §캡처물 소비(⛔) 신설 — run-cycle 밖 단독 호출 시 루브릭 숫자만으로 끝내는 사고 방지.
- **🟢 수정**: 존재하지 않는 `docs/fsd/layers.md` 인용(ui/architect 예시) → 실존 문서로,
  customer 예시 스크린샷 경로 정정, 가상 예시 표기.
- **다음 1개 행동(제안)**: `docs-lint.selftest.mjs` — 금지 문구("차단 안 함")·없는 스크립트명·깨진
  문서 참조를 grep 으로 잡는 문서 게이트를 CI 17종째로 편입(md drift 자체를 게이트화).
- **마지막 갱신**: 2026-08-11 (기록자: md 감사·동기화 세션)

### 🟢 완료 — 시행 6 실전 검증: `bench/room-booking` **3 step 완주** (계약이 현장에서 발화)

- **무엇을 했나**: v3 2단계(페이즈 산출물 계약)를 적용한 직후, **다른 고정 사양**으로 새 프로젝트를
  만들어 끝까지 돌렸다. 사양: 회의실 예약 관리(시간 충돌 판정이 있는 도메인) 3 step / AC 11개.
  위치 `C:/Users/POINT-I/Desktop/study/bench/room-booking` (tag 기준 하네스 `d36880d`).
- **결과**: `status=done` · **재작업 0 / 에스컬레이션 0 / blocked 0** · **AC 11/11 실증** ·
  평가 96 → 100 → 100(major 0) · E2E 시나리오 6개·단언 38건(회귀 누적) 전원 통과 · `yarn build` 성공.
- **계약이 발화한 실측**: step01 `decompose` 첫 호출에서 기록 없이 전진하려다 **차단**
  (`산출물결함` + `failures: decompose=1/3` + 조치 명령 출력). 예전 하네스는 이 자리에서
  아무 검사 없이 design 으로 넘어갔다. `design` 은 **implement 전에** `AC 5/5 덮임` 을 확인했고,
  `implement` 는 진입 시점 대비 코드 변경을 확인했다.
- **부수 효과 확인**: step01 debate 에서 이월한 minor 2건(a11y·`lang`)을 step02 에서 고치니
  평가가 **96 → 100** 으로 올랐다. "기록해 두고 다음 step 에서 처리" 가 실제로 닫혔다.
  step02 의 목록 리팩터(표시 전용 + widget 도입)는 step01 단언 15건이 회귀로 재검증해 무사통과.
- **발견 1건 → 즉시 반영**: T6-1 — AC 태그 경고가 **회귀 시나리오를 오탐**(step03 에서 AC-1~8 나열).
  `otherSteps`(회귀, 정상) / `unknown`(오타)로 분리 → `7072bb1` · main `b511f99`.
- **기록**: `docs/testbench/trial-log.md` §시행 6 (지표·발화 지점·발견) · 프로젝트 쪽 `harness/PROGRESS.md`
- **시행 5 실측 마감(2026-08-11 후속)**: E-1(스펙 제거)·E-2(서버 미기동)를 **실물 room-booking** 에
  주입해 둘 다 exit 2 차단 확인. E-4 는 시행 6에서 자연 확인(loop 가 평가를 스스로 실행).
  E-3·E-5 는 도구 제거가 필요해 결정적 셀프테스트 확인으로 마감 — `docs/testbench/results.md` §시행 5 결과.
  후속 점검에서 `record-decision` CLI 의 인자 계약이 셀프테스트 없이 방치된 것을 발견 →
  `record-decision.selftest.mjs`(26 체크) 신설, CI 16종으로 편입.
- **다음 1개 행동**: 4순위(`verdict.json` — AC 를 루브릭 최대 가중 차원으로) 착수.
  시행 6 은 AC 를 **E2E 로** 증명했지만, 루브릭 점수는 아직 그 사실을 최대 가중으로 반영하지 않는다.
- **마지막 갱신**: 2026-08-11 (기록자: room-booking 완주 세션 + 시행 5 마감)

### 🟢 완료 — v3 2단계: **페이즈 산출물 계약** (F1 — 개별 배선의 일반화)

- **브랜치**: `step/30-phase-artifact-gate` → main
- **무엇을 닫았나**: 1.5단계는 `verify`(E2E)·`evaluate`(평가 산출물) **두 칸**을 개별 배선으로 막았다.
  남은 네 칸(`decompose`·`design`·`implement`·`debate`/`vote`)은 `PHASE <name> requires agent work` 로그만
  찍고 **증거 없이 무조건 전진**했다 — 오케스트레이터가 페이즈를 통째로 건너뛰어도 하네스는 몰랐다.
- **핵심 변화 (실측 대조)**

  | 페이즈 | 이전 | 이후 |
  | --- | --- | --- |
  | `decompose` | 무조건 전진 | 이번 사이클 스탬프 찍힌 결정 기록 필요 → 없으면 **산출물결함** 차단 |
  | `design` | 무조건 전진 (스펙·AC 는 verify 에서 뒤늦게) | ①스펙·AC 계약 ②설계 기록 — **implement 를 낭비하기 전에** 차단 |
  | `implement` | 무조건 전진 | 진입 시점 대비 **코드 지문 변화** 필요(harness/·docs/ 제외). 면제는 기록으로 명시 |
  | `debate`/`vote` | 무조건 전진 | 이번 사이클 결정 기록 필요 |
  | 빈 재작업 라운드 | 이전 회차 산출물로 통과 가능 | `cycleId` 에 `reworkCount` 포함 → **새 토론·새 코드 없으면 차단** |

- **새 파일**: `scripts/lib/phase-gate.mjs`(계약 선언·판정) · `scripts/lib/artifact.mjs`(스탬프 형식 단일 정의 —
  쓰는 쪽 `logDecision` 과 읽는 쪽이 공유) · `scripts/record-decision.mjs`(기록 CLI — 사이클 스탬프 자동,
  이 파일의 존재가 계약의 **환경 조건**) · `scripts/phase-gate.selftest.mjs`
- **fail-open 규칙 유지**: skip 은 환경 부재(기록 도구 없음 / git 없음)에만. 산출물 부재는 전부 실패.
- **검증**: 셀프테스트 **15종 PASS**(신규 49개 체크 — phase-gate 38 + loop 시나리오 H 11)
  · 게이트 4종 green(typecheck 0 / lint 0 / check-arch 0위반 / test 5) · DEMO PASS
  · `/status` 에 `산출물 계약` 줄 + 미충족 시 **다음 1개 행동이 record-decision 명령으로 바뀜** 실측
- **다음 1개 행동**: 시행 5(방어 실험 E-1~E-5 + 계약 실험)를 실제 앱·브라우저로 실행 →
  스텁 검증이 현장에서도 성립하는지 확인. 그 후 4순위(`verdict.json` — AC 를 루브릭 최대 가중 차원으로).
- **마지막 갱신**: 2026-08-11 (기록자: 페이즈 산출물 계약 세션)

### 🟢 완료 — v3 1.5단계: 2차 자기진단(F15~F26) **반영 완료** (12건 중 11건)

- **브랜치**: `step/27-fail-open-reversal` → main
- **뿌리 원칙을 코드로**: *증거 부재는 통과가 아니다.* skip 은 **환경 부재**(도구 미설치)에만 허용하고
  **산출물 부재**(스펙 없음·평가 없음·관찰 못 함)는 실패로 분류한다.
- **핵심 변화 (실측 대조)**

  | 항목 | 이전 | 이후 |
  | --- | --- | --- |
  | 스펙 없이 verify | exit 0 **통과** | **exit 2 차단** (설계결함→design) |
  | dev 서버 미기동 | exit 0 **통과** | **exit 2 차단** (구현결함→implement) |
  | 정적 폴백 평가 | **92점 / major 0 → PASS** | **32점 / major 다수 → FAIL** |
  | 빈 스캐폴드 | **100점 PASS** | `fn.e2e-verified` major → FAIL |
  | evaluate 페이즈 | `eval-playwright` **호출자 0건** | loop 가 실행 + **이번 사이클 산출물 검사** |
  | debate 평가 부재 | 무조건 `pass` | 도구 있으면 `rework` |
  | `--resume` | 카운터 무조건 리셋 | **저장소가 바뀌어야** 허용(강제는 `--force`) |
  | 멱등 재개 | 트리거 도달 불가(죽은 기능) | `lastExecutedPhaseSeq` 앵커로 **실제 크래시 감지** |

- **면제는 명시로**: 상호작용이 없는 step 은 `{ "scenarios": [], "skipReason": "<이유>" }` 로 기록해야 통과.
  침묵의 통과를 기록된 면제로 바꿨다.
- **검증**: 셀프테스트 13종 PASS(신규 24개 체크 — loop 시나리오 G / eval [B2] / eval-scenario [4])
  · 게이트 4종 green · DEMO PASS(100/major 0, report.md 무변동)
- **미수정 1건(의도)**: F26 한글 브랜치명 — git 금지문자는 이미 제거되고, 한글 제거 시 `step/01-step` 처럼
  정보가 사라져 손실이 위험보다 크다. 실제 인코딩 사고 관측 시 재검토.
- **다음 1개 행동**: 시행 5(방어 실험 E-1~E-5)를 실제 앱·브라우저로 실행 → 스텁 검증이 현장에서도 성립하는지 확인.
  그 후 v3 2단계(페이즈 산출물 게이트 = 이번 개별 배선의 일반화) 착수.
- **마지막 갱신**: 2026-08-10 (기록자: 2차 자기진단 반영 세션)

### 📄 참고 — 2차 자기진단 원문(F15~F26) *(수정 전 상태의 기록 — 보존용)*

> 아래는 **고치기 전** 진단 내용이다. 무엇이 왜 틀려 있었는지가 다음 판단의 재료이므로 지우지 않고 남긴다.
> 반영 결과는 위 "v3 1.5단계" 항목 참조.

- **문서**: `docs/review/self-audit-2026-08-10.md` — 1단계 이후 남은 구멍 **12건**, 전부 file:line 근거 + 재현 명령 포함.
- **핵심 발견 3건 (실측)**
  - **F15** `harness/eval-scenario.json` 이 없으면 verify 의 E2E 가 **exit 0 으로 조용히 통과**.
    reset/copy 가 이 스펙을 만들지 않으므로 **새 프로젝트는 E2E 가 꺼진 상태로 태어난다.**
    시행 4의 성공은 스펙이 이미 있었기 때문 — F4 와 같은 결함이 한 칸 옆으로 옮겨간 상태.
  - **F17** `eval-playwright` **호출자 0건**(주석 4건뿐). evaluate 는 md 지시뿐이라
    평가 없이 전진 → done-gate 가 "평가 없음" FAIL → 3회 왕복 후 **blocked**.
  - **F18/F19** 루브릭 16항목 중 AC 항목 **0개** → 빈 스캐폴드가 **100점 PASS**.
    정적 폴백은 `appMounted := HTTP 200` 이라 **브라우저 없이 92점 PASS**.
- **뿌리 패턴 3가지**: ① fail-open("모르면 통과") ② md-only 강제(`run-cycle.md` 의 ⛔ 강제 5건 중
  검사자가 붙은 것은 2건 → **수정 후 3.5건**) ③ 셀프테스트가 배선을 안 봄(F21 — 멱등 재개가 실전에서
  절대 발화하지 않는데 테스트는 초록).
- **남은 과제**: F18 잔여(요구사항→AC→E2E 추적성 = `plan.json`, 3단계) · F22 Notion 코드 강제 복원(5단계)
  · 골든 픽스처 CI(5단계). F24 우회 경로는 유지하되 `bypass` 로 노출만 했다.
- **마지막 갱신**: 2026-08-10 (기록자: 2차 자기진단 세션)

### 🟢 완료 — 테스트벤치 4회 반복 시행 (v3 1단계 효과 실증)

- **추세 실측**: 사람 개입 **5 → 1 → 0 → 0**, 하네스 결함 발견 **6 → 1 → 0**, 게이트 실패 **2 → 0 → 0**.
  부팅~첫 화면 구간이 조용해졌다. AC 4/4·가짜통과 0 은 전 시행 유지.
- **반영 커밋(main)**: `1bdd9eb` v3 1단계 안전망 → `a922688` 시행 1 발견 6건 →
  `1a9889b` T2-1(Mantine CSS) → `e227339` **verify → E2E 코드 강제(F4)** → `f091a23`·`e874127` 결과 마감
- **F4 가 왜 중요했나**: 시행 1에서 `e.currentTarget` 을 setState 업데이터 안에서 읽어 **두 번째 입력에
  앱이 죽는** 버그가 게이트 4종·단위테스트 10개를 통과하고 루브릭 **100점/major 0** 을 받았다.
  오직 `eval-scenario` 만 잡았는데 **그 러너를 부르는 코드가 없었다**(md 지시뿐).
  이제 `verify` 가 직접 실행하고 실패 시 전진을 차단한다.
- **시행 4 = 방어 능력 실험 → ✅ 성공**: 같은 버그를 일부러 심고 사람이 E2E 를 따로 돌리지 않은 채
  `loop.mjs` 세 번만 호출 → verify 가 크래시를 잡아 `verify` 에 머무름(`failures: verify=1/3`).
  수정 5건(F4·T1-5·T1-6·결함 3분류·실패 라우팅) 전부 발화 확인.
- **산출물**: `docs/testbench/results.md`(계측) · `trial-log.md`(시행 로그) · `docs/review/harness-trials-2026-08-10.html`
- **마지막 갱신**: 2026-08-10 (기록자: 4회 시행 마감 세션)

### 🟢 완료 — v3 1단계 안전망 + 테스트벤치 구축
- **복원 지점**: 브랜치 `snapshot/pre-v3-2026-08-10` + 태그 `v2-final` (전환 직전 상태 박제)
- **진단·설계**: `docs/review/` — 발견 14건(F1~F14) + 목표 설계(작업 지시서·3축·5단계)
- **1단계(안전망) 완료** — `edb8fa6` → main `1bdd9eb`
  - gatesGreen 하드코딩 제거(실측 `gate-status.json` 반영) / 신선도 step→cycle(`cycleId`)
  - 빈 병합 차단(`branchHasWork`) / 실패 라우팅(재시도3→결함분류 되돌림→blocked, exit 3)
  - demo 초기상태 실패 수정(기존 결함 — 새 복사본에서 항상 FAIL 이던 것)
  - 검증: 게이트 4종 green · self-test 13종 PASS · demo PASS
- **테스트벤치**: `docs/testbench/project-manager.md`(고정 사양, 수정 금지) + `results.md`(계측)
  - 프로젝트 관리 프로그램 3 step / AC 10개. 매 시행 새 복사본에서 처음부터.
  - 핵심 지표: **사람 개입 횟수 ↓**, **AC 달성 ↑**, **가짜 통과 0 유지**
- **외부 참고 반영**: 사내 조직 가이드 pptx 의 결함 3분류 → 1단계 실패 라우팅에 채택.
  HANDOFF 스키마(2단계) · 횡단변경 이력(3단계) 은 대기.
- **다음 1개 행동**: 시행 1 — `bench/pm-trial1` 에서 고정 사양으로 자율 개발 실행 후 계측
- **마지막 갱신**: 2026-08-10 (기록자: v3 전환 세션)

### 🟢 완료 — Notion 라이브 flush 자동화 (outbox → 실제 Notion REST)
- **신규**: `scripts/lib/notion-api.mjs`(Notion REST 래퍼: clearPageChildren·appendBlocks·addComment + `flushOutbox`) + `scripts/notion-flush.mjs`(CLI, `yarn notion:flush`).
  - `dashboard.reset` → 페이지 자식 블록 비우기 + 초기화 콜아웃 / `dashboard.upsert` → 진행 한 줄 append / `decision.comment.mirror` → 페이지 댓글.
- **자동 연결**: `loop.mjs` 가 매 페이즈 적재 후 `notion-flush` best-effort spawn(useMcp 게이트), `init-project.mjs` 가 대시보드 초기화 후 `await flushOutbox`. 토큰/네트워크 없으면 skip, 실패분은 outbox 에 남아 재시도.
- **이전 한계 해소**: "적재만 하고 실제 Notion 반영은 수동" → 이제 `useMcp+NOTION_TOKEN` 이면 **개발 중 자동 라이브 반영**.
- **검증**: `notion-api.selftest`(빌더·게이트, 네트워크 미사용) PASS, lint green, selftest 11종 PASS. (실제 Notion 쓰기 스모크는 사용자 페이지 영향이라 미실행 — 승인 후 진행)
- **문서 동기**: run-cycle·usage·AGENTS(강제 모델)·notion-dashboard·start-project·README, CI self-test 11종, package.json `notion:flush`.
- **마지막 갱신**: 2026-06-15 (기록자: Notion 라이브 flush 세션)

### 🟢 완료 — Notion 자동 기록 배선(C) + agent subset 기본값 힌트(D)
- **C(코드)**: `loop.mjs` 가 매 페이즈 전이마다 `upsertDashboard`(대시보드 진행상황), `log.mjs logDecision` 이 `mirrorDecisionComment`(결정 결론)를 `harness/notion-outbox/` 에 자동 적재. 둘 다 `useMcp=false` 면 no-op. 라이브 flush 는 오케스트레이터/MCP. (이전엔 함수만 있고 호출 0건이라 진행 기록이 안 됐음)
- **D(md+설정)**: agent subset 선정은 코드 강제하지 않음(맥락 판단). 대신 `docs/agent-roster.md`(페이즈별 기본 subset 힌트) 신설 + `ceo.md` 가 출발점으로 참조. 강제 아닌 힌트.
- **근거**: 노션 기록=기계적 부수효과→코드, agent 선택=맥락 판단→md(LLM). 하네스 일관 원칙(게이트·시퀀싱·기록=코드, 토론·선택=LLM).
- **검증**: lint green, selftest 10종 PASS, demo PASS. loop·logDecision 미러 실측(useMcp=true → outbox 적재 / false → no-op).
- **문서 동기**: run-cycle.md(Notion 자동 미러 절), usage §4, AGENTS(강제 모델 표 + 페이즈 투입 예시 → agent-roster 링크).
- **마지막 갱신**: 2026-06-15 (기록자: Notion 자동기록·roster 힌트 세션)

### 🟢 완료 — Notion 책임 재배치 + start 0번(--fresh) 제거
- **start `--fresh` 제거**: 무조건 `/copy-project` 로 복사해 오는 전제 → `/start-project` 의 제자리 정리 단계 삭제. start = 1) 연동 확인+Notion 초기화 → 2) Q&A → 3) 계획 → 4) main 시드.
- **copy = 빈 껍데기**: `copy-project.mjs` 가 reset 을 항상 `--no-notion` 으로 호출. 현재 프로젝트(harness-setup)에 종속된 테스트 산출물·토큰·정체성만 비우고 **Notion 은 건드리지 않음**.
- **Notion 초기화는 start 로 이동**: `init-project.mjs` 가 notion-url 접근 확인 성공 시 `resetDashboard()` 로 대시보드 초기화 페이로드(pageId 포함) 적재. 실제 flush 는 오케스트레이터/MCP. `notion.mjs resetDashboard` 에 pageId 필드 추가.
- **검증**: lint green, selftest(copy/reset/init/eval) PASS, init-project 스모크에서 Notion 접근 OK(200)+페이로드 적재 실측(임시 cwd, 실제 repo 무오염).
- **마지막 갱신**: 2026-06-15 (기록자: Notion 책임 재배치 세션)

### 🟢 완료 — 부트스트랩 커맨드 통합 (4개 → 2개)
- **통합**: `/clear-project`·`/init-project` 커맨드를 `/start-project` 로 흡수. `/start-project` 가 0)`--fresh` 제자리 정리 → 1) git/Notion 연동 확인 → 2) Q&A → 3) 계획 시드 → 4) main 시드를 순서대로 오케스트레이션. `copy-project` 는 유지.
- **결과**: `.claude/commands/` = copy-project / start-project / run-cycle / status / git-flow / evaluate (6개). 부트스트랩 커맨드는 copy-project·start-project 2개.
- **스크립트 보존**: `reset-project.mjs`·`init-project.mjs` 는 삭제하지 않고 start-project 가 호출(yarn reset/copy 로도 직접 실행 가능).
- **문서 동기**: start-project.md 재작성, copy-project.md 참조, docs/commands.md 표·흐름, README 커맨드 흐름·인덱스, AGENTS 커맨드 목록, usage 명령어 표·§6.
- **마지막 갱신**: 2026-06-15 (기록자: 커맨드 통합 세션)

### 🟢 완료 — preflight → init-project rename + commands 인덱스
- **rename**: `scripts/preflight.mjs`→`init-project.mjs`, `*.selftest.mjs` 동일, `.claude/commands/preflight.md`→`init-project.md`. 커맨드는 `/init-project`(`/init` 은 빌트인 예약). 스크립트 경로·커맨드명 참조 전부 갱신. **단 `config.json` 의 `preflight` 키는 데이터 호환 위해 유지**(demo·init-project.mjs 가 읽고 씀).
- **commands 정리**: `docs/commands.md` 인덱스 신설 — 8개 커맨드를 부트스트랩/사이클로 묶고 실행 흐름·파괴성 표기. (commands/ 안에 두면 `.md` 가 슬래시 커맨드로 등록돼 버려 docs/ 에 배치)
- **검증**: INIT-PROJECT SELFTEST PASS, lint green, init-project 스모크(`--no-git`) 동작, demo PASS(config.preflight 키 정상).
- **마지막 갱신**: 2026-06-15 (기록자: init-project rename 세션)

### 🟢 완료 — preflight 에 git 원격·Notion 접근 확인 추가
- **추가**: `preflight.mjs` 가 `--git-remote=<url>` → `git ls-remote` 로 접근·인증 확인 후 origin 연결, `--notion-url=<url>` → page id 추출 + `NOTION_TOKEN` 으로 페이지 조회(integration 연결 확인). 결과를 `config.json`(`gitRemote`·`notionDashboardPageId`·`preflight.checks`)에 기록. 실패는 경고만(자율 유지).
- **목적**: 인터뷰/개발 **전에** 연동 끊김을 잡아 "한참 작업 후 push·미러 실패" 사고 방지.
- **부수 수정**: `--no-git`/`--no-mcp` 별칭이 실제로 동작하도록 parseFlag 별칭 지원(문서엔 있었으나 코드 미인식이던 버그).
- **검증**: `preflight.selftest.mjs`(page id 추출 10 체크) + 임시 cwd 스모크(새 config 스키마 확인) + `--no-git` 동작 확인. CI self-test 10종 편입.
- **문서 동기**: `preflight.md`(동작·인자·대화형 절차), README 빠른시작·자가검증 목록.
- **다음(미완)**: `/start-project` 에서 저장된 `notionDashboardPageId` 로 대시보드 실제 생성·초기화(B-②) 연결.
- **마지막 갱신**: 2026-06-15 (기록자: preflight 연동확인 세션)

### 🟢 완료 — 복사+초기화 커맨드 `/copy-project`
- **추가**: `scripts/copy-project.mjs` + `.claude/commands/copy-project.md`. 이 하네스를 `<경로>/<이름>` 으로 복사하고 복사본에서 `reset-project --apply` 자동 실행(복사→초기화 한 번에).
  - 제외 복사: node_modules·.git·dist·.yarn 캐시·**.env(토큰)**·*.tsbuildinfo·.omc.
  - **미리보기/승인 없음**(사용자 요청): 복사는 새 위치 생성이라 비파괴적. 안전장치는 "대상 기존 비어있지않음/소스 내부경로 거부"로 충분.
  - 커맨드는 대상 경로·이름만 묻고 바로 실행 → Notion flush 마무리.
- **검증**: `scripts/copy-project.selftest.mjs`(26 체크, filter·planCopy·doCopy) + 실제 C:\tmp 복사 smoke PASS. CI self-test 9종 편입.
- **문서 동기**: README(빠른시작 0-1 A/B·구조·자가검증·커맨드 흐름), AGENTS(커맨드·scripts), usage §6-1, package.json(`yarn copy`).
- **마지막 갱신**: 2026-06-15 (기록자: copy-project 세션)

### 🟢 완료 — 초기화 슬래시 커맨드 `/clear-project`
- **추가**: `.claude/commands/clear-project.md` — `reset-project.mjs` 를 **미리보기→사용자 승인→적용→Notion 실제 flush** 안전 절차로 감싸는 슬래시 커맨드. 직접 `node` 실행의 파괴 위험·번거로움 해소.
- 이름: `/clear` 는 Claude Code 빌트인(대화 비우기) 예약어라 `/clear-project` 사용(스크립트명은 reset-project 유지).
- **문서 동기**: README·AGENTS 커맨드 목록, usage §6 에 커맨드 안내 추가.
- **마지막 갱신**: 2026-06-15 (기록자: clear-project 커맨드 세션)

### 🟢 완료 — 새 프로젝트 초기화 스크립트(reset-project) + Notion 리셋
- **추가**: `scripts/reset-project.mjs` — 복사 후 새 프로젝트로 쓸 때 잔존물 일괄 정리. 기본 dry-run, `--apply` 로 적용.
  - 정리: `harness/` 런타임 산출물(state·config·report·cycles·decisions·evaluations·errors), `.env` 토큰(→.env.example), 정체성(package.json·index.html·App.tsx 의 harness-setup→새 이름). **이전 평가 제거로 첫 merge 가짜 통과 방지.**
  - **Notion 리셋**: `config.useMcp` 면 `notion.mjs` 의 신규 `resetDashboard()` 로 `harness/notion-outbox/dashboard-reset.json` 적재 → 다음 flush 때 대시보드 초기화. `--notion`/`--no-notion` 오버라이드.
  - 멱등(2차 실행 0건), example-/.gitkeep·하네스 엔진 보존, git 이력은 안내만.
- **추가 검증**: `scripts/reset-project.selftest.mjs`(25 체크) — CI self-test 8종으로 편입.
- **문서 동기**: README(빠른시작 0-1·구조·자가검증), AGENTS(scripts 맵), usage(§6 신설 + 데모 설명 정정), package.json(`yarn reset`).
- **마지막 갱신**: 2026-06-15 (기록자: reset-project 세션)

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
