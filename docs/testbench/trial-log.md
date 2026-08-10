# 테스트벤치 시행 로그

고정 사양: `harness-setup/docs/testbench/project-manager.md`
규칙: **시행 중에는 하네스를 고치지 않는다.** 발견은 여기 기록만 하고 시행 후 반영한다.

---

## 시행 1 — `pm-trial1`

하네스: main `1bdd9eb` (v3 1단계 안전망 적용)

### 발견

#### T1-1 · 🔴 major — `/start-project` 절차 순서가 브랜치 라이프사이클을 깨뜨림
- **증상**: 문서 순서(`3) loop --init` → `4) git-flow seed-main`)대로 실행하면
  `--init` 이 즉시 decompose 를 실행하며 `start-step` 을 호출 → main 미시드라 **거부** →
  step 01 의 브랜치가 생성되지 않은 채 design 으로 전진. step 01 작업 전체가 main 에서 일어난다.
- **로그**: `[git-flow] start-step 거부: main 이 아직 시드되지 않았습니다` / `(exit 1)` 인데 루프는 전진
- **근본원인**: 두 개가 겹침
  1. `start-project.md` 의 단계 순서가 거꾸로 (seed-main 이 `--init` 뒤에 있음)
  2. `loop.mjs` 가 `start-step` 실패를 로그만 남기고 전진 — "문제는 merge 에서 드러남" 이라는
     주석대로 나중에 드러나지만, 그때는 이미 한 step 전체를 main 에서 작업한 뒤다
- **사람 개입**: 1회 (수동으로 `seed-main` → `start-step` 실행해 복구)
- **Fix 후보**:
  - `start-project.md` 순서 교정: seed-main 을 `--init` **앞**으로
  - `loop.mjs`: `--init` 은 시드만 하고 페이즈를 전진시키지 않음 (진단 F-부수 항목과 동일)
  - `loop.mjs`: `start-step` 실패는 **전진 차단**으로 승격 (브랜치 없이 구현 시작 금지)

#### T1-2 · 🔴 major — 새 프로젝트가 **생성 직후부터 테스트 RED**
- **증상**: `copy-project`(→`reset-project`) 직후 `yarn test:run` 이 1 failed.
  `app.test.tsx` 가 `heading "harness-setup"` 을 기대하는데 `App.tsx` 는 새 이름(`pm-trial1`)으로 치환됐다.
- **근본원인**: `reset-project.mjs` 의 정체성 치환 대상이 `package.json`·`index.html`·`src/app/App.tsx` 뿐.
  **테스트 파일이 치환 목록에서 빠짐.**
- **영향**: 자율 루프가 시작하자마자 결정적 게이트 RED → 첫 verify 실패 → (v3 1단계 기준)
  구현결함으로 분류돼 implement 로 되돌림. **모든 새 프로젝트가 오염된 상태에서 출발한다.**
- **Fix 후보**: `reset-project` 치환 대상에 `src/**/*.test.tsx` 포함. 또는 스모크 테스트가
  이름을 하드코딩하지 않고 `package.json` name 을 읽도록 변경(더 견고).

#### T1-3 · 🟡 minor — 제품 단계 진입 시 MantineProvider 를 수동으로 붙여야 함
- **증상**: 스캐폴드 `providers` 는 QueryClientProvider 만 합성. Mantine 컴포넌트를 쓰려면
  구현 에이전트가 provider 추가를 **스스로 기억해야** 한다(문서에만 있음: `docs/fsd/app.md`).
- **영향**: 잊으면 런타임에 스타일 깨짐. 게이트는 통과한다(타입·테스트 무관).
- **Fix 후보**: 스캐폴드에 MantineProvider 를 미리 포함하거나, 첫 Mantine import 감지 시
  check-arch 류 검사로 provider 존재를 확인.

#### T1-4 · 🔴 major — jsdom 에 `matchMedia` 없음 → Mantine 쓰는 첫 step 에서 테스트 붕괴
- **증상**: `MantineProvider` 를 붙이자 전 렌더 테스트가 `TypeError: window.matchMedia is not a function` 로 실패.
- **근본원인**: `vitest.setup.ts` 가 jest-dom 매처만 등록. Mantine 은 **선언된 의존성**이고
  `docs/fsd/app.md` 는 제품 단계에서 MantineProvider 를 붙이라고 안내하는데,
  그렇게 하는 순간 테스트 환경이 깨진다. `ResizeObserver`(Select 등)도 동일.
- **영향**: UI 를 만드는 **모든** 프로젝트가 첫 화면 구현에서 이 벽을 만난다. 원인이 앱 코드처럼
  보여서(스택이 react/@mantine 내부) 에이전트가 자기 구현을 의심하며 시간을 버린다.
