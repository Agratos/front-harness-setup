# 프로젝트 검수 보고서 — 2026-06-12

> 전수 검수: 4종 게이트 + 셀프테스트 7종 실행, `src/**`·`scripts/**` 정독 리뷰, 문서·설정 정합성 감사.
> 기준 커밋: `b7708ca` (merge: step/07-entity-scms-style → main)

---

## 1. 게이트 현황 — 전부 통과 ✅

| 게이트 | 결과 |
| --- | --- |
| `yarn typecheck` | ✅ PASS |
| `yarn lint` | ✅ PASS |
| `yarn test:run` (vitest) | ✅ PASS |
| `yarn check:arch` (FSD 경계) | ✅ PASS |
| 셀프테스트 7종 (done-gate · eval · git-flow · state · log · loop · resume) | ✅ 전부 PASS |

빌드를 깨뜨리는 오류는 없음. 아래는 정독 리뷰에서 발견한 결함·개선 대상.

---

## 2. 🔴 우선 수정 (major) — 3건

### 2-1. mutation이 서버 비즈니스 실패를 "성공"으로 처리

- **위치**: `src/shared/lib/react-query/use-mutation-api.ts:38`, `src/shared/lib/api/server-response.ts:53`
- **문제**: `validateServerMutationResponse`가 존재하지만 **어디서도 호출되지 않는 죽은 코드**.
  `mutationFn`이 응답을 검증 없이 반환하므로 서버가 `{resultCode: 800}`(저장 실패) 등을
  내려도 mutation은 resolve되어 `onSuccess`가 실행됨.
- **영향**: 비즈니스 실패가 UI에 성공으로 표시. `ApiError(BUSINESS)` 분기와
  query-client 전역 에러 제외 규칙(`query-client.ts:17`)이 무의미해짐.
- **수정 방향**: `useMutationApi` 내부에서 `axiosApi` 응답에
  `validateServerMutationResponse` 적용.

### 2-2. check-arch.js의 FSD 게이트 우회 구멍

- **위치**: `scripts/check-arch.js:78` (IMPORT_RE), `tsconfig.json:7-12`
- **문제**: `@/` 별칭 임포트만 검사. tsconfig에 정의된 보조 별칭(`@shared/*`,
  `@entities/*` 등)이나 상대경로(`../../features/...`)로 임포트하면 **레이어 위반이
  게이트를 그대로 통과**. 같은 레이어 내 slice 간 임포트(entities/a → entities/b)도 미검출.
- **수정 방향**: 보조 별칭을 tsconfig에서 제거(권장 — `@/` 단일화)하거나
  check-arch에 보조 별칭·상대경로 해석 추가.

### 2-3. 쿼리의 비즈니스 실패가 "빈 목록"으로 위장

- **위치**: `src/shared/lib/api/response-adapter.ts:49` (`selectResult`)
- **문제**: 실패 envelope이면 조용히 fallback 반환 → `isError`는 false,
  화면에는 "표시할 예시 데이터가 없습니다" 표시. **서버 오류와 진짜 빈 데이터를
  구분할 수 없음** (`features/example-list/ui/example-list.tsx` 기준).
- **수정 방향**: 실패 시 `ApiError(BUSINESS)` throw로 react-query 에러 경로에 태우거나,
  최소한 fallback 사용 사실을 로깅/표시.

---

## 3. 🟡 개선 권장 (minor)

### src (앱 코드)

| 위치 | 문제 | 수정 방향 |
| --- | --- | --- |
| `axios-api.ts:63` | 요청마다 axios 인스턴스 새로 생성 (인터셉터 재등록) | 모듈 레벨 인스턴스 2개(인증/비인증) 재사용 |
| `example-update.mutation.ts:34` | `mutate` 래퍼가 두 번째 인자(`MutateOptions` — 호출별 onSuccess/onError) 유실 | 두 번째 인자 전달 |
| `query-api.ts:60`, `use-query-api.ts:30` | 헬퍼의 `staleTime: Infinity`가 query-client 전역 기본(5분)과 충돌 | 의도라면 주석 명시, 아니면 통일 |
| `example-list.types.ts:11` | `registeredAt: string // ISO` 주석과 달리 mapper는 `reg_dt` 무변환 통과 | 변환 추가 또는 주석 수정 |
| `app.test.tsx` | App 렌더 시 실제 queryFn이 네트워크 호출 시도(jsdom) — 스모크만 통과 | fetch/axios mock 권장 |

