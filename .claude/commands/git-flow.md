# /git-flow — git-flow 오케스트레이션

harness-setup 자율 개발 루프에서 **브랜치 생성 → step 작업 → main 병합**을 관리하는 게이트입니다.
`init-project` 이후, 각 step 작업의 시작·종료 시 호출됩니다.

모든 명령은 `harness/config.json` 의 `skipGitFlow`(= `useGit=false`) 를 먼저 확인하며,
`skipGitFlow=true` 면 **아무 것도 하지 않고(no-op) exit 0** 으로 종료합니다.

## 서브커맨드

### `seed-main` — 조건부 초기 시드

- main 에 커밋이 **없을 때(unborn)** 또는 main 이 없을 때만 초기 시드 커밋을 만듭니다.
  - 전체 스테이징(`git add -A`) 후 `chore: harness 계획 시드` 커밋.
  - 스테이징할 변경이 없으면 `--allow-empty` 로 루트 커밋을 보장합니다.
- **멱등**: main 에 이미 커밋이 있으면 아무 것도 하지 않고 `seed skipped (main already seeded)` 로그만 남깁니다.

### `start-step <nn> <slug>` — step 브랜치 생성

- main 에서 `step/<nn>-<slug>` 브랜치를 만들고 체크아웃합니다.
- 이미 같은 이름의 브랜치가 있으면 체크아웃만 합니다.
- main 이 아직 시드 안됐으면 거부합니다 (먼저 `seed-main` 필요).

### `merge-step <nn> <slug> [--gate-ok]` — done-gate 통과 시 병합

- `step/<nn>-<slug>` 를 `--no-ff` 로 main 에 병합합니다. **단, done-gate 를 통과해야만** 병합합니다.
- 게이트 실패 시 병합을 거부하고 `exit 1` + 사유를 로그로 남깁니다.

## merge-gate (done-gate) 판정 규칙

1. **`scripts/done-gate.mjs` 가 존재하면**: `node scripts/done-gate.mjs` 를 실행해 **exit 0** 이어야 통과.
   (done-gate.mjs 는 US-007 에서 도입 — 그 전까지는 아래 폴백을 사용)
2. **done-gate.mjs 가 없으면(폴백)**: 명시적 승인이 필요합니다.
   - `--gate-ok` 플래그, 또는
   - 환경변수 `HARNESS_GATE_OK=1`
   - 둘 다 없으면 거부.

## 직접 main 작업 차단

- step 작업은 반드시 `start-step` → (step 브랜치에서 작업) → `merge-step` 경로를 거쳐야 합니다.
- 가드 `assertNotDirectMainWork()` 는 **시드 이후 main 브랜치에서 직접 커밋**하려는 시도를 거부(throw)합니다.
- `merge-step` 이 **시드 이후 main 에 쓰기를 하는 유일한 경로**입니다.
- `seed-main` 은 시드 전(unborn) 단계라 예외이며, 가드는 시드 이전에는 통과시킵니다.

## 커밋 메시지 규약 (Conventional Commits 기반)

step 브랜치의 작업 커밋과 게이트 커밋 모두 아래 규약을 따릅니다. (단일 진실 공급원)

```
<type>(<scope>): <subject>

[본문 — 선택: 왜(why) / 영향]
[푸터 — 선택: Refs: harness/decisions/<id>.md, harness/errors/<id>.md]
```

- **type**: `feat`(기능) · `fix`(버그) · `refactor` · `style`(포맷) · `test` · `docs` · `perf` · `build` · `ci` · `chore` · `merge`(병합)
- **scope**(선택): FSD 레이어/슬라이스 또는 step 식별자 — 예: `entities/example`, `shared/ui`, `widgets/example-list`, `step-01`
- **subject**: 한국어, 명령형 톤, 마침표 없이 ~72자 이내. "무엇을" 명확히.
- **본문/푸터**(선택): 협의·오류 로그 참조 — `Refs: harness/decisions/dec-003.md`.
- **원칙**: 1 논리 변경 = 1 커밋. WIP/squash 흔적은 merge 전 정리.

**예시**

```
feat(entities/example): Zustand 스토어 + TanStack Query 목록 훅 추가
fix(widgets/example-list): 로딩 상태에서 빈 배열 렌더 방지
docs(fsd): 스토어 파일명 규약을 <name>.store.ts 로 통일
test(shared/ui): Button 렌더·클릭 테스트 추가
chore: harness 계획 시드            # ← seed-main 이 자동 생성
merge: step/01-login → main          # ← merge-step 이 자동 생성 (--no-ff)
```

**git-flow.mjs 가 자동 생성하는 커밋** (위 규약과 일치)

- `seed-main` → `chore: harness 계획 시드`
- `merge-step` → `merge: step/<nn>-<slug> → main` (`--no-ff` 병합 커밋)

> step 브랜치에서의 **작업 커밋은 사람/오케스트레이터가 위 규약으로 직접 작성**합니다(git-flow.mjs 는 작업 커밋을 만들지 않음). merge-step 은 done-gate 통과 시 병합 커밋만 생성합니다.

## 실행

```bash
# 1) 계획 시드 (멱등 — 재실행 안전)
node scripts/git-flow.mjs seed-main

# 2) step 시작 → step/01-login 브랜치 생성·체크아웃
node scripts/git-flow.mjs start-step 01 login

#    ... step 브랜치에서 작업 + 커밋 ...

# 3) done-gate 통과 시 main 으로 병합
node scripts/git-flow.mjs merge-step 01 login --gate-ok
# 또는
HARNESS_GATE_OK=1 node scripts/git-flow.mjs merge-step 01 login
# done-gate.mjs(US-007) 도입 후에는 플래그 없이 자동 판정
```

## useGit=false 우회

`init-project` 에서 `useGit=false` 로 결정되면 `harness/config.json` 에 `skipGitFlow=true` 가 기록되며,
`seed-main` / `start-step` / `merge-step` 모두 no-op 로그 후 exit 0 으로 빠집니다 (git 미사용 프로젝트 지원).

## 자가 검증

```bash
node scripts/git-flow.selftest.mjs   # 임시 git 저장소에서만 동작, PASS 시 exit 0
```

> selftest 는 `os.tmpdir()` 의 일회용 저장소에서만 실행되며 실제 저장소를 절대 변경하지 않습니다.

## 다음 단계

`merge-gate` 의 자동 판정은 `scripts/done-gate.mjs` (US-007) 도입 후 활성화됩니다.
