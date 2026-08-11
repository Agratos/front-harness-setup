# 2차 자기진단 — v3 1단계 이후 남은 구멍 (F15~F26)

작성: 2026-08-10 (main `e874127` 기준) · 1차 진단은 [`harness-review-2026-08-10.html`](harness-review-2026-08-10.html) (F1~F14)

4회 시행([`../testbench/results.md`](../testbench/results.md))으로 **부팅~첫 화면 마찰**과 **상호작용 버그 방어**는 해결됐다.
그래서 이번에는 "사람 개입이 0이 된 뒤에도 하네스가 스스로 속을 수 있는 경로"만 찾았다.
모든 항목은 file:line 근거와 **재현 명령**을 붙였다 — 추측이 아니라 실행해서 확인한 것이다.

---

## 한 줄 결론

> 1단계는 **verify 한 칸**을 코드로 막았다. 그 앞칸(스펙 작성)과 뒤칸(evaluate)은 아직 md 지시뿐이라,
> **F4 와 똑같은 결함이 옆으로 한 칸 옮겨가 있었다.**

시행 4의 성공은 "하네스가 잡았다"가 맞지만, 그때 `harness/eval-scenario.json` 이 **이미 있었기 때문**이다.
스펙이 없으면 같은 버그가 그대로 통과했다. 실측으로 확인했다(F15).