### scripts (하네스)

| 위치 | 문제 | 수정 방향 |
| --- | --- | --- |
| `done-gate.mjs:123` | `stdio: 'inherit'` → 실패 시 `err.stdout/stderr` 항상 빔 → `harness/errors/<id>.md`에 generic 메시지만 기록 | `stdio: 'pipe'` + 콘솔 echo |
| `eval-playwright.mjs:337,346` | `gatesGreen: true` 하드코딩 → 루브릭 `q.gates-green`(품질 40점) 무조건 통과 | done-gate 결과를 실측 주입 |
| `loop.mjs:256` | 결정적 페이즈 실패에도 항상 `exit 0` — 호출자가 종료코드로 블록 감지 불가 | 실패 시 비-0 또는 상태 코드 체계 |
| `loop.mjs:163` | init→running 전이 시 `checkpointToken` 미재생성 (phase=decompose인데 token=`0-init-0`) | 전이 시 토큰 재생성 |
| `log.mjs:47`, `eval-playwright.mjs:56` | ID가 "파일 개수+1" 기반 — 파일 삭제 시 ID 재사용·덮어쓰기 가능 | 기존 최댓값+1 방식 |
| `demo.mjs:239` | git 추적 중인 `decision-*.md` 삭제 후 재생성 (내용 결정적이라 보통 무해하나 위험) | 삭제 대신 고정 ID 덮어쓰기 |
| `teardown.mjs:64` | Windows에서 taskkill 실패(권한 등)도 `killed: true` 보고 / `isPortInUse` 타임아웃 시 "미점유" 간주 | 실패 사유 구분 보고 |

---

## 4. 🔵 문서·설정 정합성

| 항목 | 내용 | 조치 |
| --- | --- | --- |
| `.github/workflows/ci.yml:37` | `yarn test --run` — 동작은 함(`vitest --run`)이나 `package.json`의 `test:run`과 표기 불일치 | `yarn test:run`으로 통일 |
| `harness/errors/`, `harness/state.json` | 런타임 생성인데 문서(AGENTS.md, state-manifest.md 등)는 상존처럼 기술 | `.gitkeep` 추가 또는 "런타임 생성" 명시 |
| `.claude/agents/*.md` 9종 | 입력으로 `.omc/plans/` 참조 — 어떤 스크립트도 읽지 않음 | 참조 제거 또는 통합 구현 |
| `.claude/agents/README.md` | `release-notes-<id>.md` 산출물 약속 — 미구현 | 제거 또는 구현 |
| 환경변수 문서화 | `HARNESS_GATE_OK` / `HARNESS_EVAL_SCORE` / `HARNESS_EVAL_MAJOR` 누락 | preflight.md 등에 통합 표 추가 |
| tsconfig 구조 | `tsconfig.json`이 `tsconfig.app.json`을 extends하는 역전 구조 + `tsconfig.node.json` 미참조 | 표준 references 구조 검토 |

### 감사 오탐 정정

- "notion-outbox 미구현" 보고는 **오탐** — `scripts/lib/notion.mjs`의 `writeOutbox`가
  `harness/notion-outbox/<id>.json`을 실제로 기록하며 eval 셀프테스트로 검증됨.

---

## 5. ℹ️ 참고

- **미사용 의존성**: `@mantine/*`, `zod`, `react-router-dom`, `mantine-form-zod-resolver`
  — src에서 임포트 0건 (스캐폴드 선설치로 보임).
- **scripts/ 린트 제외**: `eslint.config.js`가 `**/*.{ts,tsx}`만 검사 — `.mjs/.js` 하네스
  스크립트는 ESLint 미적용.
- **CI에 build 단계 없음**: 게이트 4종 + 셀프테스트만 실행, `yarn build`(tsc -b + vite build)는
  미포함.

---

## 6. 권장 수정 순서

1. 🔴 2-1 — mutation 비즈니스 실패 검증 (정합성 핵심)
2. 🔴 2-2 — check-arch 우회 구멍 (하네스 게이트 신뢰성)
3. 🔴 2-3 — selectResult silent fallback
4. 🟡 done-gate 오류 로그 본문 / gatesGreen 실측 / loop exit code
5. 🔵 문서 정합성 일괄 (ci.yml 표기, .gitkeep, 환경변수 표 등)