- **Fix 후보**: 스캐폴드 `vitest.setup.ts` 에 matchMedia·ResizeObserver 스텁 기본 포함.

> **T1-3 · T1-4 는 뿌리가 같다** — 스캐폴드가 "제품 단계 진입"을 준비해두지 않았다.
> Mantine 이 의존성에는 있는데 provider 도, CSS import 도, 테스트 환경도 없다.
> 문서로만 "제품 단계에서 추가하라"고 안내한다. **전형적인 md 준수 의존.**

#### T1-5 · 🔴 major — `eval-scenario` 가 페이지 크래시를 진단 불가능하게 보고함
- **증상**: 앱이 입력 도중 크래시(React 언마운트)했는데, 러너 출력은
  `locator.click: Timeout 30000ms exceeded` × 6 뿐. **원인이 어디에도 없다.**
- **실제 원인**: `PAGEERROR: Cannot read properties of null (reading 'value')` —
  러너가 `page.on('pageerror')`/`console` 을 **구독하지 않아** 이 한 줄이 버려졌다.
- **비용**: 원인 규명에 별도 진단 스크립트 작성 필요(사람 개입 1회).
  러너가 pageerror 를 찍었다면 **첫 줄에서 끝날 일**이었다.
- **비교**: `eval-playwright` 는 console/pageerror 를 수집한다(rubric `fn.no-runtime-error`).
  그런데 그쪽은 **조작을 안 하므로** 상호작용 중 크래시를 못 본다.
  → **에러 수집과 조작이 서로 다른 스크립트에 나뉘어 있어 둘 다 놓친다.**
- **Fix 후보**: `eval-scenario` 에 pageerror/console 구독 추가 → 실패 리포트·`scenario.json` 에 포함.

#### T1-6 · 🟡 minor — 크래시 후에도 남은 단계를 계속 실행 (fail-fast 없음)
- **증상**: 앱이 죽은 뒤 남은 6단계가 각각 30초 타임아웃을 소진 → **약 3분 낭비**.
  마지막 `textGone` 단언은 페이지가 비어서 **거짓 통과**까지 했다(count=0 → 기대 0).
- **Fix 후보**: pageerror 감지 또는 `#root` 자식 0 감지 시 시나리오 즉시 중단 + 명시 실패.
  단언별 타임아웃도 30s 는 과함(5s 수준).

#### 🔵 관찰 — E2E 게이트의 가치 실증
`e.currentTarget` 을 setState 업데이터 안에서 읽어 **두 번째 입력에서 앱이 통째로 죽는** 버그가
**typecheck·lint·check-arch·단위테스트 10개를 전부 통과**했다. 오직 E2E 시나리오만 잡았다.
진단 문서 F4(“eval-scenario 가 게이트에 배선되어 있지 않다”)가 실제 사고로 확인된 셈이다.
**지금 구조에서는 이 버그가 그대로 merge 된다** — verify 가 eval-scenario 를 부르지 않으므로.

### 사람 개입 기록

| # | 무엇 | 왜 필요했나 |
| --- | --- | --- |
| 1 | `seed-main` → `start-step` 수동 실행 | T1-1 — 절차 순서 오류로 브랜치 미생성 |
| 2 | `app.test.tsx` 수정 | T1-2 — 새 프로젝트가 테스트 RED 로 출발 |
| 3 | `vitest.setup.ts` 스텁 추가 | T1-4 — Mantine 렌더 불가 |
| 4 | MantineProvider·CSS import 배선 | T1-3 — 스캐폴드 미준비 |

### 계측 (시행 1 최종)

사람 개입 **5** · AC **4/4** · 가짜통과 **0** · 게이트 실패 **2** · 하네스 결함 **6** · 최종 100/major 0

---

## 시행 2 — `pm-trial2`

하네스: main `a922688` (v3 1단계 + 시행 1 발견 6건 반영)

시행 1 대비 기대: 부팅 구간 개입 4회(①②③④)가 0 이 되어야 한다.
⑤(크래시 진단)는 앱 버그를 안 내면 발생하지 않으므로, **부팅 개입 0** 이 이번 시행의 성공 기준이다.

### 시행 1 수정의 효과 (검증)

| 결함 | 시행 1 | 시행 2 | 결과 |
| --- | --- | --- | --- |
| T1-1 절차/브랜치 | `start-step` 실패 → 수동 복구 | `--init` 이 시드만 하고 대기 → 다음 호출에서 `step/01-task-board` **자동 생성** | ✅ 개입 0 |
| T1-2 태생적 RED | 복사 직후 test **1 failed** | 복사 직후 test **5 passed** | ✅ 개입 0 |
| T1-3 MantineProvider | 수동 배선 | 스캐폴드에 **기본 포함** | ✅ 개입 0 |
| T1-4 matchMedia | 수동 스텁 추가 | `vitest.setup` 에 **기본 포함** | ✅ 개입 0 |