> **→ 반영 완료(2026-08-10)**: 앞칸(스펙 부재 = exit 2)과 뒤칸(evaluate 산출물 강제)을 모두 코드로 막았다.
> 아래 각 항목의 "고치는 방향"은 실제로 그렇게 반영됐고, 검증 결과는 [처리 현황](#처리-현황--12건-중-11건-반영-2026-08-10-step27-fail-open-reversal) 표에 있다.
> 원래 진단 내용은 **그대로 보존**한다 — 무엇이 왜 틀려 있었는지가 다음 판단의 재료이기 때문이다.

---

## 처리 현황 — 12건 중 11건 반영 (2026-08-10, `step/27-fail-open-reversal`)

| ID | 심각도 | 요약 | 뿌리 패턴 | 상태 |
| --- | --- | --- | --- | --- |
| **F15** | 🔴 major | E2E 스펙 파일이 없으면 verify 가 **조용히 통과** — 새 프로젝트는 항상 무장 해제로 출발 | fail-open | ✅ 수정 |
| **F16** | 🔴 major | 스펙 파싱 실패·**dev 서버 미기동**도 E2E 통과로 처리 (앱이 안 뜨는 게 크래시보다 관대) | fail-open | ✅ 수정 |
| **F17** | 🔴 major | `evaluate` 페이즈를 **코드가 호출하지 않는다** — `eval-playwright` 호출자 0건 (F4 와 동일 구조) | md-only 강제 | ✅ 수정 |
| **F18** | 🔴 major | 루브릭 16항목 중 **요구사항/AC 항목 0개** → 기능 0개 빈 스캐폴드가 **100점 PASS** | 목적 부재 | 🟡 부분 — `fn.e2e-verified` 추가(빈 스캐폴드 차단). 완전 해결은 `plan.json`(3단계) |
| **F19** | 🔴 major | 정적 폴백이 미관찰을 통과로 준다. `appMounted := HTTP 200` → 브라우저 없이 **92점 PASS** | fail-open | ✅ 수정 — 폴백 **92 → 32점** |
| **F20** | 🟡 minor | debate 가 **평가 부재 시 pass** 폴백 — "가짜 통과 0" 원칙과 어긋남 | fail-open | ✅ 수정 |
| **F21** | 🟡 minor | 광고된 **멱등 재개가 실전 전이로는 도달 불가** (셀프테스트는 상태를 주입해 검증) | 배선 미검증 | ✅ 수정 |
| **F22** | 🟡 minor | Notion 자동 갱신이 **코드에서 제거됐는데 문서는 "코드 강제"로 남아 있다** | 문서-코드 불일치 | ✅ 문서 정정(강제는 미복원 — 5단계) |
| **F23** | 🟡 minor | `blocked` 방어선이 `--resume` 한 줄로 리셋 — 조치 증거를 요구하지 않는다 | 탈출 해치 | ✅ 수정 |
| **F24** | 🟢 trivial | `HARNESS_EVAL_SCORE`·`HARNESS_GATE_OK` 주입이 루브릭·신선도를 통째로 우회 | 탈출 해치 | 🟡 부분 — 우회 사실을 `bypass` 로 노출(경로는 유지) |
| **F25** | 🟢 trivial | `harness/gate-status.json` 이 추적 대상 — `state.json` 과 같은 성격인데 gitignore 누락 | 위생 | ✅ 수정 |
| **F26** | 🟢 trivial | `slugify` 가 한글을 남겨 `step/01-작업-보드` 브랜치 생성 가능 | 위생 | ⬜ 미수정(의도) — 아래 사유 |

### 무엇이 어떻게 바뀌었나

| 항목 | 이전 | 이후 |
| --- | --- | --- |
| `eval-scenario` 종료 코드 | 스펙 없음/깨짐/서버 미기동/도구 없음 = **전부 exit 0** | **0** 통과·명시적 면제·환경 부재 / **1** 단언 실패 / **2** 검증 불가 |
| 상호작용 검증 면제 | 침묵의 통과 | `{ "scenarios": [], "skipReason": "<이유>" }` **명시 필요**, 산출물에 기록 |
| E2E 산출물 | skip 경로는 아무 파일도 안 남김 | **모든 경로가 `scenario.json` 을 남김**(검증했는지 추적 가능) |
| evaluate 페이즈 | md 지시뿐, 호출자 0건 | `loop.mjs` 가 `eval-playwright` 실행 + **이번 사이클 산출물 검사**(exit code 불신) |
| 루브릭 미관찰 처리 | `o.x !== false` → undefined 가 통과 | `=== true` 만 통과, 미관찰은 `reason:'unobserved'` 불만 |
| 정적 폴백 점수 | **92 / major 0 → PASS** | **32 / major 다수 → FAIL** (실측 관찰 없이 merge 불가) |
| 기능 차원 배점 | mounts 40 / no-error 40 / navigable 20 | mounts 30 / no-error 30 / **e2e-verified 30(major)** / navigable 10 |
| debate 평가 부재 | 무조건 `pass` | 평가 도구가 있으면 `rework`, 도구 자체가 없으면 `pass`(환경 부재) |
| `--resume` | 카운터 무조건 리셋 | blocked 이후 **저장소가 바뀌어야** 허용. 강제는 `--resume --force` |
| 멱등 재개 | 트리거가 실전 전이로 도달 불가 | `lastExecutedPhaseSeq` 앵커로 **실제 크래시 감지** |

**F26 을 고치지 않은 이유**: `slugify` 는 이미 git 이 금지하는 문자를 전부 제거하고 길이를 40자로 자른다.
남은 위험은 "git 이 아니라 주변 도구의 인코딩"이고, 이 프로젝트의 계획 라벨은 한국어가 기본이다.
한글을 제거하면 `step/01-step` 처럼 **정보가 사라진 브랜치명**이 되어 가독성 손실이 위험보다 크다.
→ **의도적으로 현행 유지**. 실제 인코딩 사고가 관측되면 그때 로마자 변환을 넣는다.

### 검증

```
셀프테스트 13종        전부 PASS (loop 시나리오 G 4건 + eval [B2] 8건 + eval-scenario [4] 12건 신설)
게이트 4종             typecheck 0 / lint 0 / check-arch 0위반 / test 5 passed
통합 데모              DEMO: PASS (종합 100 / major 0, report.md 무변동)
실측 — 스펙 부재       node scripts/eval-scenario.mjs → exit 0 → **exit 2** (unverifiable: no-spec)
실측 — 정적 폴백       scoreObservations → 92점 PASS → **32점 FAIL**
```

---

## 🔴 F15 — E2E 스펙이 없으면 verify 가 조용히 통과한다

**근거**: `scripts/eval-scenario.mjs:164-167`

```js
if (!existsSync(specPath)) {
  log(`시나리오 스펙 없음(...) — skip(차단 안 함)`);
  return { skipped: true, reason: 'no-spec', passed: true };   // ← exit 0
}
```

`loop.mjs:301-308` 의 verify 는 이 exit code 만 본다. 그러므로 스펙이 없으면 **E2E 검증이 없었다는 사실 자체가 통과**로 기록된다.

**재현** (이 레포에서 그대로):

```console
$ ls harness/ | grep scenario
eval-scenario.example.json          ← 예시만 있고 실제 스펙은 없음

$ node scripts/eval-scenario.mjs --id=probe-nospec --no-server
[scenario] 시나리오 스펙 없음(harness\eval-scenario.json) — skip(차단 안 함)
$ echo $?
0
```

**왜 중요한가**: `reset-project.mjs`·`copy-project.mjs` 는 이 스펙을 만들지 않는다(`grep -n "eval-scenario"` → 0건).
따라서 **모든 새 프로젝트는 E2E 게이트가 꺼진 상태로 태어난다.** 스펙을 쓰라는 강제는 `run-cycle.md:80` 의 ⛔ 문장뿐이다 —
이것이 정확히 F4(“md 3곳에 ⛔ 라고 적혀 있고 아무도 호출하지 않음”)와 같은 형태다. 게이트를 한 칸 옮겼을 뿐 계층 구조는 그대로다.

**고치는 방향**: 스펙 부재를 **verify 실패**로 본다(스펙 작성은 decompose/design 산출물). 환경 부재(Playwright 미설치)와
산출물 부재(스펙 없음)를 같은 skip 으로 뭉개지 말고 exit code 를 갈라야 한다.

---

## 🔴 F16 — 파싱 실패·서버 미기동도 통과로 처리한다

**근거**: `scripts/eval-scenario.mjs`

| 상황 | 코드 | 반환 |
| --- | --- | --- |
| 스펙 JSON 문법 오류 | `:171-174` | `passed: true` |
| **dev 서버가 뜨지 않음** | `:188-191` | `passed: true` |
| Playwright 미설치 | `:192-196` | `passed: true` |

세 번째(환경 부재)는 타당하다. 앞의 두 개는 fail-open 이다. 특히 두 번째가 뒤집혀 있다 —
**앱이 크래시하면 차단되는데, 앱이 아예 뜨지 않으면 통과한다.** 더 나쁜 상태가 더 관대하게 처리된다.

`typecheck`/`test` 가 잡지 못하는 기동 실패(vite 설정 오류, 포트 점유, 런타임 import 실패)가 정확히 이 경로로 빠진다.

**고치는 방향**: `bad-spec`·`server-not-ready` 는 실패. skip 은 `no-playwright` 만.

---

## 🔴 F17 — evaluate 페이즈는 여전히 코드가 부르지 않는다 (F4 와 동일 구조)

**근거**:

```console
$ grep -rn "eval-playwright" scripts/*.mjs | grep -v selftest
scripts/done-gate.mjs:98:   * 왜 파일로 남기나: 평가(eval-playwright)의 ...   ← 주석
scripts/done-gate.mjs:217:  // 실측 결과를 파일로 남긴다 ...                  ← 주석
scripts/eval-scenario.mjs:4: // 왜 필요한가: ... eval-playwright ...          ← 주석
scripts/loop.mjs:297:       // ... (eval-playwright 는 조작을 안 하므로 ...)   ← 주석
```

**호출부 0건.** `loop.mjs:431-440` 의 evaluate 는 `appendCycleLog` 한 줄만 쓰고 무조건 전진한다.

이때 벌어지는 일의 사슬:

1. evaluate 가 실제로 평가를 안 함 → `harness/evaluations/eval-*.json` 없음
2. `resolveDebateOutcome`(`loop.mjs:147-150`)이 평가 부재 시 **`'pass'`** 폴백 → merge 로 전진
3. merge 의 done-gate 가 "평가 데이터 없음"으로 FAIL(`done-gate.mjs:351-356`)
4. `classifyFailure` 가 **검증결함 → evaluate** 로 되돌림 — 그런데 evaluate 는 여전히 코드가 안 부름
5. 3회 왕복 후 `status='blocked'`

라이브락은 1단계에서 막혔지만, **evaluate 가 md 지시로 남아 있는 한 그 자리는 blocked 로 끝난다.**
verify 는 코드로 강제하고 evaluate 는 방치한 **비대칭**이 원인이다.

---

## 🔴 F18 — 루브릭이 요구사항을 채점하지 않는다 (F3, 수치로 확정)

**근거**: `scripts/lib/rubric.mjs` — 4차원 **16항목**. 목록: `ui.renders / ui.title / ui.heading / ui.no-console-error /
ux.load-fast / ux.layout-stable / ux.responsive-meta / ux.responsive-layout / ux.a11y-landmarks /
fn.app-mounts / fn.no-runtime-error / fn.navigable / q.gates-green / q.screenshot / q.observability / q.a11y-clean`

**이 중 "무엇을 만들었어야 하는가"를 보는 항목은 0개다.** 전부 "화면이 떴나 / 에러가 없나 / 게이트가 green 인가" 뿐이다.

**재현**:

```console
$ node -e "import('./scripts/lib/rubric.mjs').then(({scoreObservations})=>{ ... })"
[B] 기능 0개 빈 스캐폴드 (실측 관찰 전부 정상): score=100 major=0 => done-gate PASS
```

즉 **아무 기능도 구현하지 않은 Hello World 가 종합 100점 / major 0 으로 merge 된다.**
시행 1의 "죽은 앱 100점"은 예외 사고가 아니라 이 루브릭의 **정상 동작**이었다.

**고치는 방향**: F5(`plan.json`)와 묶어야 한다. AC 를 데이터로 두고 `verdict.json`(AC↔E2E 단언 매핑 결과)을
루브릭의 최대 가중 차원으로 넣지 않으면, 점수는 계속 "떴는가"만 측정한다.

---

## 🔴 F19 — 정적 폴백이 미관찰을 통과로 준다 (gatesGreen 하드코딩과 같은 패턴)

**근거**: `scripts/eval-playwright.mjs:186-203` (`staticObservations`)

```js
return {
  bodyNonEmpty: serverReady === true,
  ...
  responsiveLayout: true,   // 정적 폴백은 레이아웃 미관찰 → 기본 통과
  hasLandmarks: true,       // 정적 폴백은 landmark 미관찰 → 기본 통과
  appMounted: serverReady === true,   // ← HTTP 200 을 "앱이 마운트됐다"로 간주
  runtimeErrors: 0,
  navigable: true,
  a11yViolations: 0,        // 정적 폴백은 a11y 미관찰 → 위반 0 으로 간주
  ...
};
```

**재현**:

```
[A] static-fallback (Playwright 미설치, 서버만 200): score=92 major=0 => done-gate PASS
```

92 ≥ ENTER(90) 이고 major 0 이므로 **브라우저를 한 번도 띄우지 않고 merge 가 통과한다.**

특히 `appMounted: serverReady === true` 는 관찰하지 않은 사실을 관찰한 것처럼 기록한다.
`fn.app-mounts`(major, weight 40)·`fn.no-runtime-error`(major, weight 40)가 전부 이 위조된 관찰값에 걸려 있다.

`resolveGatesGreen`(`:76-85`)은 같은 문제를 **"모르면 false"** 로 이미 고쳐 놓았다.
같은 원칙이 나머지 필드에는 적용되지 않은 것 — **한 필드만 고치고 패턴은 남겨둔 부분 수정**(T2-1 과 같은 유형)이다.

**고치는 방향**: 미관찰 필드는 `null` 로 두고, 루브릭이 `null` 을 **감점**으로 처리한다. 폴백 모드는 구조적으로
90점을 넘을 수 없어야 한다(관찰 못 했으면 통과시키지 않는다).

---

## 🟡 F20 — debate 가 평가 부재를 pass 로 넘긴다

**근거**: `scripts/loop.mjs:147-150`

```js
} catch {
  // 평가 로드 실패 → 자율 유지 위해 pass 처리
}
return 'pass';
```

주석대로 뒤의 done-gate 가 잡기는 한다. 그러나 "가짜 통과 0" 을 코드 원칙으로 세운 하네스에서
**증거 없음을 통과로 읽는 기본값**은 그 자체로 결함이다. 결과적으로 3회 왕복을 낭비하고 blocked 로 끝난다(F17 사슬).

**고치는 방향**: 평가 부재 → `rework`(evaluate 로 되돌림). 자율성은 "무조건 전진"이 아니라 "막힌 이유를 말하고 되돌림"으로 유지한다.

---

## 🟡 F21 — 멱등 재개가 실전에서 절대 발화하지 않는다

`loop.mjs:17-19` 헤더가 이렇게 광고한다.

> 멱등 재개(idempotent resume): `needsRerun(state)` 가 true 면 건너뛰지 않고 현재 페이즈를 다시 실행합니다.

그런데 두 트리거 조건 모두 실행 경로에서 성립할 수 없다.

| 트리거 (`state.mjs:194-202`) | 왜 도달 못 하나 |
| --- | --- |
| `status === 'done'` | `runOnce` 가 **line 368** 에서 조기 return — `needsRerun` 은 **line 395** 에서 호출 |
| `currentStepIdx >= planSteps.length` | `nextTransition:104-107` 이 소진 시 `nextStepIdx: currentStepIdx` 로 되돌려 idx 를 올리지 않음 |

**재현**:

```
needsRerun(status=done)  = true → 그러나 runOnce 가 그 전에 return
needsRerun(idx>=len)     = true → 그러나 nextTransition 이 idx 를 len 까지 올리지 않음
```

즉 `rerun` 은 항상 `false` 이고, 출력의 `(RERUN — 멱등 재개)` 는 사람이 `state.json` 을 손으로 고칠 때만 나온다.

**가장 아픈 부분은 이게 왜 안 잡혔는가다.** `resume.selftest.mjs` 는 `needsRerun` **순수 함수만** 검증한다.
함수는 맞게 동작하고 배선이 죽어 있으므로 셀프테스트는 초록이다 — **F4 와 같은 유형의 실패**(테스트는 통과, 기능은 없음).
셀프테스트 13종이 배선을 보지 않는다는 점은 F15·F17 에도 그대로 적용된다.

---

## 🟡 F22 — Notion 은 "코드 강제"라고 적혀 있지만 코드에서 제거됐다

**근거**:

| 위치 | 주장 | 실제 |
| --- | --- | --- |
| `AGENTS.md:72` | "**코드** — 적재: `loop.mjs`→`upsertDashboard`, flush: `loop` 가 `notion-flush.mjs` 자동 실행" | `loop.mjs` 에 두 호출 모두 없음 |
| `harness/PROGRESS.md:43,50` | 🟢 완료 — "매 페이즈 적재 후 notion-flush best-effort spawn" | 제거됨 |
| `loop.mjs:481-483` | — | "구조를 지우는 옛 REST 미러는 **더 이상 수행하지 않는다**" (제거를 주석으로 명시) |

`grep -rn "upsertDashboard"` 의 호출자는 **셀프테스트뿐**이다. 1차 진단이 *"1세대 `upsertDashboard` — 호출자 0건(죽은 코드)"* 로
지적했던 바로 그 상태로 되돌아갔다. 파괴적 REST 미러를 없앤 판단 자체는 맞지만, 대체 배선 없이 md 지시(`run-cycle.md:161`)로만
남겨서 **"허브가 옛 프로젝트 그대로 남는" 사고의 조건이 복원됐다.**

**고치는 방향**: 코드로 다시 강제하든(비파괴 append 전용) md 로 내리든 **한쪽으로 정하고 세 문서를 맞춘다.**
지금은 강제 모델 표가 거짓을 말하고 있어서, 다른 판단들의 신뢰도까지 깎는다.

---

## 🟡 F23 — blocked 방어선이 `--resume` 한 줄로 무력화된다

**근거**: `scripts/loop.mjs:384-386`

```js
state = { ...state, status: 'running', blockedReason: null, failures: {}, escalations: 0, committed: false };
log('--resume: blocked 해제, 실패 카운터·에스컬레이션 초기화');
```

**조치가 실제로 있었는지 확인하지 않는다.** `MAX_ESCALATION=3` 은 "사람을 부르는 마지막 방어선"인데,
자율 오케스트레이터에게는 `--resume` 이 가장 값싼 탈출구다. 무한 루프 금지가 사실상 명예 규정이 된다.

**고치는 방향**: resume 시 해소 증거를 요구한다 — 실패했던 게이트가 이제 green이거나, `blockedReason` 이후 새 커밋이 있을 때만 허용.

---

## 🟢 F24~F26 (trivial)

- **F24 주입 해치** — `done-gate.mjs:276-281` 의 `--score`/`HARNESS_EVAL_SCORE` 는 루브릭 산출을 덮고,
  `:365` 에서 **신선도 검사까지 면제**된다(`source==='injected'`). `git-flow.mjs:210` 의 `HARNESS_GATE_OK=1` 도 같은 성격.
  CI 경로라는 설명은 타당하나, 자율 루프도 쓸 수 있는 환경변수다. 최소한 사이클 로그·평가 파일에 주입 사실을
  남기고, 주입 통과와 실측 통과의 exit 의미를 갈라야 한다.
- **F25 gitignore 누락** — `harness/gate-status.json` 은 페이즈마다 변동하는 런타임 산출물인데 `.gitignore` 에 없다.
  `state.json`·`cycle-log.ndjson` 을 제외한 것과 같은 이유(merge 체크아웃 충돌)가 그대로 적용된다.
- **F26 한글 브랜치명** — `loop.mjs:81` 의 `slugify` 가 `[^a-z0-9가-힣]` 로 한글을 보존한다.
  `planSteps` 라벨이 한국어면 `step/01-작업-보드` 가 만들어진다. 지금까지 안 터진 건 계획 라벨이 영문이었기 때문일 뿐이다.

---

## 뿌리 패턴 3가지 — 다음 단계가 겨눠야 할 것

개별 항목보다 이 셋이 본질이다. 1단계가 고친 것도 전부 이 셋의 사례였고, 남은 것도 같다.

### 1. fail-open 기본값 — "모르면 통과"

F15·F16·F19·F20 이 전부 같은 문장이다: **관찰하지 못했거나 산출물이 없을 때 통과로 처리한다.**
`resolveGatesGreen` 만 "모르면 false" 로 고쳐져 있었고 나머지가 그대로였다.

> **규칙으로 세워야 할 것**: 증거 부재는 통과가 아니다. skip 은 **환경 부재**(도구 미설치)에만 허용하고,
> **산출물 부재**(스펙 없음, 평가 없음, 관찰 못 함)는 실패로 분류한다. skip 과 pass 의 exit code 를 분리한다.

✅ **이 규칙을 코드에 심었다.** `eval-scenario` 는 exit 0/1/2 로 갈라지고(환경 부재만 0),
`rubric.mjs` 는 `=== true` 만 통과로 인정하며, `eval-playwright` 정적 폴백은 미관찰을 `null` 로 남긴다.
`debate` 는 평가 도구가 있는데 평가가 없으면 `rework` 로 돌린다. 앞으로 새 검사자를 붙일 때도 같은 규칙을 쓴다.

### 2. md-only 강제 — 검사자 없는 ⛔

`run-cycle.md` 의 ⛔ 표기 7개는 **강제 5건**으로 묶인다(`:54`·`:56` 은 같은 건, `:159`·`:161` 도 같은 건).
검사자가 붙은 것은 **2건뿐**이다.

| # | 강제 | 위치 | 검사하는 코드 (수정 전 → 수정 후) |
| --- | --- | --- | --- |
| 1 | md 를 읽고 수행 / 평가 없이 점수로 통과시키지 않기 | `:5` | ❌ → ✅ **부분** — evaluate 산출물 강제(F17)로 "평가 없이 통과" 는 코드가 막는다. "md 를 읽었는가" 자체는 여전히 검사 불가 |
| 2 | evaluate — 캡처물(스크린샷·DOM) 소비 평가 | `:54,56` | ❌ → ✅ **산출물 생성은 강제**(`loop.mjs` evaluate). *캡처물을 봤는가* 는 여전히 미검사(판단은 에이전트 몫) |
| 3 | 실제 조작 E2E 검증 | `:80` | ✅(실행) → ✅ **스펙 존재까지 강제**(exit 2 = 검증 불가 → 전진 차단) |
| 4 | 구현 산출물 커밋 | `:148` | ✅ `git-flow.mjs` (`branchHasWork`, 빈 병합 차단) — 변화 없음 |
| 5 | 매 사이클 Notion 허브 갱신 | `:159,161` | ❌ → ❌ **여전히 없음**. 문서만 "수동 준수" 로 정정(F22). 코드 강제는 로드맵 5단계 |

> **남은 md-only 강제는 2개**다: "캡처물을 실제로 봤는가"(본질적으로 판단이라 검사 어려움)와 "Notion 갱신"(배선 가능하나 미복원).
> 5개 중 2개였던 검사 비율이 5개 중 3.5개가 됐다.

> **규칙으로 세워야 할 것**: ⛔ 를 새로 쓸 때는 **그것을 검사하는 코드 위치를 같은 커밋에 적는다.**
> 검사자를 못 붙이겠으면 ⛔ 가 아니라 권고로 쓴다. 지키지 않을 강제는 강제가 아니라 소음이다.

### 3. 셀프테스트가 배선을 보지 않는다

F21 이 이 문제의 순수한 표본이다. `needsRerun` 은 완벽히 동작하고, 그 함수를 부르는 자리가 죽어 있고, 셀프테스트는 초록이다.
F15·F17 도 같다 — "스펙 없으면 skip 반환" 은 단위 테스트로 통과하지만, 그게 게이트를 무력화한다는 사실은 아무도 검사하지 않는다.

> **규칙으로 세워야 할 것**: 셀프테스트에 **골든 픽스처 통합 케이스**를 넣는다.
> "AC 를 위반한 앱을 만들면 merge 가 거부되는가"를 **결과로** 확인하는 케이스 한 개가,
> 순수 함수 단위 테스트 13종보다 이 하네스에 더 필요하다. (1차 진단 로드맵 5단계의 골든 픽스처 CI 가 여기에 해당한다.)

🟡 **부분 반영**: 이번 수정에서 추가한 셀프테스트는 의도적으로 **결과를 보는 통합 케이스**로 썼다 —
`loop.selftest` 시나리오 G 는 스텁 스크립트를 심어 "verify 가 전진하지 않는가"·"evaluate 가 실제로
`eval-playwright` 를 호출했는가"를 **상태와 마커 파일로** 확인한다(순수 함수 단위 검증이 아니다).
다만 진짜 앱을 빌드해 돌리는 골든 픽스처 CI 는 여전히 5단계 몫이다.

---

## 우선순위 제안

1단계가 "verify 한 칸"을 막았으므로, 다음은 **그 칸의 앞뒤를 같은 방식으로 막는 것**이 자연스럽다.

| 순위 | 작업 | 닫히는 항목 | 상태 |
| --- | --- | --- | --- |
| 1 | **fail-open 일괄 반전** — skip/pass exit code 분리, 미관찰은 감점 | F15 F16 F19 F20 | ✅ 완료 |
| 2 | **evaluate 코드 강제** — verify 와 대칭으로 `eval-playwright` 를 loop 가 직접 실행 | F17 | ✅ 완료 |
| 3 | **페이즈 산출물 게이트(F1, v3 2단계)** — 스펙·평가·결정 파일 존재를 전이 조건으로 | F1 | ✅ 완료 (2026-08-11, `step/30-phase-artifact-gate`) — `lib/phase-gate.mjs` 가 페이즈 계약을 선언하고 `loop.mjs` 가 전진 직전에 검사. 아래 §페이즈 산출물 계약 |
| 4 | **`plan.json` + `verdict.json`(F5·F3, v3 3단계)** — AC↔E2E 매핑을 루브릭 최대 가중 차원으로 | F18 잔여 | ⬜ 대기 — "AC 4/4" 를 사람이 세는 상태 종결 |
| 5 | **골든 픽스처 CI(5단계)** — 결함을 심은 앱이 차단되는지 CI 가 매번 확인 | 뿌리3 | ⬜ 대기 — 시행 4·5를 사람 손 없이 매 커밋 재현 |
| — | 위생 정리 | F22 F25 | ✅ 완료 (F26 은 의도적 현행 유지) |

**다음 검증은 시행 5다.** 이 문서가 예측한 세 경로(스펙 삭제 / Playwright 제거 / evaluate 생략)는
이제 **차단되어야 한다.** 예측이 뒤집혔음을 실측으로 확인하는 것이 시행 5의 목적이다
(설계표: [`../testbench/results.md`](../testbench/results.md) §시행 5).

| 실험 | 조작 | 수정 전 예측 | 수정 후 기대 | 코드 근거 |
| --- | --- | --- | --- | --- |
| E-1 | 스펙 없이 verify | 통과해버림 | **exit 2 → 차단**(설계결함→design) | `eval-scenario.mjs` no-spec |
| E-2 | dev 서버 미기동 | 통과해버림 | **exit 2 → 차단**(구현결함→implement) | `eval-scenario.mjs` server-not-ready |
| E-3 | Playwright 미설치로 평가 | 92점 PASS | **32점 FAIL** | `rubric.mjs` 미관찰 감점 |
| E-4 | evaluate 를 아무도 실행하지 않음 | 3회 왕복 후 blocked | **loop 가 스스로 실행** | `loop.mjs` `runEvaluatePhase` |
| E-5 | 기능 0개 빈 스캐폴드 | 100점 PASS | **major 불만 → FAIL** | `rubric.mjs` `fn.e2e-verified` |

---

## 페이즈 산출물 계약 — 3순위 반영 결과 (2026-08-11, `step/30-phase-artifact-gate`)

**한 줄**: 1·2순위는 `verify`·`evaluate` **두 칸**을 개별 배선으로 막았다. 3순위는 그 배선을 **계약**으로
일반화해 남은 네 칸(`decompose`/`design`/`implement`/`debate`(+`vote`))을 닫았다.

### 무엇이 바뀌었나 (실측)

| 페이즈 | 이전 | 이후 |
| --- | --- | --- |
| `decompose` | 로그만 찍고 **무조건 전진** | 이번 사이클 스탬프가 찍힌 결정 기록 필요 → 없으면 `산출물결함` 차단 |
| `design` | 무조건 전진 (스펙·AC 는 **verify 에서** 뒤늦게 검사) | ①스펙·AC 계약 ②설계 결정 기록. `implement` 를 낭비하기 **전에** 차단 |
| `implement` | 무조건 전진 (구현을 건너뛰어도 모름) | 진입 시점 대비 **코드 지문 변화** 필요. 없으면 `구현결함`, 면제는 기록으로 명시 |
| `debate`/`vote` | 무조건 전진 (토론을 건너뛰어도 모름) | 이번 사이클 결정 기록 필요 |
| 재작업 라운드 | 이전 회차 기록/코드로 통과 가능 | `cycleId` 에 `reworkCount` 가 들어가므로 **빈 재작업 라운드 차단** |

### 뿌리 패턴에 대한 답

- **fail-open**: 계약의 skip 은 **환경 부재**(`scripts/record-decision.mjs` 부재, git 부재)에만 허용한다.
  산출물 부재는 전부 실패다. 1순위에서 세운 규칙을 새 검사자에도 그대로 적용했다.
- **md-only 강제**: `run-cycle.md` §페이즈 산출물 계약에 **검사자 위치(`lib/phase-gate.mjs`)를 같은 커밋에 적었다.**
  "⛔ 에이전트 페이즈를 no-op 로 건너뛰지 않는다" 가 검사자 있는 강제로 바뀌었다(md-only 강제 5건 중 잔여는 Notion 1건).
- **셀프테스트가 배선을 안 본다**: 순수 함수 검증(`phase-gate.selftest`, 38 체크)과 **배선 검증**을 함께 넣었다 —
  `loop.selftest` 시나리오 H(11 체크)는 실제로 `loop.mjs` 를 반복 호출해 "기록 없으면 멈추고, 기록하면 전진한다" 를
  **상태 전이 결과로** 확인한다(F21 이 초록인 채 죽어 있던 실패를 되풀이하지 않기 위해).

### 남은 것

- 4순위(`verdict.json` — AC 를 루브릭 최대 가중 차원으로)와 5순위(골든 픽스처 CI)는 그대로 대기.
- 계약은 "증거가 **있다**" 만 검사한다. "증거의 **내용이 옳은가**"(토론이 실제로 이견을 다뤘는지 등)는
  여전히 판단의 영역이다 — 검사자를 붙일 수 없는 것은 강제가 아니라 권고로 둔다는 규칙을 지켰다.