### 발견

#### T2-1 · 🟡 minor — Mantine **CSS import** 는 여전히 수동 (T1-3 부분 수정)
- **증상**: 스캐폴드가 `MantineProvider` 는 넣어줬지만 `main.tsx` 의
  `import '@mantine/core/styles.css'` 는 없다. 빠뜨리면 **게이트는 전부 통과하는데 화면만 깨진다**
  (스타일 미적용) — 정확히 루브릭이 못 잡는 종류의 결함.
- **원인**: 시행 1 수정에서 provider·테스트환경만 보고 **CSS 진입점을 빠뜨렸다.**
- **Fix 후보**: 스캐폴드 `main.tsx` 에 CSS import 기본 포함. Mantine 을 안 쓰면 지우면 되므로
  넣어두는 쪽이 비용이 낮다.
- **사람 개입**: 1회

### 계측 (시행 2 최종)

사람 개입 **1** (시행 1: 5) · AC **4/4** · 가짜통과 **0** · 게이트 실패 **0** (시행 1: 2) ·
E2E **첫 시도 PASS, 실패 단언 0** (시행 1: 6→0 재작업 필요) · 하네스 결함 **1** (시행 1: 6)

**해석**: 시행 1의 개입 5회 중 부팅 관련 4회가 전부 사라졌다. 남은 1회는 시행 1 수정이
provider 만 넣고 CSS 진입점을 빠뜨린 **부분 수정**이 원인 — 새 결함이 아니라 같은 결함의 잔여분이다.
"하네스 결함 6 → 1" 은 결함이 줄어든 게 아니라 **부팅 구간이 실제로 조용해졌기 때문**이다.

---

## 시행 3 — `pm-trial3`

하네스: main (v3 1단계 + 시행 1 6건 + 시행 2 T2-1 반영)

성공 기준: **부팅 개입 0**. 스캐폴드가 provider·CSS·jsdom 스텁을 모두 갖춘 채 복사돼야 한다.

### 부팅 실측 — 개입 0 달성 ✅

| 확인 | 결과 |
| --- | --- |
| `--init` 시드 | 전진하지 않고 `decompose` 대기 ✅ |
| 다음 호출 | `decompose` 실행 → `step/01-task-board` **자동 생성** ✅ |
| 스캐폴드 준비도 | `MantineProvider` ✅ · `matchMedia` 스텁 ✅ · Mantine CSS import ✅ |
| 초기 게이트 | typecheck ✅ · lint ✅ · check-arch 0위반 ✅ |
| 구현 후 게이트 | test **10 passed** ✅ (수동 배선 0회) |

**시행 1에서 5회였던 개입이 0회.** 부팅~첫 화면 구간이 조용해졌다.

### 발견

없음 — 이 시행에서 새로 드러난 하네스 결함은 0건.

---

## 시행 4 — `pm-trial4` (설계: 방어 능력 실험)

단순 반복은 정보가 적으므로, **하네스가 스스로 막는지**를 검증하는 실험으로 바꾼다.

### 배경

시행 1에서 실측된 사실: `e.currentTarget` 을 setState 업데이터 안에서 읽어 **두 번째 입력에
앱이 통째로 죽는** 버그가 typecheck·lint·check-arch·**단위테스트 10개**를 전부 통과하고
루브릭 평가마저 **100점/major 0** 을 받았다. 오직 `eval-scenario` 만 잡았는데,
**그 러너를 호출하는 코드가 어디에도 없었다**(md 3곳의 ⛔ 지시뿐).
→ 그 시점의 하네스는 **죽은 앱을 만점으로 병합하는 상태**였다.

### 반영 (시행 4 이전)

`loop.mjs` 의 `verify` 페이즈가 `done-gate --deterministic-only` 통과 후
**`eval-scenario --id=scen-<cycleId>` 를 직접 실행**하고, 단언 실패 시 전진을 차단하도록 코드화.
결함분류: 게이트 green + E2E 실패 = **구현결함 → `implement` 되돌림**.

### 실험 설계

1. 새 복사본에 step 01 을 구현하되 **시행 1의 버그를 그대로 심는다**
   (`setValues((v) => ({ ...v, assignee: e.currentTarget.value }))`).
2. 시나리오 스펙은 동일하게 둔다.
3. `node scripts/loop.mjs` 로 **verify 페이즈를 실행**한다 — 사람이 E2E 를 따로 돌리지 않는다.
4. 판정
   - **성공**: verify 가 실패하고 phase 가 `verify` 에 머물며 로그에 상호작용 실패가 찍힌다
     → 하네스가 md 준수 없이 실제로 방어한다.
   - **실패**: verify 가 통과해 `evaluate` 로 전진한다 → 배선에 구멍이 남아 있다.

### 결과

(진행 중)
